// ============================================================
// AltaLux / multi-tenant — Send SMS Edge Function (Twilio)
// ============================================================
// Handles 2 actions from the client, with two DIFFERENT trust models:
//
//   - booking_confirmation : to customer, right after a booking is paid.
//       Callable with the public anon key (the booking widget is
//       legitimately anonymous), but the client only sends
//       { data: { bookingId } } — the function re-reads the real
//       `bookings` row server-side with the service role and builds the
//       message (and picks the recipient) entirely from that row's own
//       columns. Nothing the caller types ends up in the SMS or decides
//       who receives it. `bookings.receive_reminders` is the SOURCE OF
//       TRUTH for whether to send at all.
//
//   - manual_reply         : to customer, staff reply typed in the
//       admin Message Center (raw body, no template). Requires a real
//       Supabase Auth session belonging to an ACTIVE employee of the
//       same business (any role — Managers/Technicians reply to
//       customers day to day too). Same verification shape as
//       manage-employee-auth.
//
// Both actions are additionally rate limited per (business_id, phone).
//
// Mirrors supabase/functions/send-email's structure and conventions.
// One global Twilio account serves every business for now (per Fase 5
// spec): TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are Supabase secrets,
// not per-business columns. The "From" number IS per-business
// (business_settings.twilio_phone).
//
// Deploy with:
//   supabase functions deploy send-sms
// Set the secrets once with:
//   supabase secrets set TWILIO_ACCOUNT_SID=your_sid_here
//   supabase secrets set TWILIO_AUTH_TOKEN=your_token_here
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

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
  twilio_phone: string | null;
  twilio_enabled: boolean;
  sms_toggles: Record<string, boolean> | null;
}

async function getBizSettings(businessId: string): Promise<BizSettings> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('business_settings')
    .select('business_id, name, twilio_phone, twilio_enabled, sms_toggles')
    .eq('business_id', businessId)
    .single();
  if (error || !data) throw new Error(`No business_settings found for business_id "${businessId}".`);
  return data as BizSettings;
}

// ---------- Normalización de teléfono a E.164 (solo US, 10 dígitos) ----------
function toE164(raw: string): string | null {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return null;
}

