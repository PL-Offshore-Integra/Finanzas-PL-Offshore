-- ============================================================
-- INTEGRA · Finanzas — los proyectos se crean SOLO en Finanzas
--
-- Objetivo: que la tabla public.proyectos tenga un unico lugar de alta.
-- Hoy pueden crear tres modulos: finanzas, projects-app y
-- control-documentario-epp.
--
-- LEER ANTES DE CORRER
--
--   Esto rompe a proposito la pantalla de alta de projects-app y de
--   control-documentario-epp: sus inserts van a fallar con el mensaje de
--   abajo. Eso es lo pedido, pero afecta modulos de otra persona.
--   Coordinarlo con Fede antes de ejecutar.
--
--   NO toca UPDATE ni DELETE. Los otros modulos siguen pudiendo editar los
--   proyectos que ya existen; lo unico que pierden es la creacion.
--
-- Correr desde Supabase -> SQL Editor -> Run.
-- ============================================================

-- ------------------------------------------------------------
-- 1) El default de la columna pasa a ser 'finanzas'
--
-- Hoy el default es 'projects': por eso los 3 proyectos existentes quedaron
-- marcados como origen='projects' aunque projects-app nunca manda ese campo.
-- El default venia de cuando projects-app era el dueno del alta.
-- ------------------------------------------------------------
alter table public.proyectos
  alter column origen set default 'finanzas';

-- ------------------------------------------------------------
-- 2) Rechazar cualquier alta que no venga de Finanzas
--
-- Finanzas es el unico modulo que manda origen='finanzas' de forma explicita
-- (App.jsx, api.crearProyecto). Los demas no mandan nada, toman el default,
-- y con el trigger puesto ese default ya no los salva porque el chequeo mira
-- el valor final.
--
-- Ojo con el alcance real: esto es una baranda, no seguridad. Cualquiera con
-- la anon key puede mandar origen='finanzas' a mano desde la consola del
-- navegador. Sirve para evitar el alta accidental desde otro modulo, no para
-- frenar a alguien que lo quiera evitar a proposito.
-- ------------------------------------------------------------
create or replace function public.proyectos_solo_alta_finanzas()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.origen, '') <> 'finanzas' then
    raise exception
      'Los proyectos se crean unicamente en el modulo Finanzas. Alta rechazada (origen=%).',
      coalesce(new.origen, 'sin origen')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proyectos_solo_alta_finanzas on public.proyectos;

create trigger trg_proyectos_solo_alta_finanzas
  before insert on public.proyectos
  for each row
  execute function public.proyectos_solo_alta_finanzas();

-- ------------------------------------------------------------
-- Para dar marcha atras (pegar y correr, deja todo como estaba):
--
--   drop trigger if exists trg_proyectos_solo_alta_finanzas on public.proyectos;
--   drop function if exists public.proyectos_solo_alta_finanzas();
--   alter table public.proyectos alter column origen set default 'projects';
-- ------------------------------------------------------------
