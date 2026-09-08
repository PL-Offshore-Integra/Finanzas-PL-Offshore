-- ============================================================
-- INTEGRA · Finanzas — a qué módulos se le muestra cada centro de costo
--
-- QUE RESUELVE
--
--   Los centros de costo se sincronizan solos desde Xubio (ver
--   sql/centros_costo_xubio.sql) y la idea es que los demás módulos —hoy
--   Compras, Víveres, Reparaciones, HSQE y Comercial— eventualmente puedan
--   elegir un centro de costo en su propio desplegable, igual que ya eligen
--   un proyecto de `v_proyectos_activos`.
--
--   Pero no todos los centros de costo le sirven a todos los módulos: un
--   auto (Toyota Etios), un galpón o "Financiación" no tienen nada que
--   hacer en el desplegable de Compras de un buque, y un módulo puede
--   necesitar ver un subconjunto distinto que otro. Antes de que cualquier
--   módulo empiece a leer centros de costo, Finanzas tiene que poder curar
--   —por módulo— cuáles aparecen.
--
--   Este archivo agrega esa curaduría. No conecta ningún módulo todavía:
--   eso es trabajo de Fede en cada repo. Lo que deja listo es el dato y la
--   forma de editarlo desde Finanzas.
--
-- POR QUÉ UN ARRAY Y NO UN BOOLEANO COMO proyectos.visible_modulos
--
--   `public.proyectos.visible_modulos` es un boolean: un proyecto publicado
--   lo ven TODOS los módulos por igual, a propósito (el README de este repo
--   dice por qué: "un desplegable con una sola opción no es un
--   desplegable", pero ahí la opción es "publicado sí/no", no "a quién").
--
--   Acá el pedido es distinto y más fino: el mismo centro de costo puede
--   tener que aparecer en Compras y no en Comercial, o viceversa. Un
--   boolean no alcanza; hace falta saber CUÁLES módulos, no si "está
--   publicado". De ahí el array.
--
-- LA LISTA ES CERRADA, A PROPÓSITO
--
--   Mismo criterio que `tablero_temas` con las empresas del grupo (ver
--   sql/tablero_temas.sql): un valor mal tipeado en un array de texto libre
--   crea un módulo fantasma que ningún filtro va a encontrar nunca. El
--   check de abajo obliga a que todo elemento sea uno de los cinco
--   conocidos hoy. Agregar un módulo nuevo el día de mañana es tocar ese
--   check y esta lista de un solo lugar (MODULOS_CENTRO_COSTO en
--   src/App.jsx), no una migración de datos.
--
-- VACÍO POR DEFECTO
--
--   Igual que `visible_modulos` en proyectos: un centro de costo recién
--   sincronizado de Xubio no aparece en ningún módulo hasta que Finanzas lo
--   publique a mano. Nadie decide por default que "Astillero" es visible en
--   Compras.
--
-- CÓMO VA A CONSULTAR ESTO CADA MÓDULO (para cuando Fede lo conecte)
--
--   select id, nombre from public.centros_costo
--   where activo = true
--     and visible_modulos @> array['compras'];   -- el módulo que corresponda
--
-- Correr desde Supabase -> SQL Editor -> Run, un bloque por vez.
-- ============================================================


-- ------------------------------------------------------------
-- 1) La columna
-- ------------------------------------------------------------
alter table public.centros_costo
  add column if not exists visible_modulos text[] not null default '{}';

alter table public.centros_costo
  drop constraint if exists centros_costo_visible_modulos_check;

alter table public.centros_costo
  add constraint centros_costo_visible_modulos_check
  check (visible_modulos <@ array['compras','viveres','reparaciones','hsqe','comercial']::text[]);

comment on column public.centros_costo.visible_modulos is
  'A que modulos se les puede elegir este centro de costo en su propio desplegable. Lista cerrada (ver el check): compras, viveres, reparaciones, hsqe, comercial. Vacio por defecto: nadie lo ve hasta que Finanzas lo publique.';


-- ------------------------------------------------------------
-- 2) Publicar / despublicar en lote
--
-- Una fila puede estar seleccionada junto con otras 20 en la pantalla de
-- Finanzas, y cada una ya trae su propio visible_modulos con contenido
-- distinto: no se puede resolver con un solo UPDATE ... SET columna = valor
-- como hace setActivoCentros con `activo`, porque acá hay que agregar o
-- sacar UN elemento del array de cada fila sin pisar el resto. De ahí la
-- función en vez de un update directo desde el cliente.
--
-- No es security definer: RLS de centros_costo ya deja actualizar a
-- `authenticated` (centros_costo_update, qual true), así que corre con los
-- permisos normales de quien la llama.
-- ------------------------------------------------------------
create or replace function public.fn_centros_costo_set_modulo(
  p_ids     uuid[],
  p_modulo  text,
  p_mostrar boolean
)
returns void
language plpgsql
as $$
begin
  if p_modulo not in ('compras', 'viveres', 'reparaciones', 'hsqe', 'comercial') then
    raise exception
      'Modulo desconocido: %. Los validos son compras, viveres, reparaciones, hsqe, comercial.',
      p_modulo;
  end if;

  if p_mostrar then
    update public.centros_costo
    set visible_modulos = array(select distinct unnest(visible_modulos || array[p_modulo]))
    where id = any(p_ids)
      and not (visible_modulos @> array[p_modulo]);
  else
    update public.centros_costo
    set visible_modulos = array_remove(visible_modulos, p_modulo)
    where id = any(p_ids)
      and visible_modulos @> array[p_modulo];
  end if;
end;
$$;

comment on function public.fn_centros_costo_set_modulo(uuid[], text, boolean) is
  'Agrega o saca UN modulo del array visible_modulos de varios centros de costo a la vez, sin pisar los demas modulos que ya tuvieran marcados. p_mostrar=true agrega, false saca.';

grant execute on function public.fn_centros_costo_set_modulo(uuid[], text, boolean) to authenticated;


-- ------------------------------------------------------------
-- 3) Ver como quedo
-- ------------------------------------------------------------
select nombre, activo, visible_modulos
from public.centros_costo
where empresa = 'Parana Logistica'
order by nombre;


-- ------------------------------------------------------------
-- MARCHA ATRAS
--
--   drop function if exists public.fn_centros_costo_set_modulo(uuid[], text, boolean);
--   alter table public.centros_costo drop constraint if exists centros_costo_visible_modulos_check;
--   alter table public.centros_costo drop column if exists visible_modulos;
--
-- Sin riesgo para otros modulos: ninguno lee todavia esta columna, porque
-- ninguno esta conectado. El unico efecto de borrarla es que Finanzas deja
-- de poder curar la visibilidad, no que algo mas se rompa.
-- ------------------------------------------------------------