function fmtCurrency(amount: number | string | null | undefined): string {
  const n = Number(amount || 0);
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(date: string | null | undefined): string {
  if (!date) return '';
  const d = new Date(date + (date.length <= 10 ? 'T00:00:00' : ''));
  if (isNaN(d.getTime())) return String(date);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ---------- SMS builders ----------
// `row` is ALWAYS a server-fetched database row, never client input.
interface BookingRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  category: string | null;
  service_date: string | null;
  service_time: string | null;
  deposit: number | string | null;
  total: number | string | null;
  receive_reminders: boolean | null;
}

function buildBookingConfirmation(biz: BizSettings, row: BookingRow): string {
  const balance = Number(row.total || 0) - Number(row.deposit || 0);
  return `Hi ${row.full_name || 'there'}, this is ${biz.name} confirming your ${row.category || 'detail'} appointment on ${fmtDate(row.service_date)} at ${row.service_time || ''}. Deposit paid: ${fmtCurrency(row.deposit)}. Balance due at service: ${fmtCurrency(balance)}. Reply STOP to opt out.`;
}

const TEMPLATED_ACTIONS = new Set(['booking_confirmation']);

const TOGGLE_KEY: Record<string, string> = {
  booking_confirmation: 'booking_confirmation',
};

class TwilioError extends Error {
  code: number | null;
  constructor(message: string, code: number | null) {
    super(message);
    this.name = 'TwilioError';
    this.code = code;
  }
}

async function sendViaTwilio(to: string, from: string, body: string): Promise<{ sid: string; status: string }> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error('Twilio credentials are not configured. Set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN with `supabase secrets set`.');
  }
  const basicAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const params = new URLSearchParams({ To: to, From: from, Body: body });
  const res = await fetch(`${TWILIO_API_BASE}/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    const code = typeof data?.code === 'number' ? data.code : Number(data?.code) || null;
    throw new TwilioError(data?.message || 'Twilio API request failed.', code);
  }
  return { sid: data.sid, status: data.status };
}

// Twilio error 21610 = "recipient unsubscribed" — Twilio handles STOP at
// the carrier/number level independently of our sms_opt_outs table, so
// treat its answer as authoritative and self-heal our local list.
const TWILIO_UNSUBSCRIBED_CODE = 21610;

async function recordTwilioOptOut(supabase: any, businessId: string, phone: string) {
  const { error } = await supabase.from('sms_opt_outs').upsert(
    { business_id: businessId, phone, opted_out_at: new Date().toISOString() },
    { onConflict: 'business_id,phone' }
  );
  if (error) console.error('[send-sms] Failed to record Twilio-reported opt-out:', error);
}

// ---------- Rate limiting ----------
// Cheap per-(business, phone) cap. 5 per 5 minutes: loose enough not to
// break a legitimate rapid back-and-forth conversation in the Message
// Center, tight enough that this endpoint can't be pumped. Over the
// limit we skip quietly rather than erroring loudly, so a prober can't
// distinguish "rate limited" from "nothing happened".
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

async function isRateLimited(supabase: any, businessId: string, phone: string): Promise<boolean> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count, error } = await supabase
    .from('sms_messages')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('phone', phone)
    .gte('created_at', since);
  if (error) {
    console.error('[send-sms] Rate-limit check failed (allowing send):', error);
    return false;
  }
  return (count ?? 0) >= RATE_LIMIT_MAX;
}

// ---------- Caller verification (manual_reply only) ----------
// Same shape as manage-employee-auth: a real Supabase Auth access token,
// resolved to an ACTIVE employee row of the SAME business as the payload.
// Any active role may send a reply — this is not an Owner-only action.
interface AuthFailure { status: number; error: string }

async function requireActiveEmployee(admin: any, req: Request, businessId: string): Promise<AuthFailure | null> {
  const authHeader = req.headers.get('Authorization') || '';
  const callerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!callerToken) return { status: 401, error: 'Missing Authorization header.' };

  let callerEmail: string | null = null;
  try {
    const { data: callerData, error: callerErr } = await admin.auth.getUser(callerToken);
    if (callerErr || !callerData?.user?.email) return { status: 401, error: 'Not authenticated.' };
    callerEmail = callerData.user.email;
  } catch (_err) {
    // A malformed/garbage bearer token must be a clean 401, never a 500.
    return { status: 401, error: 'Not authenticated.' };
  }

  // ilike (not eq) because employees.email casing isn't normalized, but the
  // LIKE metacharacters have to be escaped or `john_doe@x.com` would also
  // match `johnXdoe@x.com` — i.e. a non-employee could match an employee row.
  const emailPattern = (callerEmail as string).replace(/[\\%_]/g, '\\$&');
  const { data: employee, error: empErr } = await admin
    .from('employees')
    .select('role, is_active, business_id')
    .ilike('email', emailPattern)
    .maybeSingle();
  if (empErr) return { status: 403, error: 'Only an active employee of this business can send messages.' };
  if (!employee || employee.is_active === false || employee.business_id !== businessId) {
    return { status: 403, error: 'Only an active employee of this business can send messages.' };
  }
  return null;
}

async function logMessage(supabase: any, row: {
  business_id: string; customer_id: string | null; phone: string; direction: string;
  body: string; twilio_sid: string | null; status: string; action: string | null;
}) {
  const { error } = await supabase.from('sms_messages').insert([{ ...row, read: true }]);
  if (error) console.error('[send-sms] Failed to log message (SMS itself may have sent fine):', error);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, businessId, data } = body;

    if (!action || (action !== 'manual_reply' && !TEMPLATED_ACTIONS.has(action))) {
      return jsonResponse({ error: `Unknown action: ${action}. Expected one of ${[...TEMPLATED_ACTIONS, 'manual_reply'].join(', ')}.` }, 400);
    }
    if (!businessId) return jsonResponse({ error: 'businessId is required.' }, 400);

    const supabase = getSupabaseAdmin();

    // manual_reply lets a caller pick an arbitrary recipient AND write an
    // arbitrary body — it must be an authenticated employee of this very
    // business. Checked BEFORE anything else touches the database.
    if (action === 'manual_reply') {
      const authFailure = await requireActiveEmployee(supabase, req, businessId);
      if (authFailure) return jsonResponse({ error: authFailure.error }, authFailure.status);
    }

    const biz = await getBizSettings(businessId);

    if (!biz.twilio_enabled || !biz.twilio_phone) {
      return jsonResponse({ error: `Twilio is not configured/enabled for business "${businessId}".` }, 400);
    }

    const toggleKey = TOGGLE_KEY[action];
    if (biz.sms_toggles && toggleKey && biz.sms_toggles[toggleKey] === false) {
      return jsonResponse({ skipped: true, reason: `SMS type "${action}" is disabled for this business.` });
    }

    // ---- Recipient + body: derived server-side for templated actions ----
    let rawPhone: string | null = null;
    let messageBody = '';
    let customerId: string | null = null;

    if (action === 'manual_reply') {
      rawPhone = (data && (data.customerPhone || data.phone)) || null;
      messageBody = String((data && data.body) || '').slice(0, 1600);
      customerId = (data && data.customerId) || null;
    } else if (action === 'booking_confirmation') {
      const bookingId = data && data.bookingId;
      if (!bookingId) return jsonResponse({ error: 'data.bookingId is required for booking_confirmation.' }, 400);
      // Shape-check before it reaches PostgREST, so a junk id is a clean 400
      // rather than a 500 from the uuid cast.
      if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(String(bookingId))) {
        return jsonResponse({ error: 'data.bookingId must be a uuid.' }, 400);
      }

      const { data: booking, error: bookingErr } = await supabase
        .from('bookings')
        .select('id, full_name, phone, category, service_date, service_time, deposit, total, receive_reminders')
        .eq('id', bookingId)
        .eq('business_id', businessId)
        .maybeSingle();
      if (bookingErr) throw bookingErr;
      if (!booking) return jsonResponse({ error: 'Booking not found for this business.' }, 404);

      const row = booking as BookingRow;
      // The booking row itself is the source of truth for consent — the
      // client-side check in booking/index.html is only a first gate.
      if (!row.receive_reminders) {
        return jsonResponse({ skipped: true, reason: 'Customer did not opt in to SMS on this booking.' });
      }
      rawPhone = row.phone;
      messageBody = buildBookingConfirmation(biz, row);
    }

    if (!rawPhone) return jsonResponse({ error: `No recipient phone available for action "${action}".` }, 400);
    const to = toE164(rawPhone);
    if (!to) return jsonResponse({ error: `Phone number "${rawPhone}" could not be normalized to a US E.164 number.` }, 400);
    if (!messageBody) return jsonResponse({ error: 'Message body is empty.' }, 400);

    const { data: optOut } = await supabase
      .from('sms_opt_outs')
      .select('opted_out_at')
      .eq('business_id', businessId)
      .eq('phone', to)
      .maybeSingle();
    if (optOut && optOut.opted_out_at) {
      return jsonResponse({ skipped: true, reason: 'Recipient has opted out of SMS.' });
    }

    if (await isRateLimited(supabase, businessId, to)) {
      console.warn(`[send-sms] Rate limit hit for ${businessId} / ${to} — skipping "${action}".`);
      return jsonResponse({ skipped: true, reason: 'rate_limited' });
    }

    let sid: string | null = null;
    let status = 'failed';
    try {
      const result = await sendViaTwilio(to, biz.twilio_phone, messageBody);
      sid = result.sid;
      status = result.status;
    } catch (sendErr) {
      if (sendErr instanceof TwilioError && sendErr.code === TWILIO_UNSUBSCRIBED_CODE) {
        await recordTwilioOptOut(supabase, businessId, to);
      }
      await logMessage(supabase, {
        business_id: businessId, customer_id: customerId, phone: to,
        direction: 'outbound', body: messageBody, twilio_sid: null, status: 'failed',
        action,
      });
      throw sendErr;
    }

    await logMessage(supabase, {
      business_id: businessId, customer_id: customerId, phone: to,
      direction: 'outbound', body: messageBody, twilio_sid: sid, status,
      action,
    });

    return jsonResponse({ success: true, sid });
  } catch (err) {
    console.error('[send-sms] Error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected error.' }, 500);
  }
});
