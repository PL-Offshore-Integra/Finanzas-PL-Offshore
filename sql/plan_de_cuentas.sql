-- ============================================================
-- INTEGRA · Finanzas — el plan de cuentas del P&L
--
-- QUE RESUELVE
--
--   Hasta ahora el P&L de Finanzas tenia un solo renglon: FACTURACION
--   (sql/ingresos_desde_comercial.sql). Este archivo arma el resto del
--   "cuadro" — la estructura, no los datos todavia — para Voyage Costs,
--   Vessel OPEX, SG&A y Astillero, calcada de
--   "Costos Totales Empresas 2026-variabilidad.xlsx" (la planilla que
--   Silvestre ya usa), no inventada de cero.
--
--   Revisado a mano el 2026-09-08, hoja por hoja: CONSOLIDADO BNA,
--   AD-2026, GDM-2026, GASTOS ADM, GASTOS ASTILLERO, LISTAS. La pestaña
--   LISTAS ya es, sin saberlo, un plan de cuentas: cuatro columnas de
--   cuentas por hoja destino (GTOS-GDM / GTOS-AD / GASTOS ADM / GASTOS
--   ASTILLERO) mas una tabla de ruteo centro de costo -> hoja destino.
--   Este archivo la formaliza en tablas.
--
-- LOS TRES SEGMENTOS, NO DOS
--
--   El Excel no separa "buque" de "administracion" nada mas: CONSOLIDADO
--   BNA tiene ATLANTIC DAMA / GOLONDRINA DE MAR / ADMINISTRACION /
--   ASTILLERO / ADICIONALES como bloques separados. Astillero factura a
--   terceros (Areneras Industriales, alquileres de galpon, filmaciones,
--   hasta la venta de una plegadora) — no es SG&A, es un tercer segmento
--   de negocio con ingreso propio. Se adopta tal cual, no se inventa una
--   segmentacion nueva.
--
-- CUATRO CORRECCIONES SOBRE LA PLANILLA ORIGINAL
--
--   El plan de cuentas de abajo no es una copia literal: reconcilia cuatro
--   inconsistencias que la propia planilla ya tiene (hay notas "Falta" a
--   mano en CONSOLIDADO BNA y en GASTOS ASTILLERO que lo confirman):
--
--   1. "Derecho Aduana" esta en COSTOS VARIABLES en la hoja de Atlantic
--      Dama y no existe en la lista de Golondrina. Es un costo de
--      importacion de repuestos, no de viaje: aca queda en
--      costo_semifijo para las dos.
--   2. El mismo concepto se llama "REINTEGRO SEGURO" en Atlantic Dama y
--      "DEPRECIACION DEL INGRESO" en Golondrina, mismo numero. Un solo
--      nombre: 'Reintegro de Seguro', categoria otros_no_operativo.
--   3. "Intereses Proveedores" esta mezclado en Costos Variables: es gasto
--      financiero, no operativo del buque. Categoria financiero, afuera
--      del costo operativo del buque.
--   4. Las cuentas de vehiculo (Patente AG218TK, Seguro Rodados Etios,
--      Movilidad y Viaticos Amarok...) repiten el nombre del vehiculo dentro
--      de la cuenta, una por cada uno de los 6 vehiculos. Se normalizan a
--      una cuenta generica (Patente, Seguro de Rodados, Movilidad y
--      Viaticos...): el vehiculo ya es su propio centro de costo, no hace
--      falta repetirlo en el nombre de la cuenta.
--
-- LA CUENTA "FACTURACION NEGRO" / "CAJITA FELIZ"
--
--   Aparecen en GASTOS ADM y en LISTAS. Decision de Silvestre, 2026-09-08:
--   se incluyen como una cuenta mas del plan, sin tratamiento especial.
--
-- LO QUE ESTE ARCHIVO NO HACE
--
--   No carga un solo movimiento de costo: crea la tabla y la llena de
--   CUENTAS, no de plata. Los datos son el paso siguiente (decidir si
--   viene de cost-tracker, de una carga manual de la planilla, o de las
--   dos), y todavia no esta resuelto — ver conversacion.
--
--   No incluye el dique como algo que se capitaliza y amortiza: sigue
--   siendo una cuenta de gasto del mes, igual que en la planilla. Migrarlo
--   a un activo con amortizacion es una mejora aparte, con su propio
--   registro de activos fijos que hoy no existe en ningun lado.
--
--   No arma la valuacion paralela a CCL: decision de Silvestre, arranca
--   solo con TC Oficial (fn_tc_oficial_mes, ya construido). CCL es una
--   columna que se agrega despues sin romper esto.
--
-- Correr desde Supabase -> SQL Editor -> Run, un bloque por vez.
-- ============================================================


