-- ============================================================
-- INTEGRA · Finanzas — los ingresos salen de Comercial
--
-- QUE RESUELVE
--
--   Finanzas no factura. La factura se emite y se sigue en Comercial
--   (comercial.facturas, migracion 0028), que ya tiene proyecto obligatorio,
--   importe, comision al broker, moneda, fecha de emision, vencimiento y
--   cobranza. Lo que falta no es cargar ingresos: es leerlos con la forma
--   que necesita un P&L.
--
--   Esta migracion no crea ninguna tabla nueva de Comercial. Son dos vistas
--   de lectura: el detalle factura por factura, y el resumen mensual que es
--   el renglon FACTURACION del P&L —el primero que se construye, ver
--   sql/pl_ingresos.sql para el resto.
--
-- DEVENGADO, NO PERCIBIDO
--
--   El mes de un ingreso es el de `fecha_emision`, no el del cobro. Es lo
--   mismo que hace hoy la planilla de costos ("FACTURACION NOMINAL" por
--   mes), asi que los numeros van a poder compararse contra ella.
--
--   Los datos de cobranza (cobro_fecha, tc_pagado, tc_dia_cobro) igual se
--   exponen en el detalle, porque el flujo de fondos se arma con los
--   mismos registros. Pero son otro informe: no mezclarlos en la misma
--   pantalla que el P&L.
--
-- EL ESTADO DE LA FACTURA NO SE CALCULA ACA
--
--   0028 decidio, a proposito, que "cobrada / vigente / vencida" se deduce
--   en un solo lugar (estadoDeFactura, lib/types.ts de Comercial) en vez de
--   guardarse. Reimplementarlo en SQL crearia una segunda definicion que se
--   despega de la primera. Estas vistas exponen los hechos —hay cobro, hay
--   vencimiento— y nada mas.
--
-- LA MONEDA Y EL USD OFICIAL
--
--   Verificado el 2026-09-07: las 16 facturas que hay hoy estan todas en
--   USD (ver memoria [[facturas-comercial-todas-en-usd]]). Pero una factura
--   en ARS es cuestion de tiempo, asi que la vista ya expone tres columnas
--   nuevas —importe_usd, comision_usd, neto_usd— convertidas cuando la
--   moneda no es USD. Si la moneda es USD, la columna _usd es igual a la
--   original: no hay conversion que hacer.
--
--   La conversion usa `public.fn_tc_oficial_mes(fecha_emision)`
--   (sql/tipo_cambio.sql), UN SOLO TC POR MES —el de cierre, no el del dia
--   exacto de la factura—. Decision de Silvestre, 2026-09-08: si dos
--   facturas del mismo mes convirtieran cada una al TC de su propio dia, el
--   P&L de un mes ya cerrado se releeria distinto cada vez, porque el TC de
--   referencia dependeria de en que fecha exacta cayo cada factura. Con el
--   TC de cierre de mes, todo lo que factura en febrero convierte igual, y
--   el P&L de febrero deja de moverse en cuanto febrero termina.
--
--   Si algun dia hay una factura en ARS de un mes que todavia no tiene
--   ningun TC cargado (fn_tc_oficial_mes devuelve null), la columna _usd da
--   null en vez de un numero inventado. Un P&L con un null adentro se nota;
--   uno con un TC de 1 no se nota y esta mal.
--
--   `moneda` sigue en el group by del resumen mensual a proposito: agrupar
--   sin ella sumaria importes en ARS con importes en USD en la columna
--   `importe`/`neto` (las NO convertidas). Las columnas `_usd` si se pueden
--   sumar cruzando monedas, porque ya estan todas en la misma.
--
-- EL CENTRO DE COSTO: POR NOMBRE, NO POR FK
--
--   La decision de fondo —cual de los dos maestros de buque manda, ver
--   [[dos-maestros-de-buque]]— sigue sin resolverse. Mientras tanto, el
--   buque de la factura (texto libre, viene de la salida o si no del
--   proyecto) se cruza por nombre contra `public.centros_costo` de PL
--   Offshore. Hoy los dos buques que facturan —Atlantic Dama, Golondrina de
--   Mar— matchean exacto. Un buque que no cruce (typo, o un centro que
--   todavia no esta cargado) deja `centro_costo` en null: no se inventa un
--   match aproximado.
--
-- NO DEPENDE DEL ESPEJO DE PROYECTOS
--
--   Ni del espejo ni de la 0038. Por eso expone `comercial_proyecto_id` —el
--   id que vive en Comercial— y no un id de public.proyectos. Cuando la
--   0038 este aplicada se le puede sumar el centro de costo por FK en lugar
--   de por nombre: es un join que se reemplaza, no un rediseno.
--
--   EL ESPEJO NO CORRIO. Verificado contra la base el 2026-09-07:
--   public.proyectos NO tiene la columna comercial_proyecto_id. No cambia
--   una linea del SQL de abajo: estas vistas leen Comercial directo, asi
--   que sirven igual con espejo o sin el.
--
-- PRIVILEGIOS
--
--   Como v_buque_dias, esta vista lee el schema `comercial`, al que el
--   usuario de Finanzas no llega directo, y se apoya en que una vista
--   corre con los permisos de su dueño. Expone importes y la comision del
--   broker: es el punto de la vista, pero conviene tenerlo presente antes
--   de darle acceso a alguien mas. La vista NO aplica la RLS de
--   comercial.facturas: corre con los permisos del dueño y cualquier rol
--   con select sobre la vista ve todas las facturas. Es lo que se quiere
--   —Finanzas tiene que ver el total—, pero es una decision, no un
--   descuido, y el linter de Supabase la va a listar como
--   `security_definer_view`. Ese warning es esperado: no se arregla
--   agregandole `security_invoker = true`, porque con eso la vista deja de
--   poder leer `comercial` y sale vacia. Si alguna vez Finanzas tiene
--   usuarios que no deban ver importes, la solucion es no darles select
--   sobre la vista, no tocarla.
--
-- Correr desde Supabase -> SQL Editor -> Run, un bloque por vez.
-- ============================================================


