// ============================================================
// INTEGRA · FINANZAS — PL Offshore
// Centros de costo, Consolidado y el Tablero de Control del área.
// La pantalla de Proyectos se sacó de este módulo: la tabla maestra
// `proyectos` y su curaduría (centro_costo, presupuesto_total,
// visible_modulos) siguen en la base sin cambios, simplemente ya no
// tienen interfaz acá. Ver sql/proyectos_desde_comercial.sql.
// Estética: INTEGRA Brand Book v1.0 (misma que projects-app).
// ============================================================

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "./supabaseClient";

// ============================================================
// CONSTANTES
// ============================================================

const PORTAL_URL = "https://erp-portal-fawn.vercel.app/";
const VERSION = "FINANZAS v1.0";

// Valor exacto con el que están grabados los proyectos en Supabase.
// El día del rename Parana Logistica -> PL Offshore se cambia acá
// y con un UPDATE en la tabla. Un solo lugar.
const EMPRESA = "Parana Logistica";
const EMPRESA_DISPLAY = "PL Offshore";

// Las Edge Functions de Xubio identifican la empresa con este slug, distinto
// del valor con el que estan grabadas las filas (ver EMPRESA arriba).
// Convencion tomada de sync-productos-xubio en compras-app.
const EMPRESA_XUBIO = "pl_offshore";

// Las ocho empresas del grupo. La lista esta cerrada a proposito, igual que
// el check de public.tablero_temas: un nombre mal tipeado ("Parana Port" sin
// acento) abriria un noveno grupo en el tablero que parece una empresa y no
// lo es.
//
// Agregar una empresa son DOS lugares y los dos hay que tocar: esta
// constante y el check de la tabla. El alter esta al final de
// sql/tablero_temas.sql. Si se toca solo el check, la empresa no aparece en
// el desplegable; si se toca solo esto, el insert falla.
const EMPRESAS_GRUPO = [
  "Paraná Logística",
  "Clean Sea",
  "Terra Mare Services",
  "Paraná Port",
  "Fagal",
  "Terra Mare",
  "HF Offshore Argentina",
  "Petro Trader",
];

// En minuscula en la base —como el resto de los estados del esquema— y
// capitalizadas en pantalla. El orden es el de la reunion: alta primero.
const PRIORIDADES = ["alta", "media", "baja"];
const PRIORIDAD_LABEL = { alta: "Alta", media: "Media", baja: "Baja" };

// Los módulos que pueden llegar a mostrar un centro de costo en su propio
// desplegable. Lista cerrada, igual que EMPRESAS_GRUPO: coincide con el
// check de sql/centros_costo_modulos.sql, y agregar uno nuevo es tocar los
// dos lugares. Ninguno de los cinco está conectado todavía —es curaduría
// para cuando Fede los enganche—, así que hoy no rompe nada tocar esta
// lista.
const MODULOS_CENTRO_COSTO = [
  { id: "compras", label: "Compras" },
  { id: "viveres", label: "Víveres" },
  { id: "reparaciones", label: "Reparaciones" },
  { id: "hsqe", label: "HSQE" },
  { id: "comercial", label: "Comercial" },
];

const NAV = [
  { id: "tablero", label: "Tablero de Control" },
  { id: "consolidado", label: "P&L" },
  { id: "tipo_cambio", label: "Tipo de cambio" },
  { id: "carga_manual", label: "Carga Manual" },
  { id: "centros", label: "Centros de costo" },
];

// Numeros en Saira 900 en lugar de iconos. El design system no define
// iconografia y la ausencia es deliberada: la marca sustituye iconos por
// numeracion, tipografia y color. La alternativa que contempla —Lucide con
// stroke 1.5— la tiene que aprobar Marketing Corporativo, asi que no se usa.
//
// La numeracion corre sobre todo el menu: es un indice de secciones. Se
// deriva de NAV para que agregar una pantalla no obligue a renumerar a mano.
const NAV_NUM = Object.fromEntries(
  NAV.map((it, i) => [it.id, String(i + 1).padStart(2, "0")])
);

const SECCIONES = {
  tablero: {
    titulo: "Tablero de Control",
    sub: "Los temas del área para la revisión semanal. Se agrupan por empresa, prioridad, responsable o fecha de vencimiento.",
  },
  centros: {
    titulo: "Centros de costo",
    sub: "Lista maestra de centros de costo de la empresa.",
  },
  tipo_cambio: {
    titulo: "Tipo de cambio",
    sub: "El oficial (BNA) que usa el P&L para convertir lo que no está en dólares. Se actualiza solo, todos los días.",
  },
  carga_manual: {
    titulo: "Carga Manual",
    sub: "Voyage Costs, Vessel OPEX, SG&A e ingresos de Astillero, a mano, hasta que se conecte una fuente automática (cost-tracker o la planilla).",
  },
  consolidado: {
    titulo: "P&L",
    sub: "La facturación de Comercial, en USD Oficial, por mes, centro de costo y proyecto.",
  },
};

// ============================================================
// CAPA API
// ============================================================

