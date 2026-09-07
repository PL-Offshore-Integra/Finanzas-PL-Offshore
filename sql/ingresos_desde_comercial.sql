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
--   Esta migracion no crea ninguna tabla. Son dos vistas de lectura sobre
--   Comercial: el detalle factura por factura, y el resumen mensual que es
--   el renglon de arriba del estado de resultados.
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
-- LA MONEDA: LEER ESTO
--
--   Una factura puede estar en USD o en ARS, y en la base NO hay tabla de
--   tipos de cambio: los TC del Excel viven en las filas 7 y 8 de cada
--   hoja, no en Postgres. Mientras eso siga asi, no se puede producir un
--   P&L en dolares a partir de facturas en pesos.
--
--   Por eso el resumen mensual agrupa POR MONEDA. No es prolijidad: si
--   agrupara sin la moneda, sumaria pesos con dolares y daria un numero que
--   parece plata y no lo es. Con la moneda en el group by, ese error es
--   imposible de cometer.
--
--   Cuando exista la tabla de TC se agrega una columna convertida. No la
--   creo ahora porque no se cuantas facturas hay en pesos ni cual de los
--   dos TC del Excel corresponde al ingreso, y una tabla vacia que nadie
--   llena es peor que no tenerla.
--
-- NO DEPENDE DE NADA
--
--   Ni del espejo ni de la 0038. Por eso expone `comercial_proyecto_id` y
--   no un id de public.proyectos, y el buque como texto. Cuando el espejo
--   corra se agrega el id local; cuando la 0038 este aplicada, el centro de
--   costo. Las dos cosas son un join mas, no un rediseno.
--
-- Correr desde Supabase -> SQL Editor -> Run, un bloque por vez.
-- ============================================================


-- ------------------------------------------------------------
-- 1) ANTES QUE NADA: que hay cargado en facturas
--
-- No crea nada. Contesta lo que no puedo saber desde afuera: cuantas
-- facturas hay, en que monedas, de que fechas, y cuantas no apuntan a una
-- salida (que es lo que impide saber con que buque se hizo el trabajo
-- cuando el proyecto uso mas de uno).
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
--
-- Lo mismo que comercial.facturas_listado, pero del lado de Finanzas y con
-- el mes ya resuelto. Se define aparte en vez de leer aquella vista para no
-- atarse a su forma: facturas_listado hace `f.*`, asi que cualquier columna
-- nueva en la tabla le entra sola y le cambia el contrato sin aviso.
--
-- PRIVILEGIOS. Como v_buque_dias, esta vista lee el schema `comercial`, al
-- que el usuario de Finanzas no llega directo, y se apoya en que una vista
-- corre con los permisos de su duenio. A diferencia de aquella, aca si se
-- exponen importes y la comision del broker: es el punto de la vista, pero
-- conviene tenerlo presente antes de darle acceso a alguien mas.
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

  f.moneda,
  f.importe,
  f.comision,
  -- Lo que le queda a la empresa. Es el renglon que va al P&L: la comision
  -- del broker es un costo de la venta, no plata propia.
  f.importe - f.comision      as neto,

  f.vencimiento,
  f.cobro_fecha,
  f.cobro_moneda,
  f.tc_pagado,
  f.tc_dia_cobro,
  (f.cobro_fecha is not null) as cobrada

from comercial.facturas f
join comercial.proyectos p  on p.id = f.proyecto_id
left join comercial.operaciones o on o.id = f.operacion_id;

comment on view public.v_fin_ingresos is
  'Una fila por factura de Comercial, con proyecto, salida y buque resueltos. Devengado por fecha_emision. Base del P&L.';

grant select on public.v_fin_ingresos to authenticated;


-- ------------------------------------------------------------
-- 3) El resumen mensual
--
-- Es el renglon FACTURACION del P&L, abierto por los cortes que se van a
-- querer mirar: mes, buque, proyecto.
--
-- `moneda` esta en el group by a proposito. Ver la nota del encabezado: sin
-- ella, un sum() mezclaria pesos con dolares.
-- ------------------------------------------------------------
create or replace view public.v_fin_ingresos_mensual as
select
  i.mes,
  i.moneda,
  i.empresa_facturadora,
  i.buque,
  i.comercial_proyecto_id,
  i.nro_proyecto,
  i.proyecto,
  count(*)          as facturas,
  sum(i.importe)    as importe,
  sum(i.comision)   as comision,
  sum(i.neto)       as neto
from public.v_fin_ingresos i
group by 1, 2, 3, 4, 5, 6, 7;

comment on view public.v_fin_ingresos_mensual is
  'v_fin_ingresos agregada por mes, moneda, buque y proyecto. Agrupa por moneda para que no se sumen pesos con dolares.';

grant select on public.v_fin_ingresos_mensual to authenticated;


-- ------------------------------------------------------------
-- 4) Ver como quedo · el ingreso por buque y por mes
--
-- Esto es lo que hoy se lee en la fila FACTURACION NOMINAL de cada hoja del
-- Excel. Si los numeros no coinciden, o falta cargar facturas en Comercial
-- o la planilla tiene algo que la base no.
-- ------------------------------------------------------------
select coalesce(buque, '(sin buque)') as buque,
       moneda,
       to_char(mes, 'YYYY-MM')        as mes,
       sum(importe)                   as importe,
       sum(comision)                  as comision,
       sum(neto)                      as neto
from public.v_fin_ingresos_mensual
group by 1, 2, 3
order by 1, 2, 3;


-- ------------------------------------------------------------
-- 5) El mismo dato por proyecto
--
-- El otro corte que pidio Silvestre. Ojo que esto es solo el ingreso: el
-- margen por proyecto necesita ademas los costos directos, que todavia no
-- estan.
-- ------------------------------------------------------------
select coalesce(nro_proyecto, '(sin numero)') as proyecto,
       proyecto                               as nombre,
       coalesce(buque, '(sin buque)')         as buque,
       moneda,
       min(mes)                               as primera_factura,
       max(mes)                               as ultima_factura,
       sum(facturas)                          as facturas,
       sum(neto)                              as neto
from public.v_fin_ingresos_mensual
group by 1, 2, 3, 4
order by 8 desc;


-- ------------------------------------------------------------
-- LO QUE FALTA PARA QUE ESTO SEA UN P&L
--
--   1. Tabla de tipos de cambio (mes, tc). Sin ella no hay P&L en dolares
--      si hay facturas en pesos, y no se puede comparar marzo con
--      noviembre. Los valores estan en las filas 7 y 8 de cada hoja del
--      Excel de costos; falta decidir cual de los dos TC aplica al ingreso.
--   2. Los costos. Hoy no hay ninguna fuente de costo en la base: los
--      cuatro modulos (Compras, Viveres, Reparaciones, HSQE) tienen
--      pedidos, no comprobantes, y el 76% del costo de un buque —sueldos
--      embarcados, seguros, dique— no pasa por ninguno.
--   3. La linea de tiempo del buque (sql/linea_tiempo_buque.sql) para poder
--      imputar el costo que no trae proyecto.
--
-- MARCHA ATRAS
--
--   drop view if exists public.v_fin_ingresos_mensual;
--   drop view if exists public.v_fin_ingresos;
--
-- Sin riesgo: son dos vistas de lectura, no crean ni modifican ninguna
-- tabla. Borrarlas no toca un solo dato de Comercial.
-- ------------------------------------------------------------
