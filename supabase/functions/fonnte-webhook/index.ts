// Public webhook receiver for Twilio incoming WhatsApp messages.
// Kept at path "fonnte-webhook" for backward compatibility of external webhook URL.
// Also handles Twilio status callbacks (MessageStatus updates).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function normalizePhone(p: string): string {
  let n = String(p || "").replace(/^whatsapp:/i, "").replace(/[^\d]/g, "");
  if (n.startsWith("0")) n = "62" + n.slice(1);
  if (!n) return "";
  if (!/^\d{7,}$/.test(n)) return "";
  if (!n.startsWith("62") && n.length <= 12) n = "62" + n;
  return n;
}

function detectMediaType(mime: string, url: string): "IMAGE" | "DOCUMENT" | "AUDIO" {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return "IMAGE";
  if (m.startsWith("audio/")) return "AUDIO";
  const e = (url.split("?")[0].split(".").pop() || "").toLowerCase();
  if (/^(jpg|jpeg|png|gif|webp|bmp)$/.test(e)) return "IMAGE";
  if (/^(mp3|ogg|wav|m4a|opus|aac)$/.test(e)) return "AUDIO";
  return "DOCUMENT";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET") return new Response("Twilio webhook ready", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const json = (d: any, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    let payload: Record<string, any> = {};
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) payload = await req.json();
    else {
      const fd = await req.formData();
      for (const [k, v] of fd.entries()) payload[k] = typeof v === "string" ? v : "";
    }

    // Status callback (delivery receipts) — update message status if we tracked SID
    const messageStatus = String(payload.MessageStatus || payload.SmsStatus || "").toLowerCase();
    const messageSid = String(payload.MessageSid || payload.SmsSid || "");
    if (messageStatus && !payload.Body && !payload.NumMedia) {
      if (messageSid) {
        const statusMap: Record<string, string> = {
          queued: "SENT", sending: "SENT", sent: "SENT",
          delivered: "DELIVERED", read: "DELIVERED",
          failed: "FAILED", undelivered: "FAILED",
        };
        const mapped = statusMap[messageStatus];
        if (mapped) await admin.from("messages").update({ status: mapped }).eq("fonnte_message_id", messageSid);
      }
      return json({ ok: true, kind: "status-callback", messageStatus });
    }

    const from = payload.From || payload.from;
    const to = payload.To || payload.to;
    const rawMessage = String(payload.Body || payload.body || "");
    const message = rawMessage.trim();
    const waName = (payload.ProfileName || payload.WaId || "").toString().trim() || null;
    const numMedia = Number(payload.NumMedia || 0);

    if (!from) return json({ ok: false, error: "no From" }, 400);

    const contactNumber = normalizePhone(String(from));
    if (!contactNumber || contactNumber.length < 6) return json({ ok: true, skip: "no-contact-number" });

    // Load Twilio settings for potential outbound bot replies & auth for media download
    const { data: settingsRows } = await admin.from("system_settings").select("key,value")
      .in("key", ["twilio_account_sid", "twilio_auth_token", "twilio_whatsapp_from", "active_workflow_id"]);
    const settings: Record<string, string> = {};
    (settingsRows || []).forEach((r: any) => { settings[r.key] = r.value; });

    // Skip agent phone bounces
    let { data: contact } = await admin.from("contacts").select("*").eq("whatsapp_number", contactNumber).maybeSingle();
    if (!contact) {
      const { data: agentMatch } = await admin.from("profiles").select("id, phone").not("phone", "is", null);
      const agentPhones = new Set((agentMatch || []).map((a: any) => normalizePhone(String(a.phone))));
      if (agentPhones.has(contactNumber)) return json({ ok: true, skip: "agent-phone" });

      const { data: defaultStage } = await admin.from("stages").select("id").eq("is_default", true).maybeSingle();

      // Detect ads content code from opening message
      let contentCodeId: string | null = null;
      let contentProductId: string | null = null;
      let source = "organik";
      if (message) {
        const { data: codes } = await admin.from("content_codes").select("id, code, product_id").eq("is_active", true);
        const upperMsg = String(message).toUpperCase();
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

      const { data: newC } = await admin.from("contacts").insert({
        whatsapp_number: contactNumber, full_name: waName, stage_id: defaultStage?.id || null,
        source, content_code_id: contentCodeId,
        interested_product_id: contentProductId,
        last_interaction_at: new Date().toISOString(), total_messages: 0,
      }).select().single();
      contact = newC!;
    } else if (!contact.full_name && waName) {
      await admin.from("contacts").update({ full_name: waName }).eq("id", contact.id);
      contact.full_name = waName;
    }

    let { data: conv } = await admin.from("conversations").select("*").eq("contact_id", contact.id).eq("status", "OPEN").order("created_at", { ascending: false }).maybeSingle();
    if (!conv) {
      const { data: newConv } = await admin.from("conversations").insert({
        contact_id: contact.id, status: "OPEN",
        first_inbound_at: new Date().toISOString(),
      }).select().single();
      conv = newConv!;
    }

    // Duplicate guard by MessageSid
    if (messageSid) {
      const { data: dup } = await admin.from("messages").select("id").eq("fonnte_message_id", messageSid).limit(1).maybeSingle();
      if (dup) return json({ ok: true, skip: "duplicate-id" });
    }

    // Handle media: Twilio media URLs require Basic auth; download and re-host in storage
    let storedMediaUrl: string | null = null;
    let mediaMime = "";
    if (numMedia > 0 && settings.twilio_account_sid && settings.twilio_auth_token) {
      try {
        const mUrl = String(payload.MediaUrl0 || "");
        mediaMime = String(payload.MediaContentType0 || "");
        if (mUrl) {
          const basic = btoa(`${settings.twilio_account_sid}:${settings.twilio_auth_token}`);
          const mres = await fetch(mUrl, { headers: { Authorization: `Basic ${basic}` }, redirect: "follow" });
          if (mres.ok) {
            const buf = new Uint8Array(await mres.arrayBuffer());
            const ext = mediaMime.startsWith("image/") ? mediaMime.split("/")[1]
              : mediaMime.startsWith("audio/") ? mediaMime.split("/")[1]
              : (mediaMime.split("/")[1] || "bin");
            const path = `inbound/${contact.id}/${Date.now()}.${ext}`;
            const { error: upErr } = await admin.storage.from("chat-media").upload(path, buf, {
              contentType: mediaMime || "application/octet-stream",
              upsert: false,
            });
            if (!upErr) {
              const { data: signed } = await admin.storage.from("chat-media").createSignedUrl(path, 60 * 60 * 24 * 365);
              storedMediaUrl = signed?.signedUrl || null;
            }
          }
        }
      } catch (e) {
        console.error("media download err", e);
      }
    }

    const msgType = storedMediaUrl ? detectMediaType(mediaMime, storedMediaUrl) : "TEXT";
    const insert: any = {
      conversation_id: conv.id, direction: "INBOUND", type: msgType,
      content: message || (storedMediaUrl ? "(attachment)" : ""),
      status: "DELIVERED", media_url: storedMediaUrl,
    };
    if (messageSid) insert.fonnte_message_id = messageSid;
    await admin.from("messages").insert(insert);

    await admin.from("conversations").update({
      last_message_at: new Date().toISOString(),
      last_message_preview: (message || "(attachment)").slice(0, 100),
      unread_count: (conv.unread_count || 0) + 1,
      first_inbound_at: conv.first_inbound_at || new Date().toISOString(),
    }).eq("id", conv.id);

    await admin.from("contacts").update({
      last_interaction_at: new Date().toISOString(),
      total_messages: (contact.total_messages || 0) + 1,
    }).eq("id", contact.id);

    if (contact.chatbot_state !== "done" && settings.active_workflow_id && message) {
      await runWorkflow(admin, contact, message, conv.id, settings);
    }

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String(e) }, 500);
  }
});

