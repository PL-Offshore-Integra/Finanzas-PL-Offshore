-- ============================================================
-- INTEGRA · Finanzas — el estado de cobro de la factura
--
-- QUE RESUELVE
--
--   Silvestre quiere una pantalla de Facturación en Finanzas, con las
--   facturas de Comercial (v_fin_ingresos, sql/ingresos_desde_comercial.sql)
--   y un estado de cobro que se pueda tocar desde acá: Pendiente / En
--   gestión de cobro / Cobrada.
--
-- POR QUÉ NO ES UNA COLUMNA "estado" LIBRE
--
--   sql/ingresos_desde_comercial.sql ya dice, citando la migración 0028 de
--   Comercial: "cobrada / vigente / vencida" se deduce en un solo lugar
--   (estadoDeFactura, lib/types.ts de Comercial), a propósito, para no
--   tener una segunda definición que se despegue de la primera.
--
--   "Cobrada" ya es un hecho real y verificable: `cobro_fecha is not null`.
--   Guardarlo de nuevo acá, a mano, abriría la puerta a que alguien en
--   Finanzas marque "Cobrada" una factura que en Comercial nunca recibió un
--   cobro (o al revés) — exactamente el problema que 0028 evitó. Por eso
--   esta tabla NO tiene una columna "cobrada": ese estado sigue viniendo,
--   siempre, de comercial.facturas.cobro_fecha.
--
--   Lo único que Finanzas necesita guardar de verdad es "en gestión de
--   cobro": no es una fecha, es que alguien está activamente reclamando el
--   pago. Eso no se puede derivar de ningún dato existente — es criterio
--   humano, así que es lo único que esta tabla agrega.
--
--   El estado que ve la pantalla es siempre calculado, nunca elegido a
--   mano entre los tres a la vez:
--     cobro_fecha is not null      -> Cobrada    (gana siempre)
--     si no, en_gestion = true     -> En gestión de cobro
--     si no                        -> Pendiente
--
-- Correr desde Supabase -> SQL Editor -> Run, un bloque por vez.
-- ============================================================


-- ------------------------------------------------------------
-- 1) La curación de Finanzas sobre una factura de Comercial
-- ------------------------------------------------------------
create table if not exists public.facturas_finanzas (
  factura_id  uuid primary key references comercial.facturas(id) on delete cascade,
  en_gestion  boolean not null default false,
  updated_at  timestamptz not null default now()
);

comment on table public.facturas_finanzas is
  'Curación de Finanzas sobre una factura de Comercial: hoy, solo si está en gestión de cobro. No guarda si está cobrada (ver nota arriba) — eso sigue siendo comercial.facturas.cobro_fecha, un solo lugar.';

alter table public.facturas_finanzas enable row level security;

create policy "facturas_finanzas_select"
  on public.facturas_finanzas for select
  to authenticated
  using (true);

create policy "facturas_finanzas_insert"
  on public.facturas_finanzas for insert
  to authenticated
  with check (true);

create policy "facturas_finanzas_update"
  on public.facturas_finanzas for update
  to authenticated
  using (true)
  with check (true);

grant select, insert, update on public.facturas_finanzas to authenticated;


-- ------------------------------------------------------------
-- 2) v_fin_ingresos + el estado de cobro calculado
-- ------------------------------------------------------------
create or replace view public.v_facturas_finanzas as
select
  i.*,
  coalesce(ff.en_gestion, false) as en_gestion,
  case
    when i.cobrada                        then 'cobrada'
    when coalesce(ff.en_gestion, false)   then 'en_gestion'
    else 'pendiente'
  end as estado_cobro
from public.v_fin_ingresos i
left join public.facturas_finanzas ff on ff.factura_id = i.factura_id;

comment on view public.v_facturas_finanzas is
  'v_fin_ingresos con el estado de cobro para la pantalla Facturación: cobrada (hecho real, cobro_fecha de comercial.facturas) / en_gestion (curación manual de Finanzas) / pendiente (default). "cobrada" no se puede pisar a mano: si i.cobrada es true, gana siempre sin importar en_gestion.';

grant select on public.v_facturas_finanzas to authenticated;


-- ------------------------------------------------------------
-- Ver como quedó
-- ------------------------------------------------------------
select estado_cobro, count(*) as facturas, sum(neto_usd) as neto_usd
from public.v_facturas_finanzas
group by 1
order by 1;


-- ------------------------------------------------------------
-- MARCHA ATRAS
--
--   drop view if exists public.v_facturas_finanzas;
--   drop table if exists public.facturas_finanzas;
--
-- Sin riesgo para Comercial: no toca comercial.facturas, solo lee. Borrar
-- facturas_finanzas pierde el estado "en gestión" cargado a mano, nada más.
-- ------------------------------------------------------------
