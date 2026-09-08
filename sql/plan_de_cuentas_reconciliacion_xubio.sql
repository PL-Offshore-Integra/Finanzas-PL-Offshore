-- ============================================================
-- INTEGRA · Finanzas — el plan de cuentas contra el Xubio real
--
-- QUE RESUELVE
--
--   sql/plan_de_cuentas.sql se armó a partir de la planilla manual
--   ("Costos Totales Empresas 2026-variabilidad.xlsx"). El 2026-09-08
--   Silvestre pasó el Cuadro de Resultados exportado directo de Xubio
--   ("Cuadro de Resultados (24).xlsx", 213 líneas: Cuenta + Centro de
--   Costo + monto por mes) — la fuente contable real, no la copia a mano.
--
--   Se cruzaron los 109 nombres de cuenta únicos de ese export contra las
--   124 del plan ya cargado, normalizando acentos y mayúsculas: 46
--   coincidían exacto, 20 eran el mismo concepto con otro texto (typos,
--   abreviaturas, plural/singular), y 43 no tenían ninguna cuenta parecida.
--
--   Este archivo:
--     1. Renombra las 20 cercanas al texto EXACTO de Xubio. Es lo que
--        hace falta para que, el día de mañana, un importador pueda
--        buscar por `cuenta` sin tener que adivinar variantes.
--     2. Agrega las cuentas nuevas que se pueden clasificar con
--        confianza (costo/gasto claro).
--     3. Desdobla 'Prepaga / Obra Social' (una cuenta genérica que
--        Silvestre nunca tuvo en la planilla real) en las tres que Xubio
--        factura por separado.
--     4. Dice cuáles quedaron AFUERA a propósito, porque son ambiguas y
--        Silvestre las tiene que explicar.
--
-- POR QUÉ SE PUEDE RENOMBRAR SIN RIESGO
--
--   pl_movimientos está vacía (0 filas): no hay un solo movimiento
--   cargado todavía que dependa del texto viejo de ninguna cuenta.
--
-- LOS INGRESOS DE BUQUE (Servicios prestados, Soporte Ship to Ship,
-- Servicio de Remolque, Otros Ingresos Ordinarios) NO ENTRAN ACÁ
--
--   Son cuentas de ingreso real en Xubio, pero el ingreso del P&L sigue
--   viniendo de comercial.facturas (v_fin_ingresos), no de acá: meterlas
--   en plan_de_cuentas abriría una segunda fuente de ingreso que puede
--   contradecir a la primera. Dato para la memoria: el total 2026 de
--   Atlantic Dama en "Servicios prestados" (Xubio) da ~USD 2,28M contra
--   ~USD 2,05M de neto en comercial.facturas para el mismo buque —
--   parecido pero NO igual. Esa diferencia no se investiga acá; queda
--   anotada para el día que haga falta conciliar Comercial contra Xubio.
--
-- WP HALLE PASÓ DE 'corporativo' A 'buque'
--
--   Ya corrido a mano el 2026-09-08 (no está en este archivo): Xubio
--   muestra a WP Halle con ingreso propio (Servicios prestados, Otros
--   Ingresos Ordinarios) y costos de buque (Arrendamiento de Buques
--   egreso, Asistencia, Leasing WP Halle) — no es gasto administrativo
--   como decía sql/plan_de_cuentas.sql. Corregido:
--
--     update public.centros_costo set segmento = 'buque'
--     where nombre = 'WP Halle';
--
-- LO QUE QUEDÓ AFUERA, A PROPÓSITO — Silvestre lo tiene que explicar:
--
--   - Buque Hunter en Participacion (montos grandes, sin patrón claro)
--   - Leasing WP Halle (¿ingreso de alquilar WP Halle, o el costo de
--     arrendarlo? los montos son positivos, lo que sugiere ingreso, pero
--     no calza con que WP Halle también tenga "Arrendamiento de Buques
--     egreso" como costo — ¿son dos cosas distintas?)
--   - REPCAM (sin patrón identificable)
--   - Sueldos y Jornales Y Cargas Sociales (las dos: blanco de centro de
--     costo, montos enormes, mismo patron): ¿es la nómina/las cargas
--     totales sin repartir por buque, a diferencia de "Sueldos Embarcados
--     y Cargas Sociales" que sí viene por buque? Si es asi, hace falta
--     una regla de reparto (¿por dotación? ¿por dias operados?) antes de
--     poder cargarlas a ningun centro de costo.
--   - Diferencia de Cotización de Bonos (ligado a REPCAM, ¿tenencia de
--     bonos de la empresa, no de un buque?)
--
-- Correr desde Supabase -> SQL Editor -> Run, un bloque por vez.
-- ============================================================


-- ------------------------------------------------------------
-- 1) Renombrar al texto exacto de Xubio (20 cuentas)
-- ------------------------------------------------------------
update public.plan_de_cuentas set cuenta = 'Combustibles'                               where cuenta = 'Combustible';
update public.plan_de_cuentas set cuenta = 'Diques'                                      where cuenta = 'Dique';
update public.plan_de_cuentas set cuenta = 'Consumibles Mantenimiento y Reparacion'      where cuenta = 'Consumibles Mantenimiento y Reparaciones';
update public.plan_de_cuentas set cuenta = 'Gastos de Agencias'                          where cuenta = 'Gastos de Agencia';
update public.plan_de_cuentas set cuenta = 'Honorarios de Mant. Software / Hardware'     where cuenta = 'Honorarios de Mant. Software';
update public.plan_de_cuentas set cuenta = 'Libreria e Insumos Comp'                     where cuenta = 'Librería';
update public.plan_de_cuentas set cuenta = 'Servicio de GPS y Telemetría Autos'          where cuenta = 'Servicio de GPS y Telemetría';
update public.plan_de_cuentas set cuenta = 'Equipamiento de Armamento de Remolcadores'   where cuenta = 'Equipamiento de Armamento';
update public.plan_de_cuentas set cuenta = 'Comida Personal'                             where cuenta = 'Comida de Personal';
update public.plan_de_cuentas set cuenta = 'derechos aduana'                             where cuenta = 'Derecho Aduana';
-- Ademas de renombrar, reclasifica: es un impuesto sobre movimientos
-- bancarios (Ley 25.413), mas cerca de financiero que de sga.
update public.plan_de_cuentas set cuenta = 'Impuesto Deb/Cred Bcario', categoria = 'financiero'
  where cuenta = 'Imp. Déb/Créd Bancario';
