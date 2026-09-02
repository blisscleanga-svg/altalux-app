-- ============================================================
-- Fase 5, Sub-fase 1+2 — arreglos del code review final sobre
-- 20260902120000_sms_messaging.sql.
--
-- NO se edita aquella migración: ya está aplicada y commiteada, y la
-- base de datos no se enteraría de un cambio en su texto. Todo lo que
-- sigue es aditivo y re-ejecutable.
--
-- 1) CREATE POLICY no tiene forma IF NOT EXISTS en Postgres, así que
--    re-correr el set de migraciones tras un fallo parcial reventaba
--    con "policy already exists" — aunque las tablas y la columna sí
--    usan IF NOT EXISTS y hacían no-op limpio. Se hace DROP ... IF
--    EXISTS + CREATE para que a partir de aquí el set sea idempotente.
--
-- 2) sms_messages.customer_id referenciaba customers(id) sin ON DELETE:
--    borrar un cliente fallaba por la FK. Debe ser ON DELETE SET NULL —
--    el historial de SMS sobrevive al cliente, solo pierde el vínculo.
--    No se puede alterar la cláusula REFERENCES in-place, hay que
--    recrear el constraint. Nombre real confirmado con:
--      select conname from pg_constraint
--       where conrelid = 'sms_messages'::regclass and contype='f';
--    -> sms_messages_customer_id_fkey
-- ============================================================

-- ---------- 1) Policies re-ejecutables ----------
DROP POLICY IF EXISTS "auth_select_sms_messages_same_business" ON public.sms_messages;
CREATE POLICY "auth_select_sms_messages_same_business"
  ON public.sms_messages FOR SELECT TO authenticated
  USING (business_id = current_business_id());

DROP POLICY IF EXISTS "auth_update_sms_messages_same_business" ON public.sms_messages;
CREATE POLICY "auth_update_sms_messages_same_business"
  ON public.sms_messages FOR UPDATE TO authenticated
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());

-- ---------- 2) customer_id FK -> ON DELETE SET NULL ----------
ALTER TABLE public.sms_messages
  DROP CONSTRAINT IF EXISTS sms_messages_customer_id_fkey;

ALTER TABLE public.sms_messages
  ADD CONSTRAINT sms_messages_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
