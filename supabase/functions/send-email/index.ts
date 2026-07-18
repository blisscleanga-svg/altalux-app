// ============================================================
// AltaLux / multi-tenant — Send Email Edge Function (Resend)
// ============================================================
// Handles 7 actions from the client:
//   - booking_confirmation : to customer, right after a booking is paid
//   - job_confirmed        : to customer, when admin marks a job Confirmed
//   - reminder_24h         : to customer, "Send Reminder" button in admin
//   - job_completed        : to customer, invoice email (job Completed /
//                             "Resend Invoice" button)
//   - internal_notification: to the business's notification_email, on
//                             every new booking
//   - invoice_link         : to customer, "Send Invoice" (pay/ link)
//   - payment_receipt      : to customer, right after a payment succeeds
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
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  website: string | null;
  logo_url: string | null;
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
    .select('business_id, name, email, phone, address, city, state, zip, website, logo_url, primary_color, secondary_color, resend_from_email, resend_from_name, notification_email, booking_url, admin_url, email_toggles')
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

function bizAddressLine(biz: BizSettings): string {
  const cityLine = [biz.city, biz.state].filter(Boolean).join(', ') + (biz.zip ? ' ' + biz.zip : '');
  return biz.address ? [biz.address, cityLine].filter(Boolean).join(', ') : (cityLine || 'Roswell, GA 30075');
}
function bizWebsiteHost(biz: BizSettings): string {
  return (biz.website || 'altaluxdetail.com').replace(/^https?:\/\//, '').replace(/\/$/, '');
}
function bizWebsiteHref(biz: BizSettings): string {
  const host = bizWebsiteHost(biz);
  return host.startsWith('http') ? host : `https://${host}`;
}

// ---------- Card de detalle reutilizable (label/valor con acento lateral) ----------
function detailCard(rows: Array<{ label: string; value: string; accent?: string; valueColor?: string }>, borderColor: string): string {
  const trs = rows.map(r => `
    <tr>
      <td style="padding:6px 0; font-size:13px; color:#718096; width:42%; vertical-align:top;">${esc(r.label)}</td>
      <td style="padding:6px 0; font-size:14px; color:${r.valueColor || '#1a202c'}; font-weight:600;">${r.value}</td>
    </tr>`).join('');
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fa; border-radius:8px; border-left:4px solid ${borderColor}; border-collapse:collapse;">
      <tr><td style="padding:16px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          ${trs}
        </table>
      </td></tr>
    </table>`;
}

function policyBox(text: string, tone: 'warning' | 'danger' = 'warning'): string {
  const bg = tone === 'danger' ? '#fff5f5' : '#fffbeb';
  const border = tone === 'danger' ? '#feb2b2' : '#FFAA00';
  const color = tone === 'danger' ? '#742a2a' : '#744210';
  return `<p style="font-size:12px; color:${color}; margin:20px 0 0; padding:16px; background:${bg}; border-radius:6px; border:1px solid ${border};">⚠️ ${text}</p>`;
}

function ctaButton(url: string, label: string, bg: string, textColor = '#ffffff'): string {
  return `
    <table role="presentation" width="100%" style="margin:26px 0;">
      <tr><td align="center">
        <a href="${esc(url)}" style="background:${bg}; color:${textColor}; text-decoration:none; font-family:Rajdhani, Georgia, sans-serif; font-size:16px; font-weight:700; letter-spacing:.05em; padding:16px 40px; border-radius:8px; display:inline-block;">${esc(label)}</a>
      </td></tr>
    </table>`;
}

// ---------- Shell de email — mobile-responsive, usado por todos los tipos ----------
function emailShell(biz: BizSettings, subject: string, bodyHtml: string): string {
  const primary = biz.primary_color || '#104872';
  const secondary = biz.secondary_color || '#FF8C00';
  const logoHtml = biz.logo_url
    ? `<img src="${esc(biz.logo_url)}" alt="${esc(biz.name)}" width="160" style="display:block; margin:0 auto; height:auto; max-height:44px;">`
    : `<div style="font-family:'Rajdhani',Georgia,sans-serif; font-size:22px; font-weight:700; color:#ffffff; letter-spacing:.1em; text-align:center;">${esc(biz.name).toUpperCase()}</div>`;

  return `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(subject)}</title>
<style>
  @media only screen and (max-width: 600px) {
    .email-wrapper { width: 100% !important; }
    .email-body { padding: 24px 20px !important; }
    .email-header { padding: 22px 20px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background:#f0f4f8; font-family:'Inter', Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8; padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" class="email-wrapper" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,.08);">
        <tr>
          <td class="email-header" style="background:${primary}; padding:28px 32px; text-align:center;">
            ${logoHtml}
          </td>
        </tr>
        <tr><td style="background:${secondary}; height:4px; line-height:4px; font-size:0;">&nbsp;</td></tr>
        <tr>
          <td class="email-body" style="padding:32px; color:#1a202c; font-size:15px; line-height:1.5;">
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="background:#f7f8fa; padding:24px 32px; border-top:1px solid #e2e8f0; text-align:center;">
            <p style="margin:0 0 8px; font-size:12px; color:#4a5568;">${esc(biz.name)} &middot; ${esc(bizAddressLine(biz))}</p>
            <p style="margin:0; font-size:12px; color:#4a5568;">
              <a href="${esc(bizWebsiteHref(biz))}" style="color:${primary};">${esc(bizWebsiteHost(biz))}</a>
              ${biz.email ? `&nbsp;&middot;&nbsp;<a href="mailto:${esc(biz.email)}" style="color:${primary};">${esc(biz.email)}</a>` : ''}
            </p>
            <p style="margin:12px 0 0; font-size:11px; color:#718096;">&copy; ${new Date().getFullYear()} ${esc(biz.name)}. All rights reserved.</p>
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
    `<tr><td style="padding:8px 0; border-bottom:1px solid #e2e8f0; font-size:13.5px; color:#1a202c;">${esc(i.name)}</td><td style="padding:8px 0; border-bottom:1px solid #e2e8f0; text-align:right; font-size:13.5px; color:#1a202c;">${fmtCurrency(i.price)}</td></tr>`
  ).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 16px;">${rows}</table>`;
}

function vehicleLine(d: any): string {
  return [d.vehicleYear, d.vehicleMake, d.vehicleModel].filter(Boolean).join(' ');
}

// ---------- Email builders ----------
function buildBookingConfirmation(biz: BizSettings, d: any) {
  const subject = `✅ Booking Confirmed — ${biz.name}`;
  const body = `
    <h2 style="font-family:'Rajdhani',Georgia,sans-serif; color:${biz.primary_color || '#104872'}; margin:0 0 8px; font-size:22px;">Your booking is confirmed!</h2>
    <p style="color:#4a5568; font-size:15px; margin:0 0 24px;">Hi ${esc(d.customerName)}, we look forward to serving you.</p>
    ${detailCard([
      { label: 'Service', value: `${esc(d.service)}${d.vehicle ? ' — ' + esc(d.vehicle) : ''}` },
      { label: 'Date & Time', value: `${esc(fmtDate(d.date))} at ${esc(d.time)}` },
      { label: 'Address', value: esc(d.address) },
      { label: 'Deposit Paid', value: `${fmtCurrency(d.deposit)} ✓`, valueColor: '#276749' },
      { label: 'Balance Due', value: `${fmtCurrency(d.balance)} (due at service)` },
    ], biz.secondary_color || '#FF8C00')}
    <p style="margin-top:20px; color:#4a5568;">We will contact you within 24 hours to confirm.</p>
    ${policyBox(d.cancellationPolicy || 'A 25% non-refundable deposit is required to confirm your booking. Cancellations or rescheduling with less than 72 hours notice will forfeit the deposit. A $50 late fee applies if your vehicle is not available within 15 minutes of technician arrival.')}
  `;
  return { subject, html: emailShell(biz, subject, body) };
}

function buildJobConfirmed(biz: BizSettings, d: any) {
  const subject = `Your Appointment is Confirmed — ${biz.name}`;
  const body = `
    <h2 style="font-family:'Rajdhani',Georgia,sans-serif; color:${biz.primary_color || '#104872'}; margin:0 0 8px; font-size:22px;">Great news, your appointment is confirmed!</h2>
    <p style="color:#4a5568; font-size:15px; margin:0 0 24px;">Hi ${esc(d.customerName)}, here's what to expect.</p>
    ${detailCard([
      { label: 'Service', value: `${esc(d.service)}${d.vehicle ? ' — ' + esc(d.vehicle) : ''}` },
      { label: 'Date & Time', value: `${esc(fmtDate(d.date))} at ${esc(d.time)}`, valueColor: biz.secondary_color || '#FF8C00' },
      { label: 'Address', value: esc(d.address) },
      ...(d.technician ? [{ label: 'Technician', value: esc(d.technician) }] : []),
      { label: 'Balance Due', value: `${fmtCurrency(d.balance)} (due on service day)` },
    ], biz.primary_color || '#104872')}
    <p style="font-weight:700; margin:22px 0 6px; font-size:13px; letter-spacing:.05em; text-transform:uppercase; color:${biz.secondary_color || '#FF8C00'};">A Few Tips</p>
    <ul style="margin:4px 0; padding-left:20px; color:#4a5568; font-size:14px; line-height:1.7;">
      <li>Please have your vehicle accessible</li>
      <li>Our technician will text you when on the way</li>
      <li>15 minute arrival window — a $50 late fee applies if your vehicle isn't available</li>
    </ul>
  `;
  return { subject, html: emailShell(biz, subject, body) };
}

function buildReminder24h(biz: BizSettings, d: any) {
  const subject = `⏰ Reminder — Your ${biz.name} Appointment is Tomorrow`;
  const body = `
    <h2 style="font-family:'Rajdhani',Georgia,sans-serif; color:${biz.primary_color || '#104872'}; margin:0 0 8px; font-size:22px;">Your appointment is tomorrow</h2>
    <p style="color:#4a5568; font-size:15px; margin:0 0 24px;">Hi ${esc(d.customerName)}, just a reminder about your upcoming service.</p>
    ${detailCard([
      { label: 'Service', value: `${esc(d.service)}${d.vehicle ? ' — ' + esc(d.vehicle) : ''}` },
      { label: 'Date & Time', value: `${esc(fmtDate(d.date))} at ${esc(d.time)}`, valueColor: biz.secondary_color || '#FF8C00' },
      { label: 'Address', value: esc(d.address) },
      { label: 'Balance', value: `${fmtCurrency(d.balance)} (due on service day)` },
    ], biz.secondary_color || '#FF8C00')}
    <p style="font-weight:700; margin:22px 0 6px; font-size:13px; letter-spacing:.05em; text-transform:uppercase; color:${biz.secondary_color || '#FF8C00'};">Prep Tips</p>
    <ul style="margin:4px 0; padding-left:20px; color:#4a5568; font-size:14px; line-height:1.7;">
      <li>Please make sure your vehicle is accessible</li>
      <li>Remove valuables from the vehicle</li>
      <li>Keep pets secured during the service</li>
    </ul>
    ${policyBox(`Please remember: cancellations or rescheduling with less than ${esc(d.cancellationHours || 72)} hours notice will forfeit your deposit. A $50 late fee applies if your vehicle is not available within 15 minutes of technician arrival.`, 'danger')}
  `;
  return { subject, html: emailShell(biz, subject, body) };
}

function buildJobCompleted(biz: BizSettings, d: any) {
  const subject = `Your Detail is Complete — Invoice #${esc(d.invoiceNumber)} — ${biz.name}`;
  const body = `
    <h2 style="font-family:'Rajdhani',Georgia,sans-serif; color:${biz.primary_color || '#104872'}; margin:0 0 8px; font-size:22px;">Your vehicle detail is complete!</h2>
    <p style="color:#4a5568; font-size:15px; margin:0 0 24px;">Hi ${esc(d.customerName)}, thank you for choosing us.</p>
    ${detailCard([
      { label: 'Invoice #', value: esc(d.invoiceNumber) },
      { label: 'Date', value: esc(fmtDate(d.date)) },
      { label: 'Address', value: esc(d.address) },
    ], biz.primary_color || '#104872')}
    <p style="font-weight:700; margin:22px 0 6px; font-size:13px; letter-spacing:.05em; text-transform:uppercase; color:${biz.secondary_color || '#FF8C00'};">Line Items</p>
    ${lineItemsTable(d.lineItems || [])}
    ${detailCard([
      { label: 'Deposit Paid', value: `${fmtCurrency(d.deposit)} ✓`, valueColor: '#276749' },
      { label: 'Balance Paid', value: `${fmtCurrency(d.balance)} ✓`, valueColor: '#276749' },
      { label: 'Total Paid', value: fmtCurrency(d.total) },
    ], '#276749')}
    ${d.reviewUrl ? `
    <div style="text-align:center; margin:28px 0 0; padding:20px; background:#fffbeb; border-radius:8px; border:1px solid #FFAA00;">
      <p style="margin:0 0 12px; font-size:14px; color:#744210; font-weight:600;">Enjoying your detail? Leave us a review! ⭐</p>
      <a href="${esc(d.reviewUrl)}" style="background:#FFAA00; color:#ffffff; text-decoration:none; font-family:'Rajdhani',Georgia,sans-serif; font-size:14px; font-weight:700; padding:10px 24px; border-radius:6px; display:inline-block;">Leave a Google Review →</a>
    </div>` : ''}
    ${biz.booking_url ? ctaButton(biz.booking_url, 'Book Your Next Detail', biz.secondary_color || '#FF8C00') : ''}
  `;
  return { subject, html: emailShell(biz, subject, body) };
}

function buildInternalNotification(biz: BizSettings, d: any) {
  const subject = `New Booking — ${esc(d.customerName)} — ${esc(d.service)} — ${fmtDate(d.date)}`;
  const body = `
    <h2 style="font-family:'Rajdhani',Georgia,sans-serif; color:${biz.primary_color || '#104872'}; margin:0 0 8px; font-size:20px;">New Booking Received</h2>
    <p style="color:#4a5568; font-size:14px; margin:0 0 20px;">A new booking just came in — details below.</p>
    ${detailCard([
      { label: 'Customer', value: `${esc(d.customerName)} — ${esc(d.customerPhone)} — ${esc(d.customerEmail)}` },
      { label: 'Service', value: `${esc(d.service)} — ${esc(d.vehicleType)} (${esc(d.vehicle)})` },
      { label: 'Date & Time', value: `${esc(fmtDate(d.date))} at ${esc(d.time)}` },
      { label: 'Address', value: esc(d.address) },
      { label: 'Total', value: fmtCurrency(d.total) },
      { label: 'Deposit Paid', value: fmtCurrency(d.deposit), valueColor: '#276749' },
      { label: 'Balance Due', value: fmtCurrency(d.balance) },
    ], biz.secondary_color || '#FF8C00')}
    ${d.addons && d.addons.length ? `<p style="font-weight:700; margin:20px 0 6px; font-size:13px; letter-spacing:.05em; text-transform:uppercase; color:${biz.secondary_color || '#FF8C00'};">Add-ons</p>${lineItemsTable(d.addons)}` : ''}
    ${biz.admin_url ? ctaButton(biz.admin_url, 'Review in Admin Panel →', biz.primary_color || '#104872') : ''}
  `;
  return { subject, html: emailShell(biz, subject, body) };
}

// ---------- pay/ — link de pago del invoice ----------
function payUrl(biz: BizSettings, token: string): string {
  const base = (biz.booking_url || biz.admin_url || 'https://app.altaluxdetail.com/booking/').replace(/\/(booking|admin|technician)\/?$/, '');
  return base + '/pay/?token=' + encodeURIComponent(token);
}

function buildInvoiceLink(biz: BizSettings, d: any) {
  const subject = `💳 Invoice Ready — ${biz.name} · ${esc(d.invoiceNumber)}`;
  const url = payUrl(biz, d.publicToken);
  const body = `
    <h2 style="font-family:'Rajdhani',Georgia,sans-serif; color:${biz.primary_color || '#104872'}; margin:0 0 8px; font-size:22px;">Your Invoice Is Ready</h2>
    ${d.service ? `<p style="margin:0 0 16px; color:${biz.secondary_color || '#FF8C00'}; font-weight:600;">${esc(d.service)}</p>` : ''}
    <p style="color:#4a5568;">Hi ${esc(d.customerName)}, your invoice for your recent detailing service is ready for payment.</p>
    ${detailCard([
      { label: 'Invoice', value: esc(d.invoiceNumber) },
      ...(d.service ? [{ label: 'Service', value: esc(d.service) }] : []),
      ...(vehicleLine(d) ? [{ label: 'Vehicle', value: esc(vehicleLine(d)) }] : []),
      { label: 'Amount Due', value: fmtCurrency(d.total), valueColor: biz.secondary_color || '#FF8C00' },
      { label: 'Due By', value: d.dueBy ? esc(fmtDate(d.dueBy)) : 'Upon receipt' },
    ], biz.primary_color || '#104872')}
    ${d.comment ? `<p style="background:#fff8ec; border-left:3px solid ${biz.secondary_color || '#FF8C00'}; padding:10px 14px; font-size:13.5px; margin:16px 0; color:#4a5568;">${esc(d.comment)}</p>` : ''}
    ${ctaButton(url, 'View & Pay Invoice →', biz.secondary_color || '#FF8C00')}
    <p style="font-size:12.5px; color:#718096; text-align:center; margin:0;">Or copy this link: <a href="${esc(url)}" style="color:${biz.primary_color || '#104872'}; word-break:break-all;">${esc(url)}</a></p>
    <p style="font-size:12.5px; color:#718096; margin-top:16px;">If you have already paid, please disregard this message.</p>
  `;
  return { subject, html: emailShell(biz, subject, body) };
}

function buildPaymentReceipt(biz: BizSettings, d: any) {
  const subject = `✅ Payment Received — ${biz.name} · ${esc(d.invoiceNumber)}`;
  // No siempre hay un invoice real ligado al pago (el depósito del booking
  // se cobra directo con Square, nunca pasa por la tabla invoices) — sin
  // publicToken no hay a dónde enlazar un "View Receipt" válido, así que
  // se omite el botón en vez de armar un link con token=null (404/expired).
  const url = d.publicToken ? payUrl(biz, d.publicToken) : null;
  const body = `
    <div style="background:#f0fff4; border:1px solid #9ae6b4; border-radius:8px; padding:16px 20px; text-align:center; margin-bottom:24px;">
      <div style="font-size:32px; margin-bottom:8px;">✅</div>
      <h2 style="font-family:'Rajdhani',Georgia,sans-serif; color:#276749; margin:0; font-size:20px;">Payment Received!</h2>
    </div>
    <p style="color:#4a5568;">Hi ${esc(d.customerName)}, thank you for your payment. Here is your receipt.</p>
    ${detailCard([
      { label: 'Receipt #', value: esc(d.invoiceNumber) },
      ...(d.service ? [{ label: 'Service', value: esc(d.service) }] : []),
      ...(vehicleLine(d) ? [{ label: 'Vehicle', value: esc(vehicleLine(d)) }] : []),
      { label: 'Amount Paid', value: fmtCurrency(d.amountPaid), valueColor: '#276749' },
      { label: 'Date', value: esc(fmtDate(d.paidAt)) },
      ...(d.squarePaymentId ? [{ label: 'Reference', value: `<span style="font-family:monospace; font-size:12px; color:#718096;">${esc(d.squarePaymentId)}</span>` }] : []),
    ], '#276749')}
    ${url ? ctaButton(url, 'View Receipt', biz.primary_color || '#104872') : ''}
    ${d.reviewUrl ? `
    <div style="text-align:center; margin:8px 0 0; padding:20px; background:#fffbeb; border-radius:8px; border:1px solid #FFAA00;">
      <p style="margin:0 0 12px; font-size:14px; color:#744210; font-weight:600;">Enjoying your detail? Leave us a review! ⭐</p>
      <a href="${esc(d.reviewUrl)}" style="background:#FFAA00; color:#ffffff; text-decoration:none; font-family:'Rajdhani',Georgia,sans-serif; font-size:14px; font-weight:700; padding:10px 24px; border-radius:6px; display:inline-block;">Leave a Google Review →</a>
    </div>` : ''}
  `;
  return { subject, html: emailShell(biz, subject, body) };
}

const BUILDERS: Record<string, (biz: BizSettings, d: any) => { subject: string; html: string }> = {
  booking_confirmation: buildBookingConfirmation,
  job_confirmed: buildJobConfirmed,
  reminder_24h: buildReminder24h,
  job_completed: buildJobCompleted,
  internal_notification: buildInternalNotification,
  invoice_link: buildInvoiceLink,
  payment_receipt: buildPaymentReceipt,
};

const TOGGLE_KEY: Record<string, string> = {
  booking_confirmation: 'booking_confirmation',
  job_confirmed: 'job_confirmed',
  reminder_24h: 'reminder_24h',
  job_completed: 'job_completed',
  internal_notification: 'internal_notification',
  invoice_link: 'invoice_link',
  payment_receipt: 'payment_receipt',
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
