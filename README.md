# Finanzas — PL Offshore

Módulo de Finanzas del ecosistema INTEGRA. Es el **curador de la tabla maestra
`proyectos`**: no da de alta nada, recibe lo que se vendió en Comercial y le
agrega lo que sólo él sabe —centro de costo y presupuesto— antes de decidir
qué proyectos ven los demás módulos.

## Stack

React + Vite + Supabase, desplegado en Vercel.

## Variables de entorno

Se cargan en Vercel (Settings → Environment Variables). **Nunca se commitean.**

| Variable | Valor |
|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto Supabase |
| `VITE_SUPABASE_ANON_KEY` | anon / public key |

Para desarrollo local, crear `.env.local` con esas dos variables (está en `.gitignore`).

## De dónde salen los proyectos

De **Comercial**, siempre. Un proyecto se crea en `comercial.proyectos` —con o
sin oportunidad detrás— y un espejo en la base lo copia a `public.proyectos`.
Finanzas no tiene alta: no hay botón ni formulario para crear uno.

Quién escribe qué, una vez que el proyecto llegó:

| Columna | La escribe | En Finanzas |
|---|---|---|
| `codigo`, `nombre`, `cliente`, `moneda`, `fecha_inicio`, `fecha_fin`, `descripcion`, `estado_financiero` | Comercial, en cada edición | se muestran, no se editan |
| `centro_costo` | Finanzas | a qué buque se imputa |
| `presupuesto_total` | Finanzas | cuánto se espera gastar, **no** el valor vendido |
| `visible_modulos` | Finanzas | si los demás módulos lo pueden elegir |

El espejo nunca pisa las tres últimas: una edición en Comercial no borra el
trabajo de Finanzas.

## Cómo se conecta con los otros módulos

Los demás módulos **leen la vista `v_proyectos_activos`**, que devuelve los
proyectos publicados. Publicar es marcar `visible_modulos`, y pueden estar
publicados todos los que hagan falta: los otros módulos necesitan un
desplegable, y un desplegable con una sola opción no es un desplegable.

Módulos enganchados a la maestra:

| Módulo | Tabla | Columna |
|---|---|---|
| Projects | `proyectos` | es la maestra |
| Compras | `requisiciones` | `proyecto_origen_id` |
| Víveres | `viveres_pedidos` | `proyecto_id` |
| Reparaciones | `ssrr_solicitudes` | `proyecto_id` |
| HSQE | `hsqe_registros` | `proyecto_id` |

## Pendientes

- Correr el espejo `comercial.proyectos → public.proyectos`. **Sin esto el
  módulo no recibe ningún proyecto**, porque el alta ya no existe acá.
- Dar vuelta `sql/proyectos_solo_finanzas.sql`: hoy rechaza toda alta que no
  venga de Finanzas, que es exactamente al revés de lo que hace falta ahora.
- Borrar los tres proyectos viejos de `public.proyectos`, después de verificar
  que ningún módulo los referencie.
- Vista `v_fin_movimientos` (UNION de los módulos) para el tab Consolidado
- Sacar el botón de crear proyecto de projects-app
- Apuntar los dropdowns de los 4 módulos a `v_proyectos_activos`
- Rename `Parana Logistica` → `PL Offshore` (constantes `EMPRESA` en `src/App.jsx`)