-- ------------------------------------------------------------
-- 1) El plan de cuentas
--
-- `categoria` es la clasificacion por variabilidad — la que arma la
-- cascada del P&L (Voyage Costs, Vessel OPEX, SG&A...). `subcategoria` es
-- el sub-bloque que ya usa la planilla (ej. "Sueldos y Cargas Sociales"
-- dentro de sga), para no perder ese nivel de detalle. Es texto libre a
-- proposito: es mas granular que categoria y todavia puede crecer.
-- ------------------------------------------------------------
create table if not exists public.plan_de_cuentas (
  id            uuid primary key default gen_random_uuid(),
  cuenta        text not null,
  categoria     text not null check (categoria in (
                  'costo_variable',       -- Voyage Costs: cesa si el buque no navega
                  'costo_embarcados',     -- sueldos y honorarios de la tripulacion
                  'costo_semifijo',       -- mantenimiento, reparaciones, repuestos
                  'costo_fijo',           -- seguros, matricula, inspecciones: no depende de actividad
                  'costo_dique',          -- varada
                  'otros_no_operativo',   -- reintegros de seguro: no se netea contra ingreso ni costo
                  'financiero',           -- intereses, descuentos: no es costo operativo del buque
                  'sga',                  -- administracion / corporativo
                  'ingreso_astillero'     -- astillero factura a terceros, fuera de comercial.facturas
                )),
  subcategoria  text,
  notas         text,
  activa        boolean not null default true,
  created_at    timestamptz not null default now(),

  unique (cuenta)
);

comment on table public.plan_de_cuentas is
  'Catalogo de cuentas de costo del P&L, calcado de Costos Totales Empresas 2026-variabilidad.xlsx (hoja LISTAS) con 4 correcciones documentadas en el encabezado del archivo. Categoria arma la cascada del P&L; subcategoria conserva el sub-bloque de la planilla original.';

alter table public.plan_de_cuentas enable row level security;

create policy "plan_de_cuentas_select_authenticated"
  on public.plan_de_cuentas for select
  to authenticated
  using (true);

grant select on public.plan_de_cuentas to authenticated;


