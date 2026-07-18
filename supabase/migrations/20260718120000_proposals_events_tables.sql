-- Proposals y Events nunca tuvieron tabla en Supabase — vivían solo en
-- arrays de JS (PROPOSALS/EVENTS), se perdían al recargar la página o
-- al entrar desde otro dispositivo. Mismo patrón de columnas/RLS que
-- ya usa `jobs` (security_rls_audit_part2.sql).

CREATE TABLE IF NOT EXISTS proposals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone DEFAULT now(),
  business_id text REFERENCES business_settings(business_id) DEFAULT 'altalux',
  proposal_number text,
  customer_name text,
  customer_phone text,
  customer_email text,
  service_description text,
  vehicle text,
  price numeric,
  valid_until date,
  status text DEFAULT 'Draft',
  notes text,
  converted_to_job_id uuid REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone DEFAULT now(),
  business_id text REFERENCES business_settings(business_id) DEFAULT 'altalux',
  title text,
  event_date date,
  event_time text,
  notes text
);

ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON proposals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON events TO authenticated;

CREATE POLICY "auth_select_proposals_same_business"
  ON public.proposals FOR SELECT TO authenticated
  USING (business_id = current_business_id());
CREATE POLICY "auth_insert_proposals_same_business"
  ON public.proposals FOR INSERT TO authenticated
  WITH CHECK (business_id = current_business_id());
CREATE POLICY "auth_update_proposals_same_business"
  ON public.proposals FOR UPDATE TO authenticated
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
CREATE POLICY "owner_delete_proposals"
  ON public.proposals FOR DELETE TO authenticated
  USING (is_owner() AND business_id = current_business_id());

CREATE POLICY "auth_select_events_same_business"
  ON public.events FOR SELECT TO authenticated
  USING (business_id = current_business_id());
CREATE POLICY "auth_insert_events_same_business"
  ON public.events FOR INSERT TO authenticated
  WITH CHECK (business_id = current_business_id());
CREATE POLICY "auth_update_events_same_business"
  ON public.events FOR UPDATE TO authenticated
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
CREATE POLICY "owner_delete_events"
  ON public.events FOR DELETE TO authenticated
  USING (is_owner() AND business_id = current_business_id());
