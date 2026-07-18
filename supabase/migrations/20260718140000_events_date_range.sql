-- Events necesita poder bloquear un rango de días completos (ej. vacaciones,
-- días libres) o un rango de horas dentro de uno o varios días (ej.
-- mantenimiento de equipo 8am-12pm). event_date/event_time ya existían
-- como el inicio; se agrega el fin y el flag de "todo el día".

ALTER TABLE events
ADD COLUMN IF NOT EXISTS end_date date,
ADD COLUMN IF NOT EXISTS end_time text,
ADD COLUMN IF NOT EXISTS all_day boolean DEFAULT false;

-- Backfill de eventos existentes: sin end_date, se asume que terminan el
-- mismo día que empiezan (evento de un solo día, como era el comportamiento
-- antes de este cambio).
UPDATE events SET end_date = event_date WHERE end_date IS NULL;
