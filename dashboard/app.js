// ============================================================================
// Alfred · Control Room — frontend
// Renderiza la jerarquía equipo → mayordomo (modos + subagentes + herramientas)
// + feed de issues + bitácora técnica colapsable.
// ============================================================================

const STATE_URL = "state.json";
const REFRESH_MS = 60_000;

const PILL_LABELS = {
  trabajando: "Trabajando",
  "fresco-exitoso": "OK · fresco",
  exitoso: "OK",
  descansando: "Idle",
  fallido: "Falló",
  cancelado: "Cancelado",
  saltado: "Skipped",
  "nunca-corrio": "Sin correr",
  desconocido: "?",
  completado: "Completado",
};

function estadoFraseCorta(estado, cron) {
  switch (estado) {
    case "fresco-exitoso": return "Acaba de correr · OK";
    case "exitoso": return "Corrió hoy · OK";
    case "descansando": return cron ? `Idle · próx ${cron}` : "Idle";
    case "trabajando": return "Trabajando ahora…";
    case "fallido": return "⚠️ Falló — revisa logs";
    case "cancelado": return "Cancelado manual";
    case "saltado": return "Skipped";
    case "nunca-corrio": return cron ? `Sin correr · próx ${cron}` : "Sin correr";
    default: return "Estado desconocido";
  }
}

const HEALTH_GROUPS = {
  ok: ["fresco-exitoso", "exitoso", "descansando"],
  warn: ["cancelado", "saltado", "nunca-corrio"],
  err: ["fallido"],
  busy: ["trabajando"],
};

const CATEGORIA_ICON = {
  changelog: "📝",
  brief: "📊",
  "agent-notification": "🔔",
  tarea: "📋",
  otro: "📦",
};
const CATEGORIA_LABEL = {
  changelog: "Cambio del producto",
  brief: "Brief semanal",
  "agent-notification": "Reporte de mayordomo",
  tarea: "Tarea",
  otro: "Otro",
};

let STATE = null;
let activeFilter = "all";
let colaFilter = "all";

