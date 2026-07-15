// ============================================================
// AltaLux / multi-tenant — Send Email Edge Function (Resend)
// ============================================================
// Handles 5 actions from the client:
//   - booking_confirmation : to customer, right after a booking is paid
//   - job_confirmed        : to customer, when admin marks a job Confirmed
//   - reminder_24h         : to customer, "Send Reminder" button in admin
//   - job_completed        : to customer, invoice email (job Completed /
//                             "Resend Invoice" button)
//   - internal_notification: to the business's notification_email, on
//                             every new booking
//
// Reads business branding/from-address from `business_settings` (full
// table — this function uses the service role key, which bypasses RLS,
// so it can read square/stripe secrets too if it ever needs to, though
// this function only touches the resend_* / notification_email columns).
//
// One global Resend account serves every business for now (per Phase A
// spec): RESEND_API_KEY is a Supabase secret, not a per-business column.
//
// Deploy with:
//   supabase functions deploy send-email
// Set the secret once with:
//   supabase secrets set RESEND_API_KEY=your_key_here
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_API_BASE = 'https://api.resend.com';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getSupabaseAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase service credentials are not configured for this function.');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

interface BizSettings {
  business_id: string;
  name: string;
  phone: string | null;
  website: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  resend_from_email: string | null;
  resend_from_name: string | null;
  notification_email: string | null;
  booking_url: string | null;
  admin_url: string | null;
  email_toggles: Record<string, boolean> | null;
}

async function getBizSettings(businessId: string): Promise<BizSettings> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('business_settings')
    .select('business_id, name, phone, website, primary_color, secondary_color, resend_from_email, resend_from_name, notification_email, booking_url, admin_url, email_toggles')
    .eq('business_id', businessId)
    .single();
  if (error || !data) throw new Error(`No business_settings found for business_id "${businessId}".`);
  return data as BizSettings;
}

