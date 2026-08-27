// ============================================================
// INTEGRA · FINANZAS
// Módulo dueño de la tabla maestra `proyectos`.
// Los demás módulos leen la vista `v_proyectos_activos`.
// Stack: React + Vite + Supabase. Sin router (tabs por estado).
// ============================================================

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "./supabaseClient";

// ============================================================
// CONSTANTES
// ============================================================

const C = {
  navy: "#002247",
  navyLight: "#213363",
  blue: "#235C96",
  amber: "#FBBC05",
  bg: "#F4F6F9",
  card: "#FFFFFF",
  border: "#DDE3EC",
  text: "#1A2333",
  muted: "#6B7A90",
  green: "#1E8E5A",
  red: "#C0392B",
};

// Valor exacto con el que están grabados los proyectos en Supabase.
// El día que hagas el rename Parana Logistica -> PL Offshore, se cambia acá
// y en un UPDATE de la tabla. Un solo lugar.
const EMPRESA = "Parana Logistica";
const EMPRESA_DISPLAY = "PL Offshore";

const MONEDAS = ["USD", "ARS", "EUR"];
const ESTADOS = ["abierto", "en_curso", "cerrado"];

const ESTADO_LABEL = {
  abierto: "Abierto",
  en_curso: "En curso",
  cerrado: "Cerrado",
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

// Columnas que Finanzas escribe. No tocamos nada más de `proyectos`
// para no pisar campos que administra projects-app.
const CAMPOS_ESCRITURA = Object.keys(FORM_VACIO);

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

  // RPC atómica: apaga el visible anterior y prende este en una sola transacción.
  async marcarVisible(id) {
    const { error } = await supabase.rpc("fin_set_proyecto_visible", {
      p_id: id,
    });
    if (error) throw error;
  },

  async quitarVisible(id) {
    const { error } = await supabase
      .from("proyectos")
      .update({ visible_modulos: false })
      .eq("id", id);
    if (error) throw error;
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
  const partes = String(iso).slice(0, 10).split("-");
  if (partes.length !== 3) return "—";
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

function validar(form) {
  if (!form.nombre?.trim()) return "El nombre del proyecto es obligatorio.";
  if (!form.empresa) return "Elegí una empresa.";
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
    return "Ya hay otro proyecto visible. Quitale la visibilidad primero.";
  if (msg.includes("ux_proyectos_codigo"))
    return "Ese código de proyecto ya existe.";
  if (msg.includes("fin_set_proyecto_visible"))
    return "Falta crear la función fin_set_proyecto_visible en Supabase.";
  return msg;
}

// ============================================================
// CSS
// ============================================================

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap');

  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; }

  .fin-root {
    font-family: 'Montserrat', system-ui, sans-serif;
    color: ${C.text};
    background: ${C.bg};
    min-height: 100vh;
    display: flex;
  }

  .fin-sidebar {
    width: 240px;
    flex-shrink: 0;
    background: ${C.navy};
    color: #fff;
    padding: 22px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 100vh;
  }
  .fin-brand { font-weight: 800; font-size: 17px; letter-spacing: .5px; }
  .fin-brand span { color: ${C.amber}; }
  .fin-brand-sub { font-size: 11px; color: #9FB3CC; margin: 4px 0 22px; }

  .fin-navbtn {
    background: transparent; border: none; color: #C9D6E6;
    font-family: inherit; font-size: 13px; font-weight: 600;
    text-align: left; padding: 10px 12px; border-radius: 7px; cursor: pointer;
    width: 100%;
  }
  .fin-navbtn:hover { background: rgba(255,255,255,.08); color: #fff; }
  .fin-navbtn[aria-current="true"] { background: ${C.blue}; color: #fff; }
  .fin-navbtn:focus-visible, .fin-btn:focus-visible, .fin-input:focus-visible {
    outline: 2px solid ${C.amber}; outline-offset: 2px;
  }

  .fin-user {
    margin-top: auto; border-top: 1px solid rgba(255,255,255,.14);
    padding-top: 14px; font-size: 11px; color: #9FB3CC; word-break: break-all;
  }

  .fin-main { flex: 1; padding: 28px 32px 60px; min-width: 0; }
  .fin-h1 { font-size: 22px; font-weight: 800; margin: 0 0 4px; }
  .fin-sub { font-size: 13px; color: ${C.muted}; margin: 0 0 24px; }

  .fin-card {
    background: ${C.card}; border: 1px solid ${C.border};
    border-radius: 10px; padding: 20px; margin-bottom: 20px;
  }

  .fin-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px;
  }
  .fin-field { display: flex; flex-direction: column; gap: 5px; }
  .fin-label { font-size: 11px; font-weight: 700; color: ${C.muted}; text-transform: uppercase; letter-spacing: .4px; }
  .fin-input {
    font-family: inherit; font-size: 13px; padding: 9px 11px;
    border: 1px solid ${C.border}; border-radius: 6px; background: #fff; color: ${C.text};
    width: 100%;
  }
  textarea.fin-input { resize: vertical; min-height: 70px; }

  .fin-btn {
    font-family: inherit; font-size: 13px; font-weight: 700;
    padding: 9px 18px; border-radius: 7px; border: none; cursor: pointer;
  }
  .fin-btn[disabled] { opacity: .5; cursor: not-allowed; }
  .fin-btn-primary { background: ${C.blue}; color: #fff; }
  .fin-btn-ghost { background: #EEF2F7; color: ${C.navyLight}; }
  .fin-btn-danger { background: transparent; color: ${C.red}; padding: 6px 8px; }
  .fin-btn-row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 18px; }

  .fin-tablewrap { overflow-x: auto; }
  .fin-table { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 900px; }
  .fin-table th {
    text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .5px;
    color: ${C.muted}; padding: 10px 12px; border-bottom: 2px solid ${C.border}; white-space: nowrap;
  }
  .fin-table td { padding: 11px 12px; border-bottom: 1px solid #EDF1F6; vertical-align: middle; }
  .fin-table tr[data-visible="true"] { background: #FFFBEC; }

  .fin-chip {
    display: inline-block; font-size: 10.5px; font-weight: 700;
    padding: 3px 9px; border-radius: 20px; white-space: nowrap;
  }
  .fin-chip-on { background: ${C.amber}; color: ${C.navy}; }
  .fin-chip-off { background: #EEF2F7; color: ${C.muted}; }

  .fin-banner {
    border-radius: 8px; padding: 12px 16px; font-size: 13px;
    font-weight: 600; margin-bottom: 18px;
  }
  .fin-banner-err { background: #FDEDEB; color: ${C.red}; border: 1px solid #F5C6C0; }
  .fin-banner-ok { background: #E9F7F0; color: ${C.green}; border: 1px solid #BFE6D3; }
  .fin-banner-info { background: #FFFBEC; color: ${C.navy}; border: 1px solid #F3E0A8; }

  .fin-empty { text-align: center; padding: 44px 20px; color: ${C.muted}; font-size: 13px; }

  .fin-login {
    min-height: 100vh; width: 100%; display: flex; align-items: center; justify-content: center;
    background: ${C.navy}; padding: 20px;
  }
  .fin-login-card { background: #fff; border-radius: 12px; padding: 34px; width: 100%; max-width: 380px; }

  @media (max-width: 860px) {
    .fin-root { flex-direction: column; }
    .fin-sidebar { width: 100%; min-height: auto; flex-direction: row; flex-wrap: wrap; align-items: center; padding: 14px 16px; }
    .fin-brand-sub, .fin-user { display: none; }
    .fin-navbtn { width: auto; }
    .fin-main { padding: 20px 16px 50px; }
  }

  @media (prefers-reduced-motion: reduce) {
    * { animation: none !important; transition: none !important; }
  }
`;

// ============================================================
// COMPONENTES
// ============================================================

function Banner({ tipo, children }) {
  if (!children) return null;
  return <div className={`fin-banner fin-banner-${tipo}`}>{children}</div>;
}

function Login() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  async function entrar() {
    setError(null);
    setCargando(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: pass,
      });
      if (err) throw err;
    } catch (err) {
      setError("No pudimos iniciar sesión. Revisá el mail y la contraseña.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="fin-login">
      <div className="fin-login-card">
        <div style={{ fontWeight: 800, fontSize: 18, color: C.navy }}>
          INTEGRA · Finanzas
        </div>
        <p className="fin-sub" style={{ marginTop: 6 }}>
          Ingresá con tu cuenta del grupo.
        </p>
        <Banner tipo="err">{error}</Banner>
        <div className="fin-field" style={{ marginBottom: 12 }}>
          <label className="fin-label" htmlFor="fin-email">
            Email
          </label>
          <input
            id="fin-email"
            className="fin-input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="fin-field" style={{ marginBottom: 20 }}>
          <label className="fin-label" htmlFor="fin-pass">
            Contraseña
          </label>
          <input
            id="fin-pass"
            className="fin-input"
            type="password"
            autoComplete="current-password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") entrar();
            }}
          />
        </div>
        <button
          className="fin-btn fin-btn-primary"
          style={{ width: "100%" }}
          onClick={entrar}
          disabled={cargando || !email || !pass}
        >
          {cargando ? "Entrando…" : "Entrar"}
        </button>
      </div>
    </div>
  );
}

function ProyectoForm({ form, setForm, editando, onGuardar, onCancelar, guardando }) {
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="fin-card">
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>
        {editando ? "Editar proyecto" : "Nuevo proyecto"}
      </div>

      <div className="fin-grid">
        <div className="fin-field">
          <label className="fin-label">Código</label>
          <input
            className="fin-input"
            value={form.codigo ?? ""}
            onChange={set("codigo")}
            placeholder="PL-2026-001"
          />
        </div>
        <div className="fin-field" style={{ gridColumn: "span 2" }}>
          <label className="fin-label">Nombre *</label>
          <input
            className="fin-input"
            value={form.nombre ?? ""}
            onChange={set("nombre")}
          />
        </div>
        <div className="fin-field">
          <label className="fin-label">Empresa</label>
          <input
            className="fin-input"
            value={EMPRESA_DISPLAY}
            readOnly
            tabIndex={-1}
            style={{ background: "#F4F6F9", color: C.muted }}
          />
        </div>
        <div className="fin-field">
          <label className="fin-label">Cliente</label>
          <input className="fin-input" value={form.cliente ?? ""} onChange={set("cliente")} />
        </div>
        <div className="fin-field">
          <label className="fin-label">Centro de costo</label>
          <input
            className="fin-input"
            value={form.centro_costo ?? ""}
            onChange={set("centro_costo")}
            placeholder="Golondrina de Mar"
          />
        </div>
        <div className="fin-field">
          <label className="fin-label">Moneda</label>
          <select className="fin-input" value={form.moneda ?? "USD"} onChange={set("moneda")}>
            {MONEDAS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="fin-field">
          <label className="fin-label">Presupuesto total</label>
          <input
            className="fin-input"
            type="number"
            step="0.01"
            value={form.presupuesto_total ?? ""}
            onChange={set("presupuesto_total")}
          />
        </div>
        <div className="fin-field">
          <label className="fin-label">Inicio</label>
          <input
            className="fin-input"
            type="date"
            value={form.fecha_inicio ?? ""}
            onChange={set("fecha_inicio")}
          />
        </div>
        <div className="fin-field">
          <label className="fin-label">Fin</label>
          <input
            className="fin-input"
            type="date"
            value={form.fecha_fin ?? ""}
            onChange={set("fecha_fin")}
          />
        </div>
        <div className="fin-field">
          <label className="fin-label">Estado</label>
          <select
            className="fin-input"
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
      </div>

      <div className="fin-field" style={{ marginTop: 14 }}>
        <label className="fin-label">Descripción</label>
        <textarea
          className="fin-input"
          value={form.descripcion ?? ""}
          onChange={set("descripcion")}
        />
      </div>

      <div className="fin-btn-row">
        <button className="fin-btn fin-btn-primary" onClick={onGuardar} disabled={guardando}>
          {guardando ? "Guardando…" : editando ? "Guardar cambios" : "Crear proyecto"}
        </button>
        <button className="fin-btn fin-btn-ghost" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function TablaProyectos({ proyectos, onEditar, onBorrar, onToggleVisible, ocupado }) {
  if (!proyectos.length) {
    return (
      <div className="fin-card">
        <div className="fin-empty">
          Todavía no hay proyectos. Creá el primero para que los módulos puedan imputar.
        </div>
      </div>
    );
  }

  return (
    <div className="fin-card">
      <div className="fin-tablewrap">
        <table className="fin-table">
          <thead>
            <tr>
              <th>Visible</th>
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
              <tr key={p.id} data-visible={p.visible_modulos ? "true" : "false"}>
                <td>
                  <button
                    className="fin-btn"
                    style={{ padding: 0, background: "transparent" }}
                    onClick={() => onToggleVisible(p)}
                    disabled={ocupado}
                    title={
                      p.visible_modulos
                        ? "Quitar de los módulos"
                        : "Hacer visible para los módulos"
                    }
                  >
                    <span
                      className={`fin-chip ${p.visible_modulos ? "fin-chip-on" : "fin-chip-off"}`}
                    >
                      {p.visible_modulos ? "● En módulos" : "○ Oculto"}
                    </span>
                  </button>
                </td>
                <td style={{ fontWeight: 700 }}>{p.codigo ?? "—"}</td>
                <td>{p.nombre}</td>
                <td>{p.cliente ?? "—"}</td>
                <td>{p.centro_costo ?? "—"}</td>
                <td>{fmtMoneda(p.presupuesto_total, p.moneda)}</td>
                <td>{fmtFecha(p.fecha_inicio)}</td>
                <td>{fmtFecha(p.fecha_fin)}</td>
                <td>{ESTADO_LABEL[p.estado_financiero] ?? p.estado_financiero ?? "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button
                    className="fin-btn fin-btn-ghost"
                    style={{ padding: "6px 10px" }}
                    onClick={() => onEditar(p)}
                    disabled={ocupado}
                  >
                    Editar
                  </button>
                  <button
                    className="fin-btn fin-btn-danger"
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

function VistaProyectos() {
  const [proyectos, setProyectos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [formAbierto, setFormAbierto] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [form, setForm] = useState(FORM_VACIO);

  const load = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const data = await api.listProyectos();
      setProyectos(data);
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(
    () => proyectos.find((p) => p.visible_modulos) ?? null,
    [proyectos]
  );

  function abrirNuevo() {
    setForm(FORM_VACIO);
    setEditandoId(null);
    setFormAbierto(true);
    setError(null);
    setOk(null);
  }

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
      setFormAbierto(false);
      setEditandoId(null);
      setForm(FORM_VACIO);
      await load();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(p) {
    const confirmado = window.confirm(
      `¿Borrar el proyecto "${p.nombre}"? Si tiene tareas o compras asociadas, la base lo va a rechazar.`
    );
    if (!confirmado) return;
    setGuardando(true);
    setError(null);
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
    // optimista: reflejamos el cambio y revertimos si falla
    setProyectos((lista) =>
      lista.map((x) => ({
        ...x,
        visible_modulos: p.visible_modulos ? false : x.id === p.id,
      }))
    );
    setGuardando(true);
    setError(null);
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

  return (
    <>
      <h1 className="fin-h1">Proyectos</h1>
      <p className="fin-sub">
        Esta es la fuente de verdad del grupo. Los módulos leen únicamente el proyecto
        marcado como visible.
      </p>

      <Banner tipo="err">{error}</Banner>
      <Banner tipo="ok">{ok}</Banner>
      <Banner tipo="info">
        {visible
          ? `Proyecto activo en todos los módulos: ${visible.codigo ? visible.codigo + " · " : ""}${visible.nombre}`
          : "Ningún proyecto visible. Los dropdowns de Proyecto en los otros módulos van a estar vacíos."}
      </Banner>

      {!formAbierto && (
        <div className="fin-btn-row" style={{ marginTop: 0, marginBottom: 18 }}>
          <button className="fin-btn fin-btn-primary" onClick={abrirNuevo}>
            + Nuevo proyecto
          </button>
          <button className="fin-btn fin-btn-ghost" onClick={load} disabled={cargando}>
            Actualizar
          </button>
        </div>
      )}

      {formAbierto && (
        <ProyectoForm
          form={form}
          setForm={setForm}
          editando={Boolean(editandoId)}
          onGuardar={guardar}
          onCancelar={() => {
            setFormAbierto(false);
            setEditandoId(null);
            setForm(FORM_VACIO);
          }}
          guardando={guardando}
        />
      )}

      {cargando ? (
        <div className="fin-card">
          <div className="fin-empty">Cargando proyectos…</div>
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

function VistaConsolidado() {
  return (
    <>
      <h1 className="fin-h1">Consolidado</h1>
      <p className="fin-sub">Costos por módulo imputados al proyecto activo.</p>
      <div className="fin-card">
        <div className="fin-empty">
          Pendiente: se conecta cuando exista la vista <code>v_fin_movimientos</code> que
          une Compras, Víveres y Cost Tracker.
        </div>
      </div>
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
  const [vista, setVista] = useState("proyectos");

  useEffect(() => {
    let vivo = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!vivo) return;
        setSession(data?.session ?? null);
      })
      .catch((err) => {
        console.error("getSession falló", err);
      })
      .finally(() => {
        if (vivo) setAuthLista(true);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_evento, nuevaSesion) => {
      setSession(nuevaSesion ?? null);
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
        <div className="fin-login">
          <div style={{ color: "#fff", fontFamily: "Montserrat, sans-serif" }}>
            Cargando…
          </div>
        </div>
      </>
    );
  }

  if (!session) {
    return (
      <>
        <style>{CSS}</style>
        <Login />
      </>
    );
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="fin-root">
        <nav className="fin-sidebar">
          <div>
            <div className="fin-brand">
              INTEGRA <span>· Finanzas</span>
            </div>
            <div className="fin-brand-sub">{EMPRESA_DISPLAY}</div>
          </div>

          <button
            className="fin-navbtn"
            aria-current={vista === "proyectos"}
            onClick={() => setVista("proyectos")}
          >
            Proyectos
          </button>
          <button
            className="fin-navbtn"
            aria-current={vista === "consolidado"}
            onClick={() => setVista("consolidado")}
          >
            Consolidado
          </button>

          <div className="fin-user">
            <div style={{ marginBottom: 8 }}>
              {perfil?.nombre ?? session.user?.email ?? "Usuario"}
            </div>
            <button
              className="fin-navbtn"
              style={{ padding: "6px 0" }}
              onClick={() => supabase.auth.signOut()}
            >
              Cerrar sesión
            </button>
          </div>
        </nav>

        <main className="fin-main">
          {vista === "proyectos" && <VistaProyectos />}
          {vista === "consolidado" && <VistaConsolidado />}
        </main>
      </div>
    </>
  );
}
