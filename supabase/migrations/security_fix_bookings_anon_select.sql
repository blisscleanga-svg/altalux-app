-- Hallazgo #1 de la auditoría de seguridad 2026-07-15: la tabla `bookings`
-- tenía una policy "Allow public select on bookings" (SELECT, anon,
-- USING (true)) que permitía a cualquiera con la anon key (pública, vive
-- en el HTML) leer TODA la tabla — nombre, teléfono, email y dirección de
-- cada cliente que haya reservado, de cualquier negocio.
--
-- Verificado antes de este fix que nada legítimo depende de este acceso:
-- booking/index.html solo hace INSERT en `bookings` (nunca SELECT), y
-- booking/success.html no toca Supabase en absoluto. El widget público
-- no necesita leer bookings de vuelta.
--
-- El resto de los hallazgos de esa auditoría (filtrado por business_id,
-- roles Owner/Technician en business_settings, DELETE en tablas
-- financieras, audit_log, employees.user_id) se atienden en una
-- migración aparte.

DROP POLICY IF EXISTS "Allow public select on bookings" ON public.bookings;