update public.plan_de_cuentas set cuenta = 'Indemnizacion Siniestros'                    where cuenta = 'Reintegro de Seguro';
update public.plan_de_cuentas set cuenta = 'Limp. y Mantenimiento'                       where cuenta = 'Limpieza y Mantenimiento';
update public.plan_de_cuentas set cuenta = 'Mantenimiento Rodados'                       where cuenta = 'Mantenimiento de Rodados';
update public.plan_de_cuentas set cuenta = 'Seguro Prot e Indemnidad'                    where cuenta = 'P & I';
update public.plan_de_cuentas set cuenta = 'Seguro Resp. Civil'                          where cuenta = 'Seguros Responsabilidad Civil';
update public.plan_de_cuentas set cuenta = 'Servicio de Desinsectacion y Desratuzacion'  where cuenta = 'Servicio de Desinsectación y Desratización';
update public.plan_de_cuentas set cuenta = 'Servicios de Buceo'                          where cuenta = 'Servicio de Buceo';
update public.plan_de_cuentas set cuenta = 'Inspecciones'                                where cuenta = 'Inspecciones / Tasas';
update public.plan_de_cuentas set cuenta = 'Honorario Estudio Contable Externo'          where cuenta = 'Estudio Contable';
update public.plan_de_cuentas set cuenta = 'Honorarios de Escribanía'                    where cuenta = 'Escribanía';
update public.plan_de_cuentas set cuenta = 'Certificados/Patentes'                       where cuenta = 'Certif. / Patentes / Suscrip.';
update public.plan_de_cuentas set cuenta = 'Elementos de Seguridad o Gastos de HSQE'     where cuenta = 'Elementos de Seguridad / HSQE';


-- ------------------------------------------------------------
-- 2) Desdoblar 'Prepaga / Obra Social' en las tres reales
--
-- La planilla manual nunca distinguía la prepaga; Xubio factura tres
-- proveedores distintos, cada uno su propia cuenta.
-- ------------------------------------------------------------
delete from public.plan_de_cuentas where cuenta = 'Prepaga / Obra Social';

insert into public.plan_de_cuentas (cuenta, categoria, subcategoria, notas) values
  ('Prepaga Omint',           'sga', 'Obras Sociales', null),
  ('Prepaga OSDE',            'sga', 'Obras Sociales', null),
  ('Prepaga Hospital Aleman', 'sga', 'Obras Sociales', null)
on conflict (cuenta) do nothing;


