-- ============================================================
-- INTEGRA · Finanzas — linea de tiempo del buque
--
-- QUE RESUELVE
--
--   Un remolcador cuesta plata los 365 dias del anio, pero solo navega
--   algunos. Sale, trabaja X dias, vuelve a puerto, y en puerto sigue
--   generando costo.
--
--   Hoy no hay forma de saber que estaba haciendo el buque el dia que se
--   genero un gasto, asi que "gasto sin proyecto" mezcla dos cosas
--   distintas: el buque estaba realmente parado, o el gasto era de un
--   proyecto y nadie lo etiqueto. Sin poder separarlas, el amarre no se
--   puede medir y el error de carga no se puede detectar.
--
--   Esta migracion arma la linea de tiempo: para cada buque y cada dia, en
--   que estado estaba. Con eso el amarre queda identificado en lugar de
--   deducido, y un gasto sin proyecto que cae en un dia de proyecto pasa a
--   ser un error visible.
--
-- LOS CUATRO ESTADOS
--
--   en_proyecto         navegando, con una operacion de Comercial encima
--   puerto              disponible, sin trabajo
--   dique               en dique seco
--   fuera_de_servicio   no puede operar por otro motivo
--
-- QUE SE CARGA Y QUE NO
--
--   Casi nada se carga a mano. `en_proyecto` sale de comercial.operaciones,
--   que ya tiene buque y fechas: duplicarlo crearia dos verdades que se
--   separan en el primer cambio de fecha. `puerto` es el complemento y no se
--   carga nunca.
--
--   Lo unico que se carga son los diques y las bajas: tres o cuatro por anio
--   y se saben con meses de anticipacion. Por eso la tabla nueva se llama
--   buque_indisponibilidades y su check solo admite 'dique' y
--   'fuera_de_servicio' — no se puede guardar ahi un tramo que la vista ya
--   sabe derivar.
--
-- NO DEPENDE DEL ESPEJO
--
--   Las vistas exponen `comercial_proyecto_id`, no un id de
--   public.proyectos, porque el espejo comercial -> Finanzas todavia no
--   corrio y public.proyectos.comercial_proyecto_id no existe. Eso hace que
--   esta migracion se pueda correr ya. Cuando el espejo este, se agrega el
--   id local con un join mas.
--
-- Correr desde Supabase -> SQL Editor -> Run, un bloque por vez.
-- ============================================================


-- ------------------------------------------------------------
-- 1) ANTES QUE NADA: ver si los buques se pueden cruzar
--
-- comercial.operaciones.buque es TEXTO LIBRE, y centros_costo.nombre es lo
-- que sincroniza Xubio. La vista los cruza por nombre normalizado, y si los
-- strings no coinciden la linea de tiempo queda sin ningun tramo de
-- proyecto: todo puerto, en silencio.
--
-- Esta consulta no crea nada. Lista los valores de `buque` cargados en
-- Comercial que NO matchean ningun centro de costo. Correrla primero.
--
--   - Si devuelve cero filas, seguir tranquilo.
--   - Si devuelve filas, son las que hay que corregir (en Comercial o en el
--     nombre del centro de costo) para que esos dias se imputen.
--
-- Todavia no existe la columna es_buque, asi que el chequeo mira contra
-- todos los centros de costo. Es a proposito: interesa saber si el string
-- matchea algo, no si matchea un buque.
-- ------------------------------------------------------------
select coalesce(nullif(btrim(o.buque), ''), '(vacio)') as buque_en_comercial,
       count(*)                                        as operaciones,
       min(o.fecha_inicio)                             as desde,
       max(o.fecha_fin)                                as hasta
from comercial.operaciones o
where not exists (
        select 1
        from public.centros_costo c
        where lower(btrim(c.nombre)) = lower(btrim(o.buque))
      )
group by 1
order by 2 desc;


