-- ============================================================
-- INTEGRA · Finanzas — los KPIs del área, para mostrar en Integra
--
-- QUE RESUELVE
--
--   Silvestre quiere exponer un puñado de números de Finanzas para que
--   el Portal (Integra) los pueda mostrar sin tener que reconstruir la
--   lógica del P&L o de Facturación del lado del Portal, y para mostrar
--   en el Tablero de Control de Finanzas mismo. Esta vista junta eso en
--   una sola fila, lista para leer.
--
--   Ya existe public.vw_kpis en la base, pero es de Compras (cuenta
--   requisiciones). No hay todavía una convención compartida de KPIs
--   entre módulos, así que esta vista sigue el prefijo que ya usa
--   Finanzas para todo lo propio (v_fin_...), en vez de pisar o
--   adivinar un nombre genérico.
--
-- POR QUE UNA SOLA FILA Y NO UNA FILA POR MES
--
--   v_pl_mensual y v_fin_ingresos_mensual ya dan el detalle mes a mes
--   para quien lo necesite (la pantalla P&L de Finanzas, por ejemplo).
--   Lo que un portal quiere mostrar como KPI es el número de hoy: cómo
--   cerró el último mes, cómo viene el año, y qué está en riesgo de
--   cobranza ahora mismo. Por eso es una vista de una sola fila
--   (snapshot), no una serie de tiempo.
--
-- EL SIGNO: monto_usd YA VIENE SIGNADO, NO ES UNA MAGNITUD
--
--   sql/pl_movimientos.sql documenta "monto es una magnitud, nunca
--   negativo (constraint)" — pero esa constraint no existe en la base
--   (se chequeó con pg_constraint: pl_movimientos no tiene ningún check).
--   Los datos reales, importados de Xubio, vienen con el signo real
--   puesto: ingreso positivo, costo negativo, tal cual el Cuadro de
--   Resultados de Xubio. Es la misma convención que ya usa
--   construirCascada() en el P&L (ver su propio comentario: "monto_usd
--   ya viene con el signo real... no hace falta decir si resta, es
--   simplemente la suma acumulada"). Esta vista sigue esa convención
--   real, no la documentada: resultado_neto y margen de contribución
--   son sumas directas, sin dar vuelta signos por categoría.
--
-- LOS SIETE NUMEROS
--
--   resultado_neto_usd_ultimo_mes / _ytd
--     Suma directa de monto_usd en v_pl_mensual. "Último mes cerrado" es
--     el mes más reciente con algún movimiento Y con TC cargado (si un
--     mes tiene movimientos pero fn_tc_oficial_mes todavía no tiene ese
--     mes, monto_usd da null y ese mes se descarta para no mostrar un
--     resultado vacío).
--
--   facturado_cobrado_usd_ytd / facturado_pendiente_usd_ytd /
--   facturado_en_gestion_usd_ytd / pct_cobrado_ytd
--     De v_facturas_finanzas, facturas emitidas en el año en curso,
--     agrupadas por el estado_cobro ya calculado ahí (cobrada siempre
--     gana — ver sql/facturas_finanzas.sql). No se reinventa el estado.
--
--   facturas_vencidas_sin_gestion / _usd
--     Facturas con estado_cobro = 'pendiente' (ni cobrada ni en
--     gestión) cuyo vencimiento ya pasó. Es la alerta operativa: nadie
--     las está reclamando y ya vencieron.
--
--   margen_contribucion_usd_ytd / pct_margen_contribucion_ytd
--     Facturación + Costos Variables de Viaje + Costo Embarcados (ya
--     signados, por eso se suman y no se restan) — exactamente la misma
--     definición que el subtotal CONTRIBUCIÓN MARGINAL de la cascada del
--     P&L (CASCADA_BUQUE en App.jsx). Ojo: mientras Costo Embarcados no
--     esté cargado (ver la alerta de la pantalla P&L), este margen va a
--     salir inflado — hoy, en todo el año en curso, no hay ni una fila
--     de costo_embarcados cargada.
--
--   multas_recargos_usd_ytd
--     Solo la cuenta "Multas y Recargos" del plan de cuentas (categoria
--     financiero), no toda la categoría: ahí también viven Diferencia
--     de Cambio, Descuentos Obtenidos, etc., que no son evidencia de
--     cumplimiento fiscal.
--
--   costo_financiero_usd_ytd
--     Gastos Bancarios en USD + Intereses Bcarios Pagados + Intereses
--     Proveedores. Deja afuera Impuesto Deb/Cred Bancario (un impuesto
--     de ley, no negociable) e Intereses Obtenidos (es un ingreso, no
--     un costo) — mezclarlos daría un número que no dice lo que el KPI
--     promete.
--
-- Correr desde Supabase -> SQL Editor -> Run.
-- ============================================================


create or replace view public.v_fin_kpis
  with (security_invoker = on) as
with pl_mensual as (
  select
    mes,
    sum(monto_usd) as resultado_neto_usd
  from public.v_pl_mensual
  group by mes
),
pl_ultimo_mes as (
  select mes, resultado_neto_usd
  from pl_mensual
  where resultado_neto_usd is not null
  order by mes desc
  limit 1
),
pl_ytd as (
  select sum(resultado_neto_usd) as resultado_neto_usd_ytd
  from pl_mensual
  where mes >= date_trunc('year', current_date)
    and resultado_neto_usd is not null
),
margen_contribucion_ytd as (
  select
    sum(case when categoria in ('ingreso', 'ingreso_astillero') then monto_usd else 0 end) as facturacion_usd,
    sum(case when categoria in ('costo_variable', 'costo_embarcados') then monto_usd else 0 end) as costos_variables_usd
  from public.v_pl_mensual
  where mes >= date_trunc('year', current_date)
),
costos_financieros_ytd as (
  select
    sum(case when cuenta = 'Multas y Recargos' then monto_usd else 0 end) as multas_recargos_usd,
    sum(case when cuenta in ('Gastos Bancarios en USD', 'Intereses Bcarios Pagados', 'Intereses Proveedores')
             then monto_usd else 0 end) as costo_financiero_usd
  from public.v_pl_costos_mensual
  where mes >= date_trunc('year', current_date)
),
facturacion_ytd as (
  select estado_cobro, sum(neto_usd) as neto_usd
  from public.v_facturas_finanzas
  where fecha_emision >= date_trunc('year', current_date)
  group by estado_cobro
),
vencidas_sin_gestion as (
  select count(*) as facturas, sum(neto_usd) as neto_usd
  from public.v_facturas_finanzas
  where estado_cobro = 'pendiente'
    and vencimiento < current_date
)
select
  (select mes from pl_ultimo_mes)             as mes_ultimo_cerrado,
  (select resultado_neto_usd from pl_ultimo_mes)   as resultado_neto_usd_ultimo_mes,
  (select resultado_neto_usd_ytd from pl_ytd)      as resultado_neto_usd_ytd,

  coalesce((select neto_usd from facturacion_ytd where estado_cobro = 'cobrada'), 0)    as facturado_cobrado_usd_ytd,
  coalesce((select neto_usd from facturacion_ytd where estado_cobro = 'pendiente'), 0)  as facturado_pendiente_usd_ytd,
  coalesce((select neto_usd from facturacion_ytd where estado_cobro = 'en_gestion'), 0) as facturado_en_gestion_usd_ytd,
  round(
    100.0 * coalesce((select neto_usd from facturacion_ytd where estado_cobro = 'cobrada'), 0)
    / nullif((select sum(neto_usd) from facturacion_ytd), 0)
  , 1) as pct_cobrado_ytd,

  coalesce((select facturas from vencidas_sin_gestion), 0)  as facturas_vencidas_sin_gestion,
  coalesce((select neto_usd from vencidas_sin_gestion), 0)  as facturas_vencidas_sin_gestion_usd,

  (
    (select facturacion_usd from margen_contribucion_ytd)
    + (select costos_variables_usd from margen_contribucion_ytd)
  ) as margen_contribucion_usd_ytd,
  round(
    100.0 * (
      (select facturacion_usd from margen_contribucion_ytd)
      + (select costos_variables_usd from margen_contribucion_ytd)
    )
    / nullif((select facturacion_usd from margen_contribucion_ytd), 0)
  , 1) as pct_margen_contribucion_ytd,

  coalesce((select multas_recargos_usd from costos_financieros_ytd), 0) as multas_recargos_usd_ytd,
  coalesce((select costo_financiero_usd from costos_financieros_ytd), 0) as costo_financiero_usd_ytd;

comment on view public.v_fin_kpis is
  'Snapshot de KPIs de Finanzas para Integra: resultado neto (ultimo mes con tipo de cambio cargado y YTD, suma directa de monto_usd que ya viene signado), facturacion YTD cobrada/pendiente/en gestion con su %, facturas vencidas sin gestionar, margen de contribucion YTD (Facturacion + Costos Variables + Costo Embarcados, ya signados), multas y recargos YTD (cuenta puntual del plan de cuentas, evidencia de cumplimiento fiscal) y costo financiero YTD (gastos e intereses bancarios/proveedores, sin el impuesto al cheque ni diferencias de cambio). Una sola fila, de solo lectura. "Ultimo mes cerrado" descarta meses con movimientos cargados pero sin TC oficial todavia.';

grant select on public.v_fin_kpis to authenticated;


-- ------------------------------------------------------------
-- Ver como queda
-- ------------------------------------------------------------
select * from public.v_fin_kpis;


-- ------------------------------------------------------------
-- MARCHA ATRAS
--
--   drop view if exists public.v_fin_kpis;
--
-- Sin riesgo: no crea tablas, solo lee de vistas que ya existian.
-- ------------------------------------------------------------
