-- ============================================================
-- INTEGRA · Finanzas — el tipo de cambio oficial
--
-- QUE RESUELVE
--
--   El P&L tiene que poder expresarse en USD Oficial aunque el insumo venga
--   en pesos: hoy la facturacion (comercial.facturas) esta 100% en USD —
--   ver sql/ingresos_desde_comercial.sql— pero el costo, cuando entre, va a
--   estar en su gran mayoria en ARS. Sin una tabla de TC, ese dia el P&L no
--   se puede armar.
--
--   Esta migracion crea la tabla y la alimenta sola: una Edge Function
--   (supabase/functions/sync-tipo-cambio-oficial) trae el oficial de
--   dolarapi.com todos los dias por cron, y lo guarda por fecha. Nadie
--   tiene que cargarlo a mano.
--
-- POR QUE dolarapi.com Y NO EL EXCEL
--
--   El Excel de costeo tiene el TC en las filas 7 y 8 de cada hoja, a mano.
--   Automatizarlo evita que el P&L dependa de que alguien lo transcriba
--   cada mes, y dolarapi.com es publica, sin auth, y es el mismo dato que
--   publica el BNA (oficial: compra/venta).
--
-- EL HISTORICO: api.argentinadatos.com, EL DIA A DIA: dolarapi.com
--
--   dolarapi.com solo devuelve "el oficial de hoy": no sirve para poblar
--   2011-2026. Pero es del mismo proyecto (ArgentinaDatos) que
--   api.argentinadatos.com, que SI tiene la serie diaria completa desde
--   2011. Verificado a mano el 2026-09-08: las dos dan el mismo numero
--   (compra 1480 / venta 1530) para el mismo dia. Por eso la Edge Function
--   usa la liviana (dolarapi.com) para el cron diario y la pesada
--   (argentinadatos.com) solo para el backfill que se corre a mano.
--
-- POR QUE compra Y venta, Y CUAL SE USA PARA CONVERTIR
--
--   Se guardan los dos tal como los da la fuente, por transparencia y por
--   si algun dia hace falta el otro. Para convertir un costo en ARS a USD
--   se usa VENTA: es el TC al que la empresa consigue esos dolares, y es el
--   que ya usa el Excel en la columna "U$S Oficiales" (ver
--   [[costeo-por-unidad-de-negocio]] en la memoria del proyecto).
--
-- DOS FUNCIONES, PORQUE HAY DOS PREGUNTAS DISTINTAS
--
--   fn_tc_oficial(fecha): "¿a que TC se cobra/paga HOY este movimiento?"
--   Sirve para cobranza (cobro_fecha, tc_pagado) y para cualquier cosa que
--   de verdad pase el dia exacto.
--
--   fn_tc_oficial_mes(fecha): "¿a que TC se valua este movimiento en el
--   P&L?" Y la respuesta, pedida por Silvestre el 2026-09-08, es UN SOLO TC
--   por mes, no uno por dia. Si un costo de ARS del 3 de febrero convierte
--   al TC del dia 3 y otro del 27 de febrero al TC del dia 27, dos costos
--   del mismo mes quedan valuados a tipos de cambio distintos, y peor: el
--   P&L de febrero completo se relee distinto cada vez que se lo mira,
--   porque el TC de referencia depende de en que fecha exacta cayo cada
--   factura. El P&L de un mes CERRADO tiene que dejar de moverse.
--
--   Por eso fn_tc_oficial_mes ignora el dia y usa el ULTIMO TC conocido
--   DENTRO DEL MISMO MES calendario que la fecha del movimiento —el cierre
--   de mes, ni el Excel lo hace distinto: una sola cotizacion por hoja/mes.
--   Todo lo que caiga en febrero convierte al mismo numero.
--
--   Ojo con el mes en curso: mientras el mes no termino, "el ultimo TC
--   conocido de este mes" todavia puede cambiar dia a dia —es inevitable,
--   nadie puede saber hoy cual va a ser el TC del ultimo dia habil del mes—
--   pero en cuanto el mes cierra (ya no entran mas filas de tipo_cambio con
--   ese mes) el valor que devuelve queda fijo para siempre. Un P&L de un
--   mes ya cerrado no se vuelve a mover.
--
-- EL BACKFILL YA CORRIO, DESDE 2026-01-01
--
--   Corrido a mano el 2026-09-08 con:
--
--     curl -X POST https://mwrhonkvcyyueixbdrat.supabase.co/functions/v1/sync-tipo-cambio-oficial \
--       -H "Authorization: Bearer <anon key>" -H "Content-Type: application/json" \
--       -d '{"backfill": true}'
--
--   api.argentinadatos.com trae la serie completa desde 2011 (5728 filas),
--   pero la Edge Function la corta en BACKFILL_DESDE = '2026-01-01' antes
--   de escribir: Silvestre pidio ese recorte, porque el negocio en esta
--   base arranca en 2026 (comercial.facturas parte el 2026-01-03) y no
--   tiene sentido cargar quince años de TC que nada va a usar. El primer
--   intento cargo las 5728 y se borraron a mano las anteriores a 2026; con
--   el recorte en la funcion, un backfill de ahora en mas ya sale acotado
--   solo.
--
--   Quedaron 251 filas, 2026-01-01 a 2026-09-08.
--
--   Tambien hay un boton "Traer histórico completo" en la pantalla Tipo de
--   cambio de Finanzas que hace el mismo POST, por si hace falta
--   re-correrlo (por ejemplo si la fuente corrige un valor viejo: el
--   backfill pisa por fecha, `on conflict (fecha) do update`, asi que
--   repetirlo es seguro y no duplica).
--
-- Correr desde Supabase -> SQL Editor -> Run, un bloque por vez.
-- ============================================================