-- ------------------------------------------------------------
-- 1) ANTES QUE NADA: que hay cargado en facturas
-- ------------------------------------------------------------
select f.moneda,
       count(*)                                              as facturas,
       min(f.fecha_emision)                                  as desde,
       max(f.fecha_emision)                                  as hasta,
       sum(f.importe)                                        as importe,
       sum(f.comision)                                       as comision,
       count(*) filter (where f.operacion_id is null)        as sin_salida,
       count(*) filter (where f.cobro_fecha  is not null)    as cobradas
from comercial.facturas f
group by f.moneda
order by f.moneda;


-- ------------------------------------------------------------
-- 2) El detalle: una fila por factura
-- ------------------------------------------------------------
create or replace view public.v_fin_ingresos as
select
  f.id                        as factura_id,
  f.nro_factura,

  f.fecha_emision,
  date_trunc('month', f.fecha_emision)::date as mes,
  f.empresa_facturadora,

  -- El id de Comercial, no uno de public.proyectos: el espejo no corrio.
  f.proyecto_id               as comercial_proyecto_id,
  p.nro_proyecto,
  p.nombre                    as proyecto,
  p.compania,
  p.cliente_final,

  f.operacion_id,
  o.nro_operacion,
  o.nombre                    as salida,
  -- Texto libre hasta que se aplique 0038 en Comercial. Si el proyecto uso
  -- dos buques y la factura no apunta a una salida, esto dice el del
  -- proyecto, que puede no ser el que trabajo.
  coalesce(o.buque, p.buque)  as buque,

  -- Cruce por nombre contra el maestro de centros de costo de PL Offshore.
  -- Null si el buque no matchea ninguno (typo, o un buque brokereado que
  -- legitimamente no tiene centro de costo: ver
  -- [[proyectos-sin-centro-de-costo]]).
  cc.nombre                   as centro_costo,

  f.moneda,
  f.importe,
  f.comision,
  -- Lo que le queda a la empresa. Es el renglon que va al P&L: la comision
  -- del broker es un costo de la venta, no plata propia.
  f.importe - f.comision      as neto,

  -- USD Oficial. Si ya esta en USD, la conversion es la identidad.
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
  (f.cobro_fecha is not null) as cobrada

