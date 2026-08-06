// ============================================================
// AltaLux App — Manage Tenant Edge Function (SaaS onboarding)
// ============================================================
// Único punto de acceso para todo lo cross-tenant: aprobar/rechazar/
// suspender negocios, ver la lista completa de tenants, editar el
// catálogo de templates, y los pasos server-side del wizard de signup
// (generar slug, guardar cada paso). El frontend NUNCA consulta
// business_settings directamente para otro tenant — todo pasa por acá
// con service_role.
//
// Dos niveles de auth, por acción:
//   - Acciones de plataforma (aprobar, listar todos, stats, templates):
//     el JWT del caller debe resolver al email del Super Admin.
//   - Acciones de signup (generar slug, guardar pasos, ver el propio
//     estado): el JWT debe resolver a un usuario real; para tocar una
//     fila ya existente, su owner_email debe coincidir con el caller.
//
// Deploy con:
//   supabase functions deploy manage-tenant
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const SUPER_ADMIN_EMAIL = 'blisscleanmobilega@gmail.com';

const RESERVED_SLUGS = [
  'admin', 'api', 'book', 'booking', 'platform', 'technician', 'onboarding',
  'shared', 'supabase', 'altalux', 'app', 'www', 'mail', 'contact',
];

const SUPER_ADMIN_ACTIONS = [
  'stats', 'list_tenants', 'approve_tenant', 'reject_tenant',
  'suspend_tenant', 'reactivate_tenant', 'list_templates', 'update_template',
];

// Columnas seguras de business_settings — nunca incluye credenciales
// (square_access_token, stripe_secret_key, etc.) ni columnas operativas
// que no hacen falta fuera del propio admin del tenant.
const TENANT_SAFE_COLUMNS = [
  'id', 'created_at', 'business_id', 'name', 'slug', 'status', 'owner_email',
  'phone', 'address', 'city', 'state', 'zip', 'website', 'notification_email',
  'onboarding_step', 'setup_complete', 'tos_accepted_at', 'approved_at',
  'approved_by', 'square_enabled', 'is_active', 'logo_url', 'primary_color',
  'secondary_color', 'accent_color', 'background_color', 'deposit_percentage',
  'cancellation_hours', 'late_fee', 'cancellation_policy',
  'booking_settings_confirmed',
].join(', ');

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

function logAction(action: string, businessId: string | null, callerEmail: string | null, success: boolean, extra?: Record<string, unknown>) {
  console.log(JSON.stringify({ action, businessId, callerEmail, success, ...(extra || {}) }));
}

function normalizeSlugBase(name: string): string {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

async function findAuthUserByEmail(supabase: ReturnType<typeof getSupabaseAdmin>, email: string) {
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function notifyByEmail(action: string, businessId: string, data: Record<string, unknown>) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ action, businessId, data }),
    });
  } catch (err) {
    console.error(`[manage-tenant] Failed to send ${action} email:`, err);
  }
}

// ---------------------------------------------------------------
// generate_slug — normaliza, rechaza reservados, resuelve colisiones
// ---------------------------------------------------------------
async function actionGenerateSlug(supabase: ReturnType<typeof getSupabaseAdmin>, body: any) {
  const base = normalizeSlugBase(body.businessName);
  if (!base) return jsonResponse({ error: 'A valid business name is required.' }, 400);
  if (RESERVED_SLUGS.includes(base)) {
    return jsonResponse({ error: `"${base}" is a reserved name — please choose a different business name.` }, 400);
  }

  let candidate = base;
  let suffix = 1;
  while (true) {
    const { data: existing } = await supabase.from('business_settings').select('business_id').eq('slug', candidate).maybeSingle();
    if (!existing) break;
    suffix += 1;
    candidate = `${base}-${suffix}`.slice(0, 50);
  }
  return jsonResponse({ slug: candidate });
}

