-- ============================================================
-- INTEGRA · Finanzas — el tablero de temas del area
--
-- QUE RESUELVE
--
--   Los temas del area de Finanzas se venian repasando de memoria en la
--   reunion semanal con Juan. Nada malo con eso salvo dos cosas: la lista
--   arranca de cero cada semana, y la prioridad de cada tema es la que se
--   recuerda en el momento.
--
--   Esta tabla es la lista. Un tema, la empresa del grupo a la que
--   pertenece, y su prioridad. Nada mas: lo que hace falta para abrir la
--   reunion y saber por donde empezar.
--
-- POR QUE UNA TABLA Y NO UN ARCHIVO
--
--   Porque se revisa de semana en semana y entre dos personas. Un archivo
--   local o el storage del navegador dejarian el tablero atado a una
--   maquina: Juan abriria el modulo y veria otra cosa, o nada. Es el mismo
--   criterio con el que ya viven proyectos y centros_costo.
--
-- LAS OCHO EMPRESAS
--
--   La lista del grupo, cerrada con un check. Es a proposito: un tema mal
--   tipeado ("Parana Port" sin acento) abriria un noveno grupo en el
--   tablero que parece una empresa y no lo es.
--
--   Agregar una empresa es una linea, y esta al final del archivo.
--
-- LAS TRES PRIORIDADES
--
--   alta / media / baja, en minuscula, como el resto de los estados del
--   esquema (proyectos.estado_financiero, facturas.moneda). La pantalla las
--   muestra capitalizadas; la base no opina de como se escriben.
--
-- Correr desde Supabase -> SQL Editor -> Run, un bloque por vez.
-- ============================================================


-- ------------------------------------------------------------
-- 1) ANTES QUE NADA: ver si la tabla ya existe
--
-- No crea nada. Si devuelve una fila, el tablero ya esta instalado y este
-- archivo no hace falta: el paso 2 no la volveria a crear, pero conviene
-- saberlo antes de correr nada.
-- ------------------------------------------------------------
select table_name,
       (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'tablero_temas') as columnas
from information_schema.tables
where table_schema = 'public'
  and table_name = 'tablero_temas';


-- ------------------------------------------------------------
-- 2) La tabla
-- ------------------------------------------------------------
create table if not exists public.tablero_temas (
  id         uuid primary key default gen_random_uuid(),

  -- De que se trata el tema. Texto libre y obligatorio: es lo unico que la
  -- persona escribe, y un tema sin nombre no es un tema.
  nombre     text not null,

  -- A que empresa del grupo pertenece. Cerrado a las ocho, ver el
  -- encabezado.
  empresa    text not null
    check (empresa in ('Paraná Logística',
                       'Clean Sea',
                       'Terra Mare Services',
                       'Paraná Port',
                       'Fagal',
                       'Terra Mare',
                       'HF Offshore Argentina',
                       'Petro Trader')),

  -- El default es 'media' y no 'alta': un tema que entra sin que nadie
  -- decida su prioridad no puede colarse arriba de la lista.
  prioridad  text not null default 'media'
    check (prioridad in ('alta','media','baja')),

  creado_en      timestamptz not null default now(),
  -- Para la reunion semanal: saber que se toco desde la ultima vez.
  actualizado_en timestamptz not null default now(),

  -- Cerrado: sale del tablero activo. No se borra —se apaga—, para no
  -- perder el historial de que se trato y cuando.
  realizado  boolean not null default false,

  -- Fecha limite del tema. Opcional: no todos los temas la tienen, sobre
  -- todo al principio. Alimenta la vista "Por fecha" (vencido / esta semana
  -- / este mes / mas adelante) y el aviso de vencido en las otras dos
  -- vistas. `date` y no `timestamptz`: es un vencimiento, no un instante.
  vence_el   date,

  -- Quien quedo a cargo. Texto libre y opcional: a diferencia de empresa,
  -- no hay una lista cerrada de personas —no es un catalogo del sistema,
  -- es "a quien se lo asigno Juan en la reunion"—, asi que no vale la pena
  -- un check ni depender de un catalogo de otro modulo (comparar contra
  -- public.catalogo_responsables no encaja: esa tabla son cargos operativos
  -- del buque —Capitan, Gte. Operaciones—, no personas del area).
  responsable text,

  -- Un nombre en blanco o con solo espacios pasa el `not null` y despues
  -- aparece como una fila vacia en el tablero.
  constraint tablero_temas_nombre_no_vacio
    check (btrim(nombre) <> '')
);

comment on table public.tablero_temas is
  'Temas del area de Finanzas para la revision semanal. Se agrupa por empresa o por prioridad.';
comment on column public.tablero_temas.prioridad is
  'alta / media / baja. La pantalla las muestra capitalizadas.';
comment on column public.tablero_temas.actualizado_en is
  'Lo pisa la app en cada edicion. Sirve para ver que se movio desde la ultima reunion.';
comment on column public.tablero_temas.realizado is
  'Tema cerrado: sale del tablero activo. actualizado_en marca cuando.';

