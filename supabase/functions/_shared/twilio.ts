// Shared Twilio helpers for all edge functions.
// Reads credentials from environment variables first (production),
// falls back to system_settings rows for admin-configured UI values.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type TwilioConfig = {
  accountSid: string;
  authToken: string;
  apiKeySid?: string;
  apiKeySecret?: string;
  whatsappFrom?: string;          // "whatsapp:+14155238886" (or bare E.164)
  messagingServiceSid?: string;   // preferred over From when set
};

export const TWILIO_ERROR_CODES: Record<string, string> = {
  "20003": "Authentication credentials rejected by Twilio (check SID / Auth Token or API Key).",
  "21608": "Recipient not on WhatsApp Sandbox allow-list, or number not opted in.",
  "63016": "Message failed — outside 24h session window, template required.",
  "63018": "Rate limit exceeded on WhatsApp channel.",
};

export function getEnv(name: string): string | undefined {
  const v = Deno.env.get(name);
  return v && v.trim() ? v.trim() : undefined;
}

export async function loadTwilioConfig(admin: SupabaseClient): Promise<TwilioConfig> {
  const cfg: TwilioConfig = {
    accountSid: getEnv("TWILIO_ACCOUNT_SID") || "",
    authToken: getEnv("TWILIO_AUTH_TOKEN") || "",
    apiKeySid: getEnv("TWILIO_API_KEY_SID"),
    apiKeySecret: getEnv("TWILIO_API_KEY_SECRET"),
    whatsappFrom: getEnv("TWILIO_WHATSAPP_NUMBER"),
    messagingServiceSid: getEnv("TWILIO_MESSAGING_SERVICE_SID"),
  };

  // Fill any missing pieces from system_settings (backward compatibility with UI form).
  if (!cfg.accountSid || !cfg.authToken || (!cfg.whatsappFrom && !cfg.messagingServiceSid)) {
    const { data } = await admin.from("system_settings").select("key,value").in("key", [
      "twilio_account_sid", "twilio_auth_token", "twilio_whatsapp_from",
      "twilio_messaging_service_sid", "twilio_api_key_sid", "twilio_api_key_secret",
    ]);
    const map: Record<string, string> = {};
    (data || []).forEach((r: any) => { map[r.key] = r.value; });
    cfg.accountSid ||= map.twilio_account_sid || "";
    cfg.authToken ||= map.twilio_auth_token || "";
    cfg.whatsappFrom ||= map.twilio_whatsapp_from;
    cfg.messagingServiceSid ||= map.twilio_messaging_service_sid;
    cfg.apiKeySid ||= map.twilio_api_key_sid;
    cfg.apiKeySecret ||= map.twilio_api_key_secret;
  }
  return cfg;
}

export function validateConfig(cfg: TwilioConfig, opts: { requireFrom?: boolean } = {}): string | null {
  if (!cfg.accountSid) return "TWILIO_ACCOUNT_SID belum diset";
  if (!cfg.authToken) return "TWILIO_AUTH_TOKEN belum diset";
  if (opts.requireFrom && !cfg.messagingServiceSid && !cfg.whatsappFrom) {
    return "TWILIO_MESSAGING_SERVICE_SID atau TWILIO_WHATSAPP_NUMBER belum diset";
  }
  return null;
}

export function basicAuthHeader(cfg: TwilioConfig): string {
  // Prefer API Key auth when configured.
  if (cfg.apiKeySid && cfg.apiKeySecret) {
    return "Basic " + btoa(`${cfg.apiKeySid}:${cfg.apiKeySecret}`);
  }
  return "Basic " + btoa(`${cfg.accountSid}:${cfg.authToken}`);
}

export function toWhatsapp(n: string): string {
  const raw = String(n || "").trim();
  if (!raw) return "";
  if (raw.startsWith("whatsapp:")) return raw;
  let x = raw.replace(/[^\d+]/g, "");
  if (!x.startsWith("+")) {
    // Assume Indonesian default when local
    if (x.startsWith("0")) x = "62" + x.slice(1);
    if (!x.startsWith("62") && x.length <= 12) x = "62" + x;
    x = "+" + x;
  }
  return `whatsapp:${x}`;
}