function fmtCurrency(amount: number | string | null | undefined): string {
  const n = Number(amount || 0);
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(date: string | null | undefined): string {
  if (!date) return '';
  const d = new Date(date + (date.length <= 10 ? 'T00:00:00' : ''));
  if (isNaN(d.getTime())) return String(date);
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------- Shared mobile-responsive email shell ----------
function emailShell(biz: BizSettings, subject: string, bodyHtml: string): string {
  const primary = biz.primary_color || '#104872';
  const secondary = biz.secondary_color || '#FF8C00';
  return `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(subject)}</title>
</head>
<body style="margin:0; padding:0; background:#f2f2f2; font-family:Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2; padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background:#ffffff; border-radius:8px; overflow:hidden;">
        <tr>
          <td style="background:${primary}; padding:24px 28px;">
            <span style="font-family:Arial, Helvetica, sans-serif; font-size:20px; font-weight:bold; color:#ffffff; letter-spacing:1px;">${esc(biz.name)}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:28px; color:#222222; font-size:15px; line-height:1.5;">
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="background:${secondary}; padding:18px 28px; color:#ffffff; font-size:13px;">
            ${biz.phone ? `Questions? Call us at <strong>${esc(biz.phone)}</strong>` : ''}
            ${biz.website ? `<br><a href="${esc(biz.website)}" style="color:#ffffff;">${esc(biz.website)}</a>` : ''}
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function lineItemsTable(items: Array<{ name: string; price: number }>): string {
  const rows = (items || []).map(i =>
    `<tr><td style="padding:6px 0; border-bottom:1px solid #eee;">${esc(i.name)}</td><td style="padding:6px 0; border-bottom:1px solid #eee; text-align:right;">${fmtCurrency(i.price)}</td></tr>`
  ).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0;">${rows}</table>`;
}

// ---------- Email builders ----------
function buildBookingConfirmation(biz: BizSettings, d: any) {
  const subject = `Booking Request Received — ${biz.name}`;
  const body = `
    <p>Hi ${esc(d.customerName)}, your booking request has been received!</p>
    <p style="font-weight:bold; margin-bottom:4px;">Booking Summary</p>
    <p style="margin:2px 0;">Service: ${esc(d.service)} — ${esc(d.vehicle)}</p>
    <p style="margin:2px 0;">Date: ${fmtDate(d.date)} at ${esc(d.time)}</p>
    <p style="margin:2px 0;">Address: ${esc(d.address)}</p>
    <p style="font-weight:bold; margin:16px 0 4px;">Financial</p>
    <p style="margin:2px 0;">Total: ${fmtCurrency(d.total)}</p>
    <p style="margin:2px 0; color:#1D9E75;">Deposit Paid ✓ ${fmtCurrency(d.deposit)}</p>
    <p style="margin:2px 0;">Balance Due (on service day): ${fmtCurrency(d.balance)}</p>
    <p style="margin-top:16px;">We will contact you within 24 hours to confirm.</p>
    ${d.cancellationPolicy ? `<p style="font-size:12.5px; color:#666; margin-top:16px;">${esc(d.cancellationPolicy)}</p>` : ''}
  `;
  return { subject, html: emailShell(biz, subject, body) };
}

function buildJobConfirmed(biz: BizSettings, d: any) {
  const subject = `Your Appointment is Confirmed — ${biz.name}`;
  const body = `
    <p>Great news ${esc(d.customerName)}! Your appointment is confirmed.</p>
    <p style="margin:2px 0;">Date: ${fmtDate(d.date)} at ${esc(d.time)}</p>
    <p style="margin:2px 0;">Address: ${esc(d.address)}</p>
    <p style="margin:2px 0;">Service: ${esc(d.service)} — ${esc(d.vehicle)}</p>
    ${d.technician ? `<p style="margin:2px 0;">Technician: ${esc(d.technician)}</p>` : ''}
    <p style="margin:16px 0 4px; font-weight:bold;">Balance Reminder</p>
    <p style="margin:2px 0;">${fmtCurrency(d.balance)} due on service day</p>
    <p style="font-weight:bold; margin:16px 0 4px;">A Few Tips</p>
    <ul style="margin:4px 0; padding-left:20px;">
      <li>Please have your vehicle accessible</li>
      <li>Our technician will text you when on the way</li>
      <li>15 minute arrival window — a $50 late fee applies if your vehicle isn't available</li>
    </ul>
  `;
  return { subject, html: emailShell(biz, subject, body) };
}

function buildReminder24h(biz: BizSettings, d: any) {
  const subject = `Reminder: Your Detail is Tomorrow — ${biz.name}`;
  const body = `
    <p>Hi ${esc(d.customerName)}, your detail is tomorrow!</p>
    <p style="margin:2px 0;">Appointment: ${fmtDate(d.date)} at ${esc(d.time)}</p>
    <p style="margin:2px 0;">Address: ${esc(d.address)}</p>
    <p style="margin:2px 0;">Service: ${esc(d.service)} — ${esc(d.vehicle)}</p>
    <p style="margin:16px 0 4px; font-weight:bold;">Balance</p>
    <p style="margin:2px 0;">${fmtCurrency(d.balance)} due on service day</p>
    <p style="font-weight:bold; margin:16px 0 4px;">Prep Tips</p>
    <ul style="margin:4px 0; padding-left:20px;">
      <li>Please make sure your vehicle is accessible</li>
      <li>Remove valuables from the vehicle</li>
      <li>Keep pets secured during the service</li>
    </ul>
    <p style="font-size:12.5px; color:#666; margin-top:16px;">Rescheduling requires at least ${esc(d.cancellationHours || 72)} hours notice.</p>
  `;
  return { subject, html: emailShell(biz, subject, body) };
}

function buildJobCompleted(biz: BizSettings, d: any) {
  const subject = `Your Detail is Complete — Invoice #${esc(d.invoiceNumber)} — ${biz.name}`;
  const body = `
    <p>Hi ${esc(d.customerName)}, your vehicle detail is complete!</p>
    <p style="margin:2px 0;">Invoice #: ${esc(d.invoiceNumber)}</p>
    <p style="margin:2px 0;">Date: ${fmtDate(d.date)}</p>
    <p style="margin:2px 0;">Address: ${esc(d.address)}</p>
    <p style="font-weight:bold; margin:16px 0 4px;">Line Items</p>
    ${lineItemsTable(d.lineItems || [])}
    <p style="font-weight:bold; margin:16px 0 4px;">Payment Summary</p>
    <p style="margin:2px 0; color:#1D9E75;">Deposit Paid ✓ ${fmtCurrency(d.deposit)}</p>
    <p style="margin:2px 0; color:#1D9E75;">Balance Paid ✓ ${fmtCurrency(d.balance)}</p>
    <p style="margin:2px 0; font-weight:bold;">Total Paid: ${fmtCurrency(d.total)}</p>
    ${d.reviewUrl ? `<p style="margin-top:16px;"><a href="${esc(d.reviewUrl)}" style="color:${biz.primary_color || '#104872'};">Leave us a Google review</a></p>` : ''}
    ${biz.booking_url ? `<p style="margin-top:20px;"><a href="${esc(biz.booking_url)}" style="background:${biz.secondary_color || '#FF8C00'}; color:#ffffff; padding:12px 24px; border-radius:6px; text-decoration:none; display:inline-block;">Book Your Next Detail</a></p>` : ''}
  `;
  return { subject, html: emailShell(biz, subject, body) };
}

function buildInternalNotification(biz: BizSettings, d: any) {
  const subject = `New Booking — ${esc(d.customerName)} — ${esc(d.service)} — ${fmtDate(d.date)}`;
  const body = `
    <p style="font-weight:bold; margin:0 0 4px;">Customer</p>
    <p style="margin:2px 0;">${esc(d.customerName)} — ${esc(d.customerPhone)} — ${esc(d.customerEmail)}</p>
    <p style="font-weight:bold; margin:16px 0 4px;">Booking</p>
    <p style="margin:2px 0;">${esc(d.service)} — ${esc(d.vehicleType)} (${esc(d.vehicle)})</p>
    <p style="margin:2px 0;">${fmtDate(d.date)} at ${esc(d.time)}</p>
    <p style="margin:2px 0;">${esc(d.address)}</p>
    <p style="font-weight:bold; margin:16px 0 4px;">Financial</p>
    <p style="margin:2px 0;">Total: ${fmtCurrency(d.total)} — Deposit Paid: ${fmtCurrency(d.deposit)} — Balance Due: ${fmtCurrency(d.balance)}</p>
    ${d.addons && d.addons.length ? `<p style="font-weight:bold; margin:16px 0 4px;">Add-ons</p>${lineItemsTable(d.addons)}` : ''}
    ${biz.admin_url ? `<p style="margin-top:20px;"><a href="${esc(biz.admin_url)}" style="color:${biz.primary_color || '#104872'};">Review in admin panel →</a></p>` : ''}
  `;
  return { subject, html: emailShell(biz, subject, body) };
}

const BUILDERS: Record<string, (biz: BizSettings, d: any) => { subject: string; html: string }> = {
  booking_confirmation: buildBookingConfirmation,
  job_confirmed: buildJobConfirmed,
  reminder_24h: buildReminder24h,
  job_completed: buildJobCompleted,
  internal_notification: buildInternalNotification,
};

const TOGGLE_KEY: Record<string, string> = {
  booking_confirmation: 'booking_confirmation',
  job_confirmed: 'job_confirmed',
  reminder_24h: 'reminder_24h',
  job_completed: 'job_completed',
  internal_notification: 'internal_notification',
};

async function sendViaResend(to: string, from: string, subject: string, html: string) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured. Set it with `supabase secrets set RESEND_API_KEY=...`.');
  const res = await fetch(`${RESEND_API_BASE}/emails`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || 'Resend API request failed.');
  }
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, businessId, data } = body;

    if (!action || !BUILDERS[action]) {
      return jsonResponse({ error: `Unknown action: ${action}. Expected one of ${Object.keys(BUILDERS).join(', ')}.` }, 400);
    }
    if (!businessId) return jsonResponse({ error: 'businessId is required.' }, 400);

    const biz = await getBizSettings(businessId);

    const toggleKey = TOGGLE_KEY[action];
    if (biz.email_toggles && toggleKey && biz.email_toggles[toggleKey] === false) {
      return jsonResponse({ skipped: true, reason: `Email type "${action}" is disabled for this business.` });
    }

    if (!biz.resend_from_email) {
      return jsonResponse({ error: `Resend is not configured for business "${businessId}" (no resend_from_email set in Settings > Notifications).` }, 400);
    }

    const to = action === 'internal_notification' ? biz.notification_email : (data && data.customerEmail);
    if (!to) return jsonResponse({ error: `No recipient email available for action "${action}".` }, 400);
    // Validación de input (auditoría de seguridad 2026-07-15). El resto de los
    // campos interpolados en el HTML del email ya pasan por esc() más abajo
    // (ver los builders BUILD_*), así que no hace falta sanitizar aquí también.
    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!EMAIL_REGEX.test(to)) {
      return jsonResponse({ error: `Invalid recipient email: "${to}".` }, 400);
    }

    const fromName = biz.resend_from_name || biz.name;
    const from = `${fromName} <${biz.resend_from_email}>`;

    const { subject, html } = BUILDERS[action](biz, data || {});
    const result = await sendViaResend(to, from, subject, html);

    return jsonResponse({ success: true, id: result?.id || null });
  } catch (err) {
    console.error('[send-email] Error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected error.' }, 500);
  }
});
