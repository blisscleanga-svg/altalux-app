// ============================================================
// AltaLux — Generate Receipt PDF Edge Function
// ============================================================
// Genera un PDF real de un recibo/invoice con pdf-lib (JS puro, sin
// dependencias nativas — no hay forma realista de correr un navegador
// headless dentro de una Edge Function de Supabase).
//
// Dos formas de identificar el recibo:
//   - `token`     : invoice real (invoices.public_token) — público, mismo
//                    modelo de confianza que pay/index.html/track-payment-event.
//   - `paymentId` : fila suelta de `payments` (Cash/Zelle/Square Reader/
//                    depósito, sin invoice asociada) — requiere JWT de un
//                    empleado activo (no existe token público para estos).
//
// GET  ?token=<uuid>                  → PDF binario (descarga directa, sin auth)
// POST { paymentId }, Authorization   → PDF binario (requiere JWT de empleado)
// POST { token, format: 'base64' }    → { pdfBase64, filename } (uso interno,
//                                        ej. adjuntar en un email desde otra función)
//
// Deploy con:
//   supabase functions deploy generate-receipt-pdf
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

function fmtCurrency(n: number | string | null | undefined): string {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  const dt = new Date(String(d).length <= 10 ? d + 'T00:00:00' : d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

interface ReceiptData {
  docTitle: string;
  docNumber: string;
  issueDate: string;
  bizName: string;
  bizAddressLine: string;
  bizPhone: string;
  bizEmail: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress: string;
  serviceDate: string;
  lineItems: Array<{ label: string; amount: number }>;
  total: number;
  amountPaid: number;
  paymentMethod: string;
  paymentReference: string;
  paidAt: string;
  isPaid: boolean;
}

async function getBizInfo(supabase: ReturnType<typeof getSupabaseAdmin>, businessId: string) {
  const { data } = await supabase
    .from('business_settings')
    .select('name, address, city, state, zip, phone, email')
    .eq('business_id', businessId)
    .single();
  const cityLine = [data?.city, data?.state].filter(Boolean).join(', ') + (data?.zip ? ' ' + data.zip : '');
  return {
    name: data?.name || 'AltaLux Mobile Detail',
    addressLine: data?.address ? `${data.address}, ${cityLine || 'Roswell, GA 30075'}` : (cityLine || 'Roswell, GA 30075'),
    phone: data?.phone || '',
    email: data?.email || 'contact@altaluxdetail.com',
  };
}

// ---- Modo `token` — invoice real, ya trae line items/monto en la propia fila ----
async function buildFromInvoiceToken(supabase: ReturnType<typeof getSupabaseAdmin>, token: string): Promise<ReceiptData | null> {
  const { data: inv, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, job_id, customer_id, business_id, status, original_amount, original_service_name, adjustments, final_amount, amount_paid, sent_at, created_at, paid_at, card_brand, card_last4, square_payment_id, title')
    .eq('public_token', token)
    .not('sent_at', 'is', null)
    .single();
  if (error || !inv) return null;

  const { data: job } = await supabase.from('jobs').select('service_date, category, package').eq('id', inv.job_id).single();
  const { data: customer } = inv.customer_id
    ? await supabase.from('customers').select('full_name, email, phone, address').eq('id', inv.customer_id).single()
    : { data: null };
  const biz = await getBizInfo(supabase, inv.business_id || 'altalux');

  const lineItems: Array<{ label: string; amount: number }> = [
    { label: inv.original_service_name || job?.package || job?.category || 'Service', amount: Number(inv.original_amount || 0) },
  ];
  (inv.adjustments || []).forEach((a: any) => {
    const sign = a.type === 'discount' ? -1 : 1;
    lineItems.push({ label: a.description || (a.type === 'discount' ? 'Discount' : 'Additional charge'), amount: sign * Math.abs(Number(a.amount || 0)) });
  });

  const isPaid = inv.status === 'Paid';
  const cardInfo = (inv.card_brand && inv.card_last4) ? `${inv.card_brand} ****${inv.card_last4}` : (isPaid ? 'Card' : '');

  return {
    docTitle: isPaid ? 'RECEIPT' : 'INVOICE',
    docNumber: 'INV-' + new Date(inv.created_at).getFullYear() + '-' + String(inv.invoice_number).padStart(4, '0'),
    issueDate: fmtDate(inv.created_at),
    bizName: biz.name, bizAddressLine: biz.addressLine, bizPhone: biz.phone, bizEmail: biz.email,
    customerName: customer?.full_name || '', customerEmail: customer?.email || '', customerPhone: customer?.phone || '', customerAddress: customer?.address || '',
    serviceDate: job?.service_date ? fmtDate(job.service_date) : '',
    lineItems,
    total: Number(inv.final_amount || 0),
    amountPaid: Number(inv.amount_paid || 0),
    paymentMethod: cardInfo,
    paymentReference: inv.square_payment_id || '',
    paidAt: inv.paid_at ? fmtDate(inv.paid_at) : '',
    isPaid,
  };
}

// ---- Modo `paymentId` — pago suelto (Cash/Zelle/Square Reader/depósito) ----
async function buildFromPaymentId(supabase: ReturnType<typeof getSupabaseAdmin>, paymentId: string): Promise<{ data: ReceiptData | null; businessId: string | null }> {
  const { data: payment, error } = await supabase
    .from('payments')
    .select('id, job_id, amount, payment_method, payment_type, payment_date, reference_number, created_at, business_id')
    .eq('id', paymentId)
    .single();
  if (error || !payment) return { data: null, businessId: null };

  const { data: job } = await supabase.from('jobs').select('service_date, category, package, total, customer_id').eq('id', payment.job_id).single();
  const { data: customer } = job?.customer_id
    ? await supabase.from('customers').select('full_name, email, phone, address').eq('id', job.customer_id).single()
    : { data: null };
  const biz = await getBizInfo(supabase, payment.business_id || 'altalux');

  const data: ReceiptData = {
    docTitle: 'RECEIPT',
    docNumber: 'PAY-' + String(payment.id).slice(0, 8).toUpperCase(),
    issueDate: fmtDate(payment.created_at),
    bizName: biz.name, bizAddressLine: biz.addressLine, bizPhone: biz.phone, bizEmail: biz.email,
    customerName: customer?.full_name || '', customerEmail: customer?.email || '', customerPhone: customer?.phone || '', customerAddress: customer?.address || '',
    serviceDate: job?.service_date ? fmtDate(job.service_date) : '',
    lineItems: [{ label: `${payment.payment_type || 'Payment'} — ${job?.package || job?.category || 'Service'}`, amount: Number(payment.amount || 0) }],
    total: Number(payment.amount || 0),
    amountPaid: Number(payment.amount || 0),
    paymentMethod: payment.payment_method || '',
    paymentReference: payment.reference_number || '',
    paidAt: fmtDate(payment.payment_date || payment.created_at),
    isPaid: true,
  };
  return { data, businessId: payment.business_id || 'altalux' };
}

// ---- Valida el JWT del empleado para el modo `paymentId` ----
async function validateEmployeeAuth(supabase: ReturnType<typeof getSupabaseAdmin>, authHeader: string | null, expectedBusinessId: string | null): Promise<boolean> {
  if (!authHeader) return false;
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user?.email) return false;

  const { data: employee } = await supabase
    .from('employees')
    .select('business_id')
    .ilike('email', userData.user.email)
    .eq('is_active', true)
    .single();
  if (!employee) return false;
  if (expectedBusinessId && employee.business_id !== expectedBusinessId) return false;
  return true;
}

// ---- Dibuja el PDF con pdf-lib (sin layout automático — todo por coordenadas) ----
async function renderPdfBytes(d: ReceiptData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // Letter
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const navy = rgb(0x10 / 255, 0x48 / 255, 0x72 / 255);
  const ink = rgb(0.1, 0.13, 0.18);
  const muted = rgb(0.42, 0.47, 0.53);
  const green = rgb(0.15, 0.4, 0.28);
  const line = rgb(0.88, 0.9, 0.92);

  let y = 740;
  const left = 56;
  const right = 556;

  const text = (s: string, x: number, yy: number, opts: { size?: number; f?: any; color?: any } = {}) => {
    page.drawText(s || '', { x, y: yy, size: opts.size || 10.5, font: opts.f || font, color: opts.color || ink });
  };
  const textRight = (s: string, xEnd: number, yy: number, opts: { size?: number; f?: any; color?: any } = {}) => {
    const f = opts.f || font, size = opts.size || 10.5;
    const w = f.widthOfTextAtSize(s || '', size);
    page.drawText(s || '', { x: xEnd - w, y: yy, size, font: f, color: opts.color || ink });
  };
  const hr = (yy: number) => page.drawLine({ start: { x: left, y: yy }, end: { x: right, y: yy }, thickness: 0.75, color: line });

  // Header
  text(d.bizName.toUpperCase(), left, y, { size: 17, f: bold, color: navy });
  y -= 16;
  text(d.bizAddressLine, left, y, { size: 9, color: muted });
  y -= 12;
  text([d.bizPhone, d.bizEmail].filter(Boolean).join('  ·  '), left, y, { size: 9, color: muted });

  textRight(d.docTitle, right, 740, { size: 20, f: bold, color: navy });
  textRight(d.docNumber, right, 722, { size: 10, color: muted });
  textRight(`Issued: ${d.issueDate}`, right, 708, { size: 9, color: muted });
  if (d.isPaid) textRight('PAID', right, 692, { size: 11, f: bold, color: green });

  y -= 28;
  hr(y);
  y -= 22;

  // Bill To
  text('BILL TO', left, y, { size: 8.5, f: bold, color: muted });
  y -= 14;
  text(d.customerName || '—', left, y, { size: 11, f: bold });
  y -= 14;
  if (d.customerEmail) { text(d.customerEmail, left, y, { size: 9.5, color: muted }); y -= 13; }
  if (d.customerPhone) { text(d.customerPhone, left, y, { size: 9.5, color: muted }); y -= 13; }
  if (d.customerAddress) { text(d.customerAddress, left, y, { size: 9.5, color: muted }); y -= 13; }
  if (d.serviceDate) { text(`Service date: ${d.serviceDate}`, left, y, { size: 9.5, color: muted }); y -= 13; }

  y -= 14;
  hr(y);
  y -= 10;

  // Line items
  text('DESCRIPTION', left, y, { size: 8.5, f: bold, color: muted });
  textRight('AMOUNT', right, y, { size: 8.5, f: bold, color: muted });
  y -= 16;
  d.lineItems.forEach(item => {
    text(item.label, left, y, { size: 10 });
    textRight(fmtCurrency(item.amount), right, y, { size: 10 });
    y -= 18;
  });

  y -= 6;
  hr(y);
  y -= 20;

  text('TOTAL', left, y, { size: 12, f: bold, color: navy });
  textRight(fmtCurrency(d.total), right, y, { size: 14, f: bold, color: navy });
  y -= 20;

  if (d.amountPaid > 0) {
    text('Amount Paid', left, y, { size: 10, color: green });
    textRight(fmtCurrency(d.amountPaid), right, y, { size: 10, color: green });
    y -= 16;
  }
  if (d.paymentMethod) {
    text('Payment Method', left, y, { size: 10, color: muted });
    textRight(d.paymentMethod, right, y, { size: 10 });
    y -= 16;
  }
  if (d.paidAt) {
    text('Paid On', left, y, { size: 10, color: muted });
    textRight(d.paidAt, right, y, { size: 10 });
    y -= 16;
  }
  if (d.paymentReference) {
    text('Reference', left, y, { size: 9, color: muted });
    textRight(d.paymentReference, right, y, { size: 9, color: muted });
    y -= 16;
  }

  text('Thank you for choosing us.', left, 60, { size: 9, color: muted });

  return pdfDoc.save();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseAdmin();
    const url = new URL(req.url);

    let token: string | null = null;
    let paymentId: string | null = null;
    let format = 'binary';

    if (req.method === 'GET') {
      token = url.searchParams.get('token');
      format = url.searchParams.get('format') || 'binary';
    } else {
      const body = await req.json().catch(() => ({}));
      token = body.token || null;
      paymentId = body.paymentId || null;
      format = body.format || 'binary';
    }

    let receipt: ReceiptData | null = null;

    if (token) {
      receipt = await buildFromInvoiceToken(supabase, token);
    } else if (paymentId) {
      const { data, businessId } = await buildFromPaymentId(supabase, paymentId);
      const authed = await validateEmployeeAuth(supabase, req.headers.get('authorization'), businessId);
      if (!authed) return jsonResponse({ error: 'Unauthorized.' }, 401);
      receipt = data;
    } else {
      return jsonResponse({ error: 'token or paymentId is required.' }, 400);
    }

    if (!receipt) return jsonResponse({ error: 'Receipt not found.' }, 404);

    const pdfBytes = await renderPdfBytes(receipt);
    const filename = `${receipt.docNumber}.pdf`;

    if (format === 'base64') {
      let binary = '';
      for (let i = 0; i < pdfBytes.length; i++) binary += String.fromCharCode(pdfBytes[i]);
      return jsonResponse({ pdfBase64: btoa(binary), filename });
    }

    // Cast necesario: TS 5.7+ infiere Uint8Array<ArrayBufferLike> (incluye
    // SharedArrayBuffer) para el retorno de pdf-lib, pero BlobPart exige
    // específicamente ArrayBuffer — el valor real siempre es un ArrayBuffer normal.
    return new Response(new Blob([pdfBytes as unknown as BlobPart]), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` },
    });
  } catch (err) {
    console.error('[generate-receipt-pdf] Error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected error.' }, 500);
  }
});