// ---------------------------------------------------------------
// save_step — step 0 (cuenta) / step 1 (info de negocio)
// ---------------------------------------------------------------
async function actionSaveStep(supabase: ReturnType<typeof getSupabaseAdmin>, callerEmail: string, body: any) {
  const { step, data } = body;

  if (step === 0) {
    // Idempotente: un reintento del mismo caller sobre una fila que ya
    // creó no es un error, es éxito — evita 403 espurios por timeouts.
    const { data: existing } = await supabase
      .from('business_settings')
      .select('business_id, onboarding_step')
      .eq('owner_email', callerEmail)
      .maybeSingle();
    if (existing) {
      return jsonResponse({ success: true, businessId: existing.business_id, onboardingStep: existing.onboarding_step });
    }

    const businessName = (data?.businessName || '').trim();
    const slug = (data?.slug || '').trim();
    if (!businessName || !slug) return jsonResponse({ error: 'businessName and slug are required.' }, 400);
    if (RESERVED_SLUGS.includes(slug)) return jsonResponse({ error: 'That slug is reserved.' }, 400);

    const { data: inserted, error } = await supabase
      .from('business_settings')
      .insert([{
        business_id: slug, slug, name: businessName, owner_email: callerEmail,
        status: 'pending', square_enabled: false,
        tos_accepted_at: new Date().toISOString(), onboarding_step: 1,
      }])
      .select('business_id, onboarding_step')
      .single();
    if (error) throw error;
    logAction('save_step_0', inserted.business_id, callerEmail, true);
    return jsonResponse({ success: true, businessId: inserted.business_id, onboardingStep: inserted.onboarding_step });
  }

  if (step === 1) {
    const { data: row } = await supabase
      .from('business_settings')
      .select('business_id, onboarding_step, name')
      .eq('owner_email', callerEmail)
      .maybeSingle();
    if (!row) return jsonResponse({ error: 'No pending application found for this account.' }, 404);

    const wasBeforeStep2 = (row.onboarding_step || 0) < 2;
    const { phone, address, city, state, zip, website, notification_email } = data || {};
    const { error } = await supabase
      .from('business_settings')
      .update({
        phone: phone || null, address: address || null, city: city || null,
        state: state || null, zip: zip || null, website: website || null,
        notification_email: notification_email || callerEmail,
        onboarding_step: 2,
      })
      .eq('business_id', row.business_id);
    if (error) throw error;
    logAction('save_step_1', row.business_id, callerEmail, true);

    if (wasBeforeStep2) {
      await notifyByEmail('tenant_pending', row.business_id, { businessName: row.name, ownerEmail: callerEmail });
      await notifyByEmail('internal_new_signup', row.business_id, { businessName: row.name, ownerEmail: callerEmail });
    }
    return jsonResponse({ success: true, onboardingStep: 2 });
  }

  return jsonResponse({ error: 'Invalid step.' }, 400);
}

// ---------------------------------------------------------------
// stats / list_tenants / tenant_details
// ---------------------------------------------------------------
async function actionStats(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const { data, error } = await supabase.from('business_settings').select('status, created_at, name, business_id');
  if (error) throw error;
  const counts = { total: data.length, pending: 0, approved: 0, suspended: 0, rejected: 0 };
  data.forEach((r) => {
    if (r.status && counts[r.status as keyof typeof counts] !== undefined) {
      (counts as any)[r.status] += 1;
    }
  });
  const recent = data
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 10)
    .map((r) => ({ businessId: r.business_id, name: r.name, status: r.status, createdAt: r.created_at }));
  return jsonResponse({ counts, recent });
}

async function actionListTenants(supabase: ReturnType<typeof getSupabaseAdmin>, body: any) {
  let query = supabase.from('business_settings').select(TENANT_SAFE_COLUMNS).order('created_at', { ascending: false });
  if (body?.status) query = query.eq('status', body.status);
  if (body?.search) query = query.ilike('name', `%${body.search}%`);
  const { data, error } = await query;
  if (error) throw error;
  return jsonResponse({ tenants: data });
}

async function actionTenantDetails(supabase: ReturnType<typeof getSupabaseAdmin>, callerEmail: string, isSuperAdmin: boolean, body: any) {
  const { businessId } = body;
  // Sin businessId: el propio wizard resolviendo en qué paso se quedó —
  // busca por owner_email del caller (nunca cross-tenant). Con businessId:
  // uso normal (Super Admin viendo cualquier tenant, o un tenant confirmando
  // el suyo propio una vez ya sabe su slug).
  const query = businessId
    ? supabase.from('business_settings').select(TENANT_SAFE_COLUMNS).eq('business_id', businessId)
    : supabase.from('business_settings').select(TENANT_SAFE_COLUMNS).eq('owner_email', callerEmail);
  const { data: tenantRaw, error } = await query.single();
  if (error || !tenantRaw) return jsonResponse({ error: 'Tenant not found.' }, 404);
  // Cast necesario: supabase-js no puede inferir columnas de un select
  // armado dinámicamente (TENANT_SAFE_COLUMNS es un string, no un literal).
  const tenant = tenantRaw as Record<string, any>;
  if (!isSuperAdmin && (tenant.owner_email || '').toLowerCase() !== callerEmail.toLowerCase()) {
    return jsonResponse({ error: 'Forbidden.' }, 403);
  }
  return jsonResponse({ tenant });
}