-- ------------------------------------------------------------
-- 3) Cuentas nuevas que aparecen en Xubio y no en la planilla manual,
--    clasificadas con confianza
-- ------------------------------------------------------------
insert into public.plan_de_cuentas (cuenta, categoria, subcategoria, notas) values
  -- Vessel OPEX / Voyage Costs
  ('Arrendamiento de Buques egreso', 'costo_fijo',     'Vessel OPEX', 'Charter-in: pagar por arrendar un buque de un tercero (ej. WP Halle).'),
  ('Asistencia',                     'costo_variable', 'Voyage Costs', null),
  ('Compra de Servicios',            'costo_variable', 'Voyage Costs', null),
  ('servicio de terceros',           'costo_variable', 'Voyage Costs', null),
  ('Uniforme de Trabajo',            'costo_variable', 'Voyage Costs', 'Xubio la mantiene separada de Ropa y Elemento de Trabajo.'),
  ('Servicio de Energia Electrica',  'costo_fijo',     'Vessel OPEX / SG&A', null),
  ('Repuestos y Reparaciones',       'costo_semifijo', 'Vessel OPEX', 'Distinta de "Reparaciones" (coincide exacto, no se toca) y de "Reparaciones / Mantenimiento" (cuenta propia que no tiene par en Xubio: se deja como está, sin borrar).'),

  -- Financiero (no es costo operativo de nada, se resta del resultado
  -- financiero, no del margen de flota/astillero)
  ('Diferencia de Cambio',            'financiero', null, null),
  ('Diferencia de Cambio Ingresos',   'financiero', null, null),
  ('Ajuste por Redondeo Decimal',     'financiero', null, null),
  ('Redondeo Centavos',               'financiero', null, null),
  ('Intereses Bcarios Pagados',       'financiero', null, null),
  ('Intereses Impos y Previs',        'financiero', null, 'Intereses por impuestos y cargas previsionales pagados fuera de término.'),
  ('Multas y Recargos',               'financiero', null, null),
  ('Ingresos Brutos',                 'financiero', null, 'IIBB. Tecnicamente un impuesto, no un gasto operativo: se resta aparte, no del margen de flota.'),
  ('Resultado Venta B.Uso',           'otros_no_operativo', null, 'Resultado (positivo o negativo) de vender un bien de uso, no de operar el buque.'),

  -- SG&A / Corporativo
  ('ACUERDOS LABORALES',              'sga', null, 'Item corporativo puntual (acuerdos/indemnizaciones laborales), no recurrente.'),
  ('Alquiler de Inmueble',            'sga', 'Oficina Alvear', null),
  ('Honorarios Medicos',              'sga', 'Honorarios Profesionales', null),
  ('Honorarios Profesionales',        'sga', 'Honorarios Profesionales', 'Distinta de "Honorarios / Asesoría": Xubio las separa.'),
  ('Servicio de Telefonía',           'sga', 'Gastos Generales de Administración', null),
  ('Sindicatos',                      'sga', null, null),
  ('Tasa Municipal',                  'sga', 'Oficina Alvear', null),
  ('Honorarios Seguridad e Higiene',  'sga', 'Honorarios Profesionales', null),
  ('Seguros',                         'sga', 'Seguros', 'Generica, distinta de "Seguro Resp. Civil" y "Seguro C y M.".'),
  ('Gastos Bancarios en USD',         'financiero', null, null),
  ('Gastos del Personal',             'costo_variable', 'Voyage Costs', 'Aparece tanto en buques como en Administracion; se clasifica como costo_variable porque en el ledger real la mayoria de sus filas son de buque.')
on conflict (cuenta) do nothing;


-- ------------------------------------------------------------
-- 4) Ver como quedó
-- ------------------------------------------------------------
select categoria, count(*) as cuentas from public.plan_de_cuentas group by 1 order by 1;
select cuenta from public.plan_de_cuentas order by cuenta;


-- ------------------------------------------------------------
-- 5) Ajuste de acentos encontrado recién al resolver los 650 movimientos
--    reales contra plan_de_cuentas (el matching es por texto exacto:
--    estas 6 fallaban por acentos que la sección 1 no había detectado)
-- ------------------------------------------------------------
update public.plan_de_cuentas set cuenta = 'Gastos Medicos'                              where cuenta = 'Gastos Médicos';
update public.plan_de_cuentas set cuenta = 'Movilidad y Viaticos'                        where cuenta = 'Movilidad y Viáticos';
update public.plan_de_cuentas set cuenta = 'Correo y Mensajeria'                         where cuenta = 'Correo y Mensajería';
update public.plan_de_cuentas set cuenta = 'Impuesto de Sellos Tarjeta de Credito'       where cuenta = 'Impuesto de Sellos Tarjeta de Crédito';
update public.plan_de_cuentas set cuenta = 'Repuestos de Ferreteria'                     where cuenta = 'Repuestos de Ferretería';
update public.plan_de_cuentas set cuenta = 'Equipamiento de Radio y Comunicacion'        where cuenta = 'Equipamiento de Radio y Comunicación';


