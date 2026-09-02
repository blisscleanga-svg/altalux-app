// ============================================================
// AltaLux / multi-tenant — Send SMS Edge Function (Twilio)
// ============================================================
// Handles 2 actions from the client:
//   - booking_confirmation : to customer, right after a booking is paid
//   - manual_reply         : to customer, staff reply typed in the
//                             admin Message Center (raw body, no template)
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
function buildBookingConfirmation(biz: BizSettings, d: any): string {
  return `Hi ${d.customerName || 'there'}, this is ${biz.name} confirming your ${d.service || 'detail'} appointment on ${fmtDate(d.date)} at ${d.time}. Deposit paid: ${fmtCurrency(d.deposit)}. Balance due at service: ${fmtCurrency(d.balance)}. Reply STOP to opt out.`;
}

const BUILDERS: Record<string, (biz: BizSettings, d: any) => string> = {
  booking_confirmation: buildBookingConfirmation,
};

const TOGGLE_KEY: Record<string, string> = {
  booking_confirmation: 'booking_confirmation',
};

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
    throw new Error(data?.message || 'Twilio API request failed.');
  }
  return { sid: data.sid, status: data.status };
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

    if (!action || (action !== 'manual_reply' && !BUILDERS[action])) {
      return jsonResponse({ error: `Unknown action: ${action}. Expected one of ${[...Object.keys(BUILDERS), 'manual_reply'].join(', ')}.` }, 400);
    }
    if (!businessId) return jsonResponse({ error: 'businessId is required.' }, 400);

    const supabase = getSupabaseAdmin();
    const biz = await getBizSettings(businessId);

    if (!biz.twilio_enabled || !biz.twilio_phone) {
      return jsonResponse({ error: `Twilio is not configured/enabled for business "${businessId}".` }, 400);
    }

    const toggleKey = TOGGLE_KEY[action];
    if (biz.sms_toggles && toggleKey && biz.sms_toggles[toggleKey] === false) {
      return jsonResponse({ skipped: true, reason: `SMS type "${action}" is disabled for this business.` });
    }

    const rawPhone = data && (data.customerPhone || data.phone);
    if (!rawPhone) return jsonResponse({ error: `No recipient phone available for action "${action}".` }, 400);
    const to = toE164(rawPhone);
    if (!to) return jsonResponse({ error: `Phone number "${rawPhone}" could not be normalized to a US E.164 number.` }, 400);

    const { data: optOut } = await supabase
      .from('sms_opt_outs')
      .select('opted_out_at')
      .eq('business_id', businessId)
      .eq('phone', to)
      .maybeSingle();
    if (optOut && optOut.opted_out_at) {
      return jsonResponse({ skipped: true, reason: 'Recipient has opted out of SMS.' });
    }

    const messageBody = action === 'manual_reply'
      ? String((data && data.body) || '').slice(0, 1600)
      : BUILDERS[action](biz, data || {});
    if (!messageBody) return jsonResponse({ error: 'Message body is empty.' }, 400);

    let sid: string | null = null;
    let status = 'failed';
    try {
      const result = await sendViaTwilio(to, biz.twilio_phone, messageBody);
      sid = result.sid;
      status = result.status;
    } catch (sendErr) {
      await logMessage(supabase, {
        business_id: businessId, customer_id: (data && data.customerId) || null, phone: to,
        direction: 'outbound', body: messageBody, twilio_sid: null, status: 'failed',
        action: action === 'manual_reply' ? 'manual_reply' : action,
      });
      throw sendErr;
    }

    await logMessage(supabase, {
      business_id: businessId, customer_id: (data && data.customerId) || null, phone: to,
      direction: 'outbound', body: messageBody, twilio_sid: sid, status,
      action: action === 'manual_reply' ? 'manual_reply' : action,
    });

    return jsonResponse({ success: true, sid });
  } catch (err) {
    console.error('[send-sms] Error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected error.' }, 500);
  }
});
