// Edge Function: sync-centros-costo-xubio
//
// Trae los centros de costo de Xubio (GET /centroDeCostoBean) y los espeja en
// la tabla centros_costo de Supabase.
//
// Sigue la misma estructura que sync-productos-xubio: mismo endpoint de token,
// mismos nombres de secretos, mismos headers CORS, misma forma de respuesta.
//
// Diferencias deliberadas respecto de sync-productos-xubio:
//
//   1. La reconciliacion NO es un upsert por clave. Primero busca por xubio_id
//      y si no lo encuentra cae a buscar por nombre normalizado. Eso permite
//      que las filas cargadas a mano ANTES de existir el sync (por ejemplo
//      "Golondrina de Mar") se completen con su xubio_id en lugar de
//      duplicarse.
//
//   2. Los centros nuevos entran con activo = false. La decision de que
//      aparezca en el desplegable de proyectos es local, no de Xubio: el
//      recurso centroDeCostoBean no tiene un campo de estado.
//
//   3. Nunca borra filas. Si un centro desaparece de Xubio, queda en la tabla
//      y se puede desactivar a mano. Borrar podria romper proyectos que ya lo
//      tengan asignado.
//
// Se invoca on-demand desde el boton "Sincronizar desde Xubio" en la pantalla
// Centros de costo de finanzas-app.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const XUBIO_BASE = "https://xubio.com/API/1.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Solo PL Offshore, a proposito.
//
// En Xubio cada empresa es una cuenta separada, y el client-id da acceso a una
// sola. Ese es el limite real del alcance: con estas credenciales,
// /centroDeCostoBean no puede devolver centros de otra empresa.
//
// sync-productos-xubio tambien contempla terra_mare. Aca no se incluye porque
// no sabemos con que texto estan grabadas las filas de esa empresa en las
// tablas proyectos / centros_costo, y un mapeo adivinado escribiria filas con
// una empresa que no existe. Cuando haga falta, se agrega con el valor
// confirmado, aca y en EMPRESA_EN_TABLA.
const XUBIO_CREDS: Record<string, { clientId: string; secretId: string }> = {
  pl_offshore: {
    clientId: Deno.env.get("XUBIO_PL_CLIENT_ID") ?? "",
    secretId: Deno.env.get("XUBIO_PL_SECRET_ID") ?? "",
  },
};

// OJO: hay dos vocabularios de empresa conviviendo en la misma base.
//
//   - Las funciones de Xubio y la tabla xubio_productos usan "pl_offshore".
//   - Las tablas proyectos y centros_costo usan "Parana Logistica".
//
// Este mapa es el puente. El dia del rename pendiente
// (Parana Logistica -> PL Offshore) se cambia el valor de la derecha aca y en
// el UPDATE de las tablas, igual que la constante EMPRESA de App.jsx.
const EMPRESA_EN_TABLA: Record<string, string> = {
  pl_offshore: "Parana Logistica",
};

async function getToken(clientId: string, secretId: string): Promise<string> {
  const basic = btoa(`${clientId}:${secretId}`);
  const res = await fetch(`${XUBIO_BASE}/TokenEndpoint`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Auth Xubio fallo: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

// El swagger de Xubio declara para CentroDeCostoBean tanto "ID" como "id", y
// para productos el campo real resulto ser "productoid". No hay forma de saber
// de antemano cual llega, asi que probamos todas y logueamos la primera fila
// cruda para poder fijar el nombre despues del primer run.
function idDeXubio(c: Record<string, unknown>): string | null {
  const candidatos = [
    "centroDeCostoId",
    "centrodecostoid",
    "centroCostoId",
    "ID",
    "id",
  ];
  for (const k of candidatos) {
    const v = c[k];
    if (v !== null && v !== undefined && String(v).trim() !== "") return String(v);
  }
  return null;
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { empresa = "pl_offshore" } = await req.json().catch(() => ({}));

    const cred = XUBIO_CREDS[empresa];
    if (!cred?.clientId) {
      return json({ error: `Empresa sin credenciales: ${empresa}` }, 400);
    }

    const empresaTabla = EMPRESA_EN_TABLA[empresa];
    if (!empresaTabla) {
      return json({ error: `Empresa sin mapeo a la tabla: ${empresa}` }, 400);
    }

    // 1) token
    const token = await getToken(cred.clientId, cred.secretId);

    // 2) traer centros de costo de Xubio
    const ccRes = await fetch(`${XUBIO_BASE}/centroDeCostoBean`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json",
      },
    });
    if (!ccRes.ok) {
      throw new Error(`Xubio GET centros fallo: ${ccRes.status} ${await ccRes.text()}`);
    }
    const centrosXubio = await ccRes.json();
    if (!Array.isArray(centrosXubio)) {
      throw new Error("Respuesta inesperada de Xubio (no es array)");
    }

    // Para poder fijar el nombre del campo ID despues del primer run.
    if (centrosXubio.length > 0) {
      console.log(
        "[sync-centros-costo-xubio] forma de la primera fila:",
        JSON.stringify(centrosXubio[0]),
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 3) leer lo que ya tenemos, para reconciliar en lugar de duplicar
    const { data: existentes, error: errLeer } = await supabase
      .from("centros_costo")
      .select("id, nombre, codigo, xubio_id")
      .eq("empresa", empresaTabla);
    if (errLeer) throw errLeer;

    const porXubioId = new Map<string, typeof existentes[number]>();
    const porNombre = new Map<string, typeof existentes[number]>();
    for (const fila of existentes ?? []) {
      if (fila.xubio_id) porXubioId.set(String(fila.xubio_id), fila);
      porNombre.set(norm(fila.nombre), fila);
    }

    let creados = 0;
    let vinculados = 0; // fila que ya existia y recien ahora recibe su xubio_id
    let actualizados = 0;
    const omitidos: string[] = [];

    for (const c of centrosXubio) {
      const xid = idDeXubio(c);
      const nombre = String(c.nombre ?? "").trim();

      if (!xid || !nombre) {
        omitidos.push(JSON.stringify(c));
        continue;
      }

      const codigo = c.codigo === null || c.codigo === undefined
        ? null
        : String(c.codigo).trim() || null;

      // Primero por xubio_id (la identidad fuerte), despues por nombre (para
      // enganchar las filas cargadas a mano antes de que existiera el sync).
      const previa = porXubioId.get(xid) ?? porNombre.get(norm(nombre));

      if (!previa) {
        const { error } = await supabase.from("centros_costo").insert([{
          empresa: empresaTabla,
          nombre,
          codigo,
          xubio_id: xid,
          activo: false, // lo activa una persona, no Xubio
        }]);
        if (error) throw error;
        creados++;
        continue;
      }

      // No tocamos `activo`: es una decision local.
      const eraHuerfana = !previa.xubio_id;
      const { error } = await supabase
        .from("centros_costo")
        .update({ nombre, codigo, xubio_id: xid })
        .eq("id", previa.id);
      if (error) throw error;

      if (eraHuerfana) vinculados++;
      else actualizados++;
    }

    if (omitidos.length > 0) {
      console.warn(
        `[sync-centros-costo-xubio] ${omitidos.length} centro(s) omitido(s) por venir sin id o sin nombre:`,
        omitidos.join(" | "),
      );
    }

    return json({
      ok: true,
      empresa,
      empresaTabla,
      recibidos: centrosXubio.length,
      creados,
      vinculados,
      actualizados,
      omitidos: omitidos.length,
    }, 200);
  } catch (e) {
    console.error("[sync-centros-costo-xubio]", e);
    return json({ error: String(e) }, 500);
  }
});

function json(b: unknown, status = 200): Response {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
