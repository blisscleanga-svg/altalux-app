// ============================================================
// AltaLux / multi-tenant — Twilio Inbound SMS Webhook
// ============================================================
// Public endpoint (no Supabase JWT — Twilio can't send one). Configure
// this function's URL as the "A MESSAGE COMES IN" webhook on the
// business's Twilio phone number, once toll-free verification is
// approved:
//   https://<project-ref>.supabase.co/functions/v1/twilio-webhook
//
// Twilio POSTs application/x-www-form-urlencoded (From, To, Body,
// MessageSid, ...). Every request is validated against
// X-Twilio-Signature before anything is trusted — this is the only
// thing standing between this table and anyone on the internet
// forging inbound messages.
//
// Deploy with:
//   supabase functions deploy twilio-webhook --no-verify-jwt
// Set the secrets once with:
//   supabase secrets set TWILIO_AUTH_TOKEN=your_token_here
//   supabase secrets set TWILIO_WEBHOOK_URL=https://<project-ref>.supabase.co/functions/v1/twilio-webhook
// (TWILIO_WEBHOOK_URL must match EXACTLY what's configured in the
// Twilio console — signature validation hashes this URL string, and
// Supabase's edge runtime doesn't reliably expose the same public URL
// via req.url, so it's pinned as a secret instead of trusted from the
// request.)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
const TWILIO_WEBHOOK_URL = Deno.env.get('TWILIO_WEBHOOK_URL') ?? '';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function getSupabaseAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase service credentials are not configured for this function.');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function twiml(message?: string): Response {
  const xmlBody = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new Response(xmlBody, { headers: { 'Content-Type': 'text/xml' } });
}

// ---------- Validación de firma Twilio ----------
// https://www.twilio.com/docs/usage/security#validating-requests
async function validateTwilioSignature(url: string, params: Record<string, string>, signature: string): Promise<boolean> {
  if (!TWILIO_AUTH_TOKEN || !signature) return false;
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) data += key + params[key];

  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(TWILIO_AUTH_TOKEN), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const sigBytes = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));
  return computed === signature;
}

function toE164(raw: string): string | null {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return null;
}

function last10(raw: string): string {
  return String(raw || '').replace(/\D/g, '').slice(-10);
}

const STOP_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const START_KEYWORDS = new Set(['START', 'UNSTOP', 'YES']);
const HELP_KEYWORDS = new Set(['HELP', 'INFO']);

const HELP_MESSAGE = 'AltaLux Mobile Detail: For help, visit https://app.altaluxdetail.com or call (888) 853-0590. Msg & data rates may apply. Reply STOP to unsubscribe.';
const STOP_MESSAGE = 'You have been unsubscribed from AltaLux Mobile Detail. Reply START to resubscribe.';
const START_MESSAGE = "You're resubscribed to AltaLux Mobile Detail messages. Reply STOP at any time to opt out.";

async function findMatchingCustomer(supabase: any, businessId: string, fromE164: string): Promise<string | null> {
  const { data: customers, error } = await supabase
    .from('customers')
    .select('id, phones, phone')
    .eq('business_id', businessId);
  if (error || !customers) return null;
  const target = last10(fromE164);
  for (const c of customers as any[]) {
    if (c.phone && last10(c.phone) === target) return c.id;
    const phones = Array.isArray(c.phones) ? c.phones : [];
    if (phones.some((p: any) => p && last10(p.number) === target)) return c.id;
  }
  return null;
}

async function logInbound(supabase: any, businessId: string, phone: string, body: string, sid: string | null) {
  const customerId = await findMatchingCustomer(supabase, businessId, phone);
  const { error } = await supabase.from('sms_messages').insert([{
    business_id: businessId, customer_id: customerId, phone, direction: 'inbound',
    body, twilio_sid: sid, status: 'received', action: null, read: false,
  }]);
  if (error) console.error('[twilio-webhook] Failed to log inbound message:', error);
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return twiml();

  try {
    const formData = await req.formData();
    const params: Record<string, string> = {};
    formData.forEach((value, key) => { params[key] = String(value); });

    const signature = req.headers.get('X-Twilio-Signature') || '';
    const validationUrl = TWILIO_WEBHOOK_URL || req.url;
    const validSignature = await validateTwilioSignature(validationUrl, params, signature);
    if (!validSignature) {
      console.error('[twilio-webhook] Invalid X-Twilio-Signature — rejecting.');
      return new Response('Forbidden', { status: 403 });
    }

    const from = params.From;
    const to = params.To;
    const rawBody = params.Body || '';
    const sid = params.MessageSid || null;
    if (!from || !to) return twiml();

    const supabase = getSupabaseAdmin();

    const { data: biz } = await supabase
      .from('business_settings')
      .select('business_id')
      .eq('twilio_phone', to)
      .maybeSingle();
    if (!biz) {
      console.error(`[twilio-webhook] No business found for twilio_phone "${to}" — dropping message.`);
      return twiml();
    }
    const businessId = biz.business_id as string;

    const fromE164 = toE164(from) || from;
    const keyword = rawBody.trim().toUpperCase();

    if (STOP_KEYWORDS.has(keyword)) {
      await supabase.from('sms_opt_outs').upsert(
        { business_id: businessId, phone: fromE164, opted_out_at: new Date().toISOString() },
        { onConflict: 'business_id,phone' }
      );
      await logInbound(supabase, businessId, fromE164, rawBody, sid);
      return twiml(STOP_MESSAGE);
    }
    if (START_KEYWORDS.has(keyword)) {
      await supabase.from('sms_opt_outs').upsert(
        { business_id: businessId, phone: fromE164, opted_out_at: null },
        { onConflict: 'business_id,phone' }
      );
      await logInbound(supabase, businessId, fromE164, rawBody, sid);
      return twiml(START_MESSAGE);
    }
    if (HELP_KEYWORDS.has(keyword)) {
      await logInbound(supabase, businessId, fromE164, rawBody, sid);
      return twiml(HELP_MESSAGE);
    }

    await logInbound(supabase, businessId, fromE164, rawBody, sid);
    return twiml();
  } catch (err) {
    console.error('[twilio-webhook] Error:', err);
    return twiml();
  }
});