const api = {
  async getPerfil(userId) {
    const { data, error } = await supabase
      .from("perfiles")
      .select("nombre, email")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  // --- P&L · ingresos -------------------------------------------------
  // v_fin_ingresos_mensual (sql/ingresos_desde_comercial.sql) ya agrega por
  // mes, centro de costo y proyecto. Acá solo se filtra por empresa y se
  // trae todo: el corte por año, centro de costo o proyecto lo arma
  // PagePL en el cliente, porque son pocas filas (una por mes x buque x
  // proyecto x moneda) y así no hay que ir a buscar de nuevo cada vez que
  // se cambia el filtro.
  async listIngresosMensual() {
    const { data, error } = await supabase
      .from("v_fin_ingresos_mensual")
      .select(
        "mes, moneda, centro_costo, comercial_proyecto_id, nro_proyecto, proyecto, facturas, importe, comision, neto, importe_usd, comision_usd, neto_usd"
      )
      .eq("empresa_facturadora", EMPRESA)
      .order("mes", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  // El P&L completo: ingresos (de Comercial) + costos (de pl_movimientos,
  // vacía hasta que se carguen) en una sola forma — ver
  // sql/pl_movimientos.sql. No filtra por empresa: hoy todo lo que hay en
  // la base es Parana Logistica/PL Offshore (son el mismo valor), así que
  // agregar el filtro no cambiaría nada y sí ataría la vista a esa
  // columna, que v_pl_mensual ni siquiera expone.
  async listPLMensual() {
    const { data, error } = await supabase
      .from("v_pl_mensual")
      .select("mes, segmento, centro_costo_id, centro_costo, categoria, subcategoria, monto_usd")
      .order("mes", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  // --- Carga manual de costos -------------------------------------------
  // pl_movimientos (sql/pl_movimientos.sql) es la tabla de la que sale
  // todo el P&L salvo la Facturación. Hasta que exista una conexión real
  // con cost-tracker o con la planilla, esto es lo único que la llena.

  async listPlanDeCuentas() {
    const { data, error } = await supabase
      .from("plan_de_cuentas")
      .select("id, cuenta, categoria, subcategoria")
      .eq("activa", true)
      .order("categoria", { ascending: true })
      .order("cuenta", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  // Trae de a lotes de `limite`: no hace falta paginar todavia (la tabla
  // arranca vacía), pero el limite evita traer de más el día que tenga
  // miles de filas.
  async listPLMovimientos(limite = 300) {
    const { data, error } = await supabase
      .from("pl_movimientos")
      .select("id, fecha, centro_costo_id, cuenta_id, moneda, monto, descripcion, fuente, created_at")
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limite);
    if (error) throw error;
    return data ?? [];
  },

  async crearPLMovimiento(mov) {
    const { error } = await supabase.from("pl_movimientos").insert({
      fecha: mov.fecha,
      centro_costo_id: mov.centroCostoId,
      cuenta_id: mov.cuentaId,
      moneda: mov.moneda,
      monto: Number(mov.monto),
      descripcion: mov.descripcion?.trim() || null,
    });
    if (error) throw error;
  },

  async borrarPLMovimiento(id) {
    const { error } = await supabase.from("pl_movimientos").delete().eq("id", id);
    if (error) throw error;
  },

  // --- Centros de costo ---------------------------------------
  // Tabla maestra propia de Finanzas.
  // La columna xubio_id queda reservada para mapear contra Xubio.

  async listCentrosCosto() {
    const { data, error } = await supabase
      .from("centros_costo")
      .select("id, codigo, nombre, activo, xubio_id, visible_modulos, segmento")
      .eq("empresa", EMPRESA)
      .order("nombre", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async borrarCentroCosto(id) {
    const { error } = await supabase.from("centros_costo").delete().eq("id", id);
    if (error) throw error;
  },

  // Activa o desactiva varios centros en una sola consulta. El estado activo
  // es una decision local, y Xubio no lo administra.
  async setActivoCentros(ids, activo) {
    const { error } = await supabase
      .from("centros_costo")
      .update({ activo })
      .in("id", ids);
    if (error) throw error;
  },

  // A que modulos se les muestra cada centro de costo. Es un array por fila
  // (un centro puede estar publicado en Compras y no en Comercial), asi que
  // no alcanza un UPDATE con un valor fijo como setActivoCentros: hace falta
  // agregar o sacar UN elemento sin pisar el resto. Por eso es una RPC
  // (sql/centros_costo_modulos.sql) y no un .update() directo.
  async setModuloCentros(ids, modulo, mostrar) {
    const { error } = await supabase.rpc("fn_centros_costo_set_modulo", {
      p_ids: ids,
      p_modulo: modulo,
      p_mostrar: mostrar,
    });
    if (error) throw error;
  },

  // A que segmento del P&L pertenece (buque / astillero / corporativo).
  // segmento=null es un estado valido a proposito (ver
  // sql/plan_de_cuentas.sql): "todavia sin confirmar", no un error.
  async setSegmentoCentro(id, segmento) {
    const { error } = await supabase
      .from("centros_costo")
      .update({ segmento })
      .eq("id", id);
    if (error) throw error;
  },

  // Dispara la Edge Function que espeja los centros de costo de Xubio.
  // La funcion reconcilia por xubio_id y, si no lo encuentra, por nombre:
  // asi las filas cargadas a mano reciben su xubio_id en lugar de duplicarse.
  async syncCentrosCostoXubio(empresa = EMPRESA_XUBIO) {
    const { data, error } = await supabase.functions.invoke(
      "sync-centros-costo-xubio",
      { body: { empresa } }
    );
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  },

  // --- Tipo de cambio -------------------------------------------------
  // public.tipo_cambio (sql/tipo_cambio.sql) se llena sola por cron todos
  // los dias a las 18:05 ART. Esto es solo lectura del historial mas el
  // disparador manual, para cuando alguien quiera forzar un refresco sin
  // esperar al cron.

  async listTipoCambio(limite = 400) {
    const { data, error } = await supabase
      .from("tipo_cambio")
      .select("fecha, compra, venta, fuente, actualizado_en")
      .order("fecha", { ascending: false })
      .limit(limite);
    if (error) throw error;
    return data ?? [];
  },

  // backfill=true trae la serie historica completa desde que arranca el
  // negocio (2026-01-01, ver supabase/functions/sync-tipo-cambio-oficial)
  // en vez del oficial de hoy. Piso por fecha, asi que repetirlo no duplica.
  async syncTipoCambioOficial(backfill = false) {
    const { data, error } = await supabase.functions.invoke(
      "sync-tipo-cambio-oficial",
      { body: { backfill } }
    );
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  },

  // --- El tablero de temas -------------------------------------------------

  // Por creado_en y no por nombre: dentro de un grupo el orden de carga es
  // el unico que no se mueve solo cuando alguien renombra un tema. El orden
  // que se ve en pantalla lo decide el agrupador.
  async listTemas() {
    const { data, error } = await supabase
      .from("tablero_temas")
      .select(
        "id, nombre, empresa, prioridad, responsable, vence_el, realizado, creado_en, actualizado_en"
      )
      .order("creado_en", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async crearTema({ nombre, empresa, prioridad, responsable, vence_el }) {
    const { data, error } = await supabase
      .from("tablero_temas")
      .insert({
        nombre: String(nombre).trim(),
        empresa,
        prioridad,
        responsable: responsable?.trim() || null,
        vence_el: vence_el || null,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data;
  },

  // actualizado_en lo pisa la app: la tabla no tiene trigger, a proposito.
  // Es el dato que contesta "que se movio desde la reunion pasada".
  async actualizarTema(id, cambios) {
    const { error } = await supabase
      .from("tablero_temas")
      .update({ ...cambios, actualizado_en: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  },

  async borrarTema(id) {
    const { error } = await supabase
      .from("tablero_temas")
      .delete()
      .eq("id", id);
    if (error) throw error;
  },
};

// ============================================================
// HELPERS
// ============================================================

function fmtFecha(iso) {
  if (!iso) return "—";
  const p = String(iso).slice(0, 10).split("-");
  if (p.length !== 3) return "—";
  return `${p[2]}/${p[1]}/${p[0]}`;
}

// Dias de hoy a `iso` (negativo si ya pasó). Se parsea a mano y no con
// `new Date(iso)` porque esa forma la interpreta como UTC medianoche: en un
// huso al oeste de Greenwich (Argentina) resta un dia y "hoy" da vencido un
// dia antes de tiempo.
function diasHasta(iso) {
  if (!iso) return null;
  const p = String(iso).slice(0, 10).split("-").map(Number);
  if (p.length !== 3 || p.some(Number.isNaN)) return null;
  const fecha = new Date(p[0], p[1] - 1, p[2]);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.round((fecha - hoy) / 86400000);
}

// Los baldes de la vista "Por fecha" del tablero. Vencido primero: es lo
// mas urgente, igual que Alta encabeza la vista por prioridad. El corte de
// 7 y 30 dias es a ojo —una semana y un mes de calendario—, no una regla
// del negocio.
const BALDES_FECHA = ["Vencido", "Esta semana", "Este mes", "Más adelante", "Sin fecha"];
function baldeFecha(t) {
  const d = diasHasta(t.vence_el);
  if (d === null) return "Sin fecha";
  if (d < 0) return "Vencido";
  if (d <= 7) return "Esta semana";
  if (d <= 30) return "Este mes";
  return "Más adelante";
}

function mensajeError(err) {
  const msg = err?.message ?? String(err ?? "Error desconocido");
  if (msg.includes("ux_centros_costo_nombre"))
    return "Ya existe un centro de costo con ese nombre.";
  if (msg.includes("centros_costo"))
    return "Falta crear la tabla centros_costo en Supabase. Corré sql/centros_costo.sql.";
  if (msg.includes("violates foreign key"))
    return "El registro tiene datos asociados.";
  return msg;
}

// ============================================================
// CSS · INTEGRA Brand Book v1.0
// ============================================================

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Saira:wght@500;600;700;800;900&family=Archivo:wght@400;500;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

/*  TOKENS · paleta del PL Offshore Design System, que es normativo: cuando el
    sistema y una convención genérica de diseño difieren, gana el sistema.
    Navy corporativo #002247 dominante (~70%), blanco (~20%) y amarillo
    #FBBC05 de acento puntual (~10%), nunca como fondo de un bloque grande.
    Gris técnico #5B6671 para texto secundario y datos, negro institucional
    #0B0F14 para el cuerpo.  */
:root{
  --navy:#002247;--navy-deep:#001327;--navy-mid:#001A38;
  --blue:#002247;--mid:#5B6671;--light:#D8DEE4;
  --bg:#FAFBFC;--surface:#FFFFFF;--surface2:#F4F6F8;--surface3:#E4E8EC;
  /* Un solo color de borde, 1px, como manda el sistema. */
  --border:#D8DEE4;--border2:#D8DEE4;
  --text:#0B0F14;--muted:#5B6671;--muted2:#8A939C;
  --amarillo:#FBBC05;--amarillo-press:#E0A800;
  --accent:#002247;--accent2:#0E7A5F;--warn:#8F5A0B;--danger:#B3261E;
  /* --mono ya no es monoespaciada: es la Saira en mayúscula con la que están
     hechas las etiquetas y los eyebrows. Los números de las tablas usan
     .td-mono, que es la que aporta las cifras tabulares. */
  --mono:'Saira',sans-serif;--display:'Saira',sans-serif;
  --sans:'Archivo',Arial,sans-serif;--r:2px;
  --nav:#002247;--action:#002247;--action-press:#001327;
  --tr:color 120ms cubic-bezier(.2,0,.38,.9),background-color 120ms cubic-bezier(.2,0,.38,.9),border-color 120ms cubic-bezier(.2,0,.38,.9);
}
/* La instancia ya no cambia nada: el módulo es de PL Offshore y la paleta de
   arriba es la suya. Se deja declarado para no romper el atributo del layout. */
[data-instance="pl-offshore"]{--nav:#002247;--action:#002247;--blue:#002247;--accent:#002247}

/* Desviación consciente del sistema, la misma que ya tomó Comercial: el
   sistema define Body 13/1.55 y acá va 15. Esa escala está pensada para piezas
   documentales —decks, A4, one-pagers—, no para una pantalla de carga de datos
   que se mira de cerca varias horas por día. Por el mismo motivo los campos de
   formulario van en 14px. El resto de la escala —H1, eyebrow, KPI— sigue al
   sistema al pie de la letra. */
body{background:var(--bg);color:var(--text);font-family:var(--sans);font-size:15px;line-height:1.55;min-height:100vh;overflow-x:hidden}
/* Foco amarillo con 2px de offset, y hover de enlaces navy -> amarillo. Los
   .btn quedan afuera del hover: tienen el suyo. */
*:focus-visible{outline:2px solid var(--amarillo);outline-offset:2px}
a{color:inherit;text-decoration:none}
a:not(.btn):hover{color:var(--amarillo)}

/*  BARRA SUPERIOR · 56px navy  */
.appbar{height:56px;background:var(--nav);display:flex;align-items:center;gap:24px;padding:0 24px;flex:0 0 auto}
.appbar-iso{height:26px;width:auto;object-fit:contain;display:block;flex:0 0 auto}
.appbar-div{width:1px;height:24px;background:rgba(255,255,255,.14);flex:0 0 auto}
.appbar-instance{font:500 14px/1.2 var(--sans);color:#fff;white-space:nowrap;flex:0 0 auto}
.appbar-tools{margin-left:auto;display:flex;align-items:center;gap:16px}
.appbar-avatar{width:28px;height:28px;border-radius:var(--r);background:rgba(255,255,255,.14);color:#fff;font-family:var(--mono);font-size:12px;font-weight:500;line-height:28px;text-align:center;flex:0 0 auto}
.appbar-user{font:500 13px/1.25 var(--sans);color:#fff;white-space:nowrap}
.appbar-link{background:none;border:0;padding:0;cursor:pointer;font:500 13px/1.2 var(--sans);color:rgba(255,255,255,.86);white-space:nowrap}
.appbar-link:hover{color:#fff;text-decoration:underline}

/*  ARMAZÓN  */
.shell{display:grid;grid-template-columns:248px minmax(0,1fr);align-items:stretch;min-height:calc(100vh - 56px)}
.shell.is-collapsed{grid-template-columns:68px minmax(0,1fr)}
.sidebar{background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;min-width:0}
.sidebar-header{border-bottom:1px solid var(--border);padding:16px;display:flex;align-items:center;gap:12px;min-height:69px}
.sidebar-logo-img{width:32px;height:32px;object-fit:contain;flex:0 0 auto}
.sidebar-logo-main{font:600 15px/1.3 var(--sans);color:var(--navy)}
.sidebar-logo-sub{font-family:var(--mono);font-size:11px;font-weight:600;color:var(--muted);letter-spacing:.12em;text-transform:uppercase;margin-top:2px}
.sidebar-nav{flex:1;padding:12px 0;overflow-y:auto}
.ni{display:flex;align-items:center;gap:12px;width:100%;padding:9px 16px 9px 13px;background:transparent;border:0;border-left:3px solid transparent;cursor:pointer;text-align:left;font:400 14px/1.3 var(--sans);color:var(--muted);transition:var(--tr);min-height:38px}
.ni:hover{background:var(--surface2);color:var(--navy)}
.ni.active{background:var(--surface2);border-left-color:var(--amarillo);color:var(--navy);font-weight:500}
/* El sistema no admite iconografía: el número de sección, en Saira 900, ocupa
   el lugar que tenía el icono. */
.ni-num{display:block;flex:0 0 auto;width:20px;font-family:var(--display);font-size:12px;font-weight:900;letter-spacing:.06em;color:var(--muted2);font-variant-numeric:tabular-nums}
.ni.active .ni-num{color:var(--amarillo)}
.ni-label{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sidebar-foot{border-top:1px solid var(--border);padding:12px 8px;display:flex;flex-direction:column;gap:2px}
.sidebar-foot-btn{display:flex;align-items:center;gap:12px;width:100%;padding:9px 10px;background:none;border:0;border-radius:var(--r);cursor:pointer;font:500 13px/1.2 var(--sans);color:var(--muted);transition:var(--tr)}
.sidebar-foot-btn:hover{background:var(--surface2);color:var(--navy)}
/* El chevron de colapsar, en la misma caja que los números de sección. */
.sidebar-foot-ico{display:block;flex:0 0 auto;width:20px;text-align:center;font-family:var(--display);font-size:13px;font-weight:900;color:var(--muted2)}
.sidebar-foot-meta{padding:8px 10px 0;font-family:var(--mono);font-size:11px;font-weight:600;line-height:1.6;letter-spacing:.12em;color:var(--muted2)}
.shell.is-collapsed .sidebar-header{justify-content:center;padding:16px 8px}
.shell.is-collapsed .ni{justify-content:center;padding:9px 8px 9px 5px}
.shell.is-collapsed .sidebar-foot-btn{justify-content:center}

.main{display:flex;flex-direction:column;min-width:0}
.pagehead{background:var(--surface);border-bottom:1px solid var(--border);padding:16px 24px;flex:0 0 auto}
.crumb{display:flex;align-items:center;gap:8px;font:400 13px/1.2 var(--sans);color:var(--muted)}
.crumb button{background:none;border:0;padding:0;cursor:pointer;font:400 13px/1.2 var(--sans);color:var(--action)}
.crumb button:hover{text-decoration:underline;color:var(--navy)}
.crumb-current{color:var(--text)}
.pagehead-row{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-top:10px}
.pagehead h1{font:800 30px/1.05 var(--display);letter-spacing:-.01em;text-transform:uppercase;color:var(--navy);margin:0}
.pagehead p{font:400 13px/1.45 var(--sans);color:var(--muted);margin:6px 0 0;max-width:70ch}
.pagehead-actions{display:flex;gap:8px;flex:0 0 auto}
.content{flex:1;overflow-y:auto;overflow-x:hidden;padding:24px;background:var(--bg)}

/*  PANELES  */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:24px;margin-bottom:16px}
.card-pad0{padding:0}

/*  KPIs  */
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-bottom:24px}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:16px 18px;min-width:0}
.stat-label{font-family:var(--mono);font-size:10px;color:var(--muted);font-weight:600;letter-spacing:.1em;margin-bottom:8px;text-transform:uppercase}
.stat-value{font-family:var(--display);font-size:38px;font-weight:900;line-height:1.05;color:var(--navy);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.stat-value.sm{font-size:20px;line-height:1.4}

/*  TABLAS  */
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th{font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.18em;color:var(--muted);text-transform:uppercase;padding:10px 12px;text-align:left;border-bottom:2px solid var(--navy);white-space:nowrap;background:var(--surface)}
td{padding:12px;border-bottom:1px solid var(--border);vertical-align:middle}
tr:last-child td{border-bottom:none}
tr.is-visible td{background:var(--surface2)}
/* Los números de tabla: Archivo con cifras tabulares. Desde que --mono es
   Saira en mayúscula, es acá donde vive la alineación de las columnas. */
.td-mono{font-family:var(--sans);font-variant-numeric:tabular-nums;letter-spacing:.01em;white-space:nowrap}
.td-actions{white-space:nowrap;text-align:right}
.td-actions .btn+.btn{margin-left:8px}

/*  BADGES  */
.badge{display:inline-flex;align-items:center;font-family:var(--mono);font-size:11px;font-weight:600;padding:3px 8px;border-radius:3px;white-space:nowrap;letter-spacing:.12em;text-transform:uppercase}
.b-blue{background:#E6F1F2;color:#056D76;border:0}
.b-teal{background:#E8F3EF;color:#0E7A5F;border:0}
.b-gray{background:#F4F6F8;color:#4A5560;border:0}
.b-amber{background:#FBF1E3;color:#8F5A0B;border:0}
.b-red{background:#FAEAE8;color:#B3261E;border:0}
.badge-btn{border:0;cursor:pointer;font-family:var(--mono);transition:var(--tr)}
.badge-btn:hover{filter:brightness(.96)}
.badge-btn:disabled{cursor:not-allowed;opacity:.6}

/*  BOTONES · un solo primario por vista  */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-family:var(--display);font-size:13px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;height:36px;padding:0 16px;border-radius:var(--r);border:1px solid transparent;cursor:pointer;transition:var(--tr);white-space:nowrap}
.btn-primary{background:var(--action);color:#fff}
.btn-primary:hover{background:var(--navy)}
.btn-primary:active{background:var(--action-press)}
.btn-ghost{background:var(--surface);color:var(--muted);border-color:var(--border2)}
.btn-ghost:hover{color:var(--text);background:var(--surface2)}
.btn-danger{background:var(--surface);color:var(--danger);border-color:var(--border2)}
.btn-danger:hover{background:#FAEAE8;border-color:var(--danger)}
/* El CTA amarillo: fondo #FBBC05 con texto navy. Nunca a ancho completo, que
   sería el amarillo como fondo de un bloque grande. */
.btn-amarillo{background:var(--amarillo);color:var(--navy)}
.btn-amarillo:hover{background:var(--amarillo-press)}
.btn-amarillo:active{background:#C99700}
.btn-sm{height:28px;padding:0 12px;font-size:13px}
.btn:disabled{background:var(--surface3);color:var(--muted2);border-color:transparent;cursor:not-allowed}

/*  AVISOS · borde izquierdo de 3px, sin fondos saturados  */
.note{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--border2);border-radius:var(--r);padding:12px 16px;font:400 13px/1.45 var(--sans);margin-bottom:16px}
.note strong{font-weight:600}
.note-err{border-left-color:var(--danger)}
.note-ok{border-left-color:var(--accent2)}
.note-info{border-left-color:var(--amarillo)}
.note-warn{border-left-color:var(--warn)}

/*  FORMULARIOS  */
.fg{display:flex;flex-direction:column;gap:6px;min-width:0}
.fg label{font-family:var(--mono);font-size:11px;color:var(--muted);letter-spacing:.18em;text-transform:uppercase;font-weight:600}
.fg input,.fg select,.fg textarea{background:var(--surface);border:1px solid var(--border2);border-radius:var(--r);color:var(--text);font-family:var(--sans);font-size:14px;height:36px;padding:0 12px;outline:none;transition:var(--tr);width:100%}
.fg textarea{resize:vertical;min-height:72px;height:auto;padding:10px 12px}
/* El foco es el outline amarillo del sistema, no un borde más grueso: así el
   campo no se mueve un pixel al enfocarse. */
.fg input:focus,.fg select:focus,.fg textarea:focus{border-color:var(--navy);outline:2px solid var(--amarillo);outline-offset:2px}
.fg .hint{font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--muted2)}
.form-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-bottom:16px}
.form-section{position:relative;font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.18em;color:var(--muted);text-transform:uppercase;margin:0 0 16px;padding-bottom:8px;border-bottom:1px solid var(--border)}
/* La regla amarilla de 64x3px debajo del título de sección, como la define el
   design system. */
.form-section::after{content:"";position:absolute;left:0;bottom:-2px;width:64px;height:3px;background:var(--amarillo)}
.form-ftr{display:flex;gap:8px;justify-content:flex-end;margin-top:24px;padding-top:16px;border-top:1px solid var(--border)}

/* --- Tablero de temas --- */
.tablero-barra{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:16px}
/* Segmentado y no dos botones: son dos formas de mirar lo mismo, no dos
   acciones. Y no puede haber dos .btn-primary en la pantalla. */
.seg{display:inline-flex;border:1px solid var(--border2);border-radius:var(--r);overflow:hidden}
.seg button{background:var(--surface);border:0;border-right:1px solid var(--border2);cursor:pointer;font-family:var(--display);font-size:12px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);height:32px;padding:0 14px;transition:var(--tr)}
.seg button:last-child{border-right:0}
.seg button:hover{background:var(--surface2);color:var(--navy)}
.seg button.on{background:var(--navy);color:#fff}
.grupo-tit{position:relative;display:flex;align-items:baseline;gap:10px;font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.18em;color:var(--navy);text-transform:uppercase;margin:0 0 12px;padding-bottom:8px;border-bottom:1px solid var(--border)}
.grupo-tit::after{content:"";position:absolute;left:0;bottom:-2px;width:64px;height:3px;background:var(--amarillo)}
.grupo-tit .cuenta{font-family:var(--sans);font-size:12px;font-weight:400;letter-spacing:0;text-transform:none;color:var(--muted2)}
/* El select de la celda: mas bajo que el del formulario, porque va dentro de
   una fila de tabla y no de un .fg. */
.sel-inline{background:var(--surface);border:1px solid var(--border2);border-radius:var(--r);color:var(--text);font-family:var(--sans);font-size:13px;height:30px;padding:0 8px;max-width:100%;outline:none;transition:var(--tr)}
.sel-inline:hover{border-color:var(--navy)}
.sel-inline:focus{border-color:var(--navy);outline:2px solid var(--amarillo);outline-offset:2px}
.sel-inline:disabled{background:var(--surface2);color:var(--muted);cursor:not-allowed}
tr.is-realizado td{color:var(--muted)}
/* Los recuadros de arriba del tablero, cuando filtran. El acento es la barra
   amarilla a la izquierda, igual que el item activo del menu: se marca el
   estado sin cambiar el tamano del recuadro ni moverlo de lugar. */
.stat-btn{display:block;width:100%;text-align:left;font-family:var(--sans);cursor:pointer;transition:var(--tr)}
.stat-btn:hover{border-color:var(--navy)}
.stat-btn.on{border-color:var(--navy);box-shadow:inset 3px 0 0 var(--amarillo)}

.empty{padding:48px 24px;text-align:center;color:var(--muted);font-size:14px}
.empty-mono{font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--muted2);margin-bottom:8px}

@media (max-width:900px){
  .form-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .stats{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width:768px){
  .shell,.shell.is-collapsed{grid-template-columns:1fr}
  .sidebar{display:none}
  .appbar{gap:12px;padding:0 16px}
  .appbar-instance,.appbar-user{display:none}
  .pagehead{padding:14px 16px}
  .pagehead-row{flex-direction:column;align-items:stretch;gap:12px}
  .content{padding:16px}
  .form-grid{grid-template-columns:1fr}
  .stats{grid-template-columns:1fr}
}
@media (prefers-reduced-motion: reduce){
  *{animation:none !important;transition:none !important}
}
`;

// ============================================================
// COMPONENTES
// ============================================================

function Note({ tipo, children }) {
  if (!children) return null;
  return <div className={`note note-${tipo}`}>{children}</div>;
}

function LoginPage() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  async function handleLogin() {
    setError(null);
    setCargando(true);
    try {
      const { error: e } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: pass,
      });
      if (e) throw e;
    } catch (err) {
      setError("No pudimos iniciar sesión. Revisá el mail y la contraseña.");
    } finally {
      setCargando(false);
    }
  }

  const handleKey = (e) => {
    if (e.key === "Enter") handleLogin();
  };

  const loginCSS = `
    @import url('https://fonts.googleapis.com/css2?family=Saira:wght@500;600;700;800;900&family=Archivo:wght@400;500;600&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    .login-page{min-height:100vh;display:grid;grid-template-columns:minmax(0,1fr) 560px;background:#FFFFFF;font-family:'Archivo',Arial,sans-serif;color:#0F1419;text-align:left}
    .login-left{display:flex;flex-direction:column;justify-content:space-between;gap:48px;padding:56px 64px;background:#002247}
    .login-left-integra-img{height:52px;width:auto;object-fit:contain;display:block}
    .login-left-divider{width:100%;height:1px;background:rgba(255,255,255,.14);margin:24px 0}
    .login-left-company{display:flex;align-items:center;gap:14px}
    .login-left-company-logo{width:40px;height:40px;border-radius:4px;object-fit:contain;background:rgba(255,255,255,.14);padding:4px}
    .login-left-company-name{font:600 24px/1.25 'Archivo',Arial,sans-serif;color:#fff}
    .login-left-line{width:56px;height:3px;background:#FBBC05;margin:24px 0}
    .login-left-sub{font:400 15px/1.55 'Archivo',Arial,sans-serif;color:rgba(255,255,255,.82);max-width:420px}
    .login-right{display:flex;align-items:center;justify-content:center;padding:56px 64px;background:#FFFFFF}
    .login-card{width:100%;max-width:420px}
    .login-card-eyebrow{font:500 11px/1.2 'Saira',sans-serif;letter-spacing:.18em;color:#4A5560;text-transform:uppercase;margin-bottom:12px}
    .login-card-title{font:600 24px/1.25 'Archivo',Arial,sans-serif;color:#082F4E;margin-bottom:8px}
    .login-card-sub{font:400 15px/1.55 'Archivo',Arial,sans-serif;color:#4A5560;margin-bottom:28px}
    .login-fg{display:flex;flex-direction:column;gap:6px;margin-bottom:16px}
    .login-fg label{font:500 11px/1.2 'Saira',sans-serif;color:#4A5560;letter-spacing:.18em;text-transform:uppercase}
    .login-fg input{width:100%;border:1px solid #C9D0D6;border-radius:4px;height:40px;padding:0 12px;font:400 14px/1.2 'Archivo',Arial,sans-serif;color:#0F1419;background:#FFFFFF;outline:none;transition:border-color 120ms cubic-bezier(.2,0,.38,.9)}
    .login-fg input::placeholder{color:#7A8792}
    .login-fg input:focus{border-color:#002247;outline:2px solid #FBBC05;outline-offset:2px}
    .login-btn{width:100%;height:44px;padding:0 16px;margin-top:24px;background:#FBBC05;color:#002247;border:none;border-radius:4px;font:600 15px/1.2 'Archivo',Arial,sans-serif;cursor:pointer;transition:background-color 120ms cubic-bezier(.2,0,.38,.9)}
    .login-btn:hover{background:#E0A800}
    .login-btn:disabled{background:#E4E8EC;color:#7A8792;cursor:not-allowed}
    .login-error{background:#FFFFFF;color:#0F1419;border:1px solid #E4E8EC;border-left:3px solid #B3261E;border-radius:4px;padding:12px 16px;font:400 13px/1.45 'Archivo',Arial,sans-serif;margin-bottom:16px}
    .login-footer{font:500 11px/1.2 'Saira',sans-serif;color:#4A5560;margin-top:32px;letter-spacing:.12em}
    .login-back{margin-top:12px;font:500 14px/1.2 'Archivo',Arial,sans-serif;color:#002247;cursor:pointer;background:none;border:0;padding:0}
    .login-back:hover{text-decoration:underline}
    @media(max-width:900px){
      .login-page{grid-template-columns:1fr}
      .login-left{padding:40px 24px;gap:32px}
      .login-left-integra-img{height:40px}
      .login-left-sub{max-width:100%}
      .login-right{padding:40px 24px}
    }
  `;

  return (
    <>
      <style>{loginCSS}</style>
      <div className="login-page">
        <div className="login-left">
          <div>
            <img
              src="/integra-logo-white-noclaim.svg"
              alt="INTEGRA"
              className="login-left-integra-img"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          </div>
          <div>
            <div className="login-left-divider" />
            <div className="login-left-company">
              <img
                src="/PL.png"
                alt={EMPRESA_DISPLAY}
                className="login-left-company-logo"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
              <div className="login-left-company-name">
                {EMPRESA_DISPLAY} | Finanzas
              </div>
            </div>
            <div className="login-left-line" />
            <div className="login-left-sub">We Find the Way, or We Make One.</div>
          </div>
        </div>

        <div className="login-right">
          <div className="login-card">
            <div className="login-card-eyebrow">{EMPRESA_DISPLAY} | Finanzas</div>
            <div className="login-card-title">Acceso al módulo</div>
            <div className="login-card-sub">Solo personal autorizado</div>
            {error && <div className="login-error">{error}</div>}
            <div className="login-fg">
              <label htmlFor="fin-email">Email</label>
              <input
                id="fin-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKey}
                placeholder="usuario@paranalogistica.com.ar"
                autoFocus
              />
            </div>
            <div className="login-fg">
              <label htmlFor="fin-pass">Contraseña</label>
              <input
                id="fin-pass"
                type="password"
                autoComplete="current-password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                onKeyDown={handleKey}
                placeholder="••••••••"
              />
            </div>
            <button
              className="login-btn"
              onClick={handleLogin}
              disabled={cargando || !email || !pass}
            >
              {cargando ? "Ingresando..." : "Ingresar →"}
            </button>
            <div className="login-footer">{EMPRESA_DISPLAY} · Acceso restringido</div>
            <button
              className="login-back"
              onClick={() => {
                window.location.href = PORTAL_URL;
              }}
            >
              ← Volver a Grupo PL
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ============================================================
// TABLERO DE CONTROL — los temas del area
//
// Pedido para la revision semanal con Juan: cada tema con su empresa y su
// prioridad, y poder mirarlo agrupado por una o por otra.
//
// Se edita en la propia fila, sin abrir un formulario: en una reunion de
// media hora, abrir y cerrar un modal por cada cambio de prioridad no se
// hace, y lo que no se hace no queda registrado.
//
// Los datos viven en public.tablero_temas (sql/tablero_temas.sql). No en el
// navegador: el tablero es de dos personas, y guardarlo local seria que Juan
// abra el modulo y vea otra cosa.
// ============================================================

function PageTablero() {
  const [temas, setTemas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [agrupar, setAgrupar] = useState("empresa");
  const [abierto, setAbierto] = useState(false);
  const [verRealizados, setVerRealizados] = useState(false);
  // Filtro que nace de los recuadros de arriba: null = todo. Se combina con
  // el agrupador, no lo reemplaza —"los Alta, agrupados por responsable" es
  // justo la pregunta de la reunion.
  const [filtro, setFiltro] = useState(null);
  const [alta, setAlta] = useState({
    nombre: "",
    empresa: EMPRESAS_GRUPO[0],
    prioridad: "media",
    responsable: "",
    vence_el: "",
  });

  const load = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setTemas(await api.listTemas());
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Un tema realizado sale del tablero activo: no se borra, se apaga. Asi
  // queda el historial de que se trato sin que la reunion siguiente tenga
  // que volver a mirarlo.
  const activos = useMemo(() => temas.filter((t) => !t.realizado), [temas]);
  const realizados = useMemo(() => temas.filter((t) => t.realizado), [temas]);

  const cuenta = useMemo(() => {
    const c = { alta: 0, media: 0, baja: 0 };
    for (const t of activos) if (c[t.prioridad] !== undefined) c[t.prioridad] += 1;
    return c;
  }, [activos]);

  const vencidos = useMemo(
    () => activos.filter((t) => baldeFecha(t) === "Vencido").length,
    [activos]
  );

  // Lo que se dibuja abajo. Los recuadros de arriba siguen contando sobre
  // `activos` y no sobre esto: si el filtro les cambiara el numero, apretar
  // "Alta" pondria los otros tres en cero y se perderia la referencia.
  const visibles = useMemo(() => {
    if (!filtro) return activos;
    if (filtro.tipo === "vencidos")
      return activos.filter((t) => baldeFecha(t) === "Vencido");
    return activos.filter((t) => t.prioridad === filtro.valor);
  }, [activos, filtro]);

  const filtroLabel = !filtro
    ? null
    : filtro.tipo === "vencidos"
    ? "Vencidos"
    : "Prioridad " + (PRIORIDAD_LABEL[filtro.valor] ?? filtro.valor);

  // Apretar el recuadro que ya esta activo lo apaga: el mismo boton prende y
  // suelta, asi no hace falta buscar donde se quita.
  function alternarFiltro(nuevo) {
    setFiltro((prev) =>
      prev && prev.tipo === nuevo.tipo && prev.valor === nuevo.valor
        ? null
        : nuevo
    );
  }

  const grupos = useMemo(() => {
    const peso = (t) => {
      const i = PRIORIDADES.indexOf(t.prioridad);
      return i < 0 ? PRIORIDADES.length : i;
    };

    // "Por responsable" no tiene lista fija: los grupos son los nombres que
    // efectivamente hay cargados. Es texto libre, asi que "Juan" y "juan "
    // serian dos grupos distintos —se normaliza el espacio al comparar, pero
    // no la capitalizacion: si alguien escribio dos variantes, mostrarlas
    // separadas es mas honesto que unificarlas y elegir una por el modelo.
    if (agrupar === "responsable") {
      const cmp = (a, b) =>
        peso(a) - peso(b) || a.nombre.localeCompare(b.nombre, "es");
      const de = (t) => (t.responsable ?? "").trim();

      const nombres = [...new Set(visibles.map(de).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "es")
      );

      const out = [];
      for (const nombre of nombres) {
        const filas = visibles.filter((t) => de(t) === nombre).sort(cmp);
        if (filas.length) out.push({ clave: nombre, filas });
      }

      // Al final y no primero: un tema sin dueño es lo que hay que repartir
      // en la reunion, pero el orden lo encabezan los que ya tienen alguien.
      const sinDueno = visibles.filter((t) => !de(t)).sort(cmp);
      if (sinDueno.length)
        out.push({ clave: "Sin responsable", filas: sinDueno });

      return out;
    }

    // "Por fecha" agrupa distinto a las otras dos: los baldes son fijos
    // (Vencido / Esta semana / Este mes / Más adelante / Sin fecha) y no
    // vienen de una constante de catálogo, así que no hay "sueltos": todo
    // tema cae en alguno de los cinco, con o sin vence_el.
    if (agrupar === "fecha") {
      const cmpFecha = (a, b) =>
        a.vence_el && b.vence_el
          ? a.vence_el.localeCompare(b.vence_el) ||
            a.nombre.localeCompare(b.nombre, "es")
          : a.nombre.localeCompare(b.nombre, "es");

      const out = [];
      for (const balde of BALDES_FECHA) {
        const filas = visibles.filter((t) => baldeFecha(t) === balde).sort(cmpFecha);
        if (filas.length) out.push({ clave: balde, filas });
      }
      return out;
    }

    const porEmpresa = agrupar === "empresa";
    const orden = porEmpresa ? EMPRESAS_GRUPO : PRIORIDADES;
    const clave = (t) => (porEmpresa ? t.empresa : t.prioridad);

    // Dentro de un grupo se ordena por el OTRO criterio: agrupado por
    // empresa, lo urgente queda arriba; agrupado por prioridad, los temas de
    // una misma empresa quedan juntos. `peso` está declarado más arriba: lo
    // comparten esta rama y la de responsable.
    const cmp = (a, b) =>
      porEmpresa
        ? peso(a) - peso(b) || a.nombre.localeCompare(b.nombre, "es")
        : a.empresa.localeCompare(b.empresa, "es") ||
          a.nombre.localeCompare(b.nombre, "es");

    // Los grupos vacios no se dibujan: la cuenta por prioridad ya esta
    // arriba, y ocho encabezados sin filas es ruido, no informacion.
    const out = [];
    for (const g of orden) {
      const filas = visibles.filter((t) => clave(t) === g).sort(cmp);
      if (filas.length) out.push({ clave: g, filas });
    }

    // Un valor fuera de la lista no se puede cargar desde esta pantalla,
    // pero si por SQL. Va al final en vez de desaparecer del tablero.
    const sueltos = visibles.filter((t) => !orden.includes(clave(t))).sort(cmp);
    if (sueltos.length)
      out.push({ clave: "Sin clasificar", filas: sueltos, huerfano: true });

    return out;
  }, [visibles, agrupar]);

  // Optimista: el select ya se movio en pantalla y esperar el round-trip para
  // reflejarlo se lee como que no tomo el cambio. Si la base lo rechaza, el
  // catch recarga y la fila vuelve a lo que dice la base.
  async function cambiar(tema, campo, valor) {
    if (tema[campo] === valor) return;
    setTemas((prev) =>
      prev.map((t) => (t.id === tema.id ? { ...t, [campo]: valor } : t))
    );
    setError(null);
    setOk(null);
    try {
      await api.actualizarTema(tema.id, { [campo]: valor });
    } catch (err) {
      setError(mensajeError(err));
      await load();
    }
  }

  // El responsable se guarda al salir del campo, no en cada tecla: es texto
  // libre, y llamar a la API en cada letra no aporta nada y multiplica los
  // round-trips. El "key" del input (mas abajo) lo remonta cuando cambia el
  // valor de la base, asi un guardado o un load() no dejan el campo
  // mostrando algo que ya no es cierto.
  async function guardarResponsable(tema, valorCrudo) {
    const valor = valorCrudo.trim() || null;
    if ((tema.responsable ?? null) === valor) return;
    setTemas((prev) =>
      prev.map((t) => (t.id === tema.id ? { ...t, responsable: valor } : t))
    );
    setError(null);
    setOk(null);
    try {
      await api.actualizarTema(tema.id, { responsable: valor });
    } catch (err) {
      setError(mensajeError(err));
      await load();
    }
  }

  async function agregar() {
    const nombre = alta.nombre.trim();
    if (!nombre) {
      setError("El tema necesita un nombre.");
      return;
    }
    setGuardando(true);
    setError(null);
    setOk(null);
    try {
      await api.crearTema({ ...alta, nombre });
      // Se limpian nombre, responsable y vencimiento, pero no la empresa ni
      // la prioridad: cuando se carga una tanda, suelen ser de la misma
      // empresa, y cada tema nuevo suele tener a alguien y una fecha
      // distintos.
      setAlta((prev) => ({ ...prev, nombre: "", responsable: "", vence_el: "" }));
      await load();
      setOk("Tema agregado.");
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(t) {
    const confirmado = window.confirm(
      "¿Borrar el tema “" + t.nombre + "”? No se puede recuperar."
    );
    if (!confirmado) return;
    setGuardando(true);
    setError(null);
    setOk(null);
    try {
      await api.borrarTema(t.id);
      setOk("Tema borrado.");
      await load();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) {
    return (
      <div className="card card-pad0">
        <div className="empty">
          <div className="empty-mono">Cargando</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Note tipo="err">{error}</Note>
      <Note tipo="ok">{ok}</Note>

      {/* Los recuadros son botones: filtran el tablero de abajo. El que esta
          aplicado queda marcado, y volver a apretarlo lo suelta. "Temas
          abiertos" es el sin-filtro, asi que esta marcado cuando no hay
          ninguno puesto. */}
      <div className="stats">
        {PRIORIDADES.map((p) => {
          const on = filtro?.tipo === "prioridad" && filtro.valor === p;
          return (
            <button
              key={p}
              className={`stat stat-btn ${on ? "on" : ""}`}
              aria-pressed={on}
              // El nombre del boton lo armaria el navegador con el texto de
              // adentro, pero queda como "Prioridad Alta 2": dos datos
              // pegados sin relacion. Dicho asi se entiende que hace.
              aria-label={`Filtrar por prioridad ${PRIORIDAD_LABEL[p]} (${cuenta[p]})`}
              onClick={() => alternarFiltro({ tipo: "prioridad", valor: p })}
            >
              <div className="stat-label">Prioridad {PRIORIDAD_LABEL[p]}</div>
              <div className="stat-value">{cuenta[p]}</div>
            </button>
          );
        })}
        <button
          className={`stat stat-btn ${filtro?.tipo === "vencidos" ? "on" : ""}`}
          aria-pressed={filtro?.tipo === "vencidos"}
          aria-label={`Filtrar por vencidos (${vencidos})`}
          onClick={() => alternarFiltro({ tipo: "vencidos" })}
        >
          <div className="stat-label">Vencidos</div>
          <div className="stat-value">{vencidos}</div>
        </button>
        <button
          className={`stat stat-btn ${!filtro ? "on" : ""}`}
          aria-pressed={!filtro}
          aria-label={`Ver todos los temas abiertos (${activos.length})`}
          onClick={() => setFiltro(null)}
        >
          <div className="stat-label">Temas abiertos</div>
          <div className="stat-value">{activos.length}</div>
        </button>
      </div>

      {filtro && (
        <Note tipo="info">
          Mostrando <strong>{filtroLabel}</strong>: {visibles.length} de{" "}
          {activos.length} temas abiertos.
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: 12, verticalAlign: "middle" }}
            onClick={() => setFiltro(null)}
          >
            Ver todos
          </button>
        </Note>
      )}

      <div className="tablero-barra">
        <div className="seg" role="group" aria-label="Agrupar el tablero">
          <button
            className={agrupar === "empresa" ? "on" : ""}
            aria-pressed={agrupar === "empresa"}
            onClick={() => setAgrupar("empresa")}
          >
            Por empresa
          </button>
          <button
            className={agrupar === "prioridad" ? "on" : ""}
            aria-pressed={agrupar === "prioridad"}
            onClick={() => setAgrupar("prioridad")}
          >
            Por prioridad
          </button>
          <button
            className={agrupar === "responsable" ? "on" : ""}
            aria-pressed={agrupar === "responsable"}
            onClick={() => setAgrupar("responsable")}
          >
            Por responsable
          </button>
          <button
            className={agrupar === "fecha" ? "on" : ""}
            aria-pressed={agrupar === "fecha"}
            onClick={() => setAgrupar("fecha")}
          >
            Por fecha
          </button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {realizados.length > 0 && (
            <button
              className="btn btn-ghost"
              onClick={() => setVerRealizados((v) => !v)}
            >
              {verRealizados
                ? "Ocultar realizados"
                : realizados.length === 1
                ? "Ver 1 realizado"
                : `Ver ${realizados.length} realizados`}
            </button>
          )}
          <button
            className="btn btn-ghost"
            onClick={() => {
              setAbierto((v) => !v);
              setError(null);
              setOk(null);
            }}
          >
            {abierto ? "Cancelar" : "Agregar tema"}
          </button>
        </div>
      </div>

      {abierto && (
        <div className="card">
          <div className="form-section">Tema nuevo</div>
          <div className="form-grid">
            <div className="fg">
              <label htmlFor="tema-nombre">Tema</label>
              <input
                id="tema-nombre"
                value={alta.nombre}
                maxLength={200}
                placeholder="De qué se trata"
                onChange={(e) => setAlta({ ...alta, nombre: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") agregar();
                }}
              />
            </div>
            <div className="fg">
              <label htmlFor="tema-empresa">Empresa</label>
              <select
                id="tema-empresa"
                value={alta.empresa}
                onChange={(e) => setAlta({ ...alta, empresa: e.target.value })}
              >
                {EMPRESAS_GRUPO.map((em) => (
                  <option key={em} value={em}>
                    {em}
                  </option>
                ))}
              </select>
            </div>
            <div className="fg">
              <label htmlFor="tema-prioridad">Prioridad</label>
              <select
                id="tema-prioridad"
                value={alta.prioridad}
                onChange={(e) => setAlta({ ...alta, prioridad: e.target.value })}
              >
                {PRIORIDADES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORIDAD_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="fg">
              <label htmlFor="tema-responsable">Responsable</label>
              <input
                id="tema-responsable"
                value={alta.responsable}
                maxLength={200}
                placeholder="Opcional"
                onChange={(e) =>
                  setAlta({ ...alta, responsable: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") agregar();
                }}
              />
            </div>
            <div className="fg">
              <label htmlFor="tema-vence">Vencimiento</label>
              <input
                id="tema-vence"
                type="date"
                value={alta.vence_el}
                onChange={(e) =>
                  setAlta({ ...alta, vence_el: e.target.value })
                }
              />
              <span className="hint">Opcional</span>
            </div>
          </div>
          <div className="form-ftr">
            <button
              className="btn btn-primary"
              onClick={agregar}
              disabled={guardando || !alta.nombre.trim()}
            >
              {guardando ? "Guardando" : "Agregar"}
            </button>
          </div>
        </div>
      )}

      {activos.length === 0 ? (
        <div className="card card-pad0">
          <div className="empty">
            <div className="empty-mono">
              {temas.length === 0 ? "Tablero vacío" : "Sin temas abiertos"}
            </div>
            {temas.length === 0
              ? "Todavía no hay temas cargados. Se agregan con el botón de arriba y quedan guardados para la próxima reunión."
              : "Todos los temas cargados están marcados como realizados."}
          </div>
        </div>
      ) : visibles.length === 0 ? (
        // Pasa al apretar un recuadro que marca cero: "Vencidos 0" es un
        // boton valido y tiene que contestar algo, no dejar la pantalla en
        // blanco.
        <div className="card card-pad0">
          <div className="empty">
            <div className="empty-mono">Ningún tema en {filtroLabel}</div>
            Hay {activos.length}{" "}
            {activos.length === 1 ? "tema abierto" : "temas abiertos"}, pero
            ninguno entra en este filtro.
          </div>
        </div>
      ) : (
        grupos.map((g) => (
          <div className="card" key={g.clave}>
            <div className="grupo-tit">
              <span>
                {agrupar === "prioridad" && !g.huerfano
                  ? PRIORIDAD_LABEL[g.clave]
                  : g.clave}
              </span>
              <span className="cuenta">
                {g.filas.length === 1 ? "1 tema" : g.filas.length + " temas"}
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>Hecho</th>
                    <th>Tema</th>
                    <th>Empresa</th>
                    <th>Responsable</th>
                    <th>Prioridad</th>
                    <th>Vence</th>
                    <th aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {/* Las dos columnas editables estan en las dos vistas,
                      incluida la que agrupa. Cambiar ahi la empresa de un
                      tema lo manda al grupo de al lado, que es justo la
                      operacion que se hace en la reunion. */}
                  {g.filas.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={false}
                          disabled={guardando}
                          aria-label={"Marcar realizado " + t.nombre}
                          onChange={() => cambiar(t, "realizado", true)}
                        />
                      </td>
                      <td>{t.nombre}</td>
                      <td>
                        <select
                          className="sel-inline"
                          value={t.empresa}
                          disabled={guardando}
                          aria-label={"Empresa de " + t.nombre}
                          onChange={(e) => cambiar(t, "empresa", e.target.value)}
                        >
                          {EMPRESAS_GRUPO.map((em) => (
                            <option key={em} value={em}>
                              {em}
                            </option>
                          ))}
                          {/* Un valor cargado por SQL fuera de las ocho: sin
                              esta opcion el select mostraria otro y daria a
                              entender un valor que no esta guardado. */}
                          {!EMPRESAS_GRUPO.includes(t.empresa) && (
                            <option value={t.empresa}>{t.empresa}</option>
                          )}
                        </select>
                      </td>
                      <td>
                        {/* defaultValue + key: no controlado por cada tecla.
                            El key remonta el input cuando el valor de base
                            cambia (guardado o load()), asi nunca muestra un
                            texto a medio escribir que ya no es cierto. */}
                        <input
                          key={t.id + ":" + (t.responsable ?? "")}
                          className="sel-inline"
                          defaultValue={t.responsable ?? ""}
                          maxLength={200}
                          placeholder="Sin asignar"
                          disabled={guardando}
                          aria-label={"Responsable de " + t.nombre}
                          onBlur={(e) => guardarResponsable(t, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                        />
                      </td>
                      <td>
                        <select
                          className="sel-inline"
                          value={t.prioridad}
                          disabled={guardando}
                          aria-label={"Prioridad de " + t.nombre}
                          onChange={(e) =>
                            cambiar(t, "prioridad", e.target.value)
                          }
                        >
                          {PRIORIDADES.map((p) => (
                            <option key={p} value={p}>
                              {PRIORIDAD_LABEL[p]}
                            </option>
                          ))}
                          {!PRIORIDADES.includes(t.prioridad) && (
                            <option value={t.prioridad}>{t.prioridad}</option>
                          )}
                        </select>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <input
                            type="date"
                            className="sel-inline"
                            value={t.vence_el ?? ""}
                            disabled={guardando}
                            aria-label={"Vencimiento de " + t.nombre}
                            onChange={(e) =>
                              cambiar(t, "vence_el", e.target.value || null)
                            }
                          />
                          {/* El badge repite lo que ya agrupa la vista "Por
                              fecha", pero visible tambien en las otras dos:
                              en la reunion no siempre se mira agrupado por
                              fecha, y un vencido no se puede pasar por alto
                              solo porque hoy se esta mirando por empresa. */}
                          {baldeFecha(t) === "Vencido" && (
                            <span className="badge b-red">Vencido</span>
                          )}
                        </div>
                      </td>
                      <td className="td-actions">
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => borrar(t)}
                          disabled={guardando}
                        >
                          Borrar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      {/* Los realizados no se borran ni desaparecen del todo: quedan un
          click abajo, de solo lectura salvo el botón para reabrirlos. Un
          tema que se cerró por error tiene que poder volver. */}
      {verRealizados && realizados.length > 0 && (
        <div className="card card-pad0">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tema</th>
                  <th>Empresa</th>
                  <th>Responsable</th>
                  <th>Prioridad</th>
                  <th>Vencía</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {realizados.map((t) => (
                  <tr key={t.id} className="is-realizado">
                    <td>{t.nombre}</td>
                    <td>{t.empresa}</td>
                    <td>{t.responsable || "—"}</td>
                    <td>{PRIORIDAD_LABEL[t.prioridad] ?? t.prioridad}</td>
                    <td>{fmtFecha(t.vence_el)}</td>
                    <td className="td-actions">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => cambiar(t, "realizado", false)}
                        disabled={guardando}
                      >
                        Reabrir
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => borrar(t)}
                        disabled={guardando}
                      >
                        Borrar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================
// P&L — el ingreso de Comercial, leído como estado de resultados
//
// Primer renglón nada más: FACTURACIÓN. El costo (Compras, Víveres,
// Reparaciones, HSQE, y sobre todo lo que hoy vive en cost-tracker, que es
// donde está la plata real) se suma más adelante, como renglones nuevos de
// esta misma tabla.
//
// Todo en USD Oficial, sea cual sea la moneda de origen: v_fin_ingresos_mensual
// ya convierte con el TC del día de la factura (sql/tipo_cambio.sql). Hoy no
// hace falta —la facturación está 100% en USD— pero el costo va a llegar
// mayormente en pesos, y la tabla no se puede rediseñar cada vez que entra
// una moneda nueva.
// ============================================================

const MESES_LABEL = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

// Negativos entre paréntesis: convención contable, y ademas es lo único
// que deja distinguir a simple vista un RESULTADO FINANCIERO negativo de
// uno positivo en una grilla densa de números.
function fmtUSD(n, decimales = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const s = Math.abs(v).toLocaleString("es-AR", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
  return v < 0 ? `(${s})` : s;
}

// La cascada de cada segmento: que categorías de plan_de_cuentas entran en
// cada renglón, y donde va un subtotal. No hace falta decir si cada
// renglón suma o resta: monto_usd ya viene con el signo real (positivo
// ingreso, negativo costo, tal cual lo carga Xubio o Carga Manual), así
// que un subtotal es sencillamente la suma acumulada de los renglones de
// arriba. Ver sql/plan_de_cuentas.sql y sql/pl_movimientos.sql — categoria
// es la misma palabra en las dos puntas.
const CASCADA_BUQUE = [
  { label: "FACTURACIÓN",                  categorias: ["ingreso"] },
  { label: "Costos Variables de Viaje",    categorias: ["costo_variable"] },
  { label: "Costo Embarcados",             categorias: ["costo_embarcados"],   subtotal: "CONTRIBUCIÓN MARGINAL" },
  { label: "Costos Semifijos",             categorias: ["costo_semifijo"] },
  { label: "Costos Fijos",                 categorias: ["costo_fijo"] },
  { label: "Costo Dique",                  categorias: ["costo_dique"],        subtotal: "RESULTADO OPERATIVO" },
  { label: "Otros Ingresos No Operativos", categorias: ["otros_no_operativo"], subtotal: "RESULTADO FINANCIERO" },
];
const CASCADA_ASTILLERO = [
  { label: "INGRESOS ASTILLERO", categorias: ["ingreso_astillero"] },
  {
    label: "Costos Astillero",
    categorias: ["costo_variable", "costo_embarcados", "costo_semifijo", "costo_fijo", "otros_no_operativo", "financiero"],
    subtotal: "RESULTADO ASTILLERO",
  },
];
const CASCADA_CORPORATIVO = [
  { label: "Gastos de Administración (SG&A)", categorias: ["sga", "financiero"], subtotal: "TOTAL SG&A" },
];

const SEGMENTOS_PL = [
  // "consolidado" no tiene cascada propia: no es una categoria de
  // plan_de_cuentas, es la suma del resultado final de los otros tres
  // segmentos. Se arma aparte, ver cascadaConsolidado en PagePL.
  { id: "consolidado", label: "Consolidado PL Offshore", cascada: null },
  { id: "buque", label: "Flota", cascada: CASCADA_BUQUE },
  { id: "astillero", label: "Astillero", cascada: CASCADA_ASTILLERO },
  { id: "corporativo", label: "Corporativo / SG&A", cascada: CASCADA_CORPORATIVO },
];

// De filas planas (mes, categoria, monto_usd) a la cascada del segmento:
// una fila por renglón con sus 12 meses, más una fila de subtotal donde la
// cascada la pide. El subtotal es la suma acumulada tal cual —sin invertir
// signo de nada— porque monto_usd ya es positivo o negativo según
// corresponda desde el origen (ver nota de CASCADA_BUQUE más arriba).
function construirCascada(cascada, filasAnio) {
  const porCategoria = new Map();
  for (const f of filasAnio) {
    const idx = Number(String(f.mes).slice(5, 7)) - 1;
    if (idx < 0 || idx > 11) continue;
    if (!porCategoria.has(f.categoria)) porCategoria.set(f.categoria, Array(12).fill(0));
    porCategoria.get(f.categoria)[idx] += Number(f.monto_usd || 0);
  }

  const filas = [];
  const acumulado = Array(12).fill(0);
  for (const linea of cascada) {
    const meses = Array(12).fill(0);
    for (const cat of linea.categorias) {
      const arr = porCategoria.get(cat);
      if (!arr) continue;
      for (let i = 0; i < 12; i++) meses[i] += arr[i];
    }
    filas.push({ label: linea.label, meses, esSubtotal: false });
    for (let i = 0; i < 12; i++) acumulado[i] += meses[i];
    if (linea.subtotal) {
      filas.push({ label: linea.subtotal, meses: [...acumulado], esSubtotal: true });
    }
  }
  return filas;
}

function PagePL() {
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [anio, setAnio] = useState(null);
  const [segmento, setSegmento] = useState("consolidado");
  const [buque, setBuque] = useState(null); // null = consolidado de la flota

  const load = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setFilas(await api.listPLMensual());
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const anios = useMemo(() => {
    const s = new Set(filas.map((f) => String(f.mes).slice(0, 4)));
    return [...s].sort((a, b) => Number(b) - Number(a));
  }, [filas]);

  // El año por defecto es el más reciente con datos, no el calendario: si
  // hoy es 2027 y la última factura es de 2026, abrir en 2027 mostraría una
  // pantalla vacía sin ninguna pista de por qué.
  useEffect(() => {
    if (anio === null && anios.length) setAnio(anios[0]);
  }, [anio, anios]);

  const buquesDisponibles = useMemo(() => {
    const s = new Set(
      filas.filter((f) => f.segmento === "buque" && f.centro_costo).map((f) => f.centro_costo)
    );
    return [...s].sort((a, b) => a.localeCompare(b, "es"));
  }, [filas]);

  const filasDelSegmento = useMemo(
    () =>
      filas.filter(
        (f) => f.segmento === segmento && (segmento !== "buque" || !buque || f.centro_costo === buque)
      ),
    [filas, segmento, buque]
  );

  const filasDelAnio = useMemo(
    () => filasDelSegmento.filter((f) => String(f.mes).slice(0, 4) === anio),
    [filasDelSegmento, anio]
  );

  // Para "consolidado" hace falta el año entero sin filtrar por segmento:
  // se arma sumando el resultado final de los otros tres, no filtrando una
  // categoria propia (no existe tal cosa como una fila con
  // segmento='consolidado' en la base).
  const filasAnioTotal = useMemo(
    () => filas.filter((f) => String(f.mes).slice(0, 4) === anio),
    [filas, anio]
  );

  const esConsolidado = segmento === "consolidado";

  // Un centro de costo sin segmento (Centros de costo -> "Sin clasificar")
  // no entra en NINGUNA pestaña, ni siquiera el Consolidado: sus filas
  // tienen segmento=null y ninguna de las tres ramas de arriba las
  // encuentra. Eso está bien mientras esos centros no tengan actividad,
  // pero en cuanto entra plata real ahí queda invisible en todo el P&L sin
  // que nada lo diga. Se avisa en vez de dejarlo esconderse.
  const sinSegmento = useMemo(() => {
    const filasSinSeg = filasAnioTotal.filter((f) => !f.segmento);
    const total = filasSinSeg.reduce((a, f) => a + Number(f.monto_usd || 0), 0);
    const centros = [...new Set(filasSinSeg.map((f) => f.centro_costo).filter(Boolean))];
    return { total, centros };
  }, [filasAnioTotal]);

  // El consolidado que le faltaba a la pantalla: Σ Resultado Financiero de
  // cada buque + Resultado de Astillero − Total SG&A de Corporativo. Es
  // exactamente lo que hace la hoja CONSOLIDADO BNA del Excel, sumando los
  // bloques por separado en vez de un renglon por categoria.
  const cascadaConsolidado = useMemo(() => {
    const deFlota = construirCascada(CASCADA_BUQUE, filasAnioTotal.filter((f) => f.segmento === "buque"));
    const deAstillero = construirCascada(
      CASCADA_ASTILLERO,
      filasAnioTotal.filter((f) => f.segmento === "astillero")
    );
    const deCorporativo = construirCascada(
      CASCADA_CORPORATIVO,
      filasAnioTotal.filter((f) => f.segmento === "corporativo")
    );

    const cero = () => Array(12).fill(0);
    const facturacionFlota = deFlota.find((f) => f.label === "FACTURACIÓN")?.meses ?? cero();
    const resultadoFlota = [...deFlota].reverse().find((f) => f.esSubtotal)?.meses ?? cero();
    const resultadoAstillero = [...deAstillero].reverse().find((f) => f.esSubtotal)?.meses ?? cero();
    // Ya viene negativo: la cascada de Corporativo no tiene ningun renglon
    // que sume, asi que su subtotal acumulado es directamente el gasto en
    // negativo. Sumarlo tal cual, sin volver a invertir el signo.
    const totalSGA = [...deCorporativo].reverse().find((f) => f.esSubtotal)?.meses ?? cero();

    const neto = cero().map((_, i) => resultadoFlota[i] + resultadoAstillero[i] + totalSGA[i]);

    return {
      facturacionFlota,
      filas: [
        { label: "Resultado Financiero · Flota", meses: resultadoFlota, esSubtotal: false },
        { label: "Resultado · Astillero", meses: resultadoAstillero, esSubtotal: false },
        { label: "Total SG&A · Corporativo", meses: totalSGA, esSubtotal: false },
        { label: "RESULTADO NETO CONSOLIDADO", meses: neto, esSubtotal: true },
      ],
    };
  }, [filasAnioTotal]);

  const seccion = SEGMENTOS_PL.find((s) => s.id === segmento) ?? SEGMENTOS_PL[0];
  const cascada = useMemo(() => {
    if (esConsolidado) return cascadaConsolidado.filas;
    return construirCascada(seccion.cascada, filasDelAnio);
  }, [esConsolidado, cascadaConsolidado, seccion, filasDelAnio]);

  const facturacion = esConsolidado
    ? { label: "Facturación Flota", meses: cascadaConsolidado.facturacionFlota }
    : cascada.find((f) => f.label === "FACTURACIÓN" || f.label === "INGRESOS ASTILLERO");
  const resultadoFinal = [...cascada].reverse().find((f) => f.esSubtotal);
  const totalFacturacion = facturacion ? facturacion.meses.reduce((a, b) => a + b, 0) : 0;
  const totalResultado = resultadoFinal ? resultadoFinal.meses.reduce((a, b) => a + b, 0) : 0;

  // El aviso de "sin movimientos" mira el universo correcto segun la
  // pestaña: para consolidado es todo el año (no hay una sola categoria
  // propia que filtrar), para los demas es lo que ya filtraba antes.
  const sinDatosDelSegmento = esConsolidado ? filasAnioTotal.length === 0 : filasDelAnio.length === 0;

  if (cargando) {
    return (
      <div className="card card-pad0">
        <div className="empty">
          <div className="empty-mono">Cargando</div>
        </div>
      </div>
    );
  }

  if (!filas.length) {
    return (
      <>
        <Note tipo="err">{error}</Note>
        <div className="card card-pad0">
          <div className="empty">
            <div className="empty-mono">Sin facturación cargada</div>
            El P&L lee <code>comercial.facturas</code>: en cuanto haya una factura
            emitida en Comercial, aparece acá sola.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Note tipo="err">{error}</Note>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="fg" style={{ maxWidth: 140 }}>
            <label htmlFor="pl-anio">Año</label>
            <select id="pl-anio" value={anio ?? ""} onChange={(e) => setAnio(e.target.value)}>
              {anios.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          {segmento === "buque" && buquesDisponibles.length > 0 && (
            <div className="fg" style={{ maxWidth: 220 }}>
              <label htmlFor="pl-buque">Buque</label>
              <select
                id="pl-buque"
                value={buque ?? ""}
                onChange={(e) => setBuque(e.target.value || null)}
              >
                <option value="">Consolidado de la flota</option>
                {buquesDisponibles.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="seg" role="group" aria-label="Segmento del P&L">
          {SEGMENTOS_PL.map((s) => (
            <button
              key={s.id}
              className={segmento === s.id ? "on" : ""}
              aria-pressed={segmento === s.id}
              onClick={() => setSegmento(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="stats">
        {facturacion && (
          <div className="stat">
            <div className="stat-label">
              {facturacion.label} {anio} · USD Oficial
            </div>
            <div className="stat-value sm">{fmtUSD(totalFacturacion)}</div>
          </div>
        )}
        <div className="stat">
          <div className="stat-label">{resultadoFinal?.label ?? "Resultado"}</div>
          <div className="stat-value sm">{fmtUSD(totalResultado)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Segmento</div>
          <div className="stat-value sm">
            {seccion.label}
            {segmento === "buque" && buque ? ` · ${buque}` : ""}
          </div>
        </div>
      </div>

      {Math.abs(sinSegmento.total) > 0.5 && (
        <Note tipo="warn">
          {fmtUSD(sinSegmento.total)} USD de {anio} quedan FUERA de las cuatro
          pestañas (Flota, Astillero, Corporativo y Consolidado) porque su
          centro de costo todavía no está clasificado en Centros de costo:{" "}
          {sinSegmento.centros.join(", ")}. No es un error de carga, es que
          ese centro no tiene segmento asignado — andá a Centros de costo y
          asignale uno para que aparezca.
        </Note>
      )}

      {esConsolidado && (
        <Note tipo="info">
          El consolidado no tiene una cascada propia: suma el Resultado
          Financiero de toda la flota (todos los buques juntos, sin importar
          el filtro de la pestaña Flota) más el Resultado de Astillero, menos
          el Total SG&A de Corporativo. Es la misma cuenta que hace la hoja
          "CONSOLIDADO BNA" de la planilla.
        </Note>
      )}

      {segmento === "corporativo" && (
        <Note tipo="info">
          Corporativo no tiene un ingreso propio: es el gasto de estructura
          (Administración, oficina, flota de vehículos, impuestos...) que se
          resta del resultado consolidado de la flota y de Astillero, no de
          cada buque por separado.
        </Note>
      )}

      {sinDatosDelSegmento && (
        <Note tipo="warn">
          Todavía no hay ningún movimiento de costo cargado para{" "}
          {seccion.label.toLowerCase()} en {anio}
          {segmento === "buque" ? " (la Facturación sí es real, viene de Comercial)" : ""}.
          Las filas de abajo muestran la estructura del renglón, en "—", hasta
          que se cargue el primer movimiento en <code>pl_movimientos</code>.
        </Note>
      )}

      <div className="card card-pad0">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{seccion.label.toUpperCase()} (USD)</th>
                {MESES_LABEL.map((m) => (
                  <th key={m} className="td-mono" style={{ textAlign: "right" }}>
                    {m}
                  </th>
                ))}
                <th className="td-mono" style={{ textAlign: "right" }}>
                  TOTAL
                </th>
              </tr>
            </thead>
            <tbody>
              {cascada.map((f, i) => (
                <tr
                  key={i}
                  style={
                    f.esSubtotal
                      ? { borderTop: "1px solid var(--border)", fontWeight: 700 }
                      : undefined
                  }
                >
                  <td>{f.label}</td>
                  {f.meses.map((v, mi) => (
                    <td key={mi} className="td-mono" style={{ textAlign: "right" }}>
                      {v ? fmtUSD(v) : "—"}
                    </td>
                  ))}
                  <td className="td-mono" style={{ textAlign: "right", fontWeight: f.esSubtotal ? 700 : 400 }}>
                    {fmtUSD(f.meses.reduce((a, b) => a + b, 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ============================================================
// TIPO DE CAMBIO — el oficial (BNA), traído solo
//
// Se llena vía cron (sql/tipo_cambio.sql llama a la Edge Function
// sync-tipo-cambio-oficial todos los días a las 18:05 ART). Esta pantalla
// es de lectura más un disparador manual: sirve para confirmar que el cron
// corrió, y para forzar un refresco sin esperar a mañana si un valor vino
// raro o si el cron se cayó un día.
// ============================================================

function PageTipoCambio() {
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [backfilleando, setBackfilleando] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);

  const load = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setFilas(await api.listTipoCambio());
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function mensajeSyncError(err) {
    const msg = err?.message ?? String(err);
    if (/Failed to send a request|not found|404/i.test(msg)) {
      return "Falta desplegar la Edge Function sync-tipo-cambio-oficial en Supabase. El código está en supabase/functions/.";
    }
    return msg;
  }

  async function sincronizar() {
    setSincronizando(true);
    setError(null);
    setOk(null);
    try {
      const r = await api.syncTipoCambioOficial();
      setOk(
        `TC oficial del ${fmtFecha(r.fecha)}: compra ${fmtUSD(r.compra)} · venta ${fmtUSD(r.venta)}.`
      );
      await load();
    } catch (err) {
      setError(mensajeSyncError(err));
    } finally {
      setSincronizando(false);
    }
  }

  // Trae la serie historica completa desde que arranca el negocio en la
  // base (2026-01-01, sql/tipo_cambio.sql), no solo el dia de hoy. Ya corrio
  // una vez (251 filas al 2026-09-08); este boton es para repetirlo si hace
  // falta —por ejemplo si la fuente corrige un valor viejo— y no para uso
  // diario, de ahi la confirmacion.
  async function backfillear() {
    const confirmado = window.confirm(
      "Esto trae de nuevo TODO el histórico del TC oficial desde el 01/01/2026 y pisa lo que ya está cargado con esos mismos valores. Puede tardar unos segundos. ¿Continuar?"
    );
    if (!confirmado) return;
    setBackfilleando(true);
    setError(null);
    setOk(null);
    try {
      const r = await api.syncTipoCambioOficial(true);
      setOk(
        `Histórico: ${r.escritas} día(s) cargado(s), de ${fmtFecha(r.desde)} a ${fmtFecha(r.hasta)}.`
      );
      await load();
    } catch (err) {
      setError(mensajeSyncError(err));
    } finally {
      setBackfilleando(false);
    }
  }

  const hoy = filas[0] ?? null;
  // El cron corre todos los días, fines de semana incluidos (dolarapi
  // devuelve el último valor conocido). Si el más reciente cargado tiene más
  // de 3 días, algo dejó de andar y conviene decirlo en vez de mostrar un
  // número viejo como si fuera de hoy.
  const diasDesdeUltimo = hoy ? diasHasta(hoy.fecha) : null;
  const desactualizado = diasDesdeUltimo !== null && diasDesdeUltimo < -3;

  return (
    <>
      <Note tipo="err">{error}</Note>
      <Note tipo="ok">{ok}</Note>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <button
          className="btn btn-ghost"
          onClick={backfillear}
          disabled={sincronizando || backfilleando}
          title="Trae de nuevo todo el histórico desde el 01/01/2026 de api.argentinadatos.com"
        >
          {backfilleando ? "Trayendo histórico..." : "Traer histórico completo"}
        </button>
        <button
          className="btn btn-ghost"
          onClick={sincronizar}
          disabled={sincronizando || backfilleando}
          title="Trae el oficial de hoy de dolarapi.com, sin esperar al cron de las 18:05"
        >
          {sincronizando ? "Sincronizando..." : "Sincronizar ahora"}
        </button>
      </div>

      {!cargando && hoy && (
        <div className="stats">
          <div className="stat">
            <div className="stat-label">Último TC cargado</div>
            <div className="stat-value sm">{fmtFecha(hoy.fecha)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Compra</div>
            <div className="stat-value">{fmtUSD(hoy.compra)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Venta (la que usa el P&L)</div>
            <div className="stat-value">{fmtUSD(hoy.venta)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Días cargados</div>
            <div className="stat-value">{filas.length}</div>
          </div>
        </div>
      )}

      {desactualizado && (
        <Note tipo="warn">
          El último TC es del {fmtFecha(hoy.fecha)}, hace {-diasDesdeUltimo} días.
          El cron corre todos los días a las 18:05 ART — si pasaron más de un
          par de días sin actualizarse, probá "Sincronizar ahora" y si vuelve
          a fallar revisá los logs de la Edge Function en Supabase.
        </Note>
      )}

      <Note tipo="info">
        Se carga solo, todos los días, de{" "}
        <a href="https://dolarapi.com/v1/dolares/oficial" target="_blank" rel="noreferrer">
          dolarapi.com
        </a>{" "}
        (el mismo oficial que publica el BNA). El P&L convierte con VENTA, no
        con compra.
      </Note>

      {cargando ? (
        <div className="card card-pad0">
          <div className="empty">
            <div className="empty-mono">Cargando</div>
          </div>
        </div>
      ) : !filas.length ? (
        <div className="card card-pad0">
          <div className="empty">
            <div className="empty-mono">Sin tipo de cambio cargado</div>
            Apretá "Sincronizar ahora" para traer el de hoy, o esperá al cron
            de las 18:05 ART.
          </div>
        </div>
      ) : (
        <div className="card card-pad0">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th style={{ textAlign: "right" }}>Compra</th>
                  <th style={{ textAlign: "right" }}>Venta</th>
                  <th>Fuente</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.fecha}>
                    <td className="td-mono">{fmtFecha(f.fecha)}</td>
                    <td className="td-mono" style={{ textAlign: "right" }}>
                      {fmtUSD(f.compra)}
                    </td>
                    <td className="td-mono" style={{ textAlign: "right" }}>
                      {fmtUSD(f.venta)}
                    </td>
                    <td>{f.fuente}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================
// CARGA MANUAL — lo que alimenta pl_movimientos hasta que haya una
// fuente automática
//
// Todo el P&L salvo la Facturación (que viene sola de Comercial) sale de
// acá: Voyage Costs, Vessel OPEX, SG&A e ingresos de Astillero. El día que
// se conecte cost-tracker o se automatice la lectura de la planilla, esta
// pantalla deja de ser necesaria para carga masiva pero sigue sirviendo
// para ajustes puntuales.
// ============================================================

const CATEGORIA_LABEL = {
  costo_variable: "Costos Variables de Viaje",
  costo_embarcados: "Costo Embarcados",
  costo_semifijo: "Costos Semifijos",
  costo_fijo: "Costos Fijos",
  costo_dique: "Costo Dique",
  otros_no_operativo: "Otros Ingresos No Operativos",
  financiero: "Financiero",
  sga: "SG&A / Administración",
  ingreso_astillero: "Ingresos Astillero",
};

const SEGMENTO_LABEL = {
  buque: "Flota",
  astillero: "Astillero",
  corporativo: "Corporativo / SG&A",
  excluido: "Excluido del P&L",
};

function hoyISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function PageCargaManual() {
  const [centros, setCentros] = useState([]);
  const [cuentas, setCuentas] = useState([]);
  const [movimientos, setMovimientos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [form, setForm] = useState({
    fecha: hoyISO(),
    centroCostoId: "",
    cuentaId: "",
    moneda: "ARS",
    monto: "",
    descripcion: "",
  });

  const load = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [c, cu, m] = await Promise.all([
        api.listCentrosCosto(),
        api.listPlanDeCuentas(),
        api.listPLMovimientos(),
      ]);
      setCentros(c);
      setCuentas(cu);
      setMovimientos(m);
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const centrosPorId = useMemo(() => new Map(centros.map((c) => [c.id, c])), [centros]);
  const cuentasPorId = useMemo(() => new Map(cuentas.map((c) => [c.id, c])), [cuentas]);

  // Agrupados por segmento para el desplegable: asi se ve de entrada que
  // "Sin clasificar" existe y por que no conviene cargarle nada todavia.
  const gruposCentros = useMemo(() => {
    const grupos = { buque: [], astillero: [], corporativo: [], excluido: [], sin_clasificar: [] };
    for (const c of centros) {
      if (!c.activo) continue;
      (grupos[c.segmento ?? "sin_clasificar"] ??= []).push(c);
    }
    for (const lista of Object.values(grupos)) lista.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    return grupos;
  }, [centros]);

  const gruposCuentas = useMemo(() => {
    const grupos = new Map();
    for (const c of cuentas) {
      if (!grupos.has(c.categoria)) grupos.set(c.categoria, []);
      grupos.get(c.categoria).push(c);
    }
    return grupos;
  }, [cuentas]);

  const centroSeleccionado = form.centroCostoId ? centrosPorId.get(form.centroCostoId) : null;

  function set(campo) {
    return (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));
  }

  function validar() {
    if (!form.fecha) return "Falta la fecha.";
    if (!form.centroCostoId) return "Falta el centro de costo.";
    if (!form.cuentaId) return "Falta la cuenta.";
    const n = Number(form.monto);
    if (form.monto === "" || !Number.isFinite(n) || n <= 0)
      return "El monto tiene que ser un número mayor a cero.";
    return null;
  }

  async function guardar(e) {
    e.preventDefault();
    const msg = validar();
    if (msg) {
      setError(msg);
      return;
    }
    setGuardando(true);
    setError(null);
    setOk(null);
    try {
      // Se tipea siempre un numero positivo, pero se guarda con el signo
      // real: positivo si es un ingreso (Astillero), negativo si es
      // cualquier otra categoria (costo, SG&A, financiero...). monto_usd
      // tiene que quedar consistente sea que la fila venga de aca o de un
      // import de Xubio, que ya trae el signo puesto.
      const categoria = cuentasPorId.get(form.cuentaId)?.categoria;
      const magnitud = Math.abs(Number(form.monto));
      const montoConSigno = categoria === "ingreso_astillero" ? magnitud : -magnitud;
      await api.crearPLMovimiento({ ...form, monto: montoConSigno });
      setOk("Movimiento cargado.");
      // Mantiene fecha, centro y cuenta: lo más probable es que sigan
      // cargando varias líneas seguidas del mismo mes y del mismo lugar.
      setForm((f) => ({ ...f, monto: "", descripcion: "" }));
      await load();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(m) {
    const cuenta = cuentasPorId.get(m.cuenta_id)?.cuenta ?? "este movimiento";
    const confirmado = window.confirm(`¿Borrar "${cuenta}" del ${fmtFecha(m.fecha)}?`);
    if (!confirmado) return;
    setGuardando(true);
    setError(null);
    try {
      await api.borrarPLMovimiento(m.id);
      setOk("Movimiento borrado.");
      await load();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <Note tipo="err">{error}</Note>
      <Note tipo="ok">{ok}</Note>

      <div className="card" style={{ marginBottom: 16 }}>
        <form onSubmit={guardar}>
          <div className="form-grid">
            <div className="fg">
              <label htmlFor="cm-fecha">Fecha</label>
              <input
                id="cm-fecha"
                type="date"
                value={form.fecha}
                onChange={set("fecha")}
                required
              />
            </div>
            <div className="fg">
              <label htmlFor="cm-centro">Centro de costo</label>
              <select id="cm-centro" value={form.centroCostoId} onChange={set("centroCostoId")} required>
                <option value="">Elegir...</option>
                {gruposCentros.buque.length > 0 && (
                  <optgroup label="Flota">
                    {gruposCentros.buque.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </optgroup>
                )}
                {gruposCentros.astillero.length > 0 && (
                  <optgroup label="Astillero">
                    {gruposCentros.astillero.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </optgroup>
                )}
                {gruposCentros.corporativo.length > 0 && (
                  <optgroup label="Corporativo / SG&A">
                    {gruposCentros.corporativo.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </optgroup>
                )}
                {gruposCentros.sin_clasificar.length > 0 && (
                  <optgroup label="Sin clasificar (no aparece en el P&L)">
                    {gruposCentros.sin_clasificar.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </optgroup>
                )}
                {(gruposCentros.excluido ?? []).length > 0 && (
                  <optgroup label="Excluido del P&L a propósito">
                    {gruposCentros.excluido.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <div className="fg">
              <label htmlFor="cm-cuenta">Cuenta</label>
              <select id="cm-cuenta" value={form.cuentaId} onChange={set("cuentaId")} required>
                <option value="">Elegir...</option>
                {[...gruposCuentas.entries()].map(([categoria, lista]) => (
                  <optgroup key={categoria} label={CATEGORIA_LABEL[categoria] ?? categoria}>
                    {lista.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.cuenta}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="fg">
              <label htmlFor="cm-moneda">Moneda</label>
              <select id="cm-moneda" value={form.moneda} onChange={set("moneda")}>
                <option value="ARS">ARS</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div className="fg">
              <label htmlFor="cm-monto">Monto</label>
              <input
                id="cm-monto"
                type="number"
                min="0"
                step="0.01"
                value={form.monto}
                onChange={set("monto")}
                required
              />
            </div>
            <div className="fg">
              <label htmlFor="cm-desc">Descripción (opcional)</label>
              <input
                id="cm-desc"
                value={form.descripcion}
                onChange={set("descripcion")}
                placeholder="N° de factura, proveedor..."
              />
            </div>
          </div>

          {centroSeleccionado && !centroSeleccionado.segmento && (
            <Note tipo="warn">
              "{centroSeleccionado.nombre}" todavía no está clasificado (buque / astillero /
              corporativo) en Centros de costo: este movimiento se guarda igual, pero no va a
              aparecer en ningún renglón del P&L hasta que se clasifique.
            </Note>
          )}

          <button className="btn btn-primary" type="submit" disabled={guardando}>
            {guardando ? "Guardando..." : "Cargar movimiento"}
          </button>
        </form>
      </div>

      {cargando ? (
        <div className="card card-pad0">
          <div className="empty">
            <div className="empty-mono">Cargando</div>
          </div>
        </div>
      ) : !movimientos.length ? (
        <div className="card card-pad0">
          <div className="empty">
            <div className="empty-mono">Sin movimientos cargados</div>
            Cargá el primero con el formulario de arriba: en cuanto se guarde, aparece
            en el P&L en su renglón correspondiente.
          </div>
        </div>
      ) : (
        <div className="card card-pad0">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Centro de costo</th>
                  <th>Cuenta</th>
                  <th style={{ textAlign: "right" }}>Monto</th>
                  <th>Descripción</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {movimientos.map((m) => {
                  const centro = centrosPorId.get(m.centro_costo_id);
                  const cuenta = cuentasPorId.get(m.cuenta_id);
                  return (
                    <tr key={m.id}>
                      <td className="td-mono">{fmtFecha(m.fecha)}</td>
                      <td>
                        {centro?.nombre ?? "—"}
                        {centro?.segmento && (
                          <span className="badge b-gray" style={{ marginLeft: 6 }}>
                            {SEGMENTO_LABEL[centro.segmento]}
                          </span>
                        )}
                      </td>
                      <td>{cuenta?.cuenta ?? "—"}</td>
                      <td className="td-mono" style={{ textAlign: "right" }}>
                        {m.moneda} {fmtUSD(m.monto, 2)}
                      </td>
                      <td>{m.descripcion ?? "—"}</td>
                      <td className="td-actions">
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => borrar(m)}
                          disabled={guardando}
                        >
                          Borrar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function PageCentrosCosto() {
  const [centros, setCentros] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [filtro, setFiltro] = useState("");
  const [seleccion, setSeleccion] = useState([]);
  const [moduloBulk, setModuloBulk] = useState(MODULOS_CENTRO_COSTO[0].id);

  const load = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setCentros(await api.listCentrosCosto());
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function sincronizar() {
    setSincronizando(true);
    setError(null);
    setOk(null);
    try {
      const r = await api.syncCentrosCostoXubio();
      const partes = [];
      if (r?.creados) partes.push(r.creados + " nuevo(s)");
      if (r?.vinculados) partes.push(r.vinculados + " vinculado(s) a Xubio");
      if (r?.actualizados) partes.push(r.actualizados + " actualizado(s)");
      if (r?.reactivados) partes.push(r.reactivados + " activado(s)");
      if (r?.desactivados)
        partes.push(
          r.desactivados + " desactivado(s) por no estar m\u00e1s en Xubio"
        );

      const detalle =
        "Xubio devolvi\u00f3 " +
        (r?.recibidos ?? 0) +
        " centro(s) de costo. " +
        (partes.length ? partes.join(", ") + "." : "Sin cambios.");

      await load();

      if (r?.omitidos) {
        // Paso cuando Xubio cambia el nombre del campo del ID: la funcion no
        // lo encuentra y descarta la fila. Se ve el detalle en los logs.
        setError(
          detalle +
            " " +
            r.omitidos +
            " se omitieron porque no se pudo leer su ID en la respuesta de Xubio. Revis\u00e1 los logs de la funci\u00f3n."
        );
      } else {
        setOk(detalle);
      }
    } catch (err) {
      const msg = err?.message ?? String(err);
      // La funcion todavia no esta desplegada en Supabase.
      if (/Failed to send a request|not found|404/i.test(msg)) {
        setError(
          "Falta desplegar la Edge Function sync-centros-costo-xubio en Supabase. El codigo esta en supabase/functions/."
        );
      } else {
        setError(msg);
      }
    } finally {
      setSincronizando(false);
    }
  }

  async function borrar(c) {
    const confirmado = window.confirm(
      "¿Borrar el centro de costo " +
        c.nombre +
        "? Los proyectos que ya lo tengan asignado conservan el texto."
    );
    if (!confirmado) return;
    setGuardando(true);
    setError(null);
    try {
      await api.borrarCentroCosto(c.id);
      setOk("Centro de costo borrado.");
      await load();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  const activos = centros.filter((c) => c.activo).length;

  const normaliza = (s) => String(s ?? "").trim().toLowerCase();
  const visibles = filtro.trim()
    ? centros.filter((c) => normaliza(c.nombre).includes(normaliza(filtro)))
    : centros;

  const seleccionados = seleccion.filter((id) =>
    visibles.some((c) => c.id === id)
  );
  const todosMarcados =
    visibles.length > 0 && visibles.every((c) => seleccion.includes(c.id));

  function marcar(id) {
    setSeleccion((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function marcarTodos() {
    // Aplica sobre lo que se ve, no sobre la tabla entera: con un filtro
    // activo, "todos" son los filtrados.
    setSeleccion(todosMarcados ? [] : visibles.map((c) => c.id));
  }

  async function cambiarActivo(activo) {
    if (!seleccionados.length) return;
    setGuardando(true);
    setError(null);
    setOk(null);
    try {
      await api.setActivoCentros(seleccionados, activo);
      setOk(
        seleccionados.length +
          (activo ? " centro(s) activado(s)." : " centro(s) desactivado(s).")
      );
      setSeleccion([]);
      await load();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  // Un módulo por vez, sobre lo seleccionado. La API ya arma el array sin
  // pisar los otros módulos que cada fila tuviera marcados (ver
  // fn_centros_costo_set_modulo), así que acá alcanza con avisarle cuáles
  // ids y qué módulo.
  async function aplicarModuloBulk(mostrar) {
    if (!seleccionados.length) return;
    setGuardando(true);
    setError(null);
    setOk(null);
    try {
      await api.setModuloCentros(seleccionados, moduloBulk, mostrar);
      const label =
        MODULOS_CENTRO_COSTO.find((m) => m.id === moduloBulk)?.label ?? moduloBulk;
      setOk(
        seleccionados.length +
          (mostrar ? " centro(s) publicado(s) en " : " centro(s) sacado(s) de ") +
          label +
          "."
      );
      setSeleccion([]);
      await load();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  // Toggle de una sola fila y un solo módulo, para la corrección puntual
  // (el lote de arriba es para la carga inicial). Optimista: si la RPC
  // falla, vuelve al estado anterior.
  async function toggleModulo(c, modulo) {
    const mostrar = !(c.visible_modulos ?? []).includes(modulo);
    const previos = centros;
    setCentros((lista) =>
      lista.map((x) =>
        x.id === c.id
          ? {
              ...x,
              visible_modulos: mostrar
                ? [...(x.visible_modulos ?? []), modulo]
                : (x.visible_modulos ?? []).filter((m) => m !== modulo),
            }
          : x
      )
    );
    setError(null);
    try {
      await api.setModuloCentros([c.id], modulo, mostrar);
    } catch (err) {
      setCentros(previos);
      setError(mensajeError(err));
    }
  }

  // "" en el <select> es el estado "sin clasificar": se guarda como null,
  // no como string vacio.
  async function cambiarSegmento(c, segmento) {
    const previos = centros;
    setCentros((lista) =>
      lista.map((x) => (x.id === c.id ? { ...x, segmento: segmento || null } : x))
    );
    setError(null);
    try {
      await api.setSegmentoCentro(c.id, segmento || null);
    } catch (err) {
      setCentros(previos);
      setError(mensajeError(err));
    }
  }

  return (
    <>
      <Note tipo="err">{error}</Note>
      <Note tipo="ok">{ok}</Note>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 16,
        }}
      >
        <button
          className="btn btn-ghost"
          onClick={sincronizar}
          disabled={sincronizando || guardando}
          title="Trae los centros de costo desde Xubio, que es donde se crean"
        >
          {sincronizando ? "Sincronizando..." : "Sincronizar desde Xubio"}
        </button>
      </div>

      {!cargando && centros.length > 0 && (
        <Note tipo="info">
          {activos} de {centros.length} centros activos. Activo significa que el
          centro sigue existiendo en Xubio; los inactivos ya no están ahí.
        </Note>
      )}

      {!cargando && centros.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-end",
            flexWrap: "wrap",
            marginBottom: 12,
          }}
        >
          <div className="fg" style={{ flex: "1 1 220px", maxWidth: 320 }}>
            <label htmlFor="cc-filtro">Buscar</label>
            <input
              id="cc-filtro"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Golondrina, Cronos, Administracion..."
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={() => cambiarActivo(true)}
            disabled={guardando || !seleccionados.length}
          >
            Activar
            {seleccionados.length ? " (" + seleccionados.length + ")" : ""}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => cambiarActivo(false)}
            disabled={guardando || !seleccionados.length}
          >
            Desactivar
            {seleccionados.length ? " (" + seleccionados.length + ")" : ""}
          </button>
        </div>
      )}

      {!cargando && centros.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-end",
            flexWrap: "wrap",
            marginBottom: 16,
          }}
        >
          <div className="fg" style={{ maxWidth: 220 }}>
            <label htmlFor="cc-modulo-bulk">Publicar en el módulo</label>
            <select
              id="cc-modulo-bulk"
              value={moduloBulk}
              onChange={(e) => setModuloBulk(e.target.value)}
            >
              {MODULOS_CENTRO_COSTO.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => aplicarModuloBulk(true)}
            disabled={guardando || !seleccionados.length}
          >
            Mostrar
            {seleccionados.length ? " (" + seleccionados.length + ")" : ""}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => aplicarModuloBulk(false)}
            disabled={guardando || !seleccionados.length}
          >
            Ocultar
            {seleccionados.length ? " (" + seleccionados.length + ")" : ""}
          </button>
        </div>
      )}

      {cargando ? (
        <div className="card card-pad0">
          <div className="empty">
            <div className="empty-mono">Cargando</div>
          </div>
        </div>
      ) : !centros.length ? (
        <div className="card card-pad0">
          <div className="empty">
            <div className="empty-mono">Sin centros de costo</div>
            Se cargan desde Xubio: apretá "Sincronizar desde Xubio" para traerlos.
          </div>
        </div>
      ) : (
        <div className="card card-pad0">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    <input
                      type="checkbox"
                      checked={todosMarcados}
                      onChange={marcarTodos}
                      disabled={guardando}
                      aria-label="Marcar todos"
                    />
                  </th>
                  <th>Nombre</th>
                  <th>Estado</th>
                  <th>Segmento</th>
                  <th>Xubio</th>
                  <th>Módulos</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibles.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={seleccion.includes(c.id)}
                        onChange={() => marcar(c.id)}
                        disabled={guardando}
                        aria-label={"Marcar " + c.nombre}
                      />
                    </td>
                    <td>{c.nombre}</td>
                    <td>
                      <span
                        className={`badge ${c.activo ? "b-teal" : "b-gray"}`}
                      >
                        {c.activo ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td>
                      <select
                        value={c.segmento ?? ""}
                        onChange={(e) => cambiarSegmento(c, e.target.value)}
                        disabled={guardando}
                        aria-label={"Segmento de " + c.nombre}
                        style={{ minWidth: 130 }}
                      >
                        <option value="">Sin clasificar</option>
                        <option value="buque">Flota (buque)</option>
                        <option value="astillero">Astillero</option>
                        <option value="corporativo">Corporativo / SG&A</option>
                        <option value="excluido">Excluido del P&L</option>
                      </select>
                    </td>
                    <td className="td-mono">{c.xubio_id ?? "—"}</td>
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {MODULOS_CENTRO_COSTO.map((m) => {
                          const on = (c.visible_modulos ?? []).includes(m.id);
                          return (
                            <button
                              key={m.id}
                              type="button"
                              className={`badge badge-btn ${on ? "b-teal" : "b-gray"}`}
                              onClick={() => toggleModulo(c, m.id)}
                              disabled={guardando}
                              title={
                                on
                                  ? `Sacar de ${m.label}`
                                  : `Mostrar en ${m.label}`
                              }
                            >
                              {m.label}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td className="td-actions">
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => borrar(c)}
                        disabled={guardando}
                      >
                        Borrar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!visibles.length && (
            <div className="empty">
              <div className="empty-mono">Sin resultados</div>
              Ningún centro de costo coincide con "{filtro}".
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ============================================================
// ROOT
// ============================================================

export default function App() {
  const [session, setSession] = useState(null);
  const [authLista, setAuthLista] = useState(false);
  const [perfil, setPerfil] = useState(null);
  const [page, setPage] = useState("centros");
  const [navOpen, setNavOpen] = useState(true);

  useEffect(() => {
    let vivo = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (vivo) setSession(data?.session ?? null);
      })
      .catch((err) => {
        console.error("getSession falló", err);
      })
      .finally(() => {
        if (vivo) setAuthLista(true);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_evento, nueva) => {
      setSession(nueva ?? null);
    });

    return () => {
      vivo = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (!userId) {
      setPerfil(null);
      return;
    }
    let vivo = true;
    api
      .getPerfil(userId)
      .then((data) => {
        if (vivo) setPerfil(data ?? null);
      })
      .catch((err) => {
        console.error("No se pudo leer el perfil", err);
      });
    return () => {
      vivo = false;
    };
  }, [userId]);

  if (!authLista) {
    return (
      <>
        <style>{CSS}</style>
        <header className="appbar">
          <span className="appbar-instance">{EMPRESA_DISPLAY} · Finanzas</span>
        </header>
        <div className="content">
          <div className="card card-pad0">
            <div className="empty">
              <div className="empty-mono">Cargando</div>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (!session) {
    return <LoginPage />;
  }

  const usuario = perfil?.nombre ?? session.user?.email ?? "Usuario";
  const inicial = String(usuario).trim().charAt(0).toUpperCase() || "U";
  const seccion = SECCIONES[page] ?? SECCIONES.centros;

  return (
    <>
      <style>{CSS}</style>

      <header className="appbar">
        <img
          src="/integra-logo-white-noclaim.svg"
          alt="INTEGRA"
          className="appbar-iso"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
        <div className="appbar-div" />
        <span className="appbar-instance">{EMPRESA_DISPLAY} · Finanzas</span>
        <div className="appbar-tools">
          <span className="appbar-avatar">{inicial}</span>
          <span className="appbar-user">{usuario}</span>
          <button
            className="appbar-link"
            onClick={() => {
              window.location.href = PORTAL_URL;
            }}
          >
            Volver al portal
          </button>
          <button className="appbar-link" onClick={() => supabase.auth.signOut()}>
            Salir
          </button>
        </div>
      </header>

      <div className={`shell ${navOpen ? "" : "is-collapsed"}`}>
        <nav className="sidebar">
          <div className="sidebar-header">
            <img
              src="/PL.png"
              alt={EMPRESA_DISPLAY}
              className="sidebar-logo-img"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
            {navOpen && (
              <div>
                <div className="sidebar-logo-main">Finanzas</div>
                <div className="sidebar-logo-sub">{EMPRESA_DISPLAY}</div>
              </div>
            )}
          </div>

          <div className="sidebar-nav">
            {NAV.map((it) => (
              <button
                key={it.id}
                className={`ni ${page === it.id ? "active" : ""}`}
                onClick={() => setPage(it.id)}
                title={it.label}
              >
                <span className="ni-num">{NAV_NUM[it.id]}</span>
                {navOpen && <span className="ni-label">{it.label}</span>}
              </button>
            ))}
          </div>

          <div className="sidebar-foot">
            <button className="sidebar-foot-btn" onClick={() => setNavOpen((v) => !v)}>
              <span className="sidebar-foot-ico" aria-hidden="true">
                {navOpen ? "«" : "»"}
              </span>
              {navOpen && (
                <span style={{ flex: 1, textAlign: "left" }}>Colapsar menú</span>
              )}
            </button>
            {navOpen && (
              <div className="sidebar-foot-meta">
                <div>{VERSION}</div>
                <div>POWERED BY INTEGRA</div>
              </div>
            )}
          </div>
        </nav>

        <div className="main">
          <div className="pagehead">
            <div className="crumb">
              <button
                onClick={() => {
                  window.location.href = PORTAL_URL;
                }}
              >
                Portal
              </button>
              <span>/</span>
              <button onClick={() => setPage("centros")}>Finanzas</button>
              <span>/</span>
              <span className="crumb-current">{seccion.titulo}</span>
            </div>
            <div className="pagehead-row">
              <div>
                <h1>{seccion.titulo}</h1>
                {seccion.sub && <p>{seccion.sub}</p>}
              </div>
            </div>
          </div>

          <div className="content">
            {page === "tablero" && <PageTablero />}
            {page === "centros" && <PageCentrosCosto />}
            {page === "tipo_cambio" && <PageTipoCambio />}
            {page === "carga_manual" && <PageCargaManual />}
            {page === "consolidado" && <PagePL />}
          </div>
        </div>
      </div>
    </>
  );
}
