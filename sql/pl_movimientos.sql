-- ============================================================
-- INTEGRA · Finanzas — el cuadro del P&L completo
--
-- QUE RESUELVE
--
--   Con sql/plan_de_cuentas.sql ya estan las CUENTAS. Este archivo agrega
--   la tabla donde van a vivir los MOVIMIENTOS de costo —vacia todavia,
--   es el paso "armar el cuadro" antes de "cargar los datos"— y las
--   vistas que arman el P&L completo: ingresos (ya existian, de
--   comercial.facturas) + costos (pl_movimientos, cuando se carguen) en
--   una sola forma, para que la pantalla P&L de Finanzas deje de mostrar
--   nada mas que la Facturación.
--
-- POR QUE UNA TABLA GENERICA Y NO UNA POR CATEGORIA
--
--   Voyage Costs, Vessel OPEX, SG&A y Astillero son la MISMA forma de
--   dato: una fecha, un centro de costo, una cuenta, un monto. Lo que los
--   distingue es la cuenta (plan_de_cuentas.categoria) y el centro de
--   costo (centros_costo.segmento), no la estructura de la tabla. Separar
--   en cuatro tablas obligaria a cuatro vistas identicas y a decidir cuatro
--   veces como convertir a USD.
--
-- EL SIGNO: SIEMPRE POSITIVO
--
--   monto es una magnitud, nunca negativo (constraint abajo). Si es costo
--   o ingreso lo dice la categoria de la cuenta —categoria = 'ingreso' o
--   'ingreso_astillero' suma, cualquier otra categoria resta— no el signo
--   de la fila. La planilla original mezcla signos (UTILIDADES da negativo
--   cuando hay perdida, pero DIQUE es positivo aunque reste) y eso es
--   exactamente la clase de ambiguedad que un monto siempre positivo mas
--   una categoria fija evita.
--
-- Correr desde Supabase -> SQL Editor -> Run, un bloque por vez.
-- ============================================================


-- ------------------------------------------------------------
-- 1) La tabla de movimientos
-- ------------------------------------------------------------
create table if not exists public.pl_movimientos (
  id              uuid primary key default gen_random_uuid(),
  fecha           date not null,
  centro_costo_id uuid not null references public.centros_costo(id),
  cuenta_id       uuid not null references public.plan_de_cuentas(id),
  moneda          text not null default 'ARS',
  monto           numeric not null check (monto >= 0),
  descripcion     text,
  fuente          text not null default 'manual',
  creado_por      uuid,
  created_at      timestamptz not null default now()
);

comment on table public.pl_movimientos is
  'Un movimiento de costo (o de ingreso de Astillero) por fila: fecha, centro de costo, cuenta del plan_de_cuentas, monto siempre positivo. El renglon de Facturación de buque sigue viniendo de comercial.facturas via v_fin_ingresos; esta tabla es todo lo demas del P&L.';

-- Un indice comun sobre `fecha` sirve igual para un filtro por mes
-- (`fecha >= '2026-02-01' and fecha < '2026-03-01'`): no hace falta una
-- expresion con date_trunc, que ademas Postgres no deja indexar porque la
-- funcion no esta marcada IMMUTABLE.
create index if not exists ix_pl_movimientos_fecha
  on public.pl_movimientos (fecha);
create index if not exists ix_pl_movimientos_centro_costo
  on public.pl_movimientos (centro_costo_id);
create index if not exists ix_pl_movimientos_cuenta
  on public.pl_movimientos (cuenta_id);

alter table public.pl_movimientos enable row level security;

create policy "pl_movimientos_select_authenticated"
  on public.pl_movimientos for select to authenticated using (true);
create policy "pl_movimientos_insert_authenticated"
  on public.pl_movimientos for insert to authenticated with check (true);
create policy "pl_movimientos_update_authenticated"
  on public.pl_movimientos for update to authenticated using (true);