-- ------------------------------------------------------------
-- 1) La tabla
--
-- Una fila por dia. La escribe unicamente la Edge Function (con la service
-- role key, que no pasa por RLS); Finanzas y el resto de los modulos solo
-- leen.
-- ------------------------------------------------------------
create table if not exists public.tipo_cambio (
  fecha         date primary key,
  compra        numeric,
  venta         numeric,
  fuente        text not null default 'dolarapi.com/oficial',
  actualizado_en timestamptz not null default now()
);

comment on table public.tipo_cambio is
  'TC oficial (BNA) por dia, traido de dolarapi.com por la Edge Function sync-tipo-cambio-oficial. Solo lectura para los modulos.';

alter table public.tipo_cambio enable row level security;

create policy "tipo_cambio_select_authenticated"
  on public.tipo_cambio for select
  to authenticated
  using (true);

grant select on public.tipo_cambio to authenticated;


-- ------------------------------------------------------------
-- 2) El TC vigente a una fecha exacta
--
-- El ultimo conocido en o antes de la fecha pedida. `stable` porque para
-- una misma fecha y el mismo contenido de la tabla siempre da lo mismo
-- dentro de una consulta: permite que el planner la trate como una
-- expresion, no como una funcion volatil.
--
-- NO es la que usa el P&L (ver mas abajo fn_tc_oficial_mes): esta es para
-- cobranza y cualquier cosa que de verdad se resuelva un dia puntual.
-- ------------------------------------------------------------
create or replace function public.fn_tc_oficial(p_fecha date)
returns numeric
language sql
stable
as $$
  select venta
  from public.tipo_cambio
  where fecha <= p_fecha
  order by fecha desc
  limit 1
$$;

comment on function public.fn_tc_oficial(date) is
  'TC oficial venta vigente en o antes de p_fecha (dia exacto). Para cobranza, no para el P&L: ver fn_tc_oficial_mes. Null si no hay ninguno cargado hasta esa fecha: no inventar un 1 en su lugar.';

grant execute on function public.fn_tc_oficial(date) to authenticated;


-- ------------------------------------------------------------
-- 2.1) El TC del P&L: uno solo por mes, el de cierre
--
-- El ultimo TC conocido DENTRO del mismo mes calendario de p_fecha, sin
-- importar el dia exacto. Es la funcion que usan v_fin_ingresos y las
-- vistas de costo que se agreguen despues para convertir a USD: asi todo
-- movimiento de un mes queda valuado igual, y un mes ya cerrado no cambia
-- mas (ver la nota "DOS FUNCIONES" arriba).
-- ------------------------------------------------------------
create or replace function public.fn_tc_oficial_mes(p_fecha date)
returns numeric
language sql
stable
as $$
  select venta
  from public.tipo_cambio
  where fecha >= date_trunc('month', p_fecha)::date
    and fecha <  (date_trunc('month', p_fecha) + interval '1 month')::date
  order by fecha desc
  limit 1