-- ------------------------------------------------------------
-- 2) Marcar cuales centros de costo son un buque
--
-- centros_costo es un maestro contable, no de flota: tiene el Atlantic Dama
-- y el Golondrina, pero tambien Administracion y Astillero. La linea de
-- tiempo solo tiene sentido para los que flotan.
--
-- No se crea un maestro de buques aparte porque la correspondencia es uno a
-- uno, el xubio_id ya viene con el centro de costo, y todo el modelo de
-- costos (el Excel incluido) ya tiene forma de centro de costo.
-- ------------------------------------------------------------
alter table public.centros_costo
  add column if not exists es_buque boolean not null default false;

comment on column public.centros_costo.es_buque is
  'Este centro de costo es un buque. Habilita la linea de tiempo (v_buque_dias).';

-- Si el sync de Xubio los trajo con otro nombre, ajustar esta lista: el
-- update no falla, simplemente no marca nada, y despues la vista sale vacia.
update public.centros_costo
set es_buque = true
where lower(btrim(nombre)) in ('atlantic dama', 'golondrina de mar');

-- Confirmar que quedaron marcados los que corresponde, y solo esos.
select nombre,
       empresa,
       activo,
       es_buque,
       coalesce(xubio_id, '(sin xubio_id)') as xubio_id
from public.centros_costo
order by es_buque desc, nombre;


-- ------------------------------------------------------------
-- 3) La tabla de indisponibilidades
--
-- Solo diques y bajas. Fechas en `date` y no timestamptz: el P&L es mensual
-- y el grano util es el dia; una hora de mas o de menos no cambia nada y en
-- cambio abre la puerta al corrimiento por zona horaria.
--
-- `hasta` nulo significa abierto: el dique arranco y todavia no termino.
-- ------------------------------------------------------------

-- Necesaria para el constraint de no solape: permite mezclar una igualdad
-- (centro_costo_id) con un solape de rangos en el mismo indice.
create extension if not exists btree_gist;

create table if not exists public.buque_indisponibilidades (
  id              uuid primary key default gen_random_uuid(),
  centro_costo_id uuid not null references public.centros_costo(id),

  estado          text not null
    check (estado in ('dique','fuera_de_servicio')),

  desde           date not null,
  hasta           date,

  -- Para que dentro de un anio se entienda por que el buque estuvo parado:
  -- "dique programado Tandanor", "falla de reductor babor".
  motivo          text,

  creado_en       timestamptz not null default now(),

  constraint buque_indisp_rango
    check (hasta is null or hasta >= desde)
);

-- Un buque no puede estar en dique y de baja al mismo tiempo. Esto no es
-- prolijidad: si dos tramos se pisan, un dia tendria dos estados y la vista
-- tendria que elegir uno en silencio.
alter table public.buque_indisponibilidades
  drop constraint if exists buque_indisp_sin_solape;

alter table public.buque_indisponibilidades
  add constraint buque_indisp_sin_solape
  exclude using gist (
    centro_costo_id               with =,
    daterange(desde, hasta, '[]') with &&
  );

create index if not exists ix_buque_indisp_centro
  on public.buque_indisponibilidades (centro_costo_id, desde);

-- Impedir que le cuelguen un dique a "Administracion". Sin esto la vista no
-- se rompe: simplemente ignora la fila, que es peor, porque el dato queda
-- cargado y no aparece en ningun lado.
create or replace function public.buque_indisp_valida_centro()
returns trigger
language plpgsql
set search_path = ''
as $valida$
begin
  if not exists (
    select 1
    from public.centros_costo
    where id = new.centro_costo_id
      and es_buque
  ) then
    raise exception
      'El centro de costo % no esta marcado como buque (centros_costo.es_buque).',
      new.centro_costo_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$valida$;

drop trigger if exists trg_buque_indisp_valida_centro on public.buque_indisponibilidades;

create trigger trg_buque_indisp_valida_centro
  before insert or update on public.buque_indisponibilidades
  for each row
  execute function public.buque_indisp_valida_centro();

alter table public.buque_indisponibilidades enable row level security;

-- Mismas politicas permisivas que centros_costo y proyectos.
drop policy if exists buque_indisp_select on public.buque_indisponibilidades;
create policy buque_indisp_select on public.buque_indisponibilidades
  for select to authenticated using (true);

