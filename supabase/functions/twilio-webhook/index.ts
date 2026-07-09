// Twilio Programmable Messaging — inbound WhatsApp webhook.
// Endpoint: POST /functions/v1/twilio-webhook
// Handles: inbound text/media messages, chatbot workflow, media re-hosting.
// Status callbacks live in /functions/v1/twilio-status but this endpoint
// tolerates status posts too (for setups that share a single URL).
import {
  CORS_HEADERS, jsonResponse, loadTwilioConfig, makeAdmin, getEnv, buildTwilioSignatureUrls,
  normalizePhone, twilioSendMessage, validateTwilioSignature, TWILIO_ERROR_CODES,
} from "../_shared/twilio.ts";

function detectMediaType(mime: string, url: string): "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO" | "VOICE" | "STICKER" {
  const m = (mime || "").toLowerCase();
  if (m === "image/webp") return "STICKER";
  if (m.startsWith("image/")) return "IMAGE";
  // WhatsApp voice notes come as audio/ogg (opus)
  if (m === "audio/ogg" || m.includes("opus")) return "VOICE";
  if (m.startsWith("audio/")) return "AUDIO";
  if (m.startsWith("video/")) return "VIDEO";
  const e = (url.split("?")[0].split(".").pop() || "").toLowerCase();
  if (e === "webp") return "STICKER";
  if (/^(jpg|jpeg|png|gif|bmp)$/.test(e)) return "IMAGE";
  if (/^(ogg|opus)$/.test(e)) return "VOICE";
  if (/^(mp3|wav|m4a|aac)$/.test(e)) return "AUDIO";
  if (/^(mp4|mov|3gp|webm)$/.test(e)) return "VIDEO";
  return "DOCUMENT";
}

const STATUS_MAP: Record<string, string> = {
  queued: "SENT", accepted: "SENT", scheduled: "SENT",
  sending: "SENT", sent: "SENT",
  delivered: "DELIVERED", read: "DELIVERED",
  failed: "FAILED", undelivered: "FAILED",
};

