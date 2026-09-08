// Edge Function: sync-tipo-cambio-oficial
//
// Trae el dolar oficial (BNA) y lo guarda en public.tipo_cambio, una fila
// por dia. Dos modos, un solo endpoint:
//
//   - Diario (default, sin body o {}): trae el valor de HOY de
//     dolarapi.com. Se invoca sola: sql/tipo_cambio.sql programa un cron
//     (pg_cron + pg_net) que la llama todos los dias a las 18:05 ART.
//   - Backfill ({backfill: true}): trae la SERIE HISTORICA de
//     api.argentinadatos.com desde BACKFILL_DESDE (2026-01-01, cuando
//     arranca el negocio en la base) y la vuelca. Se invoca a mano, una vez
//     (o cuando haga falta re-traer algo).
//
// Son dos APIs porque dolarapi.com no ofrece historico —solo "el oficial de
// hoy"— y argentinadatos.com no ofrece "solo hoy" sin traer todo el JSON.
// Son el mismo proyecto (ArgentinaDatos) y dan el mismo numero en las
// fechas que se pisan: verificado a mano el 2026-09-08, compra 1480 / venta
// 1530 en ambas para el mismo dia. Se usa la liviana para el dia a dia y la
// pesada solo para poblar el pasado.
//
// Ninguna de las dos pide auth ni tiene limite de uso publicado para este
// volumen (una llamada diaria, y el backfill se corre a mano contadas
// veces). Si dolarapi.com deja de responder un dia, el cron simplemente no
// escribe esa fecha: fn_tc_oficial_mes() sigue devolviendo el ultimo valor
// conocido del mes en vez de romper nada.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DOLARAPI_URL = "https://dolarapi.com/v1/dolares/oficial";
const FUENTE_DIARIA = "dolarapi.com/oficial";

const ARGENTINADATOS_URL = "https://api.argentinadatos.com/v1/cotizaciones/dolares/oficial";
const FUENTE_BACKFILL = "api.argentinadatos.com/oficial (backfill historico)";

// argentinadatos.com devuelve la serie completa desde 2011: mas de lo que
// Finanzas necesita. El negocio empieza a operar con esto en 2026
// (comercial.facturas arranca el 2026-01-03), asi que el backfill se corta
// ahi. Decision de Silvestre, 2026-09-08.
const BACKFILL_DESDE = "2026-01-01";

// Cuantas filas manda cada upsert. argentinadatos.com devuelve ~5700 filas
// (toda la serie desde 2011): un solo upsert con todas de una es mas fragil
// que varios de a poco, y esto no es un endpoint que se llame seguido.
const TAMANIO_LOTE = 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// dolarapi.com devuelve fechaActualizacion en UTC. La fecha de la fila tiene
// que ser la fecha de Argentina de ese instante, no la de UTC: una
// actualizacion a las 21:30 UTC ya es el dia siguiente en Buenos Aires
// (UTC-3) recien pasada la medianoche, pero el BNA publica de dia, asi que
// en la practica esto solo importa para no correr un dia adelantado cerca
// de las 21-24hs UTC.
function fechaArgentina(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

async function sincronizarHoy(supabase: ReturnType<typeof createClient>) {
  const res = await fetch(DOLARAPI_URL, { headers: { "Accept": "application/json" } });
  if (!res.ok) {
    throw new Error(`dolarapi.com fallo: ${res.status} ${await res.text()}`);
  }
  const d = await res.json();

  const compra = Number(d.compra);
  const venta = Number(d.venta);
  if (!Number.isFinite(compra) || !Number.isFinite(venta) || !d.fechaActualizacion) {
    throw new Error(`Respuesta inesperada de dolarapi.com: ${JSON.stringify(d)}`);
  }

  const fecha = fechaArgentina(String(d.fechaActualizacion));

  const { error } = await supabase
    .from("tipo_cambio")
    .upsert(
      { fecha, compra, venta, fuente: FUENTE_DIARIA, actualizado_en: new Date().toISOString() },
      { onConflict: "fecha" },
    );
  if (error) throw error;

  return { ok: true, modo: "diario", fecha, compra, venta, fuente: FUENTE_DIARIA };
}

async function backfillHistorico(supabase: ReturnType<typeof createClient>) {
  const res = await fetch(ARGENTINADATOS_URL, { headers: { "Accept": "application/json" } });
  if (!res.ok) {
    throw new Error(`api.argentinadatos.com fallo: ${res.status} ${await res.text()}`);
  }
  const serie = await res.json();
  if (!Array.isArray(serie)) {
    throw new Error("Respuesta inesperada de api.argentinadatos.com (no es array)");
  }

  const ahora = new Date().toISOString();
  const filas = serie
    .map((r: Record<string, unknown>) => ({
      fecha: String(r.fecha ?? ""),
      compra: Number(r.compra),
      venta: Number(r.venta),
      fuente: FUENTE_BACKFILL,
      actualizado_en: ahora,
    }))
    .filter(
      (f) =>
        /^\d{4}-\d{2}-\d{2}$/.test(f.fecha) &&
        f.fecha >= BACKFILL_DESDE &&
        Number.isFinite(f.compra) &&
        Number.isFinite(f.venta),
    );

  let escritas = 0;
  for (let i = 0; i < filas.length; i += TAMANIO_LOTE) {
    const lote = filas.slice(i, i + TAMANIO_LOTE);
    const { error } = await supabase.from("tipo_cambio").upsert(lote, { onConflict: "fecha" });
    if (error) throw error;
    escritas += lote.length;
  }

  return {
    ok: true,
    modo: "backfill",
    recibidas: serie.length,
    escritas,
    omitidas: serie.length - filas.length,
    desde: filas[0]?.fecha ?? null,
    hasta: filas[filas.length - 1]?.fecha ?? null,
    fuente: FUENTE_BACKFILL,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { backfill = false } = await req.json().catch(() => ({}));

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const resultado = backfill
      ? await backfillHistorico(supabase)
      : await sincronizarHoy(supabase);

    return json(resultado, 200);
  } catch (e) {
    console.error("[sync-tipo-cambio-oficial]", e);
    return json({ error: String(e) }, 500);
  }
});

function json(b: unknown, status = 200): Response {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
