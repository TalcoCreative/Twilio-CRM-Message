// Twilio history backfill: import inbound WhatsApp messages that never reached
// the webhook (e.g. Cloud downtime) and re-sync outbound delivery statuses.
import { createFileRoute } from '@tanstack/react-router';
import { createClient } from '@supabase/supabase-js';
import {
  loadTwilioConfig, twilioGet, twilioFetchRaw, normalizePhone, toWhatsapp,
  detectMediaType, TWILIO_STATUS_MAP, isUniqueViolation, type MsgType,
} from '@/lib/twilio.server';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
  });
}

export const Route = createFileRoute('/api/twilio-backfill')({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
        },
      }),
      POST: async ({ request }) => {
        const SUPABASE_URL = process.env['SUPABASE_URL']!;
        const PUBLISHABLE = process.env['SUPABASE_PUBLISHABLE_KEY'] || process.env['SUPABASE_ANON_KEY']!;

        const token = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
        if (!token) return json({ success: false, error: 'Unauthorized' }, 401);

        const userClient = createClient(SUPABASE_URL, PUBLISHABLE, {
          auth: { persistSession: false },
          global: { headers: { Authorization: `Bearer ${token}`, apikey: PUBLISHABLE } },
        });
        const { data: userRes } = await userClient.auth.getUser();
        const user = userRes?.user;
        if (!user) return json({ success: false, error: 'Unauthorized' }, 401);

        const { supabaseAdmin: admin } = await import('@/integrations/supabase/client.server');
        const { data: isAdmin } = await admin.rpc('is_admin', { _user_id: user.id });
        if (!isAdmin) return json({ success: false, error: 'Hanya admin yang bisa menarik riwayat.' }, 403);

        const body: any = await request.json().catch(() => ({}));
        const dryRun = !!body.dry_run;
        const startDate = String(body.start_date || '');
        const endDate = String(body.end_date || '');
        if (!startDate || !endDate) return json({ success: false, error: 'Tanggal mulai dan akhir wajib diisi' }, 400);

        const fromUtc = new Date(`${startDate}T00:00:00+07:00`);
        const toUtc = new Date(`${endDate}T23:59:59+07:00`);
        if (isNaN(fromUtc.getTime()) || isNaN(toUtc.getTime()) || fromUtc > toUtc) {
          return json({ success: false, error: 'Rentang tanggal tidak valid' }, 400);
        }

        const cfg = await loadTwilioConfig(admin as any);
        if (!cfg.accountSid || (!cfg.authToken && !(cfg.apiKeySid && cfg.apiKeySecret))) {
          return json({ success: false, error: 'Kredensial Twilio belum lengkap' }, 500);
        }

        // ---- page through Twilio message history ----
        const base = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`;
        const qs = new URLSearchParams({
          PageSize: '200',
          'DateSent>': fromUtc.toISOString(),
          'DateSent<': toUtc.toISOString(),
        });
        let nextUrl: string | null = `${base}?${qs.toString()}`;
        const twMessages: any[] = [];
        let pages = 0;
        while (nextUrl && pages < 30) {
          const r = await twilioGet(cfg, nextUrl);
          if (!r.ok) {
            return json({
              success: false,
              error: r.data?.message || `Twilio HTTP ${r.status}`,
              twilio_code: r.data?.code ?? null,
            }, 502);
          }
          twMessages.push(...(r.data?.messages || []));
          nextUrl = r.data?.next_page_uri ? `https://api.twilio.com${r.data.next_page_uri}` : null;
          pages++;
        }

        const gatewayNumber = cfg.whatsappFrom ? toWhatsapp(cfg.whatsappFrom) : '';
        const inbound = twMessages.filter((m) =>
          String(m.direction || '').startsWith('inbound')
          && String(m.from || '').toLowerCase().startsWith('whatsapp:')
          && (!gatewayNumber || !String(m.from || '').includes(gatewayNumber.replace('whatsapp:', ''))));
        const outbound = twMessages.filter((m) => String(m.direction || '').startsWith('outbound'));

        const allSids: string[] = twMessages.map((m) => m.sid).filter(Boolean);
        const existing = new Set<string>();
        for (let i = 0; i < allSids.length; i += 200) {
          const chunk = allSids.slice(i, i + 200);
          const { data } = await admin.from('messages').select('fonnte_message_id').in('fonnte_message_id', chunk);
          (data || []).forEach((r: any) => { if (r.fonnte_message_id) existing.add(r.fonnte_message_id); });
        }

        const missing = inbound.filter((m) => !existing.has(m.sid));
        const summary = {
          scanned: twMessages.length,
          inbound: inbound.length,
          outbound: outbound.length,
          duplicates: inbound.length - missing.length,
          to_import: missing.length,
          imported: 0,
          new_contacts: 0,
          status_synced: 0,
          errors: [] as string[],
          contacts_preview: Array.from(new Set(missing.map((m) => normalizePhone(String(m.from))))).slice(0, 50),
        };

        if (dryRun) return json({ success: true, dry_run: true, ...summary });

        // ---- refresh outbound statuses ----
        for (const m of outbound) {
          if (!existing.has(m.sid)) continue;
          const mapped = TWILIO_STATUS_MAP[String(m.status || '').toLowerCase()];
          if (!mapped) continue;
          await admin.from('messages').update({
            status: mapped as any,
            error_code: m.error_code ? String(m.error_code) : null,
            error_message: m.error_message || null,
          }).eq('fonnte_message_id', m.sid);
          summary.status_synced++;
        }

        const { data: defaultStage } = await admin.from('stages').select('id')
          .eq('is_default', true).order('order_index', { ascending: true }).limit(1).maybeSingle();
        const { data: codes } = await admin.from('content_codes').select('id, code, product_id').eq('is_active', true);
        const { data: agentRows } = await admin.from('profiles').select('phone').not('phone', 'is', null);
        const agentPhones = new Set((agentRows || []).map((a: any) => normalizePhone(String(a.phone))));

        missing.sort((a, b) =>
          new Date(a.date_sent || a.date_created).getTime() - new Date(b.date_sent || b.date_created).getTime());

        for (const m of missing) {
          try {
            const sentAt = new Date(m.date_sent || m.date_created || Date.now()).toISOString();
            const contactNumber = normalizePhone(String(m.from || ''));
            if (!contactNumber || contactNumber.length < 6) continue;
            if (agentPhones.has(contactNumber)) continue;

            const text = String(m.body || '').trim();

            let { data: contact } = await admin.from('contacts').select('*')
              .eq('whatsapp_number', contactNumber).maybeSingle();

            if (!contact) {
              let contentCodeId: string | null = null;
              let contentProductId: string | null = null;
              let source = 'organik';
              if (text) {
                const upperMsg = text.toUpperCase();
                for (const c of (codes || [])) {
                  const raw = String((c as any).code || '').trim().toUpperCase();
                  if (!raw) continue;
                  const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  if (new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`).test(upperMsg)) {
                    contentCodeId = (c as any).id;
                    contentProductId = (c as any).product_id || null;
                    source = 'ads';
                    break;
                  }
                }
              }
              const { data: newC, error: cErr } = await admin.from('contacts').insert({
                whatsapp_number: contactNumber,
                stage_id: defaultStage?.id || null,
                source, content_code_id: contentCodeId, interested_product_id: contentProductId,
                last_interaction_at: sentAt, total_messages: 0, created_at: sentAt,
              }).select().single();
              if (cErr) {
                if (!isUniqueViolation(cErr)) throw cErr;
                const { data: ex } = await admin.from('contacts').select('*')
                  .eq('whatsapp_number', contactNumber).maybeSingle();
                contact = ex;
              } else {
                contact = newC;
                summary.new_contacts++;
              }
            }
            if (!contact) continue;

            let { data: conv } = await admin.from('conversations').select('*')
              .eq('contact_id', contact.id).eq('status', 'OPEN')
              .order('created_at', { ascending: false }).limit(1).maybeSingle();
            if (!conv) {
              const { data: newConv, error: convErr } = await admin.from('conversations').insert({
                contact_id: contact.id, status: 'OPEN', first_inbound_at: sentAt, created_at: sentAt,
              }).select().single();
              if (convErr) throw convErr;
              conv = newConv;
            }
            if (!conv) continue;

            // ---- re-host media into chat-media ----
            let storedMediaUrl: string | null = null;
            let mediaMime = '';
            if (Number(m.num_media || 0) > 0) {
              try {
                const listUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages/${m.sid}/Media.json`;
                const mr = await twilioGet(cfg, listUrl);
                const first = mr.data?.media_list?.[0];
                if (first) {
                  mediaMime = String(first.content_type || '');
                  const dl = `https://api.twilio.com${String(first.uri).replace('.json', '')}`;
                  const mres = await twilioFetchRaw(cfg, dl);
                  if (mres.ok) {
                    const buf = new Uint8Array(await mres.arrayBuffer());
                    const ext = (mediaMime.split('/')[1] || 'bin').split(';')[0];
                    const path = `inbound/${contact.id}/${Date.now()}-${m.sid}.${ext}`;
                    const { error: upErr } = await admin.storage.from('chat-media').upload(path, buf, {
                      contentType: mediaMime || 'application/octet-stream', upsert: false,
                    });
                    if (!upErr) {
                      const { data: signed } = await admin.storage.from('chat-media')
                        .createSignedUrl(path, 60 * 60 * 24 * 365);
                      storedMediaUrl = signed?.signedUrl || null;
                    }
                  }
                }
              } catch (e) {
                console.error('[twilio-backfill] media error', String(e));
              }
            }

            const msgType: MsgType = storedMediaUrl ? detectMediaType(mediaMime, storedMediaUrl) : 'TEXT';
            const content = text || (storedMediaUrl ? '(attachment)' : 'Pesan masuk');
            const { error: insErr } = await admin.from('messages').insert({
              conversation_id: conv.id, direction: 'INBOUND', type: msgType as any,
              content, status: 'DELIVERED', media_url: storedMediaUrl,
              sent_at: sentAt, created_at: sentAt, fonnte_message_id: m.sid,
            });
            if (insErr) {
              if (isUniqueViolation(insErr)) continue;
              throw insErr;
            }
            summary.imported++;

            const newer = !conv.last_message_at
              || new Date(conv.last_message_at).getTime() < new Date(sentAt).getTime();
            const convPatch: Record<string, unknown> = {
              unread_count: (conv.unread_count || 0) + 1,
              first_inbound_at: conv.first_inbound_at && new Date(conv.first_inbound_at) < new Date(sentAt)
                ? conv.first_inbound_at : sentAt,
            };
            if (newer) {
              convPatch['last_message_at'] = sentAt;
              convPatch['last_message_preview'] = content.slice(0, 100);
            }
            await admin.from('conversations').update(convPatch as any).eq('id', conv.id);

            const contactNewer = !contact.last_interaction_at
              || new Date(contact.last_interaction_at).getTime() < new Date(sentAt).getTime();
            await admin.from('contacts').update({
              total_messages: (contact.total_messages || 0) + 1,
              ...(contactNewer ? { last_interaction_at: sentAt } : {}),
            }).eq('id', contact.id);
          } catch (e) {
            summary.errors.push(`${m.sid}: ${String(e)}`);
          }
        }

        await admin.from('whatsapp_gateway_logs').insert({
          direction: 'INBOUND',
          level: summary.errors.length ? 'error' : 'info',
          event: 'backfill',
          status: 'done',
          error_message: summary.errors.length ? summary.errors.slice(0, 5).join(' | ') : null,
          payload: { start_date: startDate, end_date: endDate, ...summary } as any,
        });

        console.log(`[twilio-backfill] ${startDate}..${endDate} imported=${summary.imported} dup=${summary.duplicates}`);
        return json({ success: true, ...summary });
      },
    },
  },
});
