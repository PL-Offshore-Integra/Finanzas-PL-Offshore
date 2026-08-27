-- ============================================================
-- INTEGRA · Finanzas — varios proyectos publicados a la vez
--
-- Contexto
--
--   visible_modulos nacio como un interruptor de "proyecto activo": un unico
--   proyecto a la vez, forzado por el indice ux_proyectos_un_visible y por la
--   funcion fin_set_proyecto_visible, que apagaba el anterior al prender uno
--   nuevo.
--
--   Eso no sirve para lo que se necesita. Los otros modulos (Viveres, Compras,
--   Reparaciones, HSQE, Projects) tienen que ofrecer un DESPLEGABLE de
--   proyectos, y un desplegable con una sola opcion no es un desplegable.
--
--   Este script cambia el significado de la columna:
--
--     antes:  visible_modulos = true  -> "es EL proyecto activo"
--     ahora:  visible_modulos = true  -> "esta publicado, se puede elegir"
--
-- Riesgo: ninguno. Verificado en los 12 repos de la organizacion: hoy nadie
-- fuera de Finanzas lee visible_modulos, ni llama a fin_set_proyecto_visible.
--
-- Correr desde Supabase -> SQL Editor -> Run.
-- ============================================================

-- ------------------------------------------------------------
-- 0) PRIMERO: guardar que se esta por borrar
--
-- Correr SOLO este bloque, copiar el resultado y guardarlo. El esquema no
-- esta versionado en ningun repo, asi que si esto no se copia, la definicion
-- exacta se pierde y no hay marcha atras posible.
--
--   select indexdef from pg_indexes
--   where schemaname = 'public' and indexname = 'ux_proyectos_un_visible';
--
--   select pg_get_functiondef(oid) from pg_proc
--   where proname = 'fin_set_proyecto_visible';
--
-- Recien despues seguir con el resto del script.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 1) Sacar el indice que permitia un solo proyecto publicado
-- ------------------------------------------------------------
drop index if exists public.ux_proyectos_un_visible;

-- ------------------------------------------------------------
-- 2) Sacar la funcion que apagaba el proyecto anterior
--
-- La app ya no la llama: publicar es un update comun a visible_modulos.
-- Si alguien mas la estuviera usando, este drop falla en lugar de romper en
-- silencio, y ahi lo revisamos.
-- ------------------------------------------------------------
drop function if exists public.fin_set_proyecto_visible(uuid);

-- ------------------------------------------------------------
-- 3) Ver como quedo
-- ------------------------------------------------------------
select nombre,
       coalesce(codigo, '(sin codigo)') as codigo,
       coalesce(centro_costo, '(sin centro de costo)') as centro_costo,
       visible_modulos
from public.proyectos
order by visible_modulos desc, nombre;

-- ------------------------------------------------------------
-- Para dar marcha atras hay que recrear el indice Y la funcion, con las
-- definiciones que se guardaron en el paso 0. No las escribo de memoria aca
-- porque no las conozco: el esquema vive solo dentro de Supabase y no hay DDL
-- versionado en ninguno de los 12 repos.
--
-- Si el paso 0 no se corrio, pedirle a Fede la definicion antes de tocar nada.
-- ------------------------------------------------------------
