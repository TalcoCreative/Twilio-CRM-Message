// Server-only Twilio helpers for TanStack server routes.
// Mirrors supabase/functions/_shared/twilio.ts (Deno) for the Worker runtime.
import type { SupabaseClient } from '@supabase/supabase-js';

export type TwilioConfig = {
  accountSid: string;
  authToken: string;
  apiKeySid?: string;
  apiKeySecret?: string;
  whatsappFrom?: string;
  messagingServiceSid?: string;
};

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export async function loadTwilioConfig(admin: SupabaseClient): Promise<TwilioConfig> {
  const cfg: TwilioConfig = {
    accountSid: env('TWILIO_ACCOUNT_SID') || '',
    authToken: env('TWILIO_AUTH_TOKEN') || '',
    apiKeySid: env('TWILIO_API_KEY_SID'),
    apiKeySecret: env('TWILIO_API_KEY_SECRET'),
    whatsappFrom: env('TWILIO_WHATSAPP_NUMBER'),
    messagingServiceSid: env('TWILIO_MESSAGING_SERVICE_SID'),
  };

  const { data } = await admin.from('system_settings').select('key,value').in('key', [
    'twilio_account_sid', 'twilio_auth_token', 'twilio_whatsapp_from',
    'twilio_messaging_service_sid', 'twilio_api_key_sid', 'twilio_api_key_secret',
  ]);
  const map: Record<string, string> = {};
  (data || []).forEach((r: any) => { if (r.value) map[r.key] = r.value; });
  cfg.accountSid ||= map['twilio_account_sid'] || '';
  cfg.authToken ||= map['twilio_auth_token'] || '';
  cfg.whatsappFrom ||= map['twilio_whatsapp_from'];
  cfg.messagingServiceSid ||= map['twilio_messaging_service_sid'];
  cfg.apiKeySid ||= map['twilio_api_key_sid'];
  cfg.apiKeySecret ||= map['twilio_api_key_secret'];
  return cfg;
}

export function basicAuthHeader(cfg: TwilioConfig): string {
  if (cfg.apiKeySid && cfg.apiKeySecret) {
    return 'Basic ' + btoa(`${cfg.apiKeySid}:${cfg.apiKeySecret}`);
  }
  return 'Basic ' + btoa(`${cfg.accountSid}:${cfg.authToken}`);
}

function applyIdPrefix(digits: string): string {
  const n = digits;
  if (n.startsWith('0')) return '62' + n.slice(1);
  if (n.startsWith('62')) return n;
  if (n.startsWith('8')) return '62' + n;
  return n;
}

export function normalizePhone(p: string): string {
  const hadPlus = /^\s*(whatsapp:)?\+/i.test(String(p || ''));
  const n = String(p || '').replace(/^whatsapp:/i, '').replace(/[^\d]/g, '');
  if (!n) return '';
  if (!/^\d{7,15}$/.test(n)) return '';
  if (hadPlus) return n;
  return applyIdPrefix(n);
}

export function toWhatsapp(n: string): string {
  const raw = String(n || '').trim();
  if (!raw) return '';
  if (raw.startsWith('whatsapp:')) return raw;
  let x = raw.replace(/[^\d+]/g, '');
  if (!x.startsWith('+')) x = '+' + applyIdPrefix(x.replace(/\D/g, ''));
  return `whatsapp:${x}`;
}

export async function twilioGet(cfg: TwilioConfig, url: string) {
  const doFetch = (auth: string) => fetch(url, { headers: { Authorization: auth } });
  let res = await doFetch(basicAuthHeader(cfg));
  let data: any = await res.json().catch(() => ({}));
  if ((!res.ok || data?.code === 20003) && cfg.apiKeySid && cfg.apiKeySecret && cfg.authToken) {
    res = await doFetch('Basic ' + btoa(`${cfg.accountSid}:${cfg.authToken}`));
    data = await res.json().catch(() => ({}));
  }
  return { ok: res.ok && !data?.code, status: res.status, data };
}

export async function twilioFetchRaw(cfg: TwilioConfig, url: string) {
  const res = await fetch(url, { headers: { Authorization: basicAuthHeader(cfg) }, redirect: 'follow' });
  if (res.ok) return res;
  if (cfg.apiKeySid && cfg.apiKeySecret && cfg.authToken) {
    return fetch(url, {
      headers: { Authorization: 'Basic ' + btoa(`${cfg.accountSid}:${cfg.authToken}`) },
      redirect: 'follow',
    });
  }
  return res;
}

export type MsgType = 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'VIDEO' | 'VOICE' | 'STICKER' | 'TEXT';

export function detectMediaType(mime: string, url: string): MsgType {
  const m = (mime || '').toLowerCase();
  if (m === 'image/webp') return 'STICKER';
  if (m.startsWith('image/')) return 'IMAGE';
  if (m === 'audio/ogg' || m.includes('opus')) return 'VOICE';
  if (m.startsWith('audio/')) return 'AUDIO';
  if (m.startsWith('video/')) return 'VIDEO';
  const e = (url.split('?')[0]?.split('.').pop() || '').toLowerCase();
  if (e === 'webp') return 'STICKER';
  if (/^(jpg|jpeg|png|gif|bmp)$/.test(e)) return 'IMAGE';
  if (/^(ogg|opus)$/.test(e)) return 'VOICE';
  if (/^(mp3|wav|m4a|aac)$/.test(e)) return 'AUDIO';
  if (/^(mp4|mov|3gp|webm)$/.test(e)) return 'VIDEO';
  return 'DOCUMENT';
}

export const TWILIO_STATUS_MAP: Record<string, string> = {
  queued: 'SENT', accepted: 'SENT', scheduled: 'SENT', sending: 'SENT', sent: 'SENT',
  delivered: 'DELIVERED', read: 'DELIVERED', received: 'DELIVERED',
  failed: 'FAILED', undelivered: 'FAILED',
};

export function isUniqueViolation(error: any) {
  return error?.code === '23505'
    || String(error?.message || '').toLowerCase().includes('duplicate key');
}
