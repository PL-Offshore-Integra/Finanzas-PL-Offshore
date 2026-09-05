-- ============================================================
-- INTEGRA · Finanzas — sacar los proyectos que no vienen de Comercial
--
-- Los proyectos que hoy estan en public.proyectos nacieron antes de que el
-- alta pasara a Comercial. Se van, para que el maestro arranque limpio y
-- todo lo que tenga adentro venga de un solo lado.
--
-- ┌──────────────────────────────────────────────────────────────┐
-- │ ESTE SCRIPT BORRA FILAS. No se corre entero de una.           │
-- │                                                               │
-- │ El paso 1 no borra nada: cuenta que le cuelga a cada proyecto │
-- │ en los cuatro modulos que lo referencian. Correr ESE BLOQUE   │
-- │ SOLO, leer el resultado, y seguir con el paso 2 unicamente si │
-- │ todas las cuentas dan cero.                                   │
-- │                                                               │
-- │ Si alguna da distinto de cero, PARAR. Borrar ese proyecto     │
-- │ rompe una requisicion, un pedido de viveres, una SSRR o un    │
-- │ registro de HSQE que es de un modulo de Fede. Eso se habla    │
-- │ con el antes, no se fuerza.                                   │
-- └──────────────────────────────────────────────────────────────┘
--
-- Correr desde Supabase -> SQL Editor -> Run, un bloque por vez.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Que le cuelga a cada proyecto
--
-- Los nombres de tabla y columna salen de la tabla del README. Si alguno
-- cambio, la consulta falla con "relation does not exist" en lugar de dar un
-- cero enganoso: eso es a proposito, un error aca es mejor que un borrado
-- que se creia seguro.
-- ------------------------------------------------------------
select p.codigo,
       p.nombre,
       coalesce(p.origen, '(sin origen)') as origen,
       (select count(*) from public.requisiciones    r where r.proyecto_origen_id = p.id) as compras,
       (select count(*) from public.viveres_pedidos  v where v.proyecto_id        = p.id) as viveres,
       (select count(*) from public.ssrr_solicitudes s where s.proyecto_id        = p.id) as reparaciones,
       (select count(*) from public.hsqe_registros   h where h.proyecto_id        = p.id) as hsqe
from public.proyectos p
where p.origen is distinct from 'comercial'
order by p.codigo;

-- ------------------------------------------------------------
-- 2) El borrado
--
-- Recien despues de que el paso 1 diera todo en cero.
--
-- El filtro es `origen is distinct from 'comercial'` y no una lista de ids:
-- asi el script sigue siendo correcto si se corre despues de que el espejo
-- haya traido proyectos de Comercial, que son los que hay que conservar.
-- El `is distinct from` en lugar de `<>` es para que las filas con origen
-- nulo tambien entren; con `<>` un NULL no compara y se salvarian.
--
-- Va envuelto en una transaccion con un tope: si el borrado se lleva mas de
-- cinco filas, algo no es lo que pensabamos y conviene mirar antes de
-- confirmar. Cambiar el 5 si de verdad hay mas.
-- ------------------------------------------------------------
do $limpieza$
declare
  v_borradas int;
begin
  delete from public.proyectos
  where origen is distinct from 'comercial';

  get diagnostics v_borradas = row_count;

  if v_borradas > 5 then
    raise exception
      'Se iban a borrar % proyectos, mas de los 5 esperados. No se borro nada: revisar el paso 1.',
      v_borradas;
  end if;

  raise notice 'Proyectos borrados: %', v_borradas;
end;
$limpieza$;

-- ------------------------------------------------------------
-- 3) Ver como quedo
-- ------------------------------------------------------------
select coalesce(origen, '(sin origen)') as origen,
       count(*)                          as proyectos
from public.proyectos
group by 1
order by 1;

-- ------------------------------------------------------------
-- Marcha atras: no hay.
--
-- Un DELETE no se deshace. Si hace falta poder volver, sacar antes una copia
-- de las filas y guardarla fuera de la base:
--
--   select * from public.proyectos where origen is distinct from 'comercial';
--
-- Copiar ese resultado y guardarlo ANTES de correr el paso 2.
-- ------------------------------------------------------------