create policy "pl_movimientos_delete_authenticated"
  on public.pl_movimientos for delete to authenticated using (true);

grant select, insert, update, delete on public.pl_movimientos to authenticated;


-- ------------------------------------------------------------
-- 2) v_fin_ingresos: sumar centro_costo_id, segmento y estructura tarifaria
--
-- `create or replace view` en Postgres solo deja AGREGAR columnas al
-- final, no insertarlas en el medio ni reordenar las que ya habia (rompe
-- con "cannot change name of view column"). Por eso las tres columnas
-- nuevas van al final, después de `cobrada`, aunque temáticamente
-- correspondan más cerca de `buque`/`centro_costo`. El orden de columnas
-- no le importa a nadie que ya seleccione por nombre (todo el codigo de
-- Finanzas lo hace), asi que no es un problema real, solo estetico.
-- ------------------------------------------------------------
create or replace view public.v_fin_ingresos as
select
  f.id                        as factura_id,
  f.nro_factura,

  f.fecha_emision,
  date_trunc('month', f.fecha_emision)::date as mes,
  f.empresa_facturadora,

  f.proyecto_id               as comercial_proyecto_id,
  p.nro_proyecto,
  p.nombre                    as proyecto,
  p.compania,
  p.cliente_final,

  f.operacion_id,
  o.nro_operacion,
  o.nombre                    as salida,
  coalesce(o.buque, p.buque)  as buque,

  cc.nombre                   as centro_costo,

  f.moneda,
  f.importe,
  f.comision,
  f.importe - f.comision      as neto,

  case when f.moneda = 'USD' then f.importe
       else f.importe / nullif(public.fn_tc_oficial_mes(f.fecha_emision), 0)
  end as importe_usd,
  case when f.moneda = 'USD' then f.comision
       else f.comision / nullif(public.fn_tc_oficial_mes(f.fecha_emision), 0)
  end as comision_usd,
  case when f.moneda = 'USD' then (f.importe - f.comision)
       else (f.importe - f.comision) / nullif(public.fn_tc_oficial_mes(f.fecha_emision), 0)
  end as neto_usd,

  f.vencimiento,
  f.cobro_fecha,
  f.cobro_moneda,
  f.tc_pagado,
  f.tc_dia_cobro,
  (f.cobro_fecha is not null) as cobrada,

  -- nuevas, al final por la restriccion de create or replace view
  p.estructura_tarifaria,
  cc.id                       as centro_costo_id,
  cc.segmento

from comercial.facturas f
join comercial.proyectos p  on p.id = f.proyecto_id
left join comercial.operaciones o on o.id = f.operacion_id
left join public.centros_costo cc
  on cc.empresa = 'Parana Logistica'
 and lower(trim(cc.nombre)) = lower(trim(coalesce(o.buque, p.buque)));

comment on view public.v_fin_ingresos is
  'Una fila por factura de Comercial, con proyecto, salida, buque, centro de costo/segmento (por nombre) y estructura tarifaria resueltos, en moneda original y en USD Oficial al TC de cierre del mes. Devengado por fecha_emision. Base del renglon Facturación del P&L.';

grant select on public.v_fin_ingresos to authenticated;


-- ------------------------------------------------------------
-- 3) Los costos (y el ingreso de Astillero) agregados por mes
-- ------------------------------------------------------------
create or replace view public.v_pl_costos_mensual as
select
  date_trunc('month', m.fecha)::date as mes,
  m.moneda,
  cc.id                               as centro_costo_id,
  cc.nombre                           as centro_costo,
  cc.segmento,
  pc.id                               as cuenta_id,
  pc.cuenta,
  pc.categoria,
  pc.subcategoria,
  count(*)                            as movimientos,
  sum(m.monto)                        as monto,
  case when m.moneda = 'USD' then sum(m.monto)
       else sum(m.monto / nullif(public.fn_tc_oficial_mes(m.fecha), 0))
  end                                  as monto_usd
