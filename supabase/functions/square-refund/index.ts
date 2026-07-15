// ============================================================
// AltaLux — Square Refund Edge Function
// ============================================================
// Receives { payment_id, amount_to_refund, reason } where payment_id is
// the invoice_payments.id (uuid) — not the Square payment id directly.
// Looks up the real square_payment_id, calls Square's Refunds API, and
// records the result in invoice_refunds.
//
// Deploy with:
//   supabase functions deploy square-refund
// Uses the same SQUARE_ACCESS_TOKEN secret as square-payment — no
// separate setup needed.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SQUARE_ACCESS_TOKEN = Deno.env.get('SQUARE_ACCESS_TOKEN') ?? '';
const SQUARE_API_BASE = 'https://connect.squareup.com/v2';

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

async function squareRequest(path: string, method: string, body?: unknown) {
  if (!SQUARE_ACCESS_TOKEN) {
    throw new Error('SQUARE_ACCESS_TOKEN is not configured. Set it with `supabase secrets set SQUARE_ACCESS_TOKEN=...`.');
  }
  const res = await fetch(`${SQUARE_API_BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Square-Version': '2024-01-18',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    const message = data?.errors?.[0]?.detail || data?.errors?.[0]?.code || 'Square API request failed.';
    throw new Error(message);
  }
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { payment_id, amount_to_refund, reason } = body;

    if (!payment_id || !amount_to_refund) {
      return jsonResponse({ error: 'payment_id and amount_to_refund are required.' }, 400);
    }

    const supabase = getSupabaseAdmin();

    const { data: invoicePayment, error: findErr } = await supabase
      .from('invoice_payments')
      .select('*')
      .eq('id', payment_id)
      .single();
    if (findErr || !invoicePayment) {
      return jsonResponse({ error: `Payment ${payment_id} was not found.` }, 404);
    }
    if (!invoicePayment.square_payment_id) {
      return jsonResponse({ error: 'This payment has no associated Square payment ID — it may not have been a Square charge.' }, 400);
    }

    const amountCents = Math.round(Number(amount_to_refund) * 100);
    if (!amountCents || amountCents <= 0) {
      return jsonResponse({ error: 'amount_to_refund must be a positive number.' }, 400);
    }
    // Validación de input (auditoría de seguridad 2026-07-15): el reembolso
    // nunca puede superar el monto original del pago.
    if (Number(amount_to_refund) > Number(invoicePayment.amount)) {
      return jsonResponse({ error: 'El monto de reembolso no puede superar el pago original.' }, 400);
    }
    if (!reason || String(reason).trim().length < 3) {
      return jsonResponse({ error: 'Se requiere una razón para el reembolso (mínimo 3 caracteres).' }, 400);
    }

    let refundResult;
    let status = 'pending';
    try {
      refundResult = await squareRequest('/refunds', 'POST', {
        idempotency_key: crypto.randomUUID(),
        payment_id: invoicePayment.square_payment_id,
        amount_money: { amount: amountCents, currency: 'USD' },
        reason: reason || undefined,
      });
      status = refundResult.refund?.status === 'COMPLETED' ? 'completed' : 'pending';
    } catch (squareErr) {
      status = 'failed';
      const { error: insertErr } = await supabase.from('invoice_refunds').insert([{
        payment_id,
        square_refund_id: null,
        amount: amount_to_refund,
        reason: reason || null,
        status: 'failed',
      }]);
      if (insertErr) console.error('[square-refund] Failed to log failed refund attempt:', insertErr);
      throw squareErr;
    }

    const refundId = refundResult.refund?.id || null;
    const { error: insertErr } = await supabase.from('invoice_refunds').insert([{
      payment_id,
      square_refund_id: refundId,
      amount: amount_to_refund,
      reason: reason || null,
      status,
    }]);
    if (insertErr) console.error('[square-refund] Refund succeeded at Square but failed to log in Supabase:', insertErr);

    if (status === 'completed') {
      const { error: updateErr } = await supabase
        .from('invoice_payments')
        .update({ status: 'refunded' })
        .eq('id', payment_id);
      if (updateErr) console.error('[square-refund] Failed to mark invoice_payments as refunded:', updateErr);
    }

    // Auditoría (auditoría de seguridad 2026-07-15) — nunca bloquea la respuesta al cliente.
    try {
      const { error: auditErr } = await supabase.from('audit_log').insert([{
        business_id: invoicePayment.business_id || 'altalux',
        action: 'refund_issued',
        entity_type: 'invoice_payment',
        entity_id: payment_id,
        metadata: { amount_refunded: amount_to_refund, reason, square_refund_id: refundId, status },
      }]);
      if (auditErr) console.error('[square-refund] audit_log insert failed:', auditErr);
    } catch (auditErr) {
      console.error('[square-refund] audit_log insert threw:', auditErr);
    }

    return jsonResponse({ success: true, refund_id: refundId, status });
  } catch (err) {
    console.error('[square-refund] Error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected error.' }, 500);
  }
});