async function sendViaTwilio(settings: Record<string, string>, toNumber: string, text: string): Promise<string | null> {
  const sid = settings.twilio_account_sid, tok = settings.twilio_auth_token, from = settings.twilio_whatsapp_from;
  if (!sid || !tok || !from) return null;
  const toWa = (n: string) => {
    let x = String(n).replace(/^whatsapp:/i, "").replace(/[^\d+]/g, "");
    if (!x.startsWith("+")) x = "+" + x.replace(/^\+*/, "");
    return `whatsapp:${x}`;
  };
  const fromWa = from.startsWith("whatsapp:") ? from
    : `whatsapp:${from.startsWith("+") ? from : "+" + from.replace(/[^\d]/g, "")}`;
  const fd = new URLSearchParams();
  fd.append("From", fromWa);
  fd.append("To", toWa(toNumber));
  fd.append("Body", text);
  const basic = btoa(`${sid}:${tok}`);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: fd,
  });
  const data = await res.json().catch(() => ({} as any));
  return data?.sid ? String(data.sid) : null;
}

async function runWorkflow(admin: any, contact: any, message: string, convId: string, settings: Record<string, string>) {
  const workflowId = settings.active_workflow_id;
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
    if (!result.ok) {
      await sendReply(admin, contact, convId, result.error || "Mohon coba lagi.", settings);
      return;
    }
    data[cur.id] = result.value;
    if (cur.mapping) applyMapping(contactUpdates, cur.mapping, result.value);
    idx = idx + 1;
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
      const text = await renderPrompt(admin, step, data);
      await sendReply(admin, contact, convId, text, settings);
      idx++; continue;
    }

    if (step.type === "closing") {
      const text = await renderPrompt(admin, step, data);
      await sendReply(admin, contact, convId, text, settings);
      contactUpdates.chatbot_state = "done";
      contactUpdates.chatbot_data = data;
      await admin.from("contacts").update(contactUpdates).eq("id", contact.id);
      return;
    }

    const prompt = await renderPrompt(admin, step, data);
    await sendReply(admin, contact, convId, prompt, settings);
    contactUpdates.chatbot_state = step.id;
    contactUpdates.chatbot_data = data;
    await admin.from("contacts").update(contactUpdates).eq("id", contact.id);
    return;
  }

  contactUpdates.chatbot_state = "done";
  contactUpdates.chatbot_data = data;
  await admin.from("contacts").update(contactUpdates).eq("id", contact.id);
}

