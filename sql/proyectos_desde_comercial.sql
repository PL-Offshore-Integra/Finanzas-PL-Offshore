-- ============================================================
-- INTEGRA · Finanzas — el proyecto entra desde Comercial
--
-- QUE RESUELVE
--
--   La cadena que tiene que funcionar es:
--
--     oportunidad (Comercial) -> proyecto (Comercial) -> HABILITACION
--     (Finanzas) -> items por area (Compras, Viveres, SSRR, HSQE,
--     cost-tracker) -> cierre (Finanzas)
--
--   De esos cinco eslabones, cuatro ya existen. Este archivo hace el que
--   falta: que el proyecto de Comercial llegue a Finanzas.
--
--   Lo que YA estaba:
--     - oportunidad -> proyecto: comercial.proyectos.oportunidad_id, y es
--       UNIQUE, asi que una oportunidad da un proyecto y no mas.
--     - habilitar: public.proyectos.visible_modulos.
--     - la interfaz hacia los otros modulos: la vista
--       public.v_proyectos_activos, que ya filtra por
--       `visible_modulos = true and estado_financiero <> 'cerrado'`.
--     - cerrar: public.proyectos.estado_financiero = 'cerrado'.
--     - items por area: diez foreign keys ya cuelgan de
--       public.proyectos.id (requisiciones, viveres_pedidos,
--       ssrr_solicitudes, hsqe_registros y las cinco de projects-app).
--
-- POR QUE NO SE REEMPLAZA public.proyectos POR comercial.proyectos
--
--   Porque public.proyectos.id es la columna vertebral de seis modulos:
--   son diez FK, incluida comercial.oportunidades.proyecto_id. Repuntar
--   esos ids a los de Comercial rompe Compras, Viveres, SSRR, HSQE y
--   projects-app de una sola vez.
--
--   Asi que el id local NO se toca. Se agrega un vinculo al lado.
--
-- QUIEN ES DUENIO DE QUE, DESPUES DE ESTO
--
--   Comercial: nombre, nro_proyecto, cliente, fechas, moneda, buque,
--   descripcion. Finanzas los MUESTRA y no los edita (ya es asi:
--   CAMPOS_ESCRITURA en src/App.jsx son solo centro_costo y
--   presupuesto_total).
--
--   Finanzas: centro_costo, presupuesto_total, visible_modulos y
--   estado_financiero. Nada mas. Finanzas no crea el proyecto ni redefine
--   sus hechos: lo habilita y lo cierra.
--
-- OJO: valor NO es presupuesto_total
--
--   comercial.proyectos.valor es lo que se le cobra al cliente (ingreso).
--   public.proyectos.presupuesto_total es lo que Finanzas espera gastar
--   (costo). Son numeros distintos y de signo contrario en el P&L. Por eso
--   el import NO copia `valor`: mapearlos seria meter el ingreso en la
--   columna del costo y el margen saldria en cero.
--
-- Correr desde Supabase -> SQL Editor -> Run, un bloque por vez.
-- ============================================================


-- ------------------------------------------------------------
-- 1) ANTES QUE NADA: que hay a cada lado y que se puede cruzar
--
-- No crea nada. Contesta tres cosas: cuantos proyectos hay en Comercial,
-- cuantos en Finanzas, y si alguno se puede emparejar por nombre (que es
-- lo unico que hoy tienen en comun).
-- ------------------------------------------------------------
select 'comercial.proyectos' as tabla, count(*) as filas from comercial.proyectos
union all
select 'public.proyectos', count(*) from public.proyectos;

-- Y el cruce tentativo por nombre normalizado. Lo que salga con
-- `ya_en_finanzas` no nulo son los que conviene vincular a mano en el paso
-- 4 en vez de importar de nuevo (importarlos duplicaria el proyecto).
select c.nro_proyecto,
       c.nombre                as en_comercial,
       f.nombre                as ya_en_finanzas,
       f.origen
from comercial.proyectos c
left join public.proyectos f
       on lower(btrim(f.nombre)) = lower(btrim(c.nombre))
order by (f.id is null), c.nro_proyecto;


-- ------------------------------------------------------------
-- 2) El vinculo
--
-- Nullable a proposito: los proyectos que ya estan cargados y no vienen de
-- Comercial (hoy tres, con origen = 'projects') quedan con null y siguen
-- funcionando igual. No son un error: tienen tareas y adjuntos colgando.
--
-- UNIQUE para que un proyecto de Comercial no pueda entrar dos veces. Es
-- la proteccion real contra el duplicado.
--
-- `on delete set null` y no `restrict`: si en Comercial borran un
-- proyecto, la fila de Finanzas sobrevive —se queda sin vinculo, con los
-- datos que ya tenia copiados— en vez de bloquearle el borrado a
-- Comercial. Finanzas no le pone condiciones a otro modulo.
-- ------------------------------------------------------------
alter table public.proyectos
  add column if not exists comercial_proyecto_id uuid;

alter table public.proyectos
  drop constraint if exists proyectos_comercial_proyecto_id_fkey;
alter table public.proyectos
  add constraint proyectos_comercial_proyecto_id_fkey
  foreign key (comercial_proyecto_id)
  references comercial.proyectos (id)
  on delete set null;