from public.pl_movimientos m
join public.centros_costo cc  on cc.id = m.centro_costo_id
join public.plan_de_cuentas pc on pc.id = m.cuenta_id
group by 1, 2, 3, 4, 5, 6, 7, 8, 9;

comment on view public.v_pl_costos_mensual is
  'pl_movimientos agregado por mes, centro de costo/segmento y cuenta/categoria, con monto_usd al TC de cierre de mes (fn_tc_oficial_mes). Vacia hasta que se carguen movimientos.';

grant select on public.v_pl_costos_mensual to authenticated;


-- ------------------------------------------------------------
-- 3.1) v_fin_ingresos_mensual: sumar centro_costo_id
--
-- Necesario para poder unir con centros_costo.segmento en la vista
-- consolidada de mas abajo sin repetir el cruce por nombre de buque. Va al
-- final de la lista de columnas por la misma restriccion de
-- `create or replace view` explicada arriba.
-- ------------------------------------------------------------
create or replace view public.v_fin_ingresos_mensual as
select
  i.mes,
  i.moneda,
  i.empresa_facturadora,
  i.buque,
  i.centro_costo,
  i.comercial_proyecto_id,
  i.nro_proyecto,
  i.proyecto,
  count(*)              as facturas,
  sum(i.importe)        as importe,
  sum(i.comision)        as comision,
  sum(i.neto)            as neto,
  sum(i.importe_usd)     as importe_usd,
  sum(i.comision_usd)    as comision_usd,
  sum(i.neto_usd)        as neto_usd,
  i.centro_costo_id
from public.v_fin_ingresos i
group by 1, 2, 3, 4, 5, 6, 7, 8, 16;

comment on view public.v_fin_ingresos_mensual is
  'v_fin_ingresos agregada por mes, moneda, centro de costo y proyecto. Las columnas _usd ya estan en una sola moneda y se pueden sumar cruzando filas de moneda distinta; importe/comision/neto no.';

grant select on public.v_fin_ingresos_mensual to authenticated;


-- ------------------------------------------------------------
-- 4) El P&L unificado: ingresos + costos, una sola forma
--
-- (mes, segmento, centro_costo, categoria, monto_usd). Todo lo que
-- necesita la pantalla para armar la cascada completa con un solo
-- group by, sea que la fila venga de una factura de Comercial o de un
-- movimiento cargado a mano.
-- ------------------------------------------------------------
create or replace view public.v_pl_mensual as
select
  i.mes, cc.segmento, i.centro_costo_id, i.centro_costo,
  'ingreso'::text as categoria, 'Facturación'::text as subcategoria,
  sum(i.neto_usd) as monto_usd
from public.v_fin_ingresos_mensual i
left join public.centros_costo cc on cc.id = i.centro_costo_id
group by 1, 2, 3, 4

union all

select
  mes, segmento, centro_costo_id, centro_costo,
  categoria, subcategoria,
  sum(monto_usd) as monto_usd
from public.v_pl_costos_mensual
group by 1, 2, 3, 4, 5, 6;

comment on view public.v_pl_mensual is
  'El P&L completo en una sola forma: mes, segmento (buque/astillero/corporativo), centro de costo, categoria (ingreso, costo_variable, costo_embarcados, costo_semifijo, costo_fijo, costo_dique, otros_no_operativo, financiero, sga, ingreso_astillero) y monto_usd. categoria=ingreso o ingreso_astillero suma en la cascada; el resto resta.';

grant select on public.v_pl_mensual to authenticated;


-- ------------------------------------------------------------
-- MARCHA ATRAS
--
--   drop view if exists public.v_pl_mensual;
--   drop view if exists public.v_pl_costos_mensual;
--   drop table if exists public.pl_movimientos;
--
-- v_fin_ingresos queda con las columnas nuevas (centro_costo_id, segmento,
-- estructura_tarifaria); sacarlas es un create or replace view con la
-- version anterior, no un drop.
-- ------------------------------------------------------------