drop policy if exists buque_indisp_insert on public.buque_indisponibilidades;
create policy buque_indisp_insert on public.buque_indisponibilidades
  for insert to authenticated with check (true);

drop policy if exists buque_indisp_update on public.buque_indisponibilidades;
create policy buque_indisp_update on public.buque_indisponibilidades
  for update to authenticated using (true);

drop policy if exists buque_indisp_delete on public.buque_indisponibilidades;
create policy buque_indisp_delete on public.buque_indisponibilidades
  for delete to authenticated using (true);


-- ------------------------------------------------------------
-- 4) La linea de tiempo, un dia por fila
--
-- Grano diario y no por tramo porque es lo que sirve: un gasto se une por
-- fecha con un join comun, y "dias en puerto en marzo" es un count(*). El
-- volumen es despreciable: dos buques por 365 dias por unos pocos anios.
--
-- PRECEDENCIA. Si un dia cae adentro de un dique Y adentro de una operacion,
-- gana el dique. Es un dato mal cargado en algun lado, pero el dique se
-- carga a mano, a proposito y de a pocos, mientras que la fecha de una
-- operacion es lo que suele quedar sin actualizar. El paso 6 lista esos
-- conflictos para que no queden tapados.
--
-- PRIVILEGIOS. La vista lee el schema `comercial`, al que el usuario de
-- Finanzas no tiene acceso directo. Se apoya a proposito en que una vista
-- corre con los permisos de su duenio (no lleva security_invoker): expone
-- solo fechas, nombre y numero de proyecto, nada de valores ni tarifas.
-- ------------------------------------------------------------
create or replace view public.v_buque_dias as
with buques as (
  -- Sin filtrar por `activo`: esa columna es el espejo de existir en Xubio,
  -- no una curaduria local. Si el contador saca un centro de costo, no se
  -- puede borrar de un plumazo el historial del buque.
  select id, nombre
  from public.centros_costo
  where es_buque
),
tramos_operacion as (
  -- 'planificada' queda afuera: una operacion planificada con fechas viejas
  -- que nadie actualizo imputaria costo a un proyecto que nunca salio.
  -- 'cancelada' tampoco, por lo obvio.
  select b.id as centro_costo_id,
         (o.fecha_inicio at time zone 'America/Argentina/Buenos_Aires')::date as desde,
         (o.fecha_fin    at time zone 'America/Argentina/Buenos_Aires')::date as hasta,
         o.id          as operacion_id,
         o.proyecto_id as comercial_proyecto_id
  from comercial.operaciones o
  join buques b
    on lower(btrim(o.buque)) = lower(btrim(b.nombre))
  where o.estado in ('en_curso','finalizada')
    and o.fecha_inicio is not null
    and o.fecha_fin    is not null
),
tramos_indisp as (
  select i.centro_costo_id,
         i.desde,
         -- Un dique abierto llega hasta hoy, no hasta el infinito.
         coalesce(i.hasta, current_date) as hasta,
         i.estado
  from public.buque_indisponibilidades i
),
limites as (
  -- El calendario arranca en el primer hecho conocido y llega hasta hoy, o
  -- mas adelante si hay un dique ya programado que termina despues.
  select least(   (select min(desde) from tramos_operacion),
                  (select min(desde) from tramos_indisp) ) as inicio,
         greatest((select max(hasta) from tramos_operacion),
                  (select max(hasta) from tramos_indisp),
                  current_date)                            as fin
),
calendario as (
  select b.id     as centro_costo_id,
         b.nombre as centro_costo,
         d::date  as dia
  from buques b
  cross join limites l
  cross join lateral generate_series(l.inicio, l.fin, interval '1 day') d
  -- Sin ningun hecho cargado, `inicio` es nulo y la vista sale vacia en
  -- lugar de fallar.
  where l.inicio is not null
)
select c.centro_costo_id,
       c.centro_costo,
       c.dia,
       case
         when i.estado is not null        then i.estado
         when op.operacion_id is not null then 'en_proyecto'
         else 'puerto'
       end as estado,
       -- La operacion solo tiene sentido en un dia de proyecto: si ese dia
       -- el buque estaba en dique, se descarta.
       case when i.estado is null then op.operacion_id          end as operacion_id,
       case when i.estado is null then op.comercial_proyecto_id end as comercial_proyecto_id,
       case when i.estado is null then op.nro_proyecto          end as nro_proyecto,
       case when i.estado is null then op.proyecto_nombre       end as proyecto_nombre