-- El unique va como indice parcial: `unique` a secas contaria los null y
-- en Postgres varios null no chocan, pero el indice parcial deja mas claro
-- que la regla aplica solo a los vinculados.
create unique index if not exists ux_proyectos_comercial_proyecto_id
  on public.proyectos (comercial_proyecto_id)
  where comercial_proyecto_id is not null;

comment on column public.proyectos.comercial_proyecto_id is
  'El proyecto en comercial.proyectos del que salio este. Null = proyecto legacy, anterior a la integracion. Comercial es duenio de los hechos; Finanzas solo habilita y cierra.';


-- ------------------------------------------------------------
-- 3) La bandeja de entrada
--
-- Los proyectos de Comercial que Finanzas todavia no habilito. Esta es la
-- lista que la pantalla de Finanzas tiene que mostrar: el acto de abrir el
-- proyecto es de Finanzas, no automatico. Un proyecto que Comercial acaba
-- de crear no deberia aparecerle a Compras sin que Finanzas lo mire.
--
-- Por eso una vista y no un trigger de insert automatico: el trigger
-- saltearia la decision, que es justo el trabajo de Finanzas.
--
-- Corre con los permisos del duenio para poder leer `comercial`, igual que
-- v_fin_ingresos. Ver la nota de privilegios en
-- sql/ingresos_desde_comercial.sql: el warning `security_definer_view` del
-- linter es esperado.
-- ------------------------------------------------------------
create or replace view public.v_fin_proyectos_pendientes as
select
  c.id                        as comercial_proyecto_id,
  c.nro_proyecto,
  c.nombre,
  c.compania,
  c.cliente_final,
  c.buque,
  c.descripcion,
  c.moneda,
  -- El valor del contrato, expuesto para poder decidir con el numero a la
  -- vista. NO es presupuesto_total: ver la nota del encabezado.
  c.valor                     as valor_contrato,
  c.estado                    as estado_comercial,
  c.fecha_inicio_estimada::date as fecha_inicio,
  c.fecha_fin_estimada::date    as fecha_fin,
  c.created_at
from comercial.proyectos c
where not exists (
        select 1 from public.proyectos f
        where f.comercial_proyecto_id = c.id
      );

comment on view public.v_fin_proyectos_pendientes is
  'Proyectos de Comercial que Finanzas todavia no habilito. Alimenta la bandeja de entrada del modulo.';

grant select on public.v_fin_proyectos_pendientes to authenticated;


-- ------------------------------------------------------------
-- 4) Vincular a mano los que ya estaban
--
-- Solo si el paso 1 mostro un proyecto que existe en los dos lados. Une
-- las dos filas en vez de importar una nueva, que dejaria el proyecto
-- duplicado y las tareas colgando de la vieja.
--
-- NO se corre a ciegas: reemplazar los valores y descomentar.
--
--   update public.proyectos f
--      set comercial_proyecto_id = (
--            select c.id from comercial.proyectos c
--            where c.nro_proyecto = 'PL-XXXX'
--          ),
--          origen = 'comercial'
--    where f.id = '<uuid de public.proyectos>';
--
-- Verificar despues con el paso 5.


-- ------------------------------------------------------------
-- 5) Ver como quedo
-- ------------------------------------------------------------
select coalesce(origen, '(sin origen)')                as origen,
       count(*)                                        as proyectos,
       count(comercial_proyecto_id)                    as vinculados_a_comercial,
       count(*) filter (where visible_modulos)         as habilitados,
       count(*) filter (where estado_financiero = 'cerrado') as cerrados
from public.proyectos
group by 1
order by 1;

-- Y cuantos quedan en la bandeja
select count(*) as pendientes_de_habilitar
from public.v_fin_proyectos_pendientes;


-- ------------------------------------------------------------
-- LO QUE ESTE ARCHIVO NO HACE, A PROPOSITO
--
--   1. No sincroniza cambios. Si en Comercial le cambian el nombre a un
--      proyecto ya habilitado, Finanzas sigue mostrando el que copio. Que
--      los hechos se refresquen es el paso siguiente, y hay que decidir si
--      es un trigger, una Edge Function o que la pantalla lea la vista en
--      vivo. No lo adivino acá.
--   2. No toca cost-tracker. `cpt_proyectos` es un universo aparte: sus
--      dos proyectos no apuntan a public.proyectos y ahi esta la plata de
--      verdad (234 cpt_oc_nf, 25 cpt_oc, 53 cpt_alocaciones). Unirlo es
--      una decision de arquitectura del grupo y es repo de Fede.
--   3. No arma el consolidado. Cuando exista, el patron natural es una
--      vista `v_fin_movimientos` que hace union all de una rama por area,
--      normalizadas a (modulo, proyecto_id, fecha, concepto, moneda,
--      monto, estado). Ojo que hoy solo cost-tracker aportaria plata:
--      requisiciones tiene costo_real vacio en las 17 filas, viveres solo
--      precio de referencia, y ssrr/hsqe no tienen monto.
--
-- MARCHA ATRAS
--
--   drop view if exists public.v_fin_proyectos_pendientes;
--   drop index if exists public.ux_proyectos_comercial_proyecto_id;
--   alter table public.proyectos
--     drop constraint if exists proyectos_comercial_proyecto_id_fkey;
--   alter table public.proyectos drop column if exists comercial_proyecto_id;
--
-- Sin riesgo para los otros modulos: la columna es nueva y nullable, y
-- v_proyectos_activos no la selecciona, asi que su contrato no cambia.
-- ------------------------------------------------------------
