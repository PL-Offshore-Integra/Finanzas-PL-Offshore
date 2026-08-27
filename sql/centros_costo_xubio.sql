-- ============================================================
-- INTEGRA · Finanzas — indice para el sync con Xubio
--
-- Complemento de sql/centros_costo.sql. Correr una sola vez, DESPUES de aquel.
--
-- La tabla ya tiene unico sobre (empresa, lower(nombre)), que es la clave con
-- la que el sync engancha las filas cargadas a mano. Este indice agrega la otra
-- mitad: que no puedan entrar dos filas con el mismo centro de costo de Xubio.
--
-- Es parcial (WHERE xubio_id is not null) para que las filas manuales, que
-- todavia no tienen xubio_id, no choquen entre si.
-- ============================================================

create unique index if not exists ux_centros_costo_xubio
  on public.centros_costo (empresa, xubio_id)
  where xubio_id is not null;