from calendario c
left join lateral (
  -- Como maximo uno: lo garantiza buque_indisp_sin_solape.
  select t.estado
  from tramos_indisp t
  where t.centro_costo_id = c.centro_costo_id
    and c.dia between t.desde and t.hasta
  limit 1
) i on true
left join lateral (
  -- Aca si puede haber mas de uno, porque nada en Comercial impide que dos
  -- operaciones del mismo buque se pisen. El order by hace que la vista sea
  -- determinista; el paso 6 lista los casos.
  select t.operacion_id,
         t.comercial_proyecto_id,
         p.nro_proyecto,
         p.nombre as proyecto_nombre
  from tramos_operacion t
  join comercial.proyectos p on p.id = t.comercial_proyecto_id
  where t.centro_costo_id = c.centro_costo_id
    and c.dia between t.desde and t.hasta
  order by t.desde, t.operacion_id
  limit 1
) op on true;

comment on view public.v_buque_dias is
  'Un dia por buque con su estado (en_proyecto, puerto, dique, fuera_de_servicio). Base para imputar costo y contar dias.';

grant select on public.v_buque_dias to authenticated;


-- ------------------------------------------------------------
-- 5) La misma linea, agrupada en tramos
--
-- Lo que uno quiere mirar en pantalla: "del 1 al 18 de marzo, PRY-12". Sale
-- de la vista diaria juntando dias consecutivos con el mismo estado y la
-- misma operacion, asi las dos no se pueden contradecir.
-- ------------------------------------------------------------
create or replace view public.v_buque_linea_tiempo as
with marcado as (
  select d.*,
         row_number() over (partition by d.centro_costo_id
                            order by d.dia)
       - row_number() over (partition by d.centro_costo_id,
                                         d.estado,
                                         coalesce(d.operacion_id,
                                                  '00000000-0000-0000-0000-000000000000'::uuid)
                            order by d.dia) as grupo
  from public.v_buque_dias d
)
select centro_costo_id,
       centro_costo,
       estado,
       operacion_id,
       comercial_proyecto_id,
       nro_proyecto,
       proyecto_nombre,
       min(dia) as desde,
       max(dia) as hasta,
       count(*) as dias
from marcado
group by centro_costo_id, centro_costo, estado, operacion_id,
         comercial_proyecto_id, nro_proyecto, proyecto_nombre, grupo
order by centro_costo, desde;

comment on view public.v_buque_linea_tiempo is
  'v_buque_dias agrupada en tramos consecutivos. Para mostrar, no para imputar.';

grant select on public.v_buque_linea_tiempo to authenticated;


-- ------------------------------------------------------------
-- 6) Controles
--
-- Ninguno de los tres deberia devolver filas. Si devuelven, hay datos mal
-- cargados en Comercial y la linea de tiempo los esta tapando.
-- ------------------------------------------------------------

-- 6.a  Operaciones que caen adentro de un dique o una baja.
select cc.nombre as buque,
       o.nro_operacion,
       o.nombre as operacion,
       (o.fecha_inicio at time zone 'America/Argentina/Buenos_Aires')::date as op_desde,
       (o.fecha_fin    at time zone 'America/Argentina/Buenos_Aires')::date as op_hasta,
       i.estado,
       i.desde as indisp_desde,
       i.hasta as indisp_hasta
from comercial.operaciones o
join public.centros_costo cc
  on lower(btrim(cc.nombre)) = lower(btrim(o.buque))
 and cc.es_buque
join public.buque_indisponibilidades i
  on i.centro_costo_id = cc.id
 and daterange((o.fecha_inicio at time zone 'America/Argentina/Buenos_Aires')::date,
               (o.fecha_fin    at time zone 'America/Argentina/Buenos_Aires')::date, '[]')
  && daterange(i.desde, coalesce(i.hasta, current_date), '[]')