-- ------------------------------------------------------------
-- 2) Las cuentas
--
-- COSTOS DE BUQUE (Atlantic Dama / Golondrina de Mar / HF Hunter), tal
-- como aparecen en las columnas A y B de LISTAS, unificadas donde las dos
-- hojas usaban el mismo concepto con distinto nombre.
-- ------------------------------------------------------------
insert into public.plan_de_cuentas (cuenta, categoria, subcategoria, notas) values
  ('Alquiler de Equipos',                    'costo_variable',   'Voyage Costs', null),
  ('Amarres',                                'costo_variable',   'Voyage Costs', null),
  ('Análisis de Combustible',                'costo_variable',   'Voyage Costs', null),
  ('Análisis de Aceite',                     'costo_variable',   'Voyage Costs', null),
  ('Artefacto de Medición',                  'costo_variable',   'Voyage Costs', null),
  ('Combustible',                            'costo_variable',   'Voyage Costs', 'Bunkers'),
  ('Comunicaciones',                         'costo_variable',   'Voyage Costs', null),
  ('Correo y Mensajería',                    'costo_variable',   'Voyage Costs', null),
  ('Elementos de Trincado',                  'costo_variable',   'Voyage Costs', null),
  ('Elementos de Seguridad / HSQE',          'costo_variable',   'Voyage Costs', null),
  ('Gastos Comerciales',                     'costo_variable',   'Voyage Costs', null),
  ('Gastos de Agencia',                      'costo_variable',   'Voyage Costs', 'Agencia portuaria'),
  ('Gastos de Transporte/Flete',             'costo_variable',   'Voyage Costs', null),
  ('Gastos del Personal / Viáticos',         'costo_variable',   'Voyage Costs', null),
  ('Gastos Médicos',                         'costo_variable',   'Voyage Costs', null),
  ('Gastos Operativos',                      'costo_variable',   'Voyage Costs', null),
  ('Honorarios de Mant. Software',           'costo_variable',   'Voyage Costs', null),
  ('Lavadero',                               'costo_variable',   'Voyage Costs', null),
  ('Librería',                               'costo_variable',   'Voyage Costs', null),
  ('Lubricantes',                            'costo_variable',   'Voyage Costs', null),
  ('Muelle',                                 'costo_variable',   'Voyage Costs', null),
  ('Peajes',                                 'costo_variable',   'Voyage Costs', null),
  ('Retiro de Slop y Residuos',              'costo_variable',   'Voyage Costs', null),
  ('Ropa de Cama',                           'costo_variable',   'Voyage Costs', null),
  ('Ropa y Elemento de Trabajo',             'costo_variable',   'Voyage Costs', null),
  ('Servicio de Peaje de Navegación',        'costo_variable',   'Voyage Costs', null),
  ('Servicio de Buceo',                      'costo_variable',   'Voyage Costs', null),
  ('Servicios de Lancha',                    'costo_variable',   'Voyage Costs', null),
  ('Suministro de Agua',                     'costo_variable',   'Voyage Costs', null),
  ('Viáticos',                               'costo_variable',   'Voyage Costs', null),
  ('Vituallas',                              'costo_variable',   'Voyage Costs', 'Provisiones/comida de a bordo'),

  ('Sueldos Embarcados y Cargas Sociales',   'costo_embarcados', 'Vessel OPEX', null),
  ('Honorarios Embarcados',                  'costo_embarcados', 'Vessel OPEX', null),

  ('Artefacto de Baño',                      'costo_semifijo',   'Vessel OPEX', null),
  ('Chapa Marina',                           'costo_semifijo',   'Vessel OPEX', null),
  ('Consumible de Calderería',               'costo_semifijo',   'Vessel OPEX', null),
  ('Consumible de Limpieza',                 'costo_semifijo',   'Vessel OPEX', null),
  ('Consumibles de Refrigeración',           'costo_semifijo',   'Vessel OPEX', null),
  ('Consumibles Eléctricos',                 'costo_semifijo',   'Vessel OPEX', null),
  ('Consumibles Mantenimiento y Reparaciones','costo_semifijo',  'Vessel OPEX', null),
  ('Derecho Aduana',                         'costo_semifijo',   'Vessel OPEX', 'Reclasificado: estaba en costo_variable en la hoja de Atlantic Dama'),
  ('Equipamiento de Calderería',             'costo_semifijo',   'Vessel OPEX', null),
  ('Limpieza y Mantenimiento',               'costo_semifijo',   'Vessel OPEX', null),
  ('Pintura Marina',                         'costo_semifijo',   'Vessel OPEX', null),
  ('Pintura Sintética',                      'costo_semifijo',   'Vessel OPEX', null),
  ('Reparaciones',                           'costo_semifijo',   'Vessel OPEX', null),
  ('Reparaciones / Mantenimiento',           'costo_semifijo',   'Vessel OPEX', null),
  ('Repuestos',                              'costo_semifijo',   'Vessel OPEX', null),
  ('Repuestos de Ferretería',                'costo_semifijo',   'Vessel OPEX', null),
  ('Repuestos Electrodomésticos',            'costo_semifijo',   'Vessel OPEX', null),

  ('Aranceles',                              'costo_fijo',       'Vessel OPEX', null),
  ('Equipamiento de Hardware',               'costo_fijo',       'Vessel OPEX', null),
  ('Equipamiento de Radio y Comunicación',   'costo_fijo',       'Vessel OPEX', null),
  ('Equipamiento de Armamento',              'costo_fijo',       'Vessel OPEX', null),
  ('Inspecciones / Tasas',                   'costo_fijo',       'Vessel OPEX', null),
  ('Matrícula',                              'costo_fijo',       'Vessel OPEX', null),
  ('Servicio de Desinsectación y Desratización', 'costo_fijo',   'Vessel OPEX', null),
  ('P & I',                                  'costo_fijo',       'Vessel OPEX', 'Protection & Indemnity'),
  ('Seguro C y M.',                          'costo_fijo',       'Vessel OPEX', 'Casco y Máquinas'),

  ('Dique',                                  'costo_dique',      'Vessel OPEX', 'Hoy 100% gasto del mes. Ver nota de capitalizacion/amortizacion en el encabezado del archivo.'),

  ('Reintegro de Seguro',                    'otros_no_operativo', null, 'Unifica "REINTEGRO SEGURO" (Atlantic Dama) y "DEPRECIACION DEL INGRESO" (Golondrina de Mar): mismo concepto, dos nombres en la planilla original.'),

  ('Intereses Proveedores',                  'financiero',       null, 'Reclasificado: estaba en costo_variable en la hoja de Atlantic Dama'),
  ('Descuentos Obtenidos',                   'financiero',       null, null),
  ('Embargo',                                'financiero',       null, null)
