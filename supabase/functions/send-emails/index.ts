// Supabase Edge Function · send-emails
//
// Sends the queue in public.email_outbox (filled by the database every time an in-app
// notification is created — migration 0018) through Microsoft 365 (Microsoft Graph sendMail).
//
// Called by a Database Webhook on INSERT into email_outbox, and by the admin buttons
// "ส่งอีเมลทดสอบ" / "ลองส่งใหม่" in ตั้งค่าระบบ. It has no parameters: every call simply
// sends whatever is waiting.
//
// Secrets (Supabase → Edge Functions → Secrets). None of them is ever sent to the browser:
//   MS_TENANT_ID      Directory (tenant) ID
//   MS_CLIENT_ID      Application (client) ID of the app registration that may send mail
//   MS_CLIENT_SECRET  its client secret
//   MAIL_SENDER       mailbox the mail is sent from, e.g. noreply@company.co.th
//   APP_URL           the app's address, e.g. https://quotation.company.co.th (for the button in the mail)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
//
// No imports on purpose: the file can be pasted into the dashboard editor as is.

// deno-lint-ignore-file no-explicit-any
declare const Deno: any;

interface Row {
  id: number;
  to_emails: string[];
  kind: string;
  subject: string;
  body: string;
  link: string;
  attempts: number;
}

const MAX_ATTEMPTS = 3;
const env = (k: string): string => Deno.env.get(k) ?? '';
const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function mailHtml(r: Row, appUrl: string): string {
  const color = r.kind === 'bad' ? '#8E2318' : r.kind === 'ok' ? '#4F6B52' : '#502D1E';
  const href = r.link && r.link.startsWith('/') ? appUrl.replace(/\/+$/, '') + r.link : appUrl;
  return `<!doctype html><html><body style="margin:0;background:#F4EEE8;font-family:Tahoma,'Leelawadee UI',Arial,sans-serif;color:#2B1A12">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="background:#ffffff;border-radius:12px;border-top:6px solid ${color};padding:24px">
    <div style="font-size:13px;color:#8E857D">ระบบอนุมัติใบเสนอราคา · Quotation Approval</div>
    <h1 style="font-size:20px;line-height:1.4;margin:8px 0 12px;color:${color}">${esc(r.subject)}</h1>
    ${r.body ? `<p style="font-size:15px;line-height:1.6;margin:0 0 20px">${esc(r.body)}</p>` : ''}
    <a href="${esc(href)}" style="display:inline-block;background:#502D1E;color:#ffffff;text-decoration:none;font-size:15px;padding:10px 20px;border-radius:8px">เปิดในระบบ · Open</a>
  </div>
  <p style="font-size:12px;color:#8E857D;line-height:1.6;margin:16px 4px 0">อีเมลนี้ส่งอัตโนมัติ กรุณาอย่าตอบกลับ · ปิดการแจ้งเตือนทางอีเมลได้ที่หน้า “บัญชีและลายเซ็นของฉัน” ในระบบ<br>This is an automatic message. You can switch e-mail notifications off on your account page.</p>
</div></body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json(200, {});
  const need = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MAIL_SENDER', 'APP_URL'];
  const missing = need.filter((k) => !env(k));
  if (missing.length) return json(500, { ok: false, error: `ยังไม่ได้ตั้งค่า Secrets: ${missing.join(', ')} · Missing secrets` });

  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const rest = (path: string, init: RequestInit = {}) =>
    fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
  const mark = (id: number, patch: Record<string, unknown>) =>
    rest(`email_outbox?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
  const failed = (r: Row, error: string) =>
    mark(r.id, { status: r.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', error: error.slice(0, 500) });

  let token = '';
  let sent = 0;
  let errors = 0;
  let lastError = '';
  // up to 5 batches of 20 per call; stop at the first batch that had a failure (it is retried on the next call)
  for (let batch = 0; batch < 5; batch++) {
    const c = await rest('rpc/claim_emails', { method: 'POST', body: JSON.stringify({ p_limit: 20 }) });
    if (!c.ok) return json(500, { ok: false, error: `อ่านคิวอีเมลไม่ได้ (รัน SQL 0018 แล้วหรือยัง?) · ${(await c.text()).slice(0, 300)}` });
    const rows: Row[] = await c.json();
    if (!rows.length) break;

    if (!token) {
      const t = await fetch(`https://login.microsoftonline.com/${env('MS_TENANT_ID')}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env('MS_CLIENT_ID'), client_secret: env('MS_CLIENT_SECRET'), scope: 'https://graph.microsoft.com/.default' }),
      });
      const tj: any = await t.json().catch(() => ({}));
      if (!t.ok || !tj.access_token) {
        lastError = `Microsoft sign-in failed: ${tj.error_description || tj.error || t.status}`;
        await Promise.all(rows.map((r) => failed(r, lastError)));
        return json(502, { ok: false, sent, errors: rows.length, error: lastError.slice(0, 300) });
      }
      token = tj.access_token;
    }

    let bad = 0;
    for (const r of rows) {
      const m = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env('MAIL_SENDER'))}/sendMail`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            subject: r.subject,
            body: { contentType: 'HTML', content: mailHtml(r, env('APP_URL')) },
            toRecipients: r.to_emails.map((address) => ({ emailAddress: { address } })),
          },
          saveToSentItems: false,
        }),
      });
      if (m.status === 202) {
        sent++;
        await mark(r.id, { status: 'sent', sent_at: new Date().toISOString(), error: '' });
      } else {
        bad++;
        const body: any = await m.json().catch(() => ({}));
        lastError = `Graph ${m.status}: ${body?.error?.code || ''} ${body?.error?.message || ''}`.trim();
        await failed(r, lastError);
      }
    }
    errors += bad;
    if (bad) break;
  }

  // keep the queue small: sent mail older than 30 days is removed
  const old = new Date(Date.now() - 30 * 864e5).toISOString();
  await rest(`email_outbox?status=eq.sent&sent_at=lt.${old}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });

  return json(errors ? 502 : 200, { ok: !errors, sent, errors, ...(lastError ? { error: lastError.slice(0, 300) } : {}) });
});
