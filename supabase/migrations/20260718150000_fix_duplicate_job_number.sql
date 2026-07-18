-- Corrige dos jobs con el mismo job_number = 4 (bug encontrado 2026-07-18:
-- el código de admin mandaba explícitamente un job_number calculado con un
-- contador en memoria que nunca se resincronizaba con Supabase, en vez de
-- dejar que la columna use su propio default de sequence). El fix de código
-- ya no manda job_number en los inserts; esta migración limpia el dato
-- existente y agrega una restricción UNIQUE para que esto no pueda volver
-- a pasar silenciosamente.

-- Renumera el job duplicado más reciente (996b3dea..., creado 2026-07-17,
-- sin invoice enviada todavía — el otro job_number=4, 9ce09bc3..., sí tiene
-- una invoice ya enviada con ese número, se deja intacto).
update jobs
set job_number = nextval('jobs_job_number_seq')
where id = '996b3dea-480c-4762-abdb-b60c5a688375';

alter table jobs
  add constraint jobs_job_number_unique unique (job_number);