on conflict (cuenta) do nothing;


-- ------------------------------------------------------------
-- 3) SG&A / Administración
--
-- De la hoja GASTOS ADM. Las cuentas de vehiculo (Patente, Seguro de
-- Rodados, GPS y Telemetria...) se normalizan a una cuenta generica: el
-- vehiculo ya es su propio centro de costo (AMAROK AC432FF, Toyota Etios
-- AE597IT...), no hace falta repetirlo en el nombre de la cuenta.
-- ------------------------------------------------------------
insert into public.plan_de_cuentas (cuenta, categoria, subcategoria, notas) values
  ('Sueldos Administración y Cargas Sociales', 'sga', 'Sueldos y Cargas Sociales', null),
  ('Honorarios Administración',                'sga', 'Sueldos y Cargas Sociales', null),
  ('Bonos',                                    'sga', 'Sueldos y Cargas Sociales', null),

  ('Agua',                                     'sga', 'Oficina Alvear', null),
  ('Servicio de Internet',                     'sga', 'Oficina Alvear', null),
  ('Alquiler Alvear',                          'sga', 'Oficina Alvear', null),
  ('Edenor',                                   'sga', 'Oficina Alvear', 'Electricidad'),
  ('Servicio de Agua',                         'sga', 'Oficina Alvear', null),
  ('Municipalidad de San Fernando (Inmueble)', 'sga', 'Oficina Alvear', null),
  ('Municipalidad de San Fernando (Comercio)', 'sga', 'Oficina Alvear', null),
  ('Seguridad',                                'sga', 'Oficina Alvear', null),

  ('Educación',                                'sga', 'Educación y Capacitación', null),
  ('Capacitaciones',                           'sga', 'Educación y Capacitación', null),

  ('Comidas de Personal',                      'sga', 'Gastos de Personal', null),
  ('Movilidad y Viáticos',                     'sga', 'Gastos de Personal', 'Personal de oficina, no vehiculos de flota'),
  ('Peajes Flota',                             'sga', 'Gastos de Personal', null),

  ('Escribanía',                               'sga', 'Honorarios Profesionales', null),
  ('Honorarios Legales',                       'sga', 'Honorarios Profesionales', null),
  ('Estudio Contable',                         'sga', 'Honorarios Profesionales', null),
  ('Honorarios / Asesoría',                    'sga', 'Honorarios Profesionales', null),
  ('Cuota Muelle',                             'sga', 'Honorarios Profesionales', null),

  ('Gastos Bancarios',                         'sga', 'Impuestos', null),
  ('Impuesto Bs. Personales',                  'sga', 'Impuestos', null),
  ('Imp. Déb/Créd Bancario',                   'sga', 'Impuestos', null),
  ('Intereses / Multa AFIP',                   'sga', 'Impuestos', null),
  ('Ganancias',                                'sga', 'Impuestos', null),
  ('Impuesto de Sellos Tarjeta de Crédito',    'sga', 'Impuestos', null),
  ('SICREB',                                   'sga', 'Impuestos', null),
  ('Ganancia Mínima Presunta',                 'sga', 'Impuestos', null),
  ('Plan de Pagos AFIP',                       'sga', 'Impuestos', null),
  ('Plan de Pagos Rentas ARBA',                'sga', 'Impuestos', null),

  ('Certif. / Patentes / Suscrip.',            'sga', 'Gastos Generales de Administración', null),
  ('Donaciones',                               'sga', 'Gastos Generales de Administración', null),
  ('Gastos de Representación',                 'sga', 'Gastos Generales de Administración', null),
  ('Licencia Sistema Contable',                'sga', 'Gastos Generales de Administración', null),
  ('Mantenimiento Inmueble de 3°',             'sga', 'Gastos Generales de Administración', null),
  ('Indumentaria de Trabajo',                  'sga', 'Gastos Generales de Administración', null),
  ('Servicio de TV',                           'sga', 'Gastos Generales de Administración', null),

  ('Mant. Software / Hardware',                'sga', 'Sistemas Informáticos', null),

  ('Patente',                                  'sga', 'Flota de Vehículos', 'Normalizado: la planilla repetia una cuenta por vehiculo (Patente AG218TK, Patente ETIOS...). El vehiculo distingue por su propio centro de costo.'),
  ('Seguro de Rodados',                        'sga', 'Flota de Vehículos', 'Normalizado, ver nota de Patente.'),
  ('Mantenimiento de Rodados',                 'sga', 'Flota de Vehículos', 'Normalizado, ver nota de Patente.'),
  ('Servicio de GPS y Telemetría',             'sga', 'Flota de Vehículos', 'Normalizado, ver nota de Patente.'),

  ('Prepaga / Obra Social',                    'sga', 'Obras Sociales', null),

  ('Seguro Sura',                              'sga', 'Seguros', null),
  ('Seguros Responsabilidad Civil',            'sga', 'Seguros', null),
  ('Suscripciones',                            'sga', 'Seguros', null),

  ('Intereses Obtenidos',                      'financiero', null, null),
  ('Recupero de Siniestro',                    'otros_no_operativo', null, 'Vehiculos: mismo concepto que Reintegro de Seguro de buques.'),

  ('Facturación Negro',                        'sga', null, 'Incluida por decision de Silvestre, 2026-09-08.'),
  ('Cajita Feliz',                             'sga', null, 'Incluida por decision de Silvestre, 2026-09-08.')