function tiempoRelativo(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "hace segundos";
  if (min < 60) return `hace ${min}m`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `hace ${horas}h`;
  const dias = Math.floor(horas / 24);
  if (dias < 7) return `hace ${dias}d`;
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

function formatearDuracion(segundos) {
  if (segundos == null) return "—";
  if (segundos < 60) return `${segundos}s`;
  const min = Math.floor(segundos / 60);
  const seg = segundos % 60;
  return `${min}m${seg ? ` ${seg}s` : ""}`;
}

// ---------- Health summary ----------

function renderHealth() {
  const el = document.getElementById("health-summary");
  if (!STATE?.equipos) { el.textContent = "—"; return; }

  // Agregamos TODOS los estados (modos + herramientas + sueltas) para el health.
  const estados = [];
  for (const eq of STATE.equipos) {
    for (const m of eq.mayordomos || []) {
      for (const md of m.modos || []) estados.push(md.estado);
      for (const h of m.herramientas || []) estados.push(h.estado);
    }
    for (const h of eq.herramientas_sueltas || []) estados.push(h.estado);
  }

  const conteo = { ok: 0, warn: 0, err: 0, busy: 0 };
  for (const e of estados) {
    if (HEALTH_GROUPS.ok.includes(e)) conteo.ok++;
    else if (HEALTH_GROUPS.warn.includes(e)) conteo.warn++;
    else if (HEALTH_GROUPS.err.includes(e)) conteo.err++;
    else if (HEALTH_GROUPS.busy.includes(e)) conteo.busy++;
  }

  const partes = [];
  if (conteo.ok) partes.push(`<span class="h-ok">${conteo.ok} ✓ bien</span>`);
  if (conteo.busy) partes.push(`<span>${conteo.busy} ⟳ activos</span>`);
  if (conteo.warn) partes.push(`<span class="h-warn">${conteo.warn} ⚠ por correr</span>`);
  if (conteo.err) partes.push(`<span class="h-err">${conteo.err} ✗ fallaron</span>`);
  el.innerHTML = partes.join(" · ") || "—";
}

// ---------- Equipos ----------

function renderEquipos() {
  const wrap = document.getElementById("agent-groups");
  if (!STATE?.equipos) {
    wrap.innerHTML = `<div class="loading">sin datos</div>`;
    return;
  }

  wrap.innerHTML = STATE.equipos.map(renderEquipo).join("");
}

function renderEquipo(eq) {
  const mayordomos = (eq.mayordomos || []).map(renderMayordomoCard).join("");
  const sueltas = (eq.herramientas_sueltas || []).map(renderHerramientaCard).join("");
  return `
    <div class="agent-group">
      <div class="group-header">
        <h2 class="group-title">${eq.titulo}</h2>
        ${eq.descripcion ? `<p class="group-desc">${escapeHtml(eq.descripcion)}</p>` : ""}
      </div>
      <div class="agents-grid">${mayordomos}${sueltas}</div>
    </div>
  `;
}

function renderMayordomoCard(m) {
  const ghUrl = `https://github.com/${m.repo}/actions`;

  const modosHtml = m.modos.map((md) => {
    // Si nunca corrió, solo mostramos el cron + pill (no duplicamos "sin correr")
    const ultimaTxt = md.last_run ? `corrió ${tiempoRelativo(md.last_run.updated_at)}` : null;
    return `
      <div class="modo-row" data-estado="${md.estado}">
        <div class="modo-titulo">
          <span class="dot-estado dot-${classOf(md.estado)}"></span>
          <span>${escapeHtml(md.titulo)}</span>
        </div>
        <div class="modo-meta">
          <span class="mono">${escapeHtml(md.cron_human)}</span>
          ${ultimaTxt ? `<span class="modo-ultima">· ${ultimaTxt}</span>` : ""}
          <span class="status-pill compact" data-estado="${md.estado}">${PILL_LABELS[md.estado] || md.estado}</span>
        </div>
      </div>
    `;
  }).join("");

  const subagentesHtml = (m.subagentes || []).length ? `
    <div class="sub-section">
      <div class="sub-label">Subagente embebido</div>
      ${m.subagentes.map((s) => `
        <div class="subagente-row" data-estado="${s.estado}">
          <div class="subagente-head">
            <span class="subagente-avatar">${s.avatar || "🎩"}</span>
            <span class="subagente-nombre">${escapeHtml(s.nombre)}</span>
            <span class="status-pill compact subagente-pill">corre dentro de ${escapeHtml(m.nombre)}</span>
          </div>
          <p class="subagente-desc">${escapeHtml(s.rol)}. ${escapeHtml(s.descripcion)}</p>
        </div>
      `).join("")}
    </div>
  ` : "";

  const herramientasHtml = (m.herramientas || []).length ? `
    <div class="sub-section">
      <div class="sub-label">Herramientas que orquesta</div>
      ${m.herramientas.map((h) => `
        <div class="herramienta-row" data-estado="${h.estado}">
          <span class="herramienta-avatar">${h.avatar}</span>
          <div class="herramienta-info">
            <div class="herramienta-nombre">${escapeHtml(h.nombre)}</div>
            <div class="herramienta-desc">${escapeHtml(h.descripcion)}</div>
          </div>
          <div class="herramienta-meta">
            <span class="mono">${escapeHtml(h.cron_human)}</span>
            <span class="status-pill compact" data-estado="${h.estado}">${PILL_LABELS[h.estado] || h.estado}</span>
          </div>
        </div>
      `).join("")}
    </div>
  ` : "";

  return `
    <div class="mayordomo-card" data-estado="${m.estado_general}">
      <div class="mayordomo-head">
        <div class="mayordomo-identity">
          <div class="mayordomo-avatar">${m.avatar}</div>
          <div>
            <h3 class="mayordomo-name">${escapeHtml(m.nombre)}</h3>
            <div class="mayordomo-rol">${escapeHtml(m.rol)}</div>
          </div>
        </div>
        <span class="status-pill" data-estado="${m.estado_general}">${PILL_LABELS[m.estado_general] || m.estado_general}</span>
      </div>

      <p class="mayordomo-desc">${escapeHtml(m.descripcion)}</p>

      <div class="sub-section">
        <div class="sub-label">Modos de operación</div>
        ${modosHtml}
      </div>

      ${subagentesHtml}
      ${herramientasHtml}

      <a class="mayordomo-link" href="${ghUrl}" target="_blank">ver corridas de ${escapeHtml(m.nombre)} en GitHub →</a>
    </div>
  `;
}

// Herramienta suelta (no orquestada por un mayordomo).
function renderHerramientaCard(h) {
  const ghUrl = `https://github.com/${h.repo}/actions/workflows/${h.workflow}`;
  return `
    <div class="mayordomo-card herramienta-card" data-estado="${h.estado}">
      <div class="mayordomo-head">
        <div class="mayordomo-identity">
          <div class="mayordomo-avatar herramienta-avatar-big">${h.avatar}</div>
          <div>
            <h3 class="mayordomo-name">${escapeHtml(h.nombre)}</h3>
            <div class="mayordomo-rol"><span class="tipo-badge tipo-herramienta">herramienta</span> ${escapeHtml(h.cron_human)}</div>
          </div>
        </div>
        <span class="status-pill" data-estado="${h.estado}">${PILL_LABELS[h.estado] || h.estado}</span>
      </div>
      <p class="mayordomo-desc">${escapeHtml(h.descripcion)}</p>
      <div class="suelta-narrative">${escapeHtml(estadoFraseCorta(h.estado, h.cron_human))}</div>
      <a class="mayordomo-link" href="${ghUrl}" target="_blank">ver corridas en GitHub →</a>
    </div>
  `;
}

function classOf(estado) {
  if (HEALTH_GROUPS.ok.includes(estado)) return "ok";
  if (HEALTH_GROUPS.busy.includes(estado)) return "busy";
  if (HEALTH_GROUPS.warn.includes(estado)) return "warn";
  if (HEALTH_GROUPS.err.includes(estado)) return "err";
  return "idle";
}

// ---------- Mayordomos planeados (Q) ----------

function renderPlaneados() {
  const wrap = document.getElementById("planeados-grid");
  const section = document.querySelector(".planeados-section");
  if (!STATE?.mayordomos_planeados?.length) {
    wrap.innerHTML = "";
    if (section) section.style.display = "none";
    return;
  }
  if (section) section.style.display = "";
  wrap.innerHTML = STATE.mayordomos_planeados.map((p) => `
    <div class="planeado-card">
      <div class="mayordomo-head">
        <div class="mayordomo-identity">
          <div class="mayordomo-avatar">${p.avatar}</div>
          <div>
            <h3 class="mayordomo-name">${escapeHtml(p.nombre)}</h3>
            <div class="mayordomo-rol">${escapeHtml(p.rol)}</div>
          </div>
        </div>
        <span class="status-pill externo-pill-warn">Planeado</span>
      </div>
      <p class="mayordomo-desc">${escapeHtml(p.descripcion)}</p>
      <div class="suelta-narrative">📍 ${escapeHtml(p.ubicacion)}</div>
    </div>
  `).join("");
}

// ---------- Cola de piezas ----------

function renderCola() {
  const ul = document.getElementById("cola-list");
  if (!STATE?.piezas_cola) {
    ul.innerHTML = `<li class="loading">sin datos</li>`;
    return;
  }

  const piezas = STATE.piezas_cola.filter((p) => {
    if (colaFilter === "all") return true;
    return p.estado === colaFilter;
  });

  if (piezas.length === 0) {
    ul.innerHTML = `<li class="empty">
      ${colaFilter === "all"
        ? "Bandeja vacía. Cuando Jeeves corra, sus piezas aparecerán aquí."
        : `Sin piezas en estado "${colaFilter}".`}
    </li>`;
    return;
  }

  ul.innerHTML = piezas.map(renderPiezaCard).join("");

  ul.querySelectorAll(".pieza-card").forEach((card) => {
    card.addEventListener("click", () => {
      card.classList.toggle("expanded");
    });
  });
}

function renderPiezaCard(p) {
  const estadoLabel = {
    approved: "✅ Aprobada — se publica próximo cron",
    pendiente: "⏳ Pendiente — requiere revisión",
    rejected: "✗ Rechazada",
    published: "📤 Publicada",
  }[p.estado] || p.estado;

  const meta = [
    p.red,
    p.formato,
    p.etapa_funnel,
    p.vertical && p.vertical !== "generico" ? p.vertical : null,
    p.template_visual && p.template_visual !== "standard" ? p.template_visual : null,
  ].filter(Boolean);

  const clasificador = p.clasificador
    ? `<span class="badge ${p.clasificador.auto_aprobable ? "estado-open" : ""}">Clasificador: ${p.clasificador.auto_aprobable ? "OK" : `${p.clasificador.blocking} blocking, ${p.clasificador.warnings} warn`}</span>`
    : "";

  const degradado = p.degradado_por
    ? `<div class="pieza-alerta">⚠️ Degradada por ${p.degradado_por}: ${escapeHtml(p.degradado_motivo)}</div>`
    : "";

  const rechazo = p.rechazo_motivo
    ? `<div class="pieza-alerta">Rechazo: ${escapeHtml(p.rechazo_motivo)}</div>`
    : "";

  return `
    <li class="pieza-card" data-estado="${p.estado}">
      <div class="pieza-head">
        <div class="pieza-id-row">
          <span class="pieza-id">${escapeHtml(p.id)}</span>
          <span class="pieza-meta-pills">
            ${meta.map(m => `<span class="badge">${escapeHtml(m)}</span>`).join("")}
            ${clasificador}
          </span>
        </div>
        <span class="pieza-estado" data-estado="${p.estado}">${estadoLabel}</span>
      </div>

      <div class="pieza-celda-angulo">
        <span class="stat-mini-label">Celda:</span> <span class="stat-mini-value">${escapeHtml(p.celda)}</span>
        <span class="stat-mini-label" style="margin-left:12px;">Ángulo:</span> <span class="stat-mini-value">${escapeHtml(p.angulo)}</span>
      </div>

      ${p.headline_imagen ? `<div class="pieza-headline">"${escapeHtml(p.headline_imagen)}"</div>` : ""}

      <div class="pieza-copy">${escapeHtml(p.copy_preview)}${p.copy_preview.length >= 280 ? "…" : ""}</div>

      ${p.imagen_url ? `<a href="${p.imagen_url}" target="_blank" class="pieza-img-link">🖼 Ver imagen</a>` : ""}

      ${degradado}
      ${rechazo}
    </li>
  `;
}

// ---------- Issues feed ----------

function renderIssuesFeed() {
  const ul = document.getElementById("issues-list");
  if (!STATE?.issues) {
    ul.innerHTML = `<li class="loading">sin datos</li>`;
    return;
  }

  const filtered = STATE.issues.filter((i) => {
    if (activeFilter === "all") return true;
    return i.categoria === activeFilter;
  });

  if (filtered.length === 0) {
    ul.innerHTML = `<li class="empty">
      ${activeFilter === "all"
        ? "Sin notificaciones todavía. Cuando los mayordomos reporten algo (briefs, alertas, cambios), aparecerán aquí."
        : `Sin items en categoría "${CATEGORIA_LABEL[activeFilter] || activeFilter}".`}
    </li>`;
    return;
  }

  ul.innerHTML = filtered.slice(0, 25).map(renderIssueCard).join("");

  ul.querySelectorAll(".issue-card").forEach((card) => {
    card.addEventListener("click", () => {
      const url = card.dataset.url;
      if (url) window.open(url, "_blank");
    });
  });
}

function renderIssueCard(issue) {
  const icon = CATEGORIA_ICON[issue.categoria] || CATEGORIA_ICON.otro;
  const catLabel = CATEGORIA_LABEL[issue.categoria] || issue.categoria;
  const riesgo = issue.labels.find((l) => l.startsWith("riesgo:"))?.split(":")[1];
  const tipo = issue.labels.find((l) => l.startsWith("tipo:"))?.split(":")[1];

  const preview = (issue.body || "")
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n+/g, " ")
    .slice(0, 200);

  return `
    <li class="issue-card" data-cat="${issue.categoria}" data-url="${issue.html_url}">
      <div class="issue-icon">${icon}</div>
      <div class="issue-body">
        <div class="issue-title">${escapeHtml(issue.title)}</div>
        <div class="issue-meta">
          <span class="badge">${catLabel}</span>
          ${riesgo ? `<span class="badge riesgo-${riesgo}">riesgo: ${riesgo}</span>` : ""}
          ${tipo ? `<span class="badge">${tipo}</span>` : ""}
          <span class="badge estado-${issue.state}">${issue.state === "open" ? "abierto" : "cerrado"}</span>
          <span>por ${issue.author}</span>
          ${issue.comments > 0 ? `<span>💬 ${issue.comments}</span>` : ""}
        </div>
        ${preview ? `<div class="issue-preview">${escapeHtml(preview)}</div>` : ""}
      </div>
      <div class="issue-time">${tiempoRelativo(issue.updated_at)}</div>
    </li>
  `;
}

