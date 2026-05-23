// ============================================================================
// Alfred Office — frontend JS. Lee state.json (snapshot de workflows) y
// renderiza la oficina pixel con un personaje por agente. Click en cualquier
// personaje muestra detalle. Refresca cada 60 segundos.
// ============================================================================

const STATE_URL = "state.json";
const REFRESH_MS = 60_000;

// Iconos por rol (emoji = pragmático y reconocible sin sprites custom).
const ICONOS = {
  "cmo-generador": "✍️",
  publisher: "📤",
  "metricas-bot": "📊",
  "cmo-autonomo": "🧠",
  cro: "💼",
  "brief-cmo": "📋",
  "brief-cro": "📈",
};

// Etiquetas humanas para los estados.
const LABELS_ESTADO = {
  trabajando: "Trabajando",
  "fresco-exitoso": "Fresco · OK",
  exitoso: "OK",
  descansando: "Descansando",
  fallido: "Falló",
  cancelado: "Cancelado",
  saltado: "Saltado",
  "nunca-corrio": "Nunca corrió",
  desconocido: "Desconocido",
  completado: "Completado",
};

const BUBBLES = {
  trabajando: "...",
  fallido: "¡error!",
  "nunca-corrio": "zzz",
};

let STATE = null;
let selectedAgentId = null;

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

// ---------- Renderizado de la oficina ----------

const COLS = 11;
const ROWS = 7;

// Layout estático de tiles: '.' floor, 'D' desk, 'P' plant, 'A' floor-alt (variación).
const OFFICE_LAYOUT = [
  "...........",  // row 0
  ".D.D.D.....",  // row 1 - 3 desks arriba
  "...........",  // row 2
  ".D.D.D.D.P.",  // row 3 - 4 desks abajo + planta
  "...........",  // row 4
  ".P.......P.",  // row 5 - plantas en esquinas
  "...........",  // row 6
];

function renderOffice() {
  const floor = document.getElementById("office-floor");
  floor.style.setProperty("--cols", COLS);
  floor.style.setProperty("--rows", ROWS);
  floor.innerHTML = "";

  // Tiles
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const char = OFFICE_LAYOUT[y]?.[x] || ".";
      const div = document.createElement("div");
      div.className = "tile";
      switch (char) {
        case "D": div.classList.add("tile-desk"); break;
        case "P": div.classList.add("tile-plant"); break;
        case "A": div.classList.add("tile-floor-alt"); break;
        default: div.classList.add((x + y) % 2 ? "tile-floor-alt" : "tile-floor");
      }
      div.style.gridColumn = x + 1;
      div.style.gridRow = y + 1;
      floor.appendChild(div);
    }
  }

  // Characters (uno por agente, posicionado en su desk + 1 fila abajo)
  if (!STATE?.agents) return;

  for (const agent of STATE.agents) {
    const desk = agent.desk;
    const charY = desk.y + 1; // personaje "sentado" un tile debajo del desk
    const charX = desk.x;

    const ch = document.createElement("div");
    ch.className = "character";
    ch.dataset.estado = agent.estado;
    ch.dataset.id = agent.id;
    ch.title = `${agent.role} — ${LABELS_ESTADO[agent.estado] || agent.estado}`;
    // Grid placement — el alignSelf/justifySelf:center viene de styles.css
    ch.style.gridColumn = charX + 1;
    ch.style.gridRow = charY + 1;

    // Icon overlay
    const icon = document.createElement("span");
    icon.className = "character-icon";
    icon.textContent = ICONOS[agent.id] || "🤖";
    ch.appendChild(icon);

    // Speech bubble si aplica
    if (BUBBLES[agent.estado]) {
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.textContent = BUBBLES[agent.estado];
      ch.appendChild(bubble);
    }

    // Label
    const label = document.createElement("div");
    label.className = "character-label";
    label.textContent = agent.role.split(" ").slice(0, 2).join(" ");
    ch.appendChild(label);

    if (selectedAgentId === agent.id) ch.classList.add("selected");

    ch.addEventListener("click", () => {
      selectedAgentId = agent.id;
      renderOffice();
      renderDetail(agent);
    });

    floor.appendChild(ch);
  }
}