-- ------------------------------------------------------------
-- 6) Resolución de lo que había quedado pendiente en la sección "LO QUE
--    QUEDÓ AFUERA" — instrucciones de Silvestre, 2026-09-08:
--
--    "lo del cruz del sur dejemoslo afuera porque es solo algo contable.
--    Costo de embarcados no sale de xubio sino que sale de otro lado.
--    buque hunter en participacion, Leasing Wp halle, seria gasto.
--    Recpam sueldos y jornales / cargas sociales dejalo afuera.
--    Diferencia de cotizacion es consecuencia de realizar contado con
--    liquidacion"
--
--    - Cruz del Sur: no es una cuenta, es un centro de costo (Parana
--      Logistica) cuya única actividad es "Venta de Bienes" — puro
--      asiento contable, no operación económica real. Se excluye el
--      CENTRO (no una cuenta), con un 4to valor de segmento distinto de
--      null: 'excluido' marca "confirmado sin actividad real", a
--      diferencia de null que sigue significando "sin clasificar todavía".
--    - Buque Hunter en Participacion y Leasing WP Halle: confirmado que
--      son gasto, aunque Xubio los liste con signo positivo -> se cargan
--      con el signo invertido.
--    - REPCAM, Sueldos y Jornales, Cargas Sociales: quedan afuera del
--      plan de cuentas, sin importar, tal cual estaban.
--    - Diferencia de Cotización de Bonos: es resultado de operar contado
--      con liquidación (comprar bonos en ARS, venderlos en USD afuera) —
--      es financiero real, se clasifica y se importa con el signo
--      original de Xubio (puede ser ganancia o pérdida según el mes).
--    - Costo Embarcados: NO sale de este export de Xubio. Viene de otra
--      fuente todavía sin definir. Nota para cuando se diseñe esa
--      integración, no una tarea de este archivo.
-- ------------------------------------------------------------
alter table public.centros_costo drop constraint if exists centros_costo_segmento_check;
alter table public.centros_costo
  add constraint centros_costo_segmento_check
  check (segmento in ('buque', 'astillero', 'corporativo', 'excluido'));

update public.centros_costo set segmento = 'excluido'
where empresa = 'Parana Logistica' and nombre = 'Cruz del Sur';

insert into public.plan_de_cuentas (cuenta, categoria, subcategoria, notas) values
  ('Buque Hunter en Participacion',   'costo_fijo', 'Vessel OPEX', 'Xubio lo lista en positivo; confirmado por Silvestre que es gasto (participación en el buque Hunter). Se carga con signo invertido.'),
  ('Leasing WP Halle',                'costo_fijo', 'Vessel OPEX', 'Idem: confirmado gasto. Sin actividad en 2026 (su único valor cayó en el Dic-2025 excluido del período).'),
  ('Diferencia de Cotización de Bonos','financiero', null,          'Resultado de operar contado con liquidación (CCL): comprar bonos en ARS, vender en USD afuera. Signo tal cual Xubio (puede ganar o perder).')
on conflict (cuenta) do nothing;

insert into public.pl_movimientos (fecha, centro_costo_id, cuenta_id, moneda, monto, descripcion, fuente)
select '2026-02-01'::date, cc.id, pc.id, 'ARS', -46611236, 'Buque Hunter en Participacion - Xubio (signo invertido, confirmado gasto)', 'xubio_import'
from public.centros_costo cc, public.plan_de_cuentas pc
where cc.empresa = 'Parana Logistica' and cc.nombre = 'HF Hunter'
  and pc.cuenta = 'Buque Hunter en Participacion';

insert into public.pl_movimientos (fecha, centro_costo_id, cuenta_id, moneda, monto, descripcion, fuente)
select v.fecha::date, cc.id, pc.id, 'ARS', v.monto, 'Diferencia de Cotización de Bonos - Xubio (CCL)', 'xubio_import'
from (values
  ('2026-01-01', 17945889.15), ('2026-03-01', 30563059.31), ('2026-04-01', 2987668.59),
  ('2026-05-01', 21750223.70), ('2026-06-01', 3347047.94), ('2026-07-01', 34898423.39)
) as v(fecha, monto)
cross join public.centros_costo cc
cross join public.plan_de_cuentas pc
where cc.empresa = 'Parana Logistica' and cc.nombre = 'Administracion'
  and pc.cuenta = 'Diferencia de Cotización de Bonos';


-- ------------------------------------------------------------
-- LO QUE SIGUE PENDIENTE, SIN RESOLVER ACÁ
--
--   Costo Embarcados (sueldos de tripulación): confirmado que no viene de
--   este export de Xubio. Falta definir de dónde sale y cómo se integra.
--
-- MARCHA ATRAS
--
--   No hay un DROP limpio para un rename: si hace falta deshacer, hay que
--   volver a correr los UPDATE en sentido contrario (cuenta nueva ->
--   cuenta vieja). Sin riesgo para las secciones 1-5: pl_movimientos
--   seguía en cero filas cuando se corrieron. La sección 6 sí tiene datos
--   reales cargados (7 filas de pl_movimientos) — deshacerla requiere
--   borrar esas filas por fuente = 'xubio_import' y descripcion, no solo
--   revertir el rename.
-- ------------------------------------------------------------
