// ============================================================
// AltaLux — Employee Auth Management Edge Function
// ============================================================
// Lets the admin dashboard create a real Supabase Auth login for
// an employee, or reset an existing one's password, without ever
// storing the password in a client-readable table. Replaces the
// old pattern of a plaintext `password` column on `employees`.
//
// Only a caller with a valid Supabase Auth session belonging to an
// active Owner-role employee may invoke this.
//
// Deploy with:
//   supabase functions deploy manage-employee-auth --use-api
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

function getAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase service credentials are not configured for this function.');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function findAuthUserByEmail(admin: ReturnType<typeof createClient>, email: string) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  return (data.users || []).find(u => (u.email || '').toLowerCase() === email.toLowerCase()) || null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const admin = getAdminClient();

    // The caller must present a valid Supabase Auth access token for an
    // active employee with the Owner role — this endpoint changes login
    // credentials, so it can't be open to any authenticated session.
    const authHeader = req.headers.get('Authorization') || '';
    const callerToken = authHeader.replace(/^Bearer\s+/i, '');
    if (!callerToken) return jsonResponse({ error: 'Missing Authorization header.' }, 401);

    const { data: callerData, error: callerErr } = await admin.auth.getUser(callerToken);
    if (callerErr || !callerData?.user?.email) return jsonResponse({ error: 'Not authenticated.' }, 401);

    const { data: callerEmployee, error: callerEmpErr } = await admin
      .from('employees')
      .select('role, is_active')
      .ilike('email', callerData.user.email)
      .maybeSingle();
    if (callerEmpErr) throw callerEmpErr;
    if (!callerEmployee || callerEmployee.role !== 'Owner' || callerEmployee.is_active === false) {
      return jsonResponse({ error: 'Only an active Owner can manage employee logins.' }, 403);
    }

    const body = await req.json();
    const { action, email, password } = body;

    if (action !== 'set_password') {
      return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
    if (!email || !password) {
      return jsonResponse({ error: 'email and password are required.' }, 400);
    }
    if (String(password).length < 6) {
      return jsonResponse({ error: 'Password must be at least 6 characters.' }, 400);
    }

    const existing = await findAuthUserByEmail(admin, email);
    if (existing) {
      const { error } = await admin.auth.admin.updateUserById(existing.id, { password });
      if (error) throw error;
    } else {
      const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error('[manage-employee-auth] Error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected error.' }, 500);
  }
});