function applyMapping(updates: any, mapping: string, value: any) {
  const [table, field] = mapping.split(".");
  if (table !== "contacts" || !field) return;
  const NUMERIC = new Set(["age", "estimated_revenue"]);
  const UUID = new Set(["interested_product_id"]);
  if (NUMERIC.has(field)) {
    const n = Number(String(value).replace(/[^\d.-]/g, ""));
    if (Number.isFinite(n)) updates[field] = n;
    return;
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

async function consumeAnswer(admin: any, step: any, message: string): Promise<{ ok: boolean; value?: any; error?: string }> {
  const cfg = step.config || {};
  const msg = message.trim();
  if (!msg) return { ok: false, error: "Mohon kirim jawaban Anda." };

  switch (step.type) {
    case "input_text":
    case "textarea":
      return { ok: true, value: msg };
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
    case "file":
      return { ok: true, value: msg };
    case "dropdown":
    case "radio": {
      let options: { id?: string; name: string }[] = [];
      if (cfg.source === "products") {
        const { data: products } = await admin.from("products").select("id,name").eq("is_active", true).order("sort_order").limit(20);
        options = (products || []).map((p: any) => ({ id: p.id, name: p.name }));
      } else {
        options = (cfg.options || []).map((o: string) => ({ name: o }));
      }
      const idx = parseInt(msg, 10);
      if (!Number.isInteger(idx) || idx < 1 || idx > options.length) {
        return { ok: false, error: `Mohon pilih salah satu opsi yang tersedia.` };
      }
      const pick = options[idx - 1];
      return { ok: true, value: pick.id || pick.name };
    }
    case "checkbox": {
      const options: string[] = cfg.options || [];
      const picks = msg.split(/[,\s]+/).map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n >= 1 && n <= options.length);
      if (!picks.length) return { ok: false, error: `Mohon kirim nomor pilihan, contoh: 1,3` };
      return { ok: true, value: picks.map((i) => options[i - 1]).join(", ") };
    }
    default:
      return { ok: true, value: msg };
  }
}

async function sendReply(admin: any, contact: any, convId: string, text: string, settings: Record<string, string>) {
  if (!text) return;
  const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: recent } = await admin.from("messages").select("id,content")
    .eq("conversation_id", convId).eq("direction", "OUTBOUND")
    .gte("sent_at", tenMinAgo).order("sent_at", { ascending: false }).limit(1).maybeSingle();
  if (recent && recent.content === text) return;

  try {
    const sid = await sendViaTwilio(settings, contact.whatsapp_number, text);
    await admin.from("messages").insert({
      conversation_id: convId, direction: "OUTBOUND", type: "TEXT",
      content: text, status: "SENT", fonnte_message_id: sid,
    });
    await admin.from("conversations").update({
      last_message_at: new Date().toISOString(),
      last_message_preview: text.slice(0, 100),
    }).eq("id", convId);
  } catch (e) {
    console.error("send err", e);
  }
}
