# Finanzas — PL Offshore

Módulo de Finanzas del ecosistema INTEGRA. Es el **dueño de la tabla maestra
`proyectos`**: acá se crean, editan y se decide qué proyecto ven el resto de los
módulos.

## Stack

React + Vite + Supabase, desplegado en Vercel.

## Variables de entorno

Se cargan en Vercel (Settings → Environment Variables). **Nunca se commitean.**

| Variable | Valor |
|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto Supabase |
| `VITE_SUPABASE_ANON_KEY` | anon / public key |

Para desarrollo local, crear `.env.local` con esas dos variables (está en `.gitignore`).

## Cómo se conecta con los otros módulos

Finanzas escribe en `proyectos`. Los demás módulos **leen la vista
`v_proyectos_activos`**, que devuelve únicamente el proyecto marcado como
visible. Un solo proyecto visible a la vez, garantizado por un índice único
parcial en la base.

Módulos enganchados a la maestra:

| Módulo | Tabla | Columna |
|---|---|---|
| Projects | `proyectos` | es la maestra |
| Compras | `requisiciones` | `proyecto_origen_id` |
| Víveres | `viveres_pedidos` | `proyecto_id` |
| Reparaciones | `ssrr_solicitudes` | `proyecto_id` |
| HSQE | `hsqe_registros` | `proyecto_id` |

## Pendientes

- Vista `v_fin_movimientos` (UNION de los módulos) para el tab Consolidado
- Sacar el botón de crear proyecto de projects-app
- Apuntar los dropdowns de los 4 módulos a `v_proyectos_activos`
- Rename `Parana Logistica` → `PL Offshore` (constantes `EMPRESA` en `src/App.jsx`)