// ---------- Sidebar de detalle ----------

function renderDetail(agent) {
  const el = document.getElementById("agent-detail");
  if (!agent) {
    el.innerHTML = `<h3>Click un agente para ver detalle</h3>
      <p class="hint">Cada personaje en la oficina representa un workflow de GitHub Actions. Su estado refleja la última ejecución.</p>`;
    return;
  }

  const last = agent.last_run;
  const recent = (agent.latest_runs || []).slice(0, 5);

  el.innerHTML = `
    <h3>${agent.role}</h3>
    <p class="role">${agent.descripcion}</p>
    <span class="estado-badge" data-estado="${agent.estado}">${LABELS_ESTADO[agent.estado] || agent.estado}</span>
    ${last ? `
      <table>
        <tr><td>Workflow</td><td><code>${agent.workflow}</code></td></tr>
        <tr><td>Última run</td><td>${tiempoRelativo(last.updated_at)}</td></tr>
        <tr><td>Disparada por</td><td>${last.event}${last.actor ? ` (${last.actor})` : ""}</td></tr>
        <tr><td>Conclusión</td><td>${last.conclusion || last.status}</td></tr>
        <tr><td>Duración</td><td>${formatearDuracion(last.duration_seconds)}</td></tr>
        <tr><td>Branch</td><td>${last.head_branch}</td></tr>
        <tr><td>Run #</td><td><a class="run-link" href="${last.html_url}" target="_blank">${last.run_number} →</a></td></tr>
      </table>
    ` : `<p class="hint">Sin runs registradas todavía.</p>`}
    ${recent.length > 1 ? `
      <div class="recent-runs">
        <h4>Últimas ${recent.length} runs</h4>
        <ul>
          ${recent.map(r => `
            <li>
              <span style="color: var(--text-soft);">${tiempoRelativo(r.updated_at)}</span> ·
              <span class="conclusion-${r.conclusion || "none"}">${r.conclusion || r.status}</span> ·
              <a class="run-link" href="${r.html_url}" target="_blank">#${r.run_number}</a>
              ${r.duration_seconds != null ? ` · ${formatearDuracion(r.duration_seconds)}` : ""}
            </li>
          `).join("")}
        </ul>
      </div>
    ` : ""}
  `;
}

// ---------- Activity feed ----------

function renderFeed() {
  const ul = document.getElementById("activity-feed");
  if (!STATE?.agents) {
    ul.innerHTML = `<li class="loading">sin datos</li>`;
    return;
  }

  // Flatten todas las runs, ordenar por fecha desc, tomar 12.
  const todas = [];
  for (const a of STATE.agents) {
    for (const r of a.latest_runs || []) {
      todas.push({ ...r, agent_role: a.role, agent_id: a.id });
    }
  }
  todas.sort((x, y) => new Date(y.updated_at) - new Date(x.updated_at));
  const top = todas.slice(0, 12);

  if (top.length === 0) {
    ul.innerHTML = `<li class="loading">aún no hay actividad</li>`;
    return;
  }

  ul.innerHTML = top
    .map(r => `
      <li>
        <span class="time">${tiempoRelativo(r.updated_at)}</span>
        <span><span class="agent">${r.agent_role}</span> · <span class="conclusion-${r.conclusion || "none"}">${r.conclusion || r.status}</span> · <a href="${r.html_url}" target="_blank" style="color: var(--text-soft); text-decoration: none;">#${r.run_number}</a></span>
        <span class="time">${formatearDuracion(r.duration_seconds)}</span>
      </li>
    `)
    .join("");
}

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

    renderOffice();
    renderFeed();
    if (selectedAgentId) {
      const a = STATE.agents.find(x => x.id === selectedAgentId);
      if (a) renderDetail(a);
    }
  } catch (e) {
    document.getElementById("status-snapshot").textContent = `error: ${e.message}`;
  }
}

document.getElementById("btn-refresh").addEventListener("click", cargar);

cargar();
setInterval(cargar, REFRESH_MS);