where o.estado in ('en_curso','finalizada')
  and o.fecha_inicio is not null
  and o.fecha_fin    is not null;

-- 6.b  Operaciones del mismo buque que se pisan entre si.
select cc.nombre as buque,
       a.nro_operacion as op_a,
       b.nro_operacion as op_b,
       (a.fecha_inicio at time zone 'America/Argentina/Buenos_Aires')::date as a_desde,
       (a.fecha_fin    at time zone 'America/Argentina/Buenos_Aires')::date as a_hasta,
       (b.fecha_inicio at time zone 'America/Argentina/Buenos_Aires')::date as b_desde,
       (b.fecha_fin    at time zone 'America/Argentina/Buenos_Aires')::date as b_hasta
from comercial.operaciones a
join comercial.operaciones b
  on a.id < b.id
 and lower(btrim(a.buque)) = lower(btrim(b.buque))
 and daterange((a.fecha_inicio at time zone 'America/Argentina/Buenos_Aires')::date,
               (a.fecha_fin    at time zone 'America/Argentina/Buenos_Aires')::date, '[]')
  && daterange((b.fecha_inicio at time zone 'America/Argentina/Buenos_Aires')::date,
               (b.fecha_fin    at time zone 'America/Argentina/Buenos_Aires')::date, '[]')
join public.centros_costo cc
  on lower(btrim(cc.nombre)) = lower(btrim(a.buque))
 and cc.es_buque
where a.estado in ('en_curso','finalizada')
  and b.estado in ('en_curso','finalizada')
  and a.fecha_inicio is not null and a.fecha_fin is not null
  and b.fecha_inicio is not null and b.fecha_fin is not null;

-- 6.c  Operaciones en curso o finalizadas sin fechas: no entran a la linea
--      de tiempo, asi que esos dias figuran como puerto.
select cc.nombre as buque,
       o.nro_operacion,
       o.nombre,
       o.estado,
       o.fecha_inicio,
       o.fecha_fin
from comercial.operaciones o
join public.centros_costo cc
  on lower(btrim(cc.nombre)) = lower(btrim(o.buque))
 and cc.es_buque
where o.estado in ('en_curso','finalizada')
  and (o.fecha_inicio is null or o.fecha_fin is null);


-- ------------------------------------------------------------
-- 7) Ver como quedo: dias por estado y por mes
--
-- Este es el numero que hoy no existe en ningun lado.
-- ------------------------------------------------------------
select centro_costo,
       to_char(dia, 'YYYY-MM') as mes,
       count(*) filter (where estado = 'en_proyecto')       as dias_navegando,
       count(*) filter (where estado = 'puerto')            as dias_puerto,
       count(*) filter (where estado = 'dique')             as dias_dique,
       count(*) filter (where estado = 'fuera_de_servicio') as dias_baja,
       count(*)                                             as dias_total
from public.v_buque_dias
group by 1, 2
order by 1, 2;


-- ------------------------------------------------------------
-- COMO SE CARGA UN DIQUE
--
--   insert into public.buque_indisponibilidades
--     (centro_costo_id, estado, desde, hasta, motivo)
--   select id, 'dique', '2025-10-01', '2025-12-15', 'Dique programado'
--   from public.centros_costo
--   where lower(btrim(nombre)) = 'atlantic dama';
--
-- Con `hasta` en null si todavia no termino.
--
-- MARCHA ATRAS
--
--   drop view     if exists public.v_buque_linea_tiempo;
--   drop view     if exists public.v_buque_dias;
--   drop table    if exists public.buque_indisponibilidades;
--   drop function if exists public.buque_indisp_valida_centro();
--   alter table public.centros_costo drop column if exists es_buque;
--
-- Ojo: el drop de la tabla se lleva los diques cargados, y el de la columna
-- se lleva la marca de que centros son buques. Ninguna de las dos cosas se
-- recupera despues.
-- ------------------------------------------------------------
