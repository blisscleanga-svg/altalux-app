// ============================================================
// AltaLux — Track Payment Event Edge Function
// ============================================================
// Edge Function pública — registra eventos de interacción con el link
// de pago (link_opened, payment_started, payment_failed). No requiere
// autenticación — validada por public_token contra invoices.sent_at.
//
// payment_completed NO se registra acá — lo inserta square-payment
// directamente, server-side, tras confirmar el cobro con Square (este
// endpoint público nunca podría confirmar un pago real por sí solo).
//
// Deploy con:
//   supabase functions deploy track-payment-event
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

const ALLOWED_EVENTS = ['link_opened', 'payment_started', 'payment_failed'];
// Límites conservadores para evitar spam/datos corruptos — una persona
// rara vez abre un link de pago o falla un formulario más de estas veces.
const RATE_LIMITS: Record<string, number> = {
  link_opened: 5,
  payment_started: 3,
  payment_failed: 3,
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { token, event_type, metadata = {} } = body;

    if (!token || !event_type) {
      return jsonResponse({ error: 'token y event_type son requeridos.' }, 400);
    }
    if (!ALLOWED_EVENTS.includes(event_type)) {
      return jsonResponse({ error: 'event_type no permitido desde el cliente.' }, 400);
    }

    const supabase = getSupabaseAdmin();

    // Solo invoices ya enviadas (sent_at no null) — nunca un draft.
    const { data: invoice, error: invError } = await supabase
      .from('invoices')
      .select('id, business_id, job_id, link_open_count')
      .eq('public_token', token)
      .not('sent_at', 'is', null)
      .single();

    if (invError || !invoice) {
      // 200 siempre — nunca revelar si el token existe o no.
      return jsonResponse({ ok: true });
    }

    const limit = RATE_LIMITS[event_type] ?? 3;
    const { count } = await supabase
      .from('payment_events')
      .select('*', { count: 'exact', head: true })
      .eq('invoice_id', invoice.id)
      .eq('event_type', event_type);

    if (count !== null && count >= limit) {
      return jsonResponse({ ok: true });
    }

    await supabase.from('payment_events').insert({
      invoice_id: invoice.id,
      business_id: invoice.business_id,
      job_id: invoice.job_id,
      event_type,
      metadata,
    });

    if (event_type === 'link_opened') {
      // RPC atómico — evita race condition si se abre en 2 tabs a la vez.
      await supabase.rpc('increment_link_open_count', { inv_id: invoice.id });

      if (!invoice.link_open_count || invoice.link_open_count === 0) {
        await supabase
          .from('invoices')
          .update({ link_opened_at: new Date().toISOString() })
          .eq('id', invoice.id);
      }
    }

    if (event_type === 'payment_started') {
      await supabase
        .from('invoices')
        .update({ payment_started_at: new Date().toISOString() })
        .eq('id', invoice.id);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('[track-payment-event] Error:', err);
    // Nunca revelar errores internos al cliente público.
    return jsonResponse({ ok: true });
  }
});