// ---------- Workflow runs feed (bitácora técnica) ----------

function renderRunsFeed() {
  const ul = document.getElementById("activity-feed");
  if (!STATE?.equipos) {
    ul.innerHTML = `<li class="loading">sin datos</li>`;
    return;
  }

  const todas = [];
  for (const eq of STATE.equipos) {
    for (const m of eq.mayordomos || []) {
      for (const md of m.modos || []) {
        for (const r of md.latest_runs || []) {
          todas.push({ ...r, agent_role: `${m.nombre} (${md.titulo})` });
        }
      }
      for (const h of m.herramientas || []) {
        for (const r of h.latest_runs || []) {
          todas.push({ ...r, agent_role: h.nombre });
        }
      }
    }
    for (const h of eq.herramientas_sueltas || []) {
      for (const r of h.latest_runs || []) {
        todas.push({ ...r, agent_role: h.nombre });
      }
    }
  }
  todas.sort((x, y) => new Date(y.updated_at) - new Date(x.updated_at));
  const top = todas.slice(0, 15);

  if (top.length === 0) {
    ul.innerHTML = `<li class="loading">aún no hay actividad</li>`;
    return;
  }

  ul.innerHTML = top
    .map(r => `
      <li>
        <span class="time">${tiempoRelativo(r.updated_at)}</span>
        <span class="agent">${escapeHtml(r.agent_role)}</span>
        <span class="conclusion-${r.conclusion || r.status}">${conclusionHumana(r)}</span>
        <span class="duration">${formatearDuracion(r.duration_seconds)} · <a href="${r.html_url}" target="_blank" class="run-link">#${r.run_number}</a></span>
      </li>
    `)
    .join("");
}

