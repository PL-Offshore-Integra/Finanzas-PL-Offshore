// ============================================================
// INTEGRA · FINANZAS — PL Offshore
// Dueño de la tabla maestra `proyectos`. Los demás módulos leen
// la vista `v_proyectos_activos`.
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

const MONEDAS = ["USD", "ARS", "EUR"];
const ESTADOS = ["abierto", "en_curso", "cerrado"];

const ESTADO_LABEL = {
  abierto: "Abierto",
  en_curso: "En curso",
  cerrado: "Cerrado",
};

const ESTADO_BADGE = {
  abierto: "b-blue",
  en_curso: "b-teal",
  cerrado: "b-gray",
};

const FORM_VACIO = {
  codigo: "",
  nombre: "",
  empresa: EMPRESA,
  cliente: "",
  centro_costo: "",
  moneda: "USD",
  presupuesto_total: "",
  fecha_inicio: "",
  fecha_fin: "",
  descripcion: "",
  estado_financiero: "abierto",
};

// Columnas que Finanzas escribe. Nada más de `proyectos` se toca,
// para no pisar campos que administra projects-app.
const CAMPOS_ESCRITURA = Object.keys(FORM_VACIO);

const NAV = [
  {
    titulo: "Maestros",
    items: [
      { id: "proyectos", label: "Proyectos", icon: "folder" },
      { id: "centros", label: "Centros de costo", icon: "tag" },
    ],
  },
  {
    titulo: "Análisis",
    items: [{ id: "consolidado", label: "Consolidado", icon: "chart" }],
  },
];

const SECCIONES = {
  proyectos: {
    titulo: "Proyectos",
    sub: "Fuente de verdad del grupo. Los módulos leen únicamente el proyecto marcado como activo.",
  },
  centros: {
    titulo: "Centros de costo",
    sub: "Lista maestra de centros de costo. Alimenta el campo Centro de costo del formulario de proyectos.",
  },
  consolidado: {
    titulo: "Consolidado",
    sub: "Costos por módulo imputados al proyecto activo.",
  },
};