export function normalizePhone(p: string): string {
  let n = String(p || "").replace(/^whatsapp:/i, "").replace(/[^\d]/g, "");
  if (!n) return "";
  if (n.startsWith("0")) n = "62" + n.slice(1);
  if (!/^\d{7,}$/.test(n)) return "";
  if (!n.startsWith("62") && n.length <= 12) n = "62" + n;
  return n;
}

// Twilio request signature validation
// https://www.twilio.com/docs/usage/webhooks/webhooks-security
export async function validateTwilioSignature(opts: {
  authToken: string;
  url: string;                            // full URL including query
  params: Record<string, string>;         // form params
  signature: string;                      // X-Twilio-Signature header
}): Promise<boolean> {
  try {
    const keys = Object.keys(opts.params).sort();
    let data = opts.url;
    for (const k of keys) data += k + opts.params[k];
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(opts.authToken),
      { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
    const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return b64 === opts.signature;
  } catch {
    return false;
  }
}

export function buildTwilioSignatureUrls(req: Request, functionName: string): string[] {
  const orig = new URL(req.url);
  const envUrl = getEnv("SUPABASE_URL") || "";
  const envHost = envUrl ? new URL(envUrl).host : "";
  const forwardedProto = req.headers.get("x-forwarded-proto") || "https";
  const forwardedHost = req.headers.get("x-forwarded-host") || "";
  const host = req.headers.get("host") || orig.host;
  const pathWithPrefix = orig.pathname.startsWith("/functions/v1/")
    ? orig.pathname
    : `/functions/v1${orig.pathname.startsWith("/") ? orig.pathname : `/${orig.pathname}`}`;
  const canonicalPath = `/functions/v1/${functionName}`;
  const hosts = [forwardedHost, host, envHost, orig.host].filter(Boolean);

  const urls = [
    req.url,
    ...hosts.flatMap((h) => [
      `${forwardedProto}://${h}${pathWithPrefix}${orig.search}`,
      `https://${h}${pathWithPrefix}${orig.search}`,
      `${forwardedProto}://${h}${orig.pathname}${orig.search}`,
      `https://${h}${orig.pathname}${orig.search}`,
      `${forwardedProto}://${h}${canonicalPath}${orig.search}`,
      `https://${h}${canonicalPath}${orig.search}`,
    ]),
  ];

  if (envUrl) {
    const base = envUrl.replace(/\/$/, "");
    urls.push(`${base}${canonicalPath}${orig.search}`);
  }

  return Array.from(new Set(urls));
}

export type SendResult = {
  ok: boolean;
  status: number;
  sid?: string;
  errorCode?: string;
  errorMessage?: string;
  raw?: any;
};

export type ContentSids = {
  agent_assignment: string;
  lead_invitation: string;
  lead_follow_up: string;
};

export async function loadContentSids(admin: SupabaseClient): Promise<ContentSids> {
  const { data } = await admin.from("system_settings").select("key,value").in("key", [
    "twilio_content_sid_agent_assignment",
    "twilio_content_sid_lead_invitation",
    "twilio_content_sid_lead_follow_up",
  ]);
  const m: Record<string, string> = {};
  (data || []).forEach((r: any) => { m[r.key] = r.value; });
  return {
    agent_assignment: m.twilio_content_sid_agent_assignment || "",
    lead_invitation: m.twilio_content_sid_lead_invitation || "",
    lead_follow_up: m.twilio_content_sid_lead_follow_up || "",
  };
}

export function normalizeContentVars(vars: Record<string | number, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  Object.keys(vars).forEach((k) => {
    const v = vars[k];
    const s = v === null || v === undefined || String(v).trim() === "" ? "-" : String(v).trim();
    out[String(k)] = s;
  });
  return out;
}

export async function twilioSendContentTemplate(cfg: TwilioConfig, params: {
  to: string;
  contentSid: string;
  contentVariables: Record<string, string>;
  statusCallback?: string;
}): Promise<SendResult> {
  const err = validateConfig(cfg, { requireFrom: true });
  if (err) return { ok: false, status: 500, errorMessage: err };
  if (!params.contentSid) {
    return { ok: false, status: 400, errorMessage: "Content SID belum dikonfigurasi pada WhatsApp Gateway." };
  }

  const fd = new URLSearchParams();
  fd.append("To", toWhatsapp(params.to));
  if (cfg.messagingServiceSid) fd.append("MessagingServiceSid", cfg.messagingServiceSid);
  else fd.append("From", toWhatsapp(cfg.whatsappFrom!));
  fd.append("ContentSid", params.contentSid);
  fd.append("ContentVariables", JSON.stringify(params.contentVariables));
  if (params.statusCallback) fd.append("StatusCallback", params.statusCallback);

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`;
  const doFetch = (auth: string) => fetch(url, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: fd,
  });

  let res = await doFetch(basicAuthHeader(cfg));
  let data = await res.json().catch(() => ({} as any));

  if ((!res.ok || data?.code === 20003) && cfg.apiKeySid && cfg.apiKeySecret && cfg.authToken) {
    console.log(`[twilio-template] API Key auth failed (${data?.code}), retrying with Auth Token`);
    res = await doFetch("Basic " + btoa(`${cfg.accountSid}:${cfg.authToken}`));
    data = await res.json().catch(() => ({} as any));
  }

  console.log(`[twilio-template] status=${res.status} sid=${params.contentSid} to=${params.to.slice(0, 4)}*** code=${data?.code || "-"}`);
  if (!res.ok || data?.code) {
    const code = data?.code ? String(data.code) : String(res.status);
    return {
      ok: false, status: res.status,
      errorCode: code,
      errorMessage: data?.message || TWILIO_ERROR_CODES[code] || `HTTP ${res.status}`,
      raw: data,
    };
  }
  return { ok: true, status: res.status, sid: data?.sid, raw: data };
}

export async function twilioSendMessage(cfg: TwilioConfig, params: {
  to: string;
  body?: string;
  mediaUrl?: string;
}): Promise<SendResult> {
  const err = validateConfig(cfg, { requireFrom: true });
  if (err) return { ok: false, status: 500, errorMessage: err };

  const fd = new URLSearchParams();
  fd.append("To", toWhatsapp(params.to));
  if (cfg.messagingServiceSid) fd.append("MessagingServiceSid", cfg.messagingServiceSid);
  else fd.append("From", toWhatsapp(cfg.whatsappFrom!));
  if (params.body) fd.append("Body", params.body);
  if (params.mediaUrl) fd.append("MediaUrl", params.mediaUrl);

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`;
  const doFetch = (auth: string) => fetch(url, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: fd,
  });

  let res = await doFetch(basicAuthHeader(cfg));
  let data = await res.json().catch(() => ({} as any));

  // If API Key auth failed with 20003, retry with Account SID + Auth Token
  if ((!res.ok || data?.code === 20003) && cfg.apiKeySid && cfg.apiKeySecret && cfg.authToken) {
    console.log(`[twilio-send] API Key auth failed (${data?.code}), retrying with Auth Token`);
    const fallback = "Basic " + btoa(`${cfg.accountSid}:${cfg.authToken}`);
    res = await doFetch(fallback);
    data = await res.json().catch(() => ({} as any));
  }

  console.log(`[twilio-send] status=${res.status} to=${params.to.slice(0, 4)}*** code=${data?.code || "-"}`);
  if (!res.ok || data?.code) {
    const code = data?.code ? String(data.code) : String(res.status);
    return {
      ok: false, status: res.status,
      errorCode: code,
      errorMessage: data?.message || TWILIO_ERROR_CODES[code] || `HTTP ${res.status}`,
      raw: data,
    };
  }
  return { ok: true, status: res.status, sid: data?.sid, raw: data };

}

export function makeAdmin(): SupabaseClient {
  const url = getEnv("SUPABASE_URL")!;
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