function conclusionHumana(r) {
  const c = r.conclusion || r.status;
  switch (c) {
    case "success": return "✓ ok";
    case "failure": return "✗ falló";
    case "cancelled": return "cancelado";
    case "skipped": return "skip";
    case "in_progress": return "corriendo…";
    case "queued": return "en cola";
    default: return c;
  }
}

// ---------- Utils ----------

function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Filters ----------

document.querySelectorAll("#feed-filters .filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    activeFilter = btn.dataset.filter;
    document.querySelectorAll("#feed-filters .filter-btn").forEach((b) => b.classList.toggle("active", b === btn));
    renderIssuesFeed();
  });
});

document.querySelectorAll("#cola-filters .filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    colaFilter = btn.dataset.colaFilter;
    document.querySelectorAll("#cola-filters .filter-btn").forEach((b) => b.classList.toggle("active", b === btn));
    renderCola();
  });
});

// ---------- Snapshot loader ----------

async function cargar() {
  try {
    const res = await fetch(`${STATE_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    STATE = await res.json();

    document.getElementById("status-snapshot").textContent =
      `actualizado ${tiempoRelativo(STATE.generated_at)}`;
    document.getElementById("footer-repo").textContent = STATE.repo;
    document.getElementById("footer-actions-link").href =
      `https://github.com/${STATE.repo}/actions`;

    renderHealth();
    renderEquipos();
    renderPlaneados();
    renderCola();
    renderIssuesFeed();
    renderRunsFeed();
  } catch (e) {
    document.getElementById("status-snapshot").textContent = `error: ${e.message}`;
  }
}

document.getElementById("btn-refresh").addEventListener("click", cargar);

cargar();
setInterval(cargar, REFRESH_MS);
