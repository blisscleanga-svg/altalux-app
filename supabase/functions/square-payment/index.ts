// ============================================================
// AltaLux — Square Payment Edge Function
// ============================================================
// Handles three actions from the client:
//   - create_link : creates a Square-hosted payment link
//   - charge      : tokenized card charge via Square Payments API
//   - record_payment : manual insert (Cash/Zelle/Check/Other) that
//                       still needs the payments/jobs bookkeeping
//
// Deploy with:
//   supabase functions deploy square-payment
// Set the secret once with:
//   supabase secrets set SQUARE_ACCESS_TOKEN=your_token_here
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by
// the Supabase platform into every Edge Function — no manual setup
// needed for those two.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SQUARE_ACCESS_TOKEN = Deno.env.get('SQUARE_ACCESS_TOKEN') ?? '';
const SQUARE_LOCATION_ID = 'LEWG2XNWRA7BS';
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

// ---- Auditoría (auditoría de seguridad 2026-07-15) — nunca bloquea el flujo de pago ----
async function writeAuditLog(params: {
  businessId?: string | null; action: string; entityType?: string; entityId?: string | null; metadata?: unknown;
}) {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('audit_log').insert([{
      business_id: params.businessId || 'altalux',
      action: params.action,
      entity_type: params.entityType || null,
      entity_id: params.entityId || null,
      metadata: params.metadata || null,
    }]);
    if (error) console.error('[square-payment] audit_log insert failed:', error);
  } catch (err) {
    console.error('[square-payment] audit_log insert threw:', err);
  }
}