from comercial.facturas f
join comercial.proyectos p  on p.id = f.proyecto_id
left join comercial.operaciones o on o.id = f.operacion_id
left join public.centros_costo cc
  on cc.empresa = 'Parana Logistica'
 and lower(trim(cc.nombre)) = lower(trim(coalesce(o.buque, p.buque)));

comment on view public.v_fin_ingresos is
  'Una fila por factura de Comercial, con proyecto, salida, buque y centro de costo (por nombre) resueltos, en moneda original y en USD Oficial. Devengado por fecha_emision. Base del P&L.';

grant select on public.v_fin_ingresos to authenticated;


-- ------------------------------------------------------------
-- 3) El resumen mensual
--
-- Es el renglon FACTURACION del P&L, abierto por los cortes que se van a
-- querer mirar: mes, centro de costo, proyecto.
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
  sum(i.neto_usd)        as neto_usd
from public.v_fin_ingresos i
group by 1, 2, 3, 4, 5, 6, 7, 8;

comment on view public.v_fin_ingresos_mensual is
  'v_fin_ingresos agregada por mes, moneda, centro de costo y proyecto. Las columnas _usd ya estan en una sola moneda y se pueden sumar cruzando filas de moneda distinta; importe/comision/neto no.';

grant select on public.v_fin_ingresos_mensual to authenticated;


-- ------------------------------------------------------------
-- 4) Ver como quedo · el ingreso en USD por centro de costo y por mes
-- ------------------------------------------------------------
select coalesce(centro_costo, '(sin centro de costo)') as centro_costo,
       to_char(mes, 'YYYY-MM')                          as mes,
       sum(neto_usd)                                     as neto_usd
from public.v_fin_ingresos_mensual
group by 1, 2
order by 1, 2;


-- ------------------------------------------------------------
-- 5) El mismo dato por proyecto
-- ------------------------------------------------------------
select coalesce(nro_proyecto, '(sin numero)')  as proyecto,
       proyecto                                as nombre,
       coalesce(centro_costo, '(sin centro)')  as centro_costo,
       min(mes)                                as primera_factura,
       max(mes)                                as ultima_factura,
       sum(facturas)                           as facturas,
       sum(neto_usd)                           as neto_usd
from public.v_fin_ingresos_mensual
group by 1, 2, 3
order by 7 desc;


-- ------------------------------------------------------------
-- LO QUE FALTA PARA QUE ESTO SEA UN P&L COMPLETO
--
--   1. Los costos. Hoy no hay ninguna fuente de costo en la base: los
--      cuatro modulos (Compras, Viveres, Reparaciones, HSQE) tienen
--      pedidos, no comprobantes, y el 76% del costo de un buque —sueldos
--      embarcados, seguros, dique— no pasa por ninguno. Ver
--      [[tres-universos-de-proyectos]]: la plata real esta en cost-tracker
--      (repo de Fede), sin vinculo con public.proyectos.
--   2. Decidir el cruce buque <-> centro de costo por FK en vez de por
--      nombre (0038, [[dos-maestros-de-buque]]).
--   3. La linea de tiempo del buque (sql/linea_tiempo_buque.sql) para poder
--      imputar el costo que no trae proyecto.
--
-- MARCHA ATRAS
--
--   drop view if exists public.v_fin_ingresos_mensual;
--   drop view if exists public.v_fin_ingresos;
--
-- Sin riesgo: son dos vistas de lectura, no crean ni modifican ninguna
-- tabla. Borrarlas no toca un solo dato de Comercial ni de centros_costo.
-- ------------------------------------------------------------