$$;

comment on function public.fn_tc_oficial_mes(date) is
  'TC oficial venta de cierre del mes de p_fecha: el ultimo conocido dentro de ESE mes calendario, no el ultimo dia exacto. Se usa para valuar el P&L, para que un mes cerrado no se recalcule distinto segun el dia exacto de cada movimiento. Null si el mes no tiene ningun TC cargado.';

grant execute on function public.fn_tc_oficial_mes(date) to authenticated;


-- ------------------------------------------------------------
-- 3) Las extensiones para poder llamar a la Edge Function por cron
--
-- pg_net hace el POST HTTP desde dentro de Postgres; pg_cron dispara ese
-- POST todos los dias. El `with schema extensions` es solo donde se
-- registra la extension (misma convencion que uuid-ossp y pgcrypto en este
-- proyecto, commit 66c49d9); pg_cron y pg_net crean SUS PROPIOS schemas
-- fijos —`cron` y `net`— sin importar ese parametro, asi que las llamadas
-- de mas abajo son `cron.schedule` y `net.http_post`, no
-- `extensions.cron...`. Verificado contra la base: las dos funciones viven
-- en `cron`/`net`, no en `extensions`.
-- ------------------------------------------------------------
create extension if not exists pg_net  with schema extensions;
create extension if not exists pg_cron with schema extensions;


-- ------------------------------------------------------------
-- 4) El cron: todos los dias a las 18:05 ART (21:05 UTC)
--
-- Mas tarde que la hora de cierre del BNA (dolarapi actualiza el oficial
-- cerca de las 15:00 ART) para no pisarle el pie a una actualizacion
-- tardia. Corre tambien fines de semana y feriados: dolarapi devuelve el
-- ultimo valor conocido, y el upsert de la funcion escribe esa misma fecha
-- de nuevo sin duplicar filas.
--
-- La Authorization que lleva el POST es la anon key del proyecto. No es un
-- secreto: es la misma clave publica que ya viaja en el bundle del
-- navegador (VITE_SUPABASE_ANON_KEY en .env.local), y la Edge Function
-- solo la necesita para pasar el chequeo de verify_jwt; adentro usa su
-- propia service role key para escribir.
-- ------------------------------------------------------------
select cron.schedule(
  'sync-tipo-cambio-oficial-diario',
  '5 21 * * *',
  $$
  select net.http_post(
    url     := 'https://mwrhonkvcyyueixbdrat.supabase.co/functions/v1/sync-tipo-cambio-oficial',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13cmhvbmt2Y3l5dWVpeGJkcmF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5OTQ1NTMsImV4cCI6MjA5MjU3MDU1M30.LGtCgh7vedh16DATQtJMLBmfhzLwlj21sXsV43001IM'
    ),
    body    := '{}'::jsonb
  );
  $$
);


-- ------------------------------------------------------------
-- 5) Ver como quedo
-- ------------------------------------------------------------
select jobname, schedule, active from cron.job
where jobname = 'sync-tipo-cambio-oficial-diario';

select * from public.tipo_cambio order by fecha desc limit 10;

-- El de cierre de mes, para los meses que ya tienen algo cargado. Antes de
-- que dolarapi.com haya corrido para todo un mes, esto va a mostrar el
-- ultimo dia disponible hasta hoy: es lo esperado, ver la nota de arriba.
select to_char(date_trunc('month', fecha), 'YYYY-MM') as mes,
       public.fn_tc_oficial_mes(fecha)                as tc_cierre_mes
from public.tipo_cambio
group by 1
order by 1;


-- ------------------------------------------------------------
-- MARCHA ATRAS
--
--   select cron.unschedule('sync-tipo-cambio-oficial-diario');
--   drop function if exists public.fn_tc_oficial_mes(date);
--   drop function if exists public.fn_tc_oficial(date);
--   drop table if exists public.tipo_cambio;
--
-- No se listan `drop extension`: pg_net y pg_cron pueden estar en uso por
-- otro job del mismo proyecto compartido, asi que no se apagan desde aca.
-- ------------------------------------------------------------