-- El tablero se lee siempre agrupado por una de las dos, asi que las dos
-- llevan indice. Igual la tabla es chica: esto es prolijidad, no
-- performance.
create index if not exists ix_tablero_temas_empresa
  on public.tablero_temas (empresa);
create index if not exists ix_tablero_temas_prioridad
  on public.tablero_temas (prioridad);


-- ------------------------------------------------------------
-- 3) RLS y politicas
--
-- Mismo criterio que centros_costo y proyectos: cualquiera que entro al
-- modulo puede leer y escribir. El tablero es del area, no de una persona,
-- y la reunion es de dos: que uno pueda editar y el otro no seria peor.
-- ------------------------------------------------------------
alter table public.tablero_temas enable row level security;

drop policy if exists tablero_temas_select on public.tablero_temas;
create policy tablero_temas_select on public.tablero_temas
  for select to authenticated using (true);

drop policy if exists tablero_temas_insert on public.tablero_temas;
create policy tablero_temas_insert on public.tablero_temas
  for insert to authenticated with check (true);

drop policy if exists tablero_temas_update on public.tablero_temas;
create policy tablero_temas_update on public.tablero_temas
  for update to authenticated using (true);

drop policy if exists tablero_temas_delete on public.tablero_temas;
create policy tablero_temas_delete on public.tablero_temas
  for delete to authenticated using (true);

grant select, insert, update, delete on public.tablero_temas
  to authenticated, service_role;


-- ------------------------------------------------------------
-- 4) Ver como quedo
--
-- Recien creada devuelve cero filas, que es lo correcto: los temas se
-- cargan desde el tablero, no desde aca.
-- ------------------------------------------------------------
select prioridad,
       count(*)                          as temas,
       count(distinct empresa)           as empresas
from public.tablero_temas
group by prioridad
order by case prioridad
           when 'alta'  then 1
           when 'media' then 2
           else 3
         end;


-- ------------------------------------------------------------
-- 5) LA COLUMNA realizado — migracion aditiva
--
-- Se agrego despues, cuando la tabla ya estaba en produccion con temas
-- cargados. `if not exists` la hace segura de correr de nuevo: si ya existe,
-- no hace nada.
--
-- Default false y not null: ningun tema existente cambia de estado al
-- agregarla, y no puede quedar en null (ni abierto ni cerrado).
-- ------------------------------------------------------------
alter table public.tablero_temas
  add column if not exists realizado boolean not null default false;

comment on column public.tablero_temas.realizado is
  'Tema cerrado: sale del tablero activo. actualizado_en marca cuando.';

-- MARCHA ATRAS DE ESTE PASO
--
--   alter table public.tablero_temas drop column realizado;
--
-- Se lleva puesto que temas estaban marcados como realizados. El resto de
-- la tabla no se toca.


-- ------------------------------------------------------------
-- 6) LA COLUMNA responsable — migracion aditiva
--
-- Texto libre y sin check: no hay una lista cerrada de personas, y no se
-- reutiliza public.catalogo_responsables porque esa tabla son cargos
-- operativos del buque (Capitan, Gte. Operaciones, Compliance...), de otro
-- modulo. Nullable a proposito: un tema puede cargarse sin saber todavia
-- quien lo va a llevar.
-- ------------------------------------------------------------
alter table public.tablero_temas
  add column if not exists responsable text;

comment on column public.tablero_temas.responsable is
  'Quien quedo a cargo del tema. Texto libre, opcional.';

-- MARCHA ATRAS DE ESTE PASO
--
--   alter table public.tablero_temas drop column responsable;


-- ------------------------------------------------------------
-- 7) LA COLUMNA vence_el — migracion aditiva
--
-- Fecha limite, opcional. Sin ella no hay "Por fecha" ni aviso de vencido:
-- son las dos cosas que dependen de este dato.
-- ------------------------------------------------------------
alter table public.tablero_temas
  add column if not exists vence_el date;

comment on column public.tablero_temas.vence_el is
  'Fecha límite del tema. Opcional. Alimenta la vista Por fecha y el aviso de vencido.';

-- MARCHA ATRAS DE ESTE PASO
--
--   alter table public.tablero_temas drop column vence_el;


-- ------------------------------------------------------------
-- AGREGAR UNA EMPRESA
--
--   Son dos lugares, y los dos hay que tocar: el check de aca y la
--   constante EMPRESAS_GRUPO en src/App.jsx. Si se toca solo el check, la
--   empresa existe en la base pero no aparece en el desplegable; si se toca
--   solo la constante, el insert falla con "violates check constraint".
--
--     alter table public.tablero_temas
--       drop constraint tablero_temas_empresa_check;
--
--     alter table public.tablero_temas
--       add constraint tablero_temas_empresa_check
--       check (empresa in ('Paraná Logística',
--                          'Clean Sea',
--                          'Terra Mare Services',
--                          'Paraná Port',
--                          'Fagal',
--                          'Terra Mare',
--                          'HF Offshore Argentina',
--                          'Petro Trader',
--                          'La Empresa Nueva'));
--
-- MARCHA ATRAS
--
--   drop table if exists public.tablero_temas;
--
-- Ojo: se lleva todos los temas cargados. No hay de donde recuperarlos.
-- ------------------------------------------------------------
