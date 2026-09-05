-- ============================================================
-- INTEGRA · Finanzas — el alta de proyectos pasa a Comercial
--
-- Reemplaza a sql/proyectos_solo_finanzas.sql, que hacia lo contrario:
-- rechazaba toda alta cuyo origen no fuera 'finanzas'. Desde que todos los
-- proyectos salen de Comercial, esa regla bloquea justo lo unico que tiene
-- que poder entrar.
--
--   antes:  origen = 'finanzas'   pasa;  cualquier otro  rechazado
--   ahora:  origen = 'comercial'  pasa;  cualquier otro  rechazado
--
-- LEER ANTES DE CORRER
--
--   Deja sin alta a projects-app y a control-documentario-epp, que es lo que
--   el script anterior pretendia y no lograba. Son modulos de Fede:
--   coordinarlo antes.
--
--   NO toca UPDATE ni DELETE. Los otros modulos siguen pudiendo editar los
--   proyectos que ya existen; lo unico que pierden es la creacion.
--
--   Alcance real: esto es una baranda, no seguridad. Cualquiera con la anon
--   key puede mandar origen='comercial' a mano desde la consola del
--   navegador. Sirve para evitar el alta accidental desde otro modulo.
--
-- Correr desde Supabase -> SQL Editor -> Run.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Sacar el default de `origen`
--
-- Aca es donde fallaba el script original, y conviene entender por que antes
-- de repetirlo. Aquel ponia el default en 'finanzas' y despues chequeaba en
-- un trigger BEFORE que el valor fuera 'finanzas'. Pero los defaults se
-- aplican ANTES de que corra un trigger BEFORE: un INSERT sin origen llegaba
-- al chequeo ya con 'finanzas' puesto, y pasaba. El porton no bloqueaba lo
-- que decia bloquear.
--
-- Sin default, un INSERT que no diga de donde viene se rechaza.
-- ------------------------------------------------------------
alter table public.proyectos
  alter column origen drop default;

-- ------------------------------------------------------------
-- 2) El porton nuevo
--
-- Se cambia el nombre junto con la regla: una funcion que se llama
-- proyectos_solo_alta_finanzas y deja entrar solo a Comercial es una trampa
-- para el que la lea dentro de seis meses.
-- ------------------------------------------------------------
create or replace function public.proyectos_alta_solo_comercial()
returns trigger
language plpgsql
as $porton$
begin
  if coalesce(new.origen, '') <> 'comercial' then
    raise exception
      'Los proyectos se crean unicamente en el modulo Comercial. Alta rechazada (origen=%).',
      coalesce(new.origen, 'sin origen')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$porton$;

-- El trigger viejo y su funcion se van: si quedaran los dos, el INSERT
-- tendria que satisfacer dos reglas incompatibles y no entraria nada.
drop trigger if exists trg_proyectos_solo_alta_finanzas on public.proyectos;
drop function if exists public.proyectos_solo_alta_finanzas();

drop trigger if exists trg_proyectos_alta_solo_comercial on public.proyectos;

create trigger trg_proyectos_alta_solo_comercial
  before insert on public.proyectos
  for each row
  execute function public.proyectos_alta_solo_comercial();

-- ------------------------------------------------------------
-- 3) Ver como quedo
-- ------------------------------------------------------------
select t.tgname as trigger,
       p.proname as funcion,
       case when t.tgenabled = 'O' then 'activo' else t.tgenabled::text end as estado
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'public.proyectos'::regclass
  and not t.tgisinternal
order by t.tgname;

-- ------------------------------------------------------------
-- Para dar marcha atras (pegar y correr, deja el porton abierto):
--
--   drop trigger if exists trg_proyectos_alta_solo_comercial on public.proyectos;
--   drop function if exists public.proyectos_alta_solo_comercial();
--   alter table public.proyectos alter column origen set default 'finanzas';
--
-- Ojo: eso deja a cualquier modulo pudiendo crear proyectos otra vez, que es
-- como estaba antes de todo esto.
-- ------------------------------------------------------------
