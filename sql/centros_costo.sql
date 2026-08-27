-- ============================================================
-- INTEGRA · Finanzas — tabla maestra de centros de costo
-- Alimenta el desplegable "Centro de costo" del formulario de proyectos.
-- Correr una sola vez desde Supabase → SQL Editor → Run.
-- ============================================================

create table if not exists public.centros_costo (
  id         uuid primary key default gen_random_uuid(),
  empresa    text not null,
  codigo     text,
  nombre     text not null,
  activo     boolean not null default true,
  -- Reservado para la futura integracion con Xubio: aca se guarda el ID
  -- del centro de costo equivalente en Xubio (que solo se crea alla).
  xubio_id   text,
  creado_en  timestamptz not null default now()
);

-- No permitir dos centros con el mismo nombre dentro de una empresa.
create unique index if not exists ux_centros_costo_nombre
  on public.centros_costo (empresa, lower(nombre));

alter table public.centros_costo enable row level security;

-- Politicas permisivas, alineadas con como esta hoy la tabla `proyectos`.
-- Si mas adelante quieren restringir por rol, se cambia el `using (true)`.
drop policy if exists centros_costo_select on public.centros_costo;
create policy centros_costo_select on public.centros_costo
  for select to authenticated using (true);

drop policy if exists centros_costo_insert on public.centros_costo;
create policy centros_costo_insert on public.centros_costo
  for insert to authenticated with check (true);

drop policy if exists centros_costo_update on public.centros_costo;
create policy centros_costo_update on public.centros_costo
  for update to authenticated using (true);

drop policy if exists centros_costo_delete on public.centros_costo;
create policy centros_costo_delete on public.centros_costo
  for delete to authenticated using (true);
