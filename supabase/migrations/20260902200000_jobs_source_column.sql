-- ============================================================
-- Jobs mobile UX — columna de origen del job (manual vs. booking
-- online). Ver docs/superpowers/specs/2026-09-02-jobs-mobile-ux-design.md
--
-- Solo aplica hacia adelante: jobs históricos quedan en el default
-- 'manual' sin intentar inferir su origen real (decisión explícita,
-- no vale la pena el esfuerzo de reconstruir datos históricos).
-- ============================================================

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'online_booking'));