on conflict (cuenta) do nothing;


-- ------------------------------------------------------------
-- 4) Astillero
--
-- Segmento propio: factura a terceros, ademas de tener costo. El ingreso
-- NO pasa por comercial.facturas (esos clientes no estan en Comercial),
-- asi que necesita sus propias cuentas de ingreso.
-- ------------------------------------------------------------
insert into public.plan_de_cuentas (cuenta, categoria, subcategoria, notas) values
  ('Areneras Industriales',       'ingreso_astillero', null, 'Cliente de Astillero, fuera de comercial.facturas'),
  ('Alquileres Astillero',        'ingreso_astillero', null, null),
  ('Filmaciones',                 'ingreso_astillero', null, 'Alquiler del galpon para filmaciones'),
  ('Venta de Bienes',             'ingreso_astillero', null, 'Ej. venta de una plegadora'),
  ('Trabajos Propios',            'ingreso_astillero', null, 'Trabajo interno facturado al resto del grupo'),

  ('Sueldos Astillero y Cargas Sociales', 'costo_embarcados', 'Personal Astillero', null),
  ('Comida de Personal',          'costo_variable',    'Astillero', null),
  ('Rodados (Astillero)',         'costo_semifijo',    'Astillero', 'Mantenimiento/seguro de vehiculos propios del astillero, no de la flota administrativa'),
  ('Servicios Fijos Astillero',   'costo_fijo',         'Astillero', 'Edenor, Municipalidad de Tigre / San Fernando del galpon')