// ---------------------------------------------------------------
// approve_tenant — el flujo completo de aprobación
// ---------------------------------------------------------------
async function actionApproveTenant(supabase: ReturnType<typeof getSupabaseAdmin>, callerEmail: string, body: any) {
  const { businessId } = body;
  if (!businessId) return jsonResponse({ error: 'businessId is required.' }, 400);

  const { data: tenant, error: tErr } = await supabase.from('business_settings').select('*').eq('business_id', businessId).single();
  if (tErr || !tenant) return jsonResponse({ error: 'Tenant not found.' }, 404);
  if (!tenant.owner_email) return jsonResponse({ error: 'Tenant has no owner_email on file — cannot approve.' }, 400);

  // 1. Status
  const { error: statusErr } = await supabase
    .from('business_settings')
    .update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: callerEmail })
    .eq('business_id', businessId);
  if (statusErr) {
    logAction('approve_tenant', businessId, callerEmail, false, { step: 'status_update', error: statusErr.message });
    return jsonResponse({ error: statusErr.message }, 500);
  }

  // 2. Owner employee record
  const ownerFirstName = (tenant.name || 'Owner').trim().split(/\s+/)[0] || 'Owner';
  const { error: empErr } = await supabase.from('employees').insert([{
    first_name: ownerFirstName, last_name: '', email: tenant.owner_email,
    role: 'Owner', business_id: businessId, is_active: true,
  }]);
  if (empErr) logAction('approve_tenant', businessId, callerEmail, false, { step: 'employee_insert', error: empErr.message });

  // 3. Owner's Supabase Auth account — el owner YA se registró él mismo en
  // el wizard, así que solo se crea una cuenta nueva si por alguna razón
  // no existe (defensivo) — nunca se resetea su password, lo dejaría
  // afuera de la cuenta que él mismo eligió.
  try {
    const existingAuth = await findAuthUserByEmail(supabase, tenant.owner_email);
    if (!existingAuth) {
      await supabase.auth.admin.createUser({ email: tenant.owner_email, password: crypto.randomUUID(), email_confirm: true });
      logAction('approve_tenant', businessId, callerEmail, true, { step: 'auth_account_created' });
    } else {
      logAction('approve_tenant', businessId, callerEmail, true, { step: 'auth_account_already_existed' });
    }
  } catch (authErr) {
    logAction('approve_tenant', businessId, callerEmail, false, { step: 'auth_account', error: String(authErr) });
  }

  // 4. Copiar catálogo de templates
  try {
    const { data: svcTemplates } = await supabase.from('service_templates').select('*');
    const { data: addonTemplates } = await supabase.from('addon_templates').select('*');
    if (svcTemplates?.length) {
      await supabase.from('business_services').insert(svcTemplates.map((t: any) => ({
        business_id: businessId, category: t.category, package: t.package, vehicle_type: t.vehicle_type,
        price: t.suggested_price, duration_minutes: t.duration_minutes, description: t.description,
        included_items: t.included_items, is_active: true,
      })));
    }
    if (addonTemplates?.length) {
      await supabase.from('business_addons').insert(addonTemplates.map((t: any) => ({
        business_id: businessId, name: t.name, price: t.suggested_price, price_varies: t.price_varies,
        description: t.description, category: t.category, is_active: true,
      })));
    }
    logAction('approve_tenant', businessId, callerEmail, true, { step: 'templates_copied' });
  } catch (copyErr) {
    logAction('approve_tenant', businessId, callerEmail, false, { step: 'templates_copied', error: String(copyErr) });
  }

  // 5. Email de bienvenida
  await notifyByEmail('tenant_approved', businessId, { businessName: tenant.name, ownerEmail: tenant.owner_email, slug: businessId });

  logAction('approve_tenant', businessId, callerEmail, true, { step: 'complete' });
  return jsonResponse({ success: true, businessId });
}

async function actionRejectTenant(supabase: ReturnType<typeof getSupabaseAdmin>, callerEmail: string, body: any) {
  const { businessId, reason } = body;
  if (!businessId) return jsonResponse({ error: 'businessId is required.' }, 400);
  const { data: tenant, error: tErr } = await supabase.from('business_settings').select('name, owner_email').eq('business_id', businessId).single();
  if (tErr || !tenant) return jsonResponse({ error: 'Tenant not found.' }, 404);

  const { error } = await supabase.from('business_settings').update({ status: 'rejected' }).eq('business_id', businessId);
  if (error) { logAction('reject_tenant', businessId, callerEmail, false, { error: error.message }); return jsonResponse({ error: error.message }, 500); }

  if (tenant.owner_email) await notifyByEmail('tenant_rejected', businessId, { businessName: tenant.name, ownerEmail: tenant.owner_email, reason: reason || null });
  logAction('reject_tenant', businessId, callerEmail, true);
  return jsonResponse({ success: true, businessId });
}