function isUniqueViolation(error: any) {
  return error?.code === "23505" || String(error?.message || "").toLowerCase().includes("duplicate key");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method === "GET") {
    return new Response("Twilio webhook ready", { headers: CORS_HEADERS });
  }

  const admin = makeAdmin();

  try {
    // Parse Twilio form-encoded payload
    const ct = req.headers.get("content-type") || "";
    const payload: Record<string, string> = {};
    if (ct.includes("application/json")) {
      const j = await req.json();
      Object.keys(j || {}).forEach((k) => { payload[k] = String(j[k] ?? ""); });
    } else {
      const fd = await req.formData();
      for (const [k, v] of fd.entries()) payload[k] = typeof v === "string" ? v : "";
    }

    // Signature validation (only when we have credentials).
    const cfg = await loadTwilioConfig(admin);
    const signature = req.headers.get("x-twilio-signature") || "";
    const skipVerify = (getEnv("TWILIO_SKIP_SIGNATURE") || "").toLowerCase() === "true";
    if (cfg.authToken && signature && !skipVerify) {
      // Twilio signs the exact public URL configured in the console. The edge
      // runtime can expose a rewritten edge-runtime URL, so also try the
      // canonical backend URL from env plus proxy header variants.
      const candidates = buildTwilioSignatureUrls(req, "twilio-webhook");
      let valid = false;
      for (const url of candidates) {
        if (await validateTwilioSignature({ authToken: cfg.authToken, url, params: payload, signature })) {
          valid = true; break;
        }
      }
      if (!valid) {
        console.warn("[twilio-webhook] invalid signature", { tried: candidates });
        return jsonResponse({ success: false, error: "Invalid Twilio signature" }, 403);
      }
    }

    const messageSid = String(payload.MessageSid || payload.SmsSid || "");
    const messageStatus = String(payload.MessageStatus || payload.SmsStatus || "").toLowerCase();

    // Status callback fallback (if shared URL). Twilio status callbacks can
    // include From/To, so classify by absence of real inbound content instead
    // of From. This prevents delivery receipts from being saved as fake chats.
    if (messageStatus && !rawMessage && numMedia === 0) {
      if (messageSid) {
        const mapped = STATUS_MAP[messageStatus];
        if (mapped) await admin.from("messages").update({ status: mapped }).eq("fonnte_message_id", messageSid);
      }
      return jsonResponse({ success: true, kind: "status-callback", messageStatus });
    }

    const from = payload.From;
    const rawMessage = String(payload.Body || "");
    const message = rawMessage.trim();
    const waName = (payload.ProfileName || "").toString().trim() || null;
    const numMedia = Number(payload.NumMedia || 0);

    if (!from) return jsonResponse({ success: false, error: "no From" }, 400);

    const contactNumber = normalizePhone(from);
    if (!contactNumber || contactNumber.length < 6) {
      return jsonResponse({ success: true, skip: "no-contact-number" });
    }

    // Load active workflow id (still stored in system_settings)
    const { data: wfRow } = await admin.from("system_settings").select("value").eq("key", "active_workflow_id").maybeSingle();
    const activeWorkflowId = wfRow?.value || null;

    // Skip agent phone bounces
    let { data: contact } = await admin.from("contacts").select("*").eq("whatsapp_number", contactNumber).maybeSingle();
    if (!contact) {
      const { data: agentMatch } = await admin.from("profiles").select("id, phone").not("phone", "is", null);
      const agentPhones = new Set((agentMatch || []).map((a: any) => normalizePhone(String(a.phone))));
      if (agentPhones.has(contactNumber)) return jsonResponse({ success: true, skip: "agent-phone" });

      const { data: defaultStage } = await admin.from("stages").select("id").eq("is_default", true).maybeSingle();

      // Ads content code detection
      let contentCodeId: string | null = null;
      let contentProductId: string | null = null;
      let source = "organik";
      if (message) {
        const { data: codes } = await admin.from("content_codes").select("id, code, product_id").eq("is_active", true);
        const upperMsg = message.toUpperCase();
        for (const c of (codes || [])) {
          const raw = String(c.code || "").trim().toUpperCase();
          if (!raw) continue;
          const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const re = new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`);
          if (re.test(upperMsg)) {
            contentCodeId = c.id;
            contentProductId = (c as any).product_id || null;
            source = "ads";
            break;
          }
        }
      }

      const { data: newC, error: newContactError } = await admin.from("contacts").insert({
        whatsapp_number: contactNumber, full_name: waName,
        stage_id: defaultStage?.id || null,
        source, content_code_id: contentCodeId,
        interested_product_id: contentProductId,
        last_interaction_at: new Date().toISOString(), total_messages: 0,
      }).select().single();
      if (newContactError) {
        if (isUniqueViolation(newContactError)) {
          const { data: existingContact, error: existingContactError } = await admin.from("contacts")
            .select("*").eq("whatsapp_number", contactNumber).maybeSingle();
          if (existingContactError || !existingContact) throw existingContactError || newContactError;
          contact = existingContact;
        } else {
          throw newContactError;
        }
      } else {
        contact = newC!;
      }
    } else if (!contact.full_name && waName) {
      await admin.from("contacts").update({ full_name: waName }).eq("id", contact.id);
      contact.full_name = waName;
    }

    let { data: conv } = await admin.from("conversations").select("*")
      .eq("contact_id", contact.id).eq("status", "OPEN")
      .order("created_at", { ascending: false }).maybeSingle();
    if (!conv) {
      const { data: newConv, error: newConvError } = await admin.from("conversations").insert({
        contact_id: contact.id, status: "OPEN",
        first_inbound_at: new Date().toISOString(),
      }).select().single();
      if (newConvError) throw newConvError;
      conv = newConv!;
    }

    // Dedupe by MessageSid
    if (messageSid) {
      const { data: dup } = await admin.from("messages").select("id")
        .eq("fonnte_message_id", messageSid).limit(1).maybeSingle();
      if (dup) return jsonResponse({ success: true, skip: "duplicate-id" });
    }

    // Media: download with Twilio auth, re-host in storage
    let storedMediaUrl: string | null = null;
    let mediaMime = "";
    if (numMedia > 0 && cfg.accountSid && cfg.authToken) {
      try {
        const mUrl = String(payload.MediaUrl0 || "");
        mediaMime = String(payload.MediaContentType0 || "");
        if (mUrl) {
          const basic = "Basic " + btoa(`${cfg.accountSid}:${cfg.authToken}`);
          const mres = await fetch(mUrl, { headers: { Authorization: basic }, redirect: "follow" });
          if (mres.ok) {
            const buf = new Uint8Array(await mres.arrayBuffer());
            const ext = (mediaMime.split("/")[1] || "bin").split(";")[0];
            const path = `inbound/${contact.id}/${Date.now()}.${ext}`;
            const { error: upErr } = await admin.storage.from("chat-media").upload(path, buf, {
              contentType: mediaMime || "application/octet-stream", upsert: false,
            });
            if (!upErr) {
              const { data: signed } = await admin.storage.from("chat-media")
                .createSignedUrl(path, 60 * 60 * 24 * 365);
              storedMediaUrl = signed?.signedUrl || null;
            } else {
              console.error("[twilio-webhook] media upload err", upErr);
            }
          } else {
            console.error("[twilio-webhook] media download failed", mres.status);
          }
        }
      } catch (e) {
        console.error("[twilio-webhook] media handler err", e);
      }
    }

    const msgType = storedMediaUrl ? detectMediaType(mediaMime, storedMediaUrl) : "TEXT";
    const nowIso = new Date().toISOString();
    const preview = (message || (storedMediaUrl ? "(attachment)" : "Pesan masuk")).slice(0, 100);
    const insert: any = {
      conversation_id: conv.id, direction: "INBOUND", type: msgType,
      content: message || (storedMediaUrl ? "(attachment)" : "Pesan masuk"),
      status: "DELIVERED", media_url: storedMediaUrl,
      sent_at: nowIso,
    };
    if (messageSid) insert.fonnte_message_id = messageSid;
    const { error: msgError } = await admin.from("messages").insert(insert);
    if (msgError) {
      if (isUniqueViolation(msgError)) return jsonResponse({ success: true, skip: "duplicate-id" });
      throw msgError;
    }

    const { error: convUpdateError } = await admin.from("conversations").update({
      last_message_at: nowIso,
      last_message_preview: preview,
      unread_count: (conv.unread_count || 0) + 1,
      first_inbound_at: conv.first_inbound_at || nowIso,
    }).eq("id", conv.id);
    if (convUpdateError) throw convUpdateError;

    const { error: contactUpdateError } = await admin.from("contacts").update({
      last_interaction_at: nowIso,
      total_messages: (contact.total_messages || 0) + 1,
    }).eq("id", contact.id);
    if (contactUpdateError) throw contactUpdateError;

    if (contact.chatbot_state !== "done" && activeWorkflowId && message) {
      await runWorkflow(admin, contact, message, conv.id, activeWorkflowId, cfg);
    }

    console.log(`[twilio-webhook] inbound saved sid=${messageSid || "-"} contact=${contact.id} conv=${conv.id} type=${msgType}`);
    return jsonResponse({ success: true, conversation_id: conv.id });
  } catch (e) {
    console.error("[twilio-webhook] fatal", e);
    return jsonResponse({ success: false, error: String(e), twilio_message: TWILIO_ERROR_CODES["500"] }, 500);
  }
});

// ---------- chatbot workflow (unchanged behavior, uses Twilio for replies) ----------
async function runWorkflow(admin: any, contact: any, message: string, convId: string, workflowId: string, cfg: any) {
  const { data: wf } = await admin.from("workflows").select("id,status,is_enabled").eq("id", workflowId).maybeSingle();
  if (!wf || wf.status !== "published" || !wf.is_enabled) return;
  const { data: steps } = await admin.from("workflow_steps").select("*").eq("workflow_id", workflowId).order("position");
  if (!steps?.length) return;

  let state = contact.chatbot_state as string | null;
  const data = (contact.chatbot_data as any) || {};
  const contactUpdates: any = {};

  const findIndex = (id: string | null) => id ? steps.findIndex((s: any) => s.id === id) : -1;
  let idx = findIndex(state);

  if (state && idx < 0) {
    await admin.from("contacts").update({ chatbot_state: "done" }).eq("id", contact.id);
    return;
  }

  if (idx >= 0) {
    const cur = steps[idx];
    const result = await consumeAnswer(admin, cur, message);
    if (!result.ok) { await sendReply(admin, contact, convId, result.error || "Mohon coba lagi.", cfg); return; }
    data[cur.id] = result.value;
    if (cur.mapping) applyMapping(contactUpdates, cur.mapping, result.value);
    idx += 1;
  } else {
    idx = 0;
  }

  while (idx < steps.length) {
    const step = steps[idx];
    if (step.type === "conditional") {
      const branch = (step.config?.branches || []).find((b: any) => {
        const ans = String(data[b.if_step_id] ?? "");
        if (b.op === "contains") return ans.toLowerCase().includes(String(b.value || "").toLowerCase());
        return ans.toLowerCase() === String(b.value || "").toLowerCase();
      });
      if (branch?.goto_step_id) { idx = findIndex(branch.goto_step_id); if (idx < 0) break; }
      else { idx++; }
      continue;
    }
    if (step.type === "message") {
      await sendReply(admin, contact, convId, await renderPrompt(admin, step, data), cfg);
      idx++; continue;
    }
    if (step.type === "closing") {
      await sendReply(admin, contact, convId, await renderPrompt(admin, step, data), cfg);
      contactUpdates.chatbot_state = "done"; contactUpdates.chatbot_data = data;
      await admin.from("contacts").update(contactUpdates).eq("id", contact.id);
      return;
    }
    await sendReply(admin, contact, convId, await renderPrompt(admin, step, data), cfg);
    contactUpdates.chatbot_state = step.id; contactUpdates.chatbot_data = data;
    await admin.from("contacts").update(contactUpdates).eq("id", contact.id);
    return;
  }
  contactUpdates.chatbot_state = "done"; contactUpdates.chatbot_data = data;
  await admin.from("contacts").update(contactUpdates).eq("id", contact.id);
}

function applyMapping(updates: any, mapping: string, value: any) {
  const [table, field] = mapping.split(".");
  if (table !== "contacts" || !field) return;
  const NUMERIC = new Set(["age", "estimated_revenue"]);
  const UUID = new Set(["interested_product_id"]);
  if (NUMERIC.has(field)) {
    const n = Number(String(value).replace(/[^\d.-]/g, ""));
    if (Number.isFinite(n)) updates[field] = n; return;
  }
  if (UUID.has(field)) {
    const s = String(value || "").trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) updates[field] = s;
    return;
  }
  updates[field] = value;
}

async function renderPrompt(admin: any, step: any, _data: any): Promise<string> {
  let text = step.prompt || step.label || "";
  const meta = step.config || {};
  if ((step.type === "dropdown" || step.type === "radio" || step.type === "checkbox") && meta.source !== "products") {
    const opts: string[] = meta.options || [];
    text += "\n\n" + opts.map((o, i) => `${i + 1}. ${o}`).join("\n");
    if (step.type === "checkbox") text += "\n\n(Boleh pilih lebih dari satu, pisahkan dengan koma — contoh: 1,3)";
  }
  if ((step.type === "dropdown" || step.type === "radio") && meta.source === "products") {
    const { data: products } = await admin.from("products").select("id,name").eq("is_active", true).order("sort_order").limit(20);
    text += "\n\n" + (products || []).map((p: any, i: number) => `${i + 1}. ${p.name}`).join("\n");
  }
  return text;
}

async function consumeAnswer(admin: any, step: any, message: string) {
  const cfg = step.config || {};
  const msg = message.trim();
  if (!msg) return { ok: false, error: "Mohon kirim jawaban Anda." };
  switch (step.type) {
    case "input_text": case "textarea": return { ok: true, value: msg };
    case "email":
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(msg)) return { ok: false, error: "Format email tidak valid." };
      return { ok: true, value: msg.toLowerCase() };
    case "phone":
      if (!/^[+\d][\d\s\-]{6,}$/.test(msg)) return { ok: false, error: "Nomor telepon tidak valid." };
      return { ok: true, value: msg };
    case "number": {
      const n = Number(msg.replace(/[^\d.-]/g, ""));
      if (!Number.isFinite(n)) return { ok: false, error: "Mohon kirim angka." };
      return { ok: true, value: n };
    }
    case "date":
      if (!/\d{1,4}[\/\-]\d{1,2}([\/\-]\d{1,4})?/.test(msg)) return { ok: false, error: "Format tanggal tidak dikenali." };
      return { ok: true, value: msg };
    case "file": return { ok: true, value: msg };
    case "dropdown": case "radio": {
      let options: { id?: string; name: string }[] = [];
      if (cfg.source === "products") {
        const { data: products } = await admin.from("products").select("id,name").eq("is_active", true).order("sort_order").limit(20);
        options = (products || []).map((p: any) => ({ id: p.id, name: p.name }));
      } else {
        options = (cfg.options || []).map((o: string) => ({ name: o }));
      }
      const idx = parseInt(msg, 10);
      if (!Number.isInteger(idx) || idx < 1 || idx > options.length) {
        return { ok: false, error: "Mohon pilih salah satu opsi yang tersedia." };
      }
      const pick = options[idx - 1];
      return { ok: true, value: pick.id || pick.name };
    }
    case "checkbox": {
      const options: string[] = cfg.options || [];
      const picks = msg.split(/[,\s]+/).map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n >= 1 && n <= options.length);
      if (!picks.length) return { ok: false, error: "Mohon kirim nomor pilihan, contoh: 1,3" };
      return { ok: true, value: picks.map((i) => options[i - 1]).join(", ") };
    }
    default: return { ok: true, value: msg };
  }
}

async function sendReply(admin: any, contact: any, convId: string, text: string, cfg: any) {
  if (!text) return;
  const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: recent } = await admin.from("messages").select("id,content")
    .eq("conversation_id", convId).eq("direction", "OUTBOUND")
    .gte("sent_at", tenMinAgo).order("sent_at", { ascending: false }).limit(1).maybeSingle();
  if (recent && recent.content === text) return;
  try {
    const send = await twilioSendMessage(cfg, { to: contact.whatsapp_number, body: text });
    await admin.from("messages").insert({
      conversation_id: convId, direction: "OUTBOUND", type: "TEXT",
      content: text, status: send.ok ? "SENT" : "FAILED",
      fonnte_message_id: send.sid || null,
    });
    await admin.from("conversations").update({
      last_message_at: new Date().toISOString(),
      last_message_preview: text.slice(0, 100),
    }).eq("id", convId);
  } catch (e) {
    console.error("[twilio-webhook] auto-reply err", e);
  }
}