const ICONS = {
  folder:
    "M3 6a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6L11.4 6H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  tag: "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 3 12V4a1 1 0 0 1 1-1h8a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.6Z",
  panel: "M4 4h16v16H4V4Zm6 0v16",
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

  async listProyectos() {
    const { data, error } = await supabase
      .from("proyectos")
      .select(
        "id, codigo, nombre, empresa, cliente, centro_costo, moneda, presupuesto_total, fecha_inicio, fecha_fin, descripcion, estado_financiero, visible_modulos, origen"
      )
      .eq("empresa", EMPRESA)
      .order("codigo", { ascending: true, nullsFirst: false });
    if (error) throw error;
    return data ?? [];
  },

  async crearProyecto(form) {
    const { data, error } = await supabase
      .from("proyectos")
      .insert([{ ...payload(form), origen: "finanzas" }])
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async actualizarProyecto(id, form) {
    const { data, error } = await supabase
      .from("proyectos")
      .update(payload(form))
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async borrarProyecto(id) {
    const { error } = await supabase.from("proyectos").delete().eq("id", id);
    if (error) throw error;
  },

  // RPC atómica: apaga el visible anterior y prende este en una transacción.
  async marcarVisible(id) {
    const { error } = await supabase.rpc("fin_set_proyecto_visible", { p_id: id });
    if (error) throw error;
  },

  async quitarVisible(id) {
    const { error } = await supabase
      .from("proyectos")
      .update({ visible_modulos: false })
      .eq("id", id);
    if (error) throw error;
  },

  // --- Centros de costo ---------------------------------------
  // Tabla maestra propia de Finanzas. Alimenta el campo Centro de costo.
  // La columna xubio_id queda reservada para mapear contra Xubio.

  async listCentrosCosto() {
    const { data, error } = await supabase
      .from("centros_costo")
      .select("id, codigo, nombre, activo, xubio_id")
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
  // es una decision local: define que centros aparecen en el desplegable del
  // formulario de proyectos, y Xubio no lo administra.
  async setActivoCentros(ids, activo) {
    const { error } = await supabase
      .from("centros_costo")
      .update({ activo })
      .in("id", ids);
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
};

// ============================================================
// HELPERS
// ============================================================

function payload(form) {
  const out = {};
  for (const k of CAMPOS_ESCRITURA) {
    const v = form?.[k];
    if (k === "presupuesto_total") {
      out[k] = v === "" || v === null || v === undefined ? null : Number(v);
    } else if (k === "fecha_inicio" || k === "fecha_fin") {
      out[k] = v || null;
    } else {
      out[k] = typeof v === "string" ? v.trim() || null : (v ?? null);
    }
  }
  return out;
}

function fmtMoneda(valor, moneda) {
  if (valor === null || valor === undefined || valor === "") return "—";
  const n = Number(valor);
  if (!Number.isFinite(n)) return "—";
  return `${moneda ?? ""} ${n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`.trim();
}

function fmtFecha(iso) {
  if (!iso) return "—";
  const p = String(iso).slice(0, 10).split("-");
  if (p.length !== 3) return "—";
  return `${p[2]}/${p[1]}/${p[0]}`;
}

function validar(form) {
  if (!form.nombre?.trim()) return "El nombre del proyecto es obligatorio.";
  if (form.fecha_inicio && form.fecha_fin && form.fecha_fin < form.fecha_inicio)
    return "La fecha de fin no puede ser anterior a la de inicio.";
  if (
    form.presupuesto_total !== "" &&
    form.presupuesto_total !== null &&
    !Number.isFinite(Number(form.presupuesto_total))
  )
    return "El presupuesto tiene que ser un número.";
  return null;
}

function mensajeError(err) {
  const msg = err?.message ?? String(err ?? "Error desconocido");
  if (msg.includes("ux_proyectos_un_visible"))
    return "Ya hay otro proyecto activo. Quitale el estado activo primero.";
  if (msg.includes("ux_proyectos_codigo")) return "Ese código de proyecto ya existe.";
  if (msg.includes("fin_set_proyecto_visible"))
    return "Falta crear la función fin_set_proyecto_visible en Supabase.";
  if (msg.includes("ux_centros_costo_nombre"))
    return "Ya existe un centro de costo con ese nombre.";
  if (msg.includes("centros_costo"))
    return "Falta crear la tabla centros_costo en Supabase. Corré sql/centros_costo.sql.";
  if (msg.includes("violates foreign key"))
    return "El proyecto tiene registros asociados. Cerralo en lugar de borrarlo.";
  return msg;
}

// ============================================================
// CSS · INTEGRA Brand Book v1.0
// ============================================================

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

/*  TOKENS · Navy = estructura, nunca acción. Un solo color de acción.  */
:root{
  --navy:#082F4E;--blue:#056D76;--mid:#4A5560;--light:#C9D0D6;
  --bg:#FAFBFC;--surface:#FFFFFF;--surface2:#F4F6F8;--surface3:#E4E8EC;
  --border:#E4E8EC;--border2:#C9D0D6;
  --text:#0F1419;--muted:#4A5560;--muted2:#7A8792;
  --accent:#056D76;--accent2:#0E7A5F;--warn:#8F5A0B;--danger:#B3261E;
  --mono:'IBM Plex Mono',monospace;--sans:'IBM Plex Sans',sans-serif;--r:4px;
  --nav:#082F4E;--action:#056D76;--action-press:#04565D;
  --tr:color 120ms cubic-bezier(.2,0,.38,.9),background-color 120ms cubic-bezier(.2,0,.38,.9),border-color 120ms cubic-bezier(.2,0,.38,.9);
}
[data-instance="pl-offshore"]{--nav:#002247;--action:#002247;--blue:#002247;--accent:#002247;--action-press:#001730}

body{background:var(--bg);color:var(--text);font-family:var(--sans);font-size:15px;line-height:1.55;min-height:100vh;overflow-x:hidden}
*:focus-visible{outline:2px solid var(--action);outline-offset:2px}

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
.sidebar-logo-sub{font-family:var(--mono);font-size:11px;font-weight:500;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;margin-top:2px}
.sidebar-nav{flex:1;padding:12px 0;overflow-y:auto}
.nav-section{padding:14px 16px 8px;font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.08em;color:var(--muted);text-transform:uppercase;text-align:left}
.ni{display:flex;align-items:center;gap:12px;width:100%;padding:9px 16px 9px 13px;background:transparent;border:0;border-left:3px solid transparent;cursor:pointer;text-align:left;font:400 14px/1.3 var(--sans);color:var(--muted);transition:var(--tr);min-height:38px}
.ni:hover{background:var(--surface2);color:var(--navy)}
.ni.active{background:var(--surface2);border-left-color:var(--action);color:var(--navy);font-weight:500}
.ni-ico{display:block;flex:0 0 auto;color:var(--muted2)}
.ni.active .ni-ico{color:var(--action)}
.ni-label{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sidebar-foot{border-top:1px solid var(--border);padding:12px 8px;display:flex;flex-direction:column;gap:2px}
.sidebar-foot-btn{display:flex;align-items:center;gap:12px;width:100%;padding:9px 10px;background:none;border:0;border-radius:var(--r);cursor:pointer;font:500 13px/1.2 var(--sans);color:var(--muted);transition:var(--tr)}
.sidebar-foot-btn:hover{background:var(--surface2);color:var(--navy)}
.sidebar-foot-meta{padding:8px 10px 0;font-family:var(--mono);font-size:11px;font-weight:500;line-height:1.6;letter-spacing:.06em;color:var(--muted2)}
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
.pagehead h1{font:600 24px/1.25 var(--sans);color:var(--navy)}
.pagehead p{font:400 13px/1.45 var(--sans);color:var(--muted);margin:6px 0 0;max-width:70ch}
.pagehead-actions{display:flex;gap:8px;flex:0 0 auto}
.content{flex:1;overflow-y:auto;overflow-x:hidden;padding:24px;background:var(--bg)}

/*  PANELES  */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:24px;margin-bottom:16px}
.card-pad0{padding:0}

/*  KPIs  */
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-bottom:24px}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:16px 18px;min-width:0}
.stat-label{font-family:var(--mono);font-size:11px;color:var(--muted);font-weight:500;letter-spacing:.08em;margin-bottom:8px;text-transform:uppercase}
.stat-value{font-family:var(--mono);font-size:30px;font-weight:600;color:var(--navy);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.stat-value.sm{font-size:18px;line-height:1.4}

/*  TABLAS  */
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th{font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.08em;color:var(--muted);text-transform:uppercase;padding:10px 12px;text-align:left;border-bottom:2px solid var(--navy);white-space:nowrap;background:var(--surface)}
td{padding:12px;border-bottom:1px solid var(--border);vertical-align:middle}
tr:last-child td{border-bottom:none}
tr.is-visible td{background:var(--surface2)}
.td-mono{font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}
.td-actions{white-space:nowrap;text-align:right}
.td-actions .btn+.btn{margin-left:8px}

/*  BADGES  */
.badge{display:inline-flex;align-items:center;font-family:var(--mono);font-size:11px;font-weight:500;padding:3px 8px;border-radius:3px;white-space:nowrap;letter-spacing:.06em;text-transform:uppercase}
.b-blue{background:#E6F1F2;color:#056D76}
.b-teal{background:#E8F3EF;color:#0E7A5F}
.b-gray{background:#F4F6F8;color:#4A5560}
.b-amber{background:#FBF1E3;color:#8F5A0B}
.b-red{background:#FAEAE8;color:#B3261E}
.badge-btn{border:0;cursor:pointer;font-family:var(--mono);transition:var(--tr)}
.badge-btn:hover{filter:brightness(.96)}
.badge-btn:disabled{cursor:not-allowed;opacity:.6}

/*  BOTONES · un solo primario por vista  */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-family:var(--sans);font-size:14px;font-weight:500;height:36px;padding:0 16px;border-radius:var(--r);border:1px solid transparent;cursor:pointer;transition:var(--tr);white-space:nowrap}
.btn-primary{background:var(--action);color:#fff}
.btn-primary:hover{background:var(--navy)}
.btn-primary:active{background:var(--action-press)}
.btn-ghost{background:var(--surface);color:var(--muted);border-color:var(--border2)}
.btn-ghost:hover{color:var(--text);background:var(--surface2)}
.btn-danger{background:var(--surface);color:var(--danger);border-color:var(--border2)}
.btn-danger:hover{background:#FAEAE8;border-color:var(--danger)}
.btn-sm{height:28px;padding:0 12px;font-size:13px}
.btn:disabled{background:var(--surface3);color:var(--muted2);border-color:transparent;cursor:not-allowed}

/*  AVISOS · borde izquierdo de 3px, sin fondos saturados  */
.note{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--border2);border-radius:var(--r);padding:12px 16px;font:400 13px/1.45 var(--sans);margin-bottom:16px}
.note strong{font-weight:600}
.note-err{border-left-color:var(--danger)}
.note-ok{border-left-color:var(--accent2)}
.note-info{border-left-color:var(--action)}
.note-warn{border-left-color:var(--warn)}

/*  FORMULARIOS  */
.fg{display:flex;flex-direction:column;gap:6px;min-width:0}
.fg label{font-family:var(--mono);font-size:11px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;font-weight:500}
.fg input,.fg select,.fg textarea{background:var(--surface);border:1px solid var(--border2);border-radius:var(--r);color:var(--text);font-family:var(--sans);font-size:14px;height:36px;padding:0 12px;outline:none;transition:var(--tr);width:100%}
.fg textarea{resize:vertical;min-height:72px;height:auto;padding:10px 12px}
.fg input:focus,.fg select:focus,.fg textarea:focus{border-width:2px;border-color:var(--action);padding:0 11px}
.fg textarea:focus{padding:9px 11px}
.fg input[readonly]{background:var(--surface2);color:var(--muted)}
.form-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-bottom:16px}
.form-section{font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.08em;color:var(--muted);text-transform:uppercase;margin:0 0 16px;padding-bottom:8px;border-bottom:1px solid var(--border)}
.form-ftr{display:flex;gap:8px;justify-content:flex-end;margin-top:24px;padding-top:16px;border-top:1px solid var(--border)}

.empty{padding:48px 24px;text-align:center;color:var(--muted);font-size:14px}
.empty-mono{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted2);margin-bottom:8px}

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

function Ico({ d, size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

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
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    .login-page{min-height:100vh;display:grid;grid-template-columns:minmax(0,1fr) 560px;background:#FFFFFF;font-family:'IBM Plex Sans',sans-serif;color:#0F1419;text-align:left}
    .login-left{display:flex;flex-direction:column;justify-content:space-between;gap:48px;padding:56px 64px;background:#002247}
    .login-left-integra-img{height:52px;width:auto;object-fit:contain;display:block}
    .login-left-divider{width:100%;height:1px;background:rgba(255,255,255,.14);margin:24px 0}
    .login-left-company{display:flex;align-items:center;gap:14px}
    .login-left-company-logo{width:40px;height:40px;border-radius:4px;object-fit:contain;background:rgba(255,255,255,.14);padding:4px}
    .login-left-company-name{font:600 24px/1.25 'IBM Plex Sans',sans-serif;color:#fff}
    .login-left-line{width:56px;height:3px;background:#F8BC05;margin:24px 0}
    .login-left-sub{font:400 15px/1.55 'IBM Plex Sans',sans-serif;color:rgba(255,255,255,.82);max-width:420px}
    .login-right{display:flex;align-items:center;justify-content:center;padding:56px 64px;background:#FFFFFF}
    .login-card{width:100%;max-width:420px}
    .login-card-eyebrow{font:500 11px/1.2 'IBM Plex Mono',monospace;letter-spacing:.08em;color:#4A5560;text-transform:uppercase;margin-bottom:12px}
    .login-card-title{font:600 24px/1.25 'IBM Plex Sans',sans-serif;color:#082F4E;margin-bottom:8px}
    .login-card-sub{font:400 15px/1.55 'IBM Plex Sans',sans-serif;color:#4A5560;margin-bottom:28px}
    .login-fg{display:flex;flex-direction:column;gap:6px;margin-bottom:16px}
    .login-fg label{font:500 11px/1.2 'IBM Plex Mono',monospace;color:#4A5560;letter-spacing:.08em;text-transform:uppercase}
    .login-fg input{border:1px solid #C9D0D6;border-radius:4px;height:40px;padding:0 12px;font:400 14px/1.2 'IBM Plex Sans',sans-serif;color:#0F1419;background:#FFFFFF;outline:none;transition:border-color 120ms cubic-bezier(.2,0,.38,.9)}
    .login-fg input::placeholder{color:#7A8792}
    .login-fg input:focus{border-width:2px;border-color:#002247;padding:0 11px}
    .login-btn{width:100%;height:44px;padding:0 16px;margin-top:24px;background:#F8BC05;color:#002247;border:none;border-radius:4px;font:600 15px/1.2 'IBM Plex Sans',sans-serif;cursor:pointer;transition:background-color 120ms cubic-bezier(.2,0,.38,.9)}
    .login-btn:hover{background:#DCA704}
    .login-btn:disabled{background:#E4E8EC;color:#7A8792;cursor:not-allowed}
    .login-error{background:#FFFFFF;color:#0F1419;border:1px solid #E4E8EC;border-left:3px solid #B3261E;border-radius:4px;padding:12px 16px;font:400 13px/1.45 'IBM Plex Sans',sans-serif;margin-bottom:16px}
    .login-footer{font:500 11px/1.2 'IBM Plex Mono',monospace;color:#4A5560;margin-top:32px;letter-spacing:.06em}
    .login-back{margin-top:12px;font:500 14px/1.2 'IBM Plex Sans',sans-serif;color:#002247;cursor:pointer;background:none;border:0;padding:0}
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

function ProyectoForm({
  form,
  setForm,
  editando,
  onGuardar,
  onCancelar,
  guardando,
  centros,
  centrosOk,
}) {
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Opciones del desplegable: los centros activos, mas el valor que el proyecto
  // ya tenga cargado, para no perder un centro viejo o desactivado al editar.
  const opcionesCentro = useMemo(() => {
    const activos = (centros ?? []).filter((c) => c.activo).map((c) => c.nombre);
    const actual = form.centro_costo?.trim();
    if (actual && !activos.includes(actual)) return [actual, ...activos];
    return activos;
  }, [centros, form.centro_costo]);

  return (
    <div className="card">
      <div className="form-section">
        {editando ? "Editar proyecto" : "Nuevo proyecto"}
      </div>

      <div className="form-grid">
        <div className="fg">
          <label htmlFor="f-codigo">Código</label>
          <input
            id="f-codigo"
            value={form.codigo ?? ""}
            onChange={set("codigo")}
            placeholder="PL-2026-001"
          />
        </div>
        <div className="fg" style={{ gridColumn: "span 2" }}>
          <label htmlFor="f-nombre">Nombre del proyecto</label>
          <input id="f-nombre" value={form.nombre ?? ""} onChange={set("nombre")} />
        </div>

        <div className="fg">
          <label htmlFor="f-empresa">Empresa</label>
          <input id="f-empresa" value={EMPRESA_DISPLAY} readOnly tabIndex={-1} />
        </div>
        <div className="fg">
          <label htmlFor="f-cliente">Cliente</label>
          <input id="f-cliente" value={form.cliente ?? ""} onChange={set("cliente")} />
        </div>
        <div className="fg">
          <label htmlFor="f-cc">Centro de costo</label>
          {centrosOk ? (
            <select
              id="f-cc"
              value={form.centro_costo ?? ""}
              onChange={set("centro_costo")}
            >
              <option value="">Sin asignar</option>
              {opcionesCentro.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="f-cc"
              value={form.centro_costo ?? ""}
              onChange={set("centro_costo")}
              placeholder="Golondrina de Mar"
            />
          )}
        </div>

        <div className="fg">
          <label htmlFor="f-moneda">Moneda</label>
          <select id="f-moneda" value={form.moneda ?? "USD"} onChange={set("moneda")}>
            {MONEDAS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="fg">
          <label htmlFor="f-ppto">Presupuesto total</label>
          <input
            id="f-ppto"
            type="number"
            step="0.01"
            value={form.presupuesto_total ?? ""}
            onChange={set("presupuesto_total")}
          />
        </div>
        <div className="fg">
          <label htmlFor="f-estado">Estado</label>
          <select
            id="f-estado"
            value={form.estado_financiero ?? "abierto"}
            onChange={set("estado_financiero")}
          >
            {ESTADOS.map((e) => (
              <option key={e} value={e}>
                {ESTADO_LABEL[e]}
              </option>
            ))}
          </select>
        </div>

        <div className="fg">
          <label htmlFor="f-ini">Inicio</label>
          <input
            id="f-ini"
            type="date"
            value={form.fecha_inicio ?? ""}
            onChange={set("fecha_inicio")}
          />
        </div>
        <div className="fg">
          <label htmlFor="f-fin">Fin</label>
          <input
            id="f-fin"
            type="date"
            value={form.fecha_fin ?? ""}
            onChange={set("fecha_fin")}
          />
        </div>
      </div>

      <div className="fg">
        <label htmlFor="f-desc">Descripción</label>
        <textarea
          id="f-desc"
          value={form.descripcion ?? ""}
          onChange={set("descripcion")}
        />
      </div>

      <div className="form-ftr">
        <button className="btn btn-ghost" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </button>
        <button className="btn btn-primary" onClick={onGuardar} disabled={guardando}>
          {guardando ? "Guardando..." : editando ? "Guardar cambios" : "Crear proyecto"}
        </button>
      </div>
    </div>
  );
}

function TablaProyectos({ proyectos, onEditar, onBorrar, onToggleVisible, ocupado }) {
  if (!proyectos.length) {
    return (
      <div className="card card-pad0">
        <div className="empty">
          <div className="empty-mono">Sin proyectos</div>
          Creá el primero para que los módulos puedan imputar contra él.
        </div>
      </div>
    );
  }

  return (
    <div className="card card-pad0">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>En módulos</th>
              <th>Código</th>
              <th>Proyecto</th>
              <th>Cliente</th>
              <th>Centro de costo</th>
              <th>Presupuesto</th>
              <th>Inicio</th>
              <th>Fin</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {proyectos.map((p) => (
              <tr key={p.id} className={p.visible_modulos ? "is-visible" : ""}>
                <td>
                  <button
                    className={`badge badge-btn ${
                      p.visible_modulos ? "b-amber" : "b-gray"
                    }`}
                    onClick={() => onToggleVisible(p)}
                    disabled={ocupado}
                    title={
                      p.visible_modulos
                        ? "Quitar de los módulos"
                        : "Publicar a los módulos"
                    }
                  >
                    {p.visible_modulos ? "Activo" : "Oculto"}
                  </button>
                </td>
                <td className="td-mono">{p.codigo ?? "—"}</td>
                <td>{p.nombre}</td>
                <td>{p.cliente ?? "—"}</td>
                <td>{p.centro_costo ?? "—"}</td>
                <td className="td-mono">{fmtMoneda(p.presupuesto_total, p.moneda)}</td>
                <td className="td-mono">{fmtFecha(p.fecha_inicio)}</td>
                <td className="td-mono">{fmtFecha(p.fecha_fin)}</td>
                <td>
                  <span
                    className={`badge ${ESTADO_BADGE[p.estado_financiero] ?? "b-gray"}`}
                  >
                    {ESTADO_LABEL[p.estado_financiero] ?? p.estado_financiero ?? "—"}
                  </span>
                </td>
                <td className="td-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => onEditar(p)}
                    disabled={ocupado}
                  >
                    Editar
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => onBorrar(p)}
                    disabled={ocupado}
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
  );
}

function PageProyectos({ formAbierto, setFormAbierto }) {
  const [proyectos, setProyectos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [editandoId, setEditandoId] = useState(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [centros, setCentros] = useState([]);
  const [centrosOk, setCentrosOk] = useState(false);

  const load = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const data = await api.listProyectos();
      setProyectos(data);
      try {
        setCentros(await api.listCentrosCosto());
        setCentrosOk(true);
      } catch {
        // Si la tabla centros_costo no existe, el campo sigue siendo texto libre
        // y el modulo funciona igual que antes.
        setCentros([]);
        setCentrosOk(false);
      }
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // El form se puede cerrar desde el sidebar (el padre baja formAbierto).
  // Sin esto, el siguiente "Nuevo proyecto" editaría el registro anterior.
  useEffect(() => {
    if (!formAbierto) {
      setEditandoId(null);
      setForm(FORM_VACIO);
    }
  }, [formAbierto]);

  const visible = useMemo(
    () => proyectos.find((p) => p.visible_modulos) ?? null,
    [proyectos]
  );

  const stats = useMemo(() => {
    const vigentes = proyectos.filter(
      (p) => (p.estado_financiero ?? "abierto") !== "cerrado"
    );
    const porMoneda = {};
    for (const p of vigentes) {
      const n = Number(p.presupuesto_total);
      if (!Number.isFinite(n)) continue;
      const m = p.moneda ?? "USD";
      porMoneda[m] = (porMoneda[m] ?? 0) + n;
    }
    return { total: proyectos.length, abiertos: vigentes.length, porMoneda };
  }, [proyectos]);

  function abrirEdicion(p) {
    setForm({
      codigo: p.codigo ?? "",
      nombre: p.nombre ?? "",
      empresa: p.empresa ?? EMPRESA,
      cliente: p.cliente ?? "",
      centro_costo: p.centro_costo ?? "",
      moneda: p.moneda ?? "USD",
      presupuesto_total: p.presupuesto_total ?? "",
      fecha_inicio: p.fecha_inicio ? String(p.fecha_inicio).slice(0, 10) : "",
      fecha_fin: p.fecha_fin ? String(p.fecha_fin).slice(0, 10) : "",
      descripcion: p.descripcion ?? "",
      estado_financiero: p.estado_financiero ?? "abierto",
    });
    setEditandoId(p.id);
    setFormAbierto(true);
    setError(null);
    setOk(null);
  }

  function cerrarForm() {
    setFormAbierto(false);
    setEditandoId(null);
    setForm(FORM_VACIO);
  }

  async function guardar() {
    const problema = validar(form);
    if (problema) {
      setError(problema);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      if (editandoId) {
        await api.actualizarProyecto(editandoId, form);
        setOk("Proyecto actualizado.");
      } else {
        await api.crearProyecto(form);
        setOk("Proyecto creado.");
      }
      cerrarForm();
      await load();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(p) {
    const confirmado = window.confirm(
      `¿Borrar el proyecto "${p.nombre}"?\n\nSi tiene tareas, requisiciones o registros asociados, la base lo va a rechazar.`
    );
    if (!confirmado) return;
    setGuardando(true);
    setError(null);
    setOk(null);
    try {
      await api.borrarProyecto(p.id);
      setOk("Proyecto borrado.");
      await load();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function toggleVisible(p) {
    const previos = proyectos;
    setProyectos((lista) =>
      lista.map((x) => ({
        ...x,
        visible_modulos: p.visible_modulos ? false : x.id === p.id,
      }))
    );
    setGuardando(true);
    setError(null);
    setOk(null);
    try {
      if (p.visible_modulos) {
        await api.quitarVisible(p.id);
        setOk("Proyecto sacado de los módulos. Ahora no ven ninguno.");
      } else {
        await api.marcarVisible(p.id);
        setOk(`Los módulos ahora ven "${p.nombre}".`);
      }
      await load();
    } catch (err) {
      setProyectos(previos);
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  const totalesTexto =
    Object.keys(stats.porMoneda).length === 0
      ? "—"
      : Object.entries(stats.porMoneda)
          .map(([m, v]) => fmtMoneda(v, m))
          .join("  ·  ");

  return (
    <>
      <Note tipo="err">{error}</Note>
      <Note tipo="ok">{ok}</Note>

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Proyectos</div>
          <div className="stat-value">{stats.total}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Vigentes</div>
          <div className="stat-value">{stats.abiertos}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Presupuesto vigente</div>
          <div className="stat-value sm">{totalesTexto}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Activo en módulos</div>
          <div className="stat-value sm">
            {visible ? (visible.codigo ?? visible.nombre) : "Ninguno"}
          </div>
        </div>
      </div>

      <Note tipo={visible ? "info" : "warn"}>
        {visible ? (
          <>
            Compras, Víveres, Reparaciones, HSQE y Projects están imputando a{" "}
            <strong>
              {visible.codigo ? `${visible.codigo} · ` : ""}
              {visible.nombre}
            </strong>
            .
          </>
        ) : (
          <>
            Ningún proyecto publicado. Los dropdowns de Proyecto en los otros módulos
            van a estar vacíos hasta que actives uno.
          </>
        )}
      </Note>

      {formAbierto && (
        <ProyectoForm
          form={form}
          setForm={setForm}
          centros={centros}
          centrosOk={centrosOk}
          editando={Boolean(editandoId)}
          onGuardar={guardar}
          onCancelar={cerrarForm}
          guardando={guardando}
        />
      )}

      {cargando ? (
        <div className="card card-pad0">
          <div className="empty">
            <div className="empty-mono">Cargando</div>
          </div>
        </div>
      ) : (
        <TablaProyectos
          proyectos={proyectos}
          onEditar={abrirEdicion}
          onBorrar={borrar}
          onToggleVisible={toggleVisible}
          ocupado={guardando}
        />
      )}
    </>
  );
}

function PageConsolidado() {
  return (
    <div className="card card-pad0">
      <div className="empty">
        <div className="empty-mono">Pendiente</div>
        Se conecta cuando exista la vista <code>v_fin_movimientos</code>, que une
        Compras, Víveres, Reparaciones y HSQE contra el proyecto activo.
      </div>
    </div>
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
          centro sigue existiendo en Xubio; los inactivos ya no están ahí. Solo
          los activos aparecen en el formulario de proyectos.
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
                  <th>Xubio</th>
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
                    <td className="td-mono">{c.xubio_id ?? "—"}</td>
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
  const [page, setPage] = useState("proyectos");
  const [navOpen, setNavOpen] = useState(true);
  const [formAbierto, setFormAbierto] = useState(false);

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
  const seccion = SECCIONES[page] ?? SECCIONES.proyectos;

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
            {NAV.map((grupo) => (
              <div key={grupo.titulo} style={{ marginBottom: 8 }}>
                {navOpen && <div className="nav-section">{grupo.titulo}</div>}
                {grupo.items.map((it) => (
                  <button
                    key={it.id}
                    className={`ni ${page === it.id ? "active" : ""}`}
                    onClick={() => {
                      setPage(it.id);
                      setFormAbierto(false);
                    }}
                    title={it.label}
                  >
                    <span className="ni-ico">
                      <Ico d={ICONS[it.icon]} />
                    </span>
                    {navOpen && <span className="ni-label">{it.label}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div className="sidebar-foot">
            <button className="sidebar-foot-btn" onClick={() => setNavOpen((v) => !v)}>
              <span style={{ display: "block", color: "var(--muted2)" }}>
                <Ico d={ICONS.panel} size={16} />
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
              <button onClick={() => setPage("proyectos")}>Finanzas</button>
              <span>/</span>
              <span className="crumb-current">{seccion.titulo}</span>
            </div>
            <div className="pagehead-row">
              <div>
                <h1>{seccion.titulo}</h1>
                {seccion.sub && <p>{seccion.sub}</p>}
              </div>
              {page === "proyectos" && !formAbierto && (
                <div className="pagehead-actions">
                  <button
                    className="btn btn-primary"
                    onClick={() => setFormAbierto(true)}
                  >
                    Nuevo proyecto
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="content">
            {page === "proyectos" && (
              <PageProyectos
                formAbierto={formAbierto}
                setFormAbierto={setFormAbierto}
              />
            )}
            {page === "centros" && <PageCentrosCosto />}
            {page === "consolidado" && <PageConsolidado />}
          </div>
        </div>
      </div>
    </>
  );
}