async function actionSuspendTenant(supabase: ReturnType<typeof getSupabaseAdmin>, callerEmail: string, body: any) {
  const { businessId } = body;
  if (!businessId) return jsonResponse({ error: 'businessId is required.' }, 400);
  const { error } = await supabase.from('business_settings').update({ status: 'suspended' }).eq('business_id', businessId);
  if (error) { logAction('suspend_tenant', businessId, callerEmail, false, { error: error.message }); return jsonResponse({ error: error.message }, 500); }
  logAction('suspend_tenant', businessId, callerEmail, true);
  return jsonResponse({ success: true, businessId });
}

async function actionReactivateTenant(supabase: ReturnType<typeof getSupabaseAdmin>, callerEmail: string, body: any) {
  const { businessId } = body;
  if (!businessId) return jsonResponse({ error: 'businessId is required.' }, 400);
  const { error } = await supabase.from('business_settings').update({ status: 'approved' }).eq('business_id', businessId);
  if (error) { logAction('reactivate_tenant', businessId, callerEmail, false, { error: error.message }); return jsonResponse({ error: error.message }, 500); }
  logAction('reactivate_tenant', businessId, callerEmail, true);
  return jsonResponse({ success: true, businessId });
}

// ---------------------------------------------------------------
// Templates (Super Admin)
// ---------------------------------------------------------------
async function actionListTemplates(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const { data: services, error: sErr } = await supabase.from('service_templates').select('*').order('sort_order');
  if (sErr) throw sErr;
  const { data: addons, error: aErr } = await supabase.from('addon_templates').select('*').order('sort_order');
  if (aErr) throw aErr;
  return jsonResponse({ services, addons });
}

async function actionUpdateTemplate(supabase: ReturnType<typeof getSupabaseAdmin>, callerEmail: string, body: any) {
  const { table, id, fields } = body;
  if (!['service_templates', 'addon_templates'].includes(table) || !id || !fields) {
    return jsonResponse({ error: 'table (service_templates|addon_templates), id, and fields are required.' }, 400);
  }
  const { error } = await supabase.from(table).update(fields).eq('id', id);
  if (error) { logAction('update_template', null, callerEmail, false, { table, id, error: error.message }); return jsonResponse({ error: error.message }, 500); }
  logAction('update_template', null, callerEmail, true, { table, id });
  return jsonResponse({ success: true });
}

// ---------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action } = body;
    if (!action) return jsonResponse({ error: 'action is required.' }, 400);

    const supabase = getSupabaseAdmin();

    const authHeader = req.headers.get('authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return jsonResponse({ error: 'Missing Authorization header.' }, 401);

    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user?.email) return jsonResponse({ error: 'Not authenticated.' }, 401);
    const callerEmail = userData.user.email;
    const isSuperAdmin = callerEmail.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();

    if (SUPER_ADMIN_ACTIONS.includes(action) && !isSuperAdmin) {
      logAction(action, body.businessId || null, callerEmail, false, { reason: 'not_super_admin' });
      return jsonResponse({ error: 'Forbidden.' }, 403);
    }

    switch (action) {
      case 'generate_slug': return await actionGenerateSlug(supabase, body);
      case 'save_step': return await actionSaveStep(supabase, callerEmail, body);
      case 'stats': return await actionStats(supabase);
      case 'list_tenants': return await actionListTenants(supabase, body);
      case 'tenant_details': return await actionTenantDetails(supabase, callerEmail, isSuperAdmin, body);
      case 'approve_tenant': return await actionApproveTenant(supabase, callerEmail, body);
      case 'reject_tenant': return await actionRejectTenant(supabase, callerEmail, body);
      case 'suspend_tenant': return await actionSuspendTenant(supabase, callerEmail, body);
      case 'reactivate_tenant': return await actionReactivateTenant(supabase, callerEmail, body);
      case 'list_templates': return await actionListTemplates(supabase);
      case 'update_template': return await actionUpdateTemplate(supabase, callerEmail, body);
      default: return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error('[manage-tenant] Error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected error.' }, 500);
  }
});