// ---- Records a completed payment against Supabase and returns the updated job ----
async function recordPaymentInSupabase(params: {
  jobId: string; amount: number; method: string; reference?: string; notes?: string;
}) {
  const supabase = getSupabaseAdmin();
  const numericJobNumber = Number(params.jobId);

  const { data: job, error: jobFindErr } = await supabase
    .from('jobs')
    .select('*')
    .eq('job_number', numericJobNumber)
    .single();
  if (jobFindErr || !job) throw new Error(`Job ${params.jobId} was not found in the database.`);

  const { error: paymentErr } = await supabase.from('payments').insert([{
    job_id: job.id,
    amount: params.amount,
    payment_method: params.method,
    payment_type: 'Balance',
    payment_date: new Date().toISOString().slice(0, 10),
    reference_number: params.reference || null,
    notes: params.notes || null,
  }]);
  if (paymentErr) throw new Error(paymentErr.message);

  const { data: allPayments, error: paymentsListErr } = await supabase
    .from('payments')
    .select('amount')
    .eq('job_id', job.id);
  if (paymentsListErr) throw new Error(paymentsListErr.message);

  const totalPaid = (allPayments || []).reduce((sum: number, p: { amount: number }) => sum + Number(p.amount), 0);
  const balanceDue = Math.max(0, Number(job.total) - totalPaid);
  const paymentStatus = balanceDue <= 0.005 ? 'Paid in Full' : (totalPaid > 0 ? 'Deposit Paid' : 'Unpaid');

  const { data: updatedJob, error: updateErr } = await supabase
    .from('jobs')
    .update({ balance_due: balanceDue, payment_status: paymentStatus })
    .eq('id', job.id)
    .select()
    .single();
  if (updateErr) throw new Error(updateErr.message);

  return updatedJob;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action } = body;

    if (action === 'create_link') {
      const { amount, jobId, customerName, description, redirectUrl } = body;
      if (!amount || !jobId) return jsonResponse({ error: 'amount and jobId are required.' }, 400);

      const result = await squareRequest('/online-checkout/payment-links', 'POST', {
        idempotency_key: crypto.randomUUID(),
        quick_pay: {
          name: description || `AltaLux Detail — Job ${jobId}`,
          price_money: { amount, currency: 'USD' },
          location_id: SQUARE_LOCATION_ID,
        },
        checkout_options: redirectUrl ? { redirect_url: redirectUrl } : undefined,
      });

      return jsonResponse({ url: result.payment_link?.url, id: result.payment_link?.id });
    }

    if (action === 'charge') {
      const { sourceId, publicToken } = body;
      const { amount, jobId } = body;

      // ---- Pago público vía /pay/ (link de invoice) ----
      // El monto SIEMPRE sale de Supabase (invoice.final_amount), nunca del
      // cliente — esto es lo único que distingue este modo del de abajo.
      // No toca ni comparte código con el flujo de depósitos/balance existente.
      if (publicToken) {
        if (!sourceId || typeof sourceId !== 'string' || sourceId.length < 10) {
          return jsonResponse({ error: 'Token de pago inválido.' }, 400);
        }

        const supabase = getSupabaseAdmin();
        const { data: invoice, error: invErr } = await supabase
          .from('invoices')
          .select('id, final_amount, status, sent_at, invoice_number, created_at, business_id, job_id')
          .eq('public_token', publicToken)
          .single();
        if (invErr || !invoice) return jsonResponse({ error: 'Invoice not found.' }, 404);
        if (invoice.status === 'Paid') return jsonResponse({ error: 'Invoice already paid.' }, 409);
        if (!invoice.sent_at) return jsonResponse({ error: 'Invoice not available for payment.' }, 403);

        const amountInCents = Math.round(Number(invoice.final_amount) * 100);
        if (!amountInCents || amountInCents <= 0) {
          return jsonResponse({ error: 'Invalid invoice amount.' }, 400);
        }

        const result = await squareRequest('/payments', 'POST', {
          source_id: sourceId,
          // Bug 2026-07-16: invoice.id (36) + '-' + Date.now() (13) = 50
          // caracteres — Square exige idempotency_key de máximo 45. Por
          // eso el pago nunca pasaba ("Field must not be greater than 45
          // length"). Mismo patrón ya usado en el resto del archivo.
          idempotency_key: crypto.randomUUID(),
          amount_money: { amount: amountInCents, currency: 'USD' },
          location_id: SQUARE_LOCATION_ID,
          note: `AltaLux Invoice INV-${new Date(invoice.created_at).getFullYear()}-${String(invoice.invoice_number).padStart(4, '0')}`,
        });

        const paymentId = result.payment?.id;
        // REST API directo (no SDK Node) → la respuesta de Square viene en snake_case.
        const cardBrand = result.payment?.card_details?.card?.card_brand || null;
        const cardLast4 = result.payment?.card_details?.card?.last_4 || null;
        const paidAt = new Date().toISOString();

        const { error: updInvErr } = await supabase
          .from('invoices')
          .update({
            status: 'Paid', paid_at: paidAt, amount_paid: invoice.final_amount,
            card_brand: cardBrand, card_last4: cardLast4, square_payment_id: paymentId,
          })
          .eq('id', invoice.id);
        if (updInvErr) console.error('[square-payment] Failed to mark invoice paid:', updInvErr);

        const { error: invPayErr } = await supabase.from('invoice_payments').insert([{
          invoice_id: invoice.id, business_id: invoice.business_id,
          square_payment_id: paymentId, amount: invoice.final_amount, status: 'completed',
        }]);
        if (invPayErr) console.error('[square-payment] Failed to insert invoice_payments:', invPayErr);

        // ---- Payment tracking — timeline visible en el modal del job en admin ----
        const { error: evtErr } = await supabase.from('payment_events').insert({
          invoice_id: invoice.id, business_id: invoice.business_id, job_id: invoice.job_id,
          event_type: 'payment_completed',
          metadata: { card_brand: cardBrand, card_last4: cardLast4, square_payment_id: paymentId, amount: invoice.final_amount },
        });
        if (evtErr) console.error('[square-payment] Failed to insert payment_events:', evtErr);

        // Notificación por email al admin — nunca debe abortar el pago si falla.
        // Se autentica con la service role key (server-to-server); esta función
        // no tiene la anon key configurada como variable de entorno.
        try {
          let customerName = '';
          let service = '';
          if (invoice.job_id) {
            const { data: jobRow } = await supabase
              .from('jobs')
              .select('category, package, customer_id')
              .eq('id', invoice.job_id)
              .single();
            if (jobRow) {
              service = jobRow.package || jobRow.category || '';
              if (jobRow.customer_id) {
                const { data: customerRow } = await supabase
                  .from('customers')
                  .select('full_name')
                  .eq('id', jobRow.customer_id)
                  .single();
                customerName = customerRow?.full_name || '';
              }
            }
          }
          await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
            body: JSON.stringify({
              action: 'payment_notification_admin',
              businessId: invoice.business_id,
              data: { customerName, service, amount: invoice.final_amount, cardBrand, cardLast4, paidAt },
            }),
          });
        } catch (emailErr) {
          console.error('[square-payment] Failed to send admin payment notification:', emailErr);
        }

        await writeAuditLog({
          businessId: invoice.business_id,
          action: 'payment_collected',
          entityType: 'invoice',
          entityId: invoice.id,
          metadata: { amount: invoice.final_amount, square_payment_id: paymentId, source: 'pay_link' },
        });

        const invoiceDisplayNumber = `INV-${new Date(invoice.created_at).getFullYear()}-${String(invoice.invoice_number).padStart(4, '0')}`;
        return jsonResponse({ success: true, paymentId, invoice_number: invoiceDisplayNumber, amount_paid: invoice.final_amount });
      }

      // ---- flujo existente (depósitos de booking / balance en persona) — sin cambios ----
      if (!sourceId || !amount || !jobId) {
        return jsonResponse({ error: 'sourceId, amount, and jobId are required.' }, 400);
      }
      // Validación de input (auditoría de seguridad 2026-07-15) — amount en centavos.
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 100 || amount > 100000000) {
        return jsonResponse({ error: 'Monto inválido.' }, 400);
      }
      if (typeof sourceId !== 'string' || sourceId.length < 10) {
        return jsonResponse({ error: 'Token de pago inválido.' }, 400);
      }

      const result = await squareRequest('/payments', 'POST', {
        source_id: sourceId,
        idempotency_key: crypto.randomUUID(),
        amount_money: { amount, currency: 'USD' },
        location_id: SQUARE_LOCATION_ID,
        note: `AltaLux Job ${jobId}`,
      });

      const paymentId = result.payment?.id;
      let updatedJob = null;
      try {
        updatedJob = await recordPaymentInSupabase({
          jobId, amount: amount / 100, method: 'Square', reference: paymentId,
        });
      } catch (recordErr) {
        console.error('[square-payment] Square charge succeeded but Supabase recording failed:', recordErr);
      }

      await writeAuditLog({
        businessId: updatedJob?.business_id,
        action: 'payment_collected',
        entityType: 'job',
        entityId: updatedJob?.id || null,
        metadata: { amount: amount / 100, method: 'Square', square_payment_id: paymentId, job_number: jobId },
      });

      return jsonResponse({ success: true, paymentId, job: updatedJob });
    }

    if (action === 'record_payment') {
      const { jobId, amount, method, reference, notes } = body;
      if (!jobId || !amount || !method) {
        return jsonResponse({ error: 'jobId, amount, and method are required.' }, 400);
      }
      // Validación de input (auditoría de seguridad 2026-07-15) — amount en dólares aquí.
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
        return jsonResponse({ error: 'Monto inválido.' }, 400);
      }
      const updatedJob = await recordPaymentInSupabase({ jobId, amount, method, reference, notes });

      await writeAuditLog({
        businessId: updatedJob?.business_id,
        action: 'payment_collected',
        entityType: 'job',
        entityId: updatedJob?.id || null,
        metadata: { amount, method, reference: reference || null, job_number: jobId },
      });

      return jsonResponse({ success: true, job: updatedJob });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error('[square-payment] Error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected error.' }, 500);
  }
});