on conflict (cuenta) do nothing;


-- ------------------------------------------------------------
-- 5) La segmentación de centros de costo
--
-- A que segmento del P&L pertenece cada centro de costo. Solo se marca lo
-- que la planilla (hoja LISTAS) confirma; el resto queda sin clasificar a
-- proposito: es preferible un pendiente visible a un supuesto adivinado
-- (mismo criterio que fn_tc_oficial: no inventar un numero, ni un
-- segmento, que no esta confirmado).
-- ------------------------------------------------------------
alter table public.centros_costo
  add column if not exists segmento text check (segmento in ('buque', 'astillero', 'corporativo'));

comment on column public.centros_costo.segmento is
  'A que bloque del P&L pertenece: buque (cascada Voyage Costs/Vessel OPEX), astillero (segmento propio con ingreso) o corporativo (SG&A). Null = todavia sin confirmar contra la planilla real.';

update public.centros_costo set segmento = 'buque'
where empresa = 'Parana Logistica'
  and nombre in ('Atlantic Dama', 'Golondrina de Mar', 'HF Hunter');
-- HF Hunter: en LISTAS rutea a la hoja de Golondrina de Mar (GTOS-GDM), no
-- tiene su propia hoja de buque. Se marca 'buque' porque sus costos son de
-- tipo buque, pero hoy se consolidan dentro del P&L de Golondrina: no hay
-- forma de aislarlos con los datos que hay.

update public.centros_costo set segmento = 'astillero'
where empresa = 'Parana Logistica' and nombre = 'Astillero';

update public.centros_costo set segmento = 'corporativo'
where empresa = 'Parana Logistica'
  and nombre in (
    'Administracion', 'AMAROK AC432FF', 'Camioneta Expert AD095YM',
    'FIAT Cronos AG218TK (SN)', 'FIAT Cronos AG227QD (MS)',
    'Hilux SW4 AF971MD', 'Toyota Etios AE597IT', 'Galpón Alvear',
    'Excelerate', 'WP Halle', 'NS/NC'
  );
-- WP Halle y Excelerate son buques por definicion fisica (ver memoria
-- [[dos-maestros-de-buque]]), pero HOY sus costos rutean a GASTOS ADM en
-- la planilla real, igual que un vehiculo. Se respeta la practica actual,
-- no la definicion fisica: si es un error, corregirlo es un UPDATE, no
-- una migracion.


-- ------------------------------------------------------------
-- 6) Ver como quedó
-- ------------------------------------------------------------
select categoria, count(*) as cuentas from public.plan_de_cuentas group by 1 order by 1;

select coalesce(segmento, '(sin clasificar)') as segmento, count(*) as centros
from public.centros_costo where empresa = 'Parana Logistica'
group by 1 order by 1;

select nombre from public.centros_costo
where empresa = 'Parana Logistica' and segmento is null
order by nombre;


-- ------------------------------------------------------------
-- MARCHA ATRAS
--
--   alter table public.centros_costo drop column if exists segmento;
--   drop table if exists public.plan_de_cuentas;
--
-- Sin riesgo: ningun otro modulo lee estas dos cosas todavia, y no hay un
-- solo movimiento de costo cargado.
-- ------------------------------------------------------------
