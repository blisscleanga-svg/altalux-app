-- Extiende `customers` para soportar Person/Business, y múltiples
-- direcciones/teléfonos/emails con etiqueta (Home/Work/Other).
-- No se eliminan las columnas viejas (full_name, phone, email, address) —
-- el código existente (booking->job, quick job, vistas de cliente) sigue
-- leyéndolas tal cual. Los clientes nuevos usan los arrays jsonb;
-- los existentes se migran una sola vez con los UPDATE de abajo.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS customer_type text DEFAULT 'person'
    CHECK (customer_type IN ('person', 'business')),
  ADD COLUMN IF NOT EXISTS business_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS addresses jsonb DEFAULT '[]'::jsonb,
  -- Array de: { label: 'Home'|'Work'|'Other', address, place_id, lat, lng }
  ADD COLUMN IF NOT EXISTS phones jsonb DEFAULT '[]'::jsonb,
  -- Array de: { label: 'Mobile'|'Home'|'Work'|'Other', number }
  ADD COLUMN IF NOT EXISTS emails jsonb DEFAULT '[]'::jsonb;
  -- Array de: { label: 'Home'|'Work'|'Other', email }

-- Migra datos existentes de columna simple a array jsonb (una sola vez,
-- protegido por el WHERE para que sea seguro re-correr esta migración).
UPDATE customers
SET phones = jsonb_build_array(jsonb_build_object('label', 'Mobile', 'number', phone))
WHERE phone IS NOT NULL AND phone != ''
  AND (phones IS NULL OR phones = '[]'::jsonb);

UPDATE customers
SET emails = jsonb_build_array(jsonb_build_object('label', 'Home', 'email', email))
WHERE email IS NOT NULL AND email != ''
  AND (emails IS NULL OR emails = '[]'::jsonb);

UPDATE customers
SET addresses = jsonb_build_array(jsonb_build_object('label', 'Home', 'address', address))
WHERE address IS NOT NULL AND address != ''
  AND (addresses IS NULL OR addresses = '[]'::jsonb);
