// ============================================================================
// SNAPSHOT — captura estado de los workflows de GH Actions y lo escribe a
// state.json que el dashboard de control room consume.
//
// Estructura: equipo → mayordomo (con N modos + subagentes + herramientas).
// Polleamos workflows de DOS repos:
//   - ldomen-png/alfred-cmo-agente (Jeeves, Hudson, infra)
//   - cultome/alfredv2 (Pennyworth, Wadsworth)
// ============================================================================

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_CMO = "ldomen-png/alfred-cmo-agente";
const REPO_PRODUCTO = "cultome/alfredv2";

// Cron humano por workflow. La key es "repo::workflow" para evitar colisiones.
const WORKFLOWS = {
  [`${REPO_CMO}::cmo.yml`]: { cron: "L-V 8:00 CDMX (+ manual)" },
  [`${REPO_CMO}::brief-semanal.yml`]: { cron: "Domingo 16:00 CDMX" },
  [`${REPO_CMO}::generar.yml`]: { cron: "Solo manual · rollback" },
  [`${REPO_CMO}::publicar.yml`]: { cron: "L-V 10:00 CDMX" },
  [`${REPO_CMO}::metricas.yml`]: { cron: "Diario 16:00 CDMX" },
  [`${REPO_CMO}::cro.yml`]: { cron: "L-V 9:00 CDMX" },
  [`${REPO_CMO}::brief-cro-semanal.yml`]: { cron: "Domingo 17:30 CDMX" },
  [`${REPO_CMO}::dashboard-snapshot.yml`]: { cron: "Cada 15 minutos" },
  [`${REPO_CMO}::watchdog.yml`]: { cron: "L-V 14:30-17:00 UTC (cada 30min)" },
  [`${REPO_CMO}::q.yml`]: { cron: "Manual (Fase 1) — pasará a Dom 10am" },
  [`${REPO_PRODUCTO}::changelog-humano.yml`]: { cron: "Después de cada PR merged" },
  [`${REPO_PRODUCTO}::wadsworth-pr.yml`]: { cron: "Al abrir / actualizar PR" },
  [`${REPO_PRODUCTO}::wadsworth-semanal.yml`]: { cron: "Domingo (síntesis)" },
};

// Estructura de equipos.
const EQUIPOS = [
  {
    grupo: "marketing",
    titulo: "🎯 Equipo de Marketing",
    descripcion: "El centro de gravedad es Jeeves; el Publicador y el Recolector son scripts mecánicos que él orquesta. Stevens corre embebido dentro de cada sesión de Jeeves para auditarlo.",
    mayordomos: [
      {
        id: "jeeves",
        nombre: "Jeeves",
        avatar: "🎩",
        rol: "CMO autónomo — el director de marketing",
        descripcion: "Cada mañana decide qué publicar, en qué red, con qué tono. Lee el calendario, revisa qué funcionó, genera las piezas del día.",
        repo: REPO_CMO,
        modos: [
          { id: "jeeves-diario", titulo: "modo diario (producción)", workflow: "cmo.yml" },
          { id: "jeeves-brief", titulo: "modo brief semanal", workflow: "brief-semanal.yml" },
          { id: "jeeves-legacy", titulo: "generador legacy (rollback manual)", workflow: "generar.yml" },
        ],
        subagentes: [
          {
            id: "stevens",
            nombre: "Stevens",
            avatar: "🎩",
            rol: "Auditor — verifica los reportes de Jeeves",
            descripcion: "Embebido en cmo.yml. Compara lo que Jeeves dijo que hizo vs lo que realmente pasó en filesystem y APIs. Si detecta discrepancia, postea alerta.",
            embebido_en: "cmo.yml",
          },
        ],
        herramientas: [
          {
            id: "publicador",
            nombre: "Publicador",
            avatar: "📤",
            workflow: "publicar.yml",
            descripcion: "Manda las piezas aprobadas a Meta y LinkedIn.",
          },
          {
            id: "recolector",
            nombre: "Recolector de métricas",
            avatar: "📊",
            workflow: "metricas.yml",
            descripcion: "Pulla likes, comentarios, alcance de Meta.",
          },
        ],
      },
    ],
  },
  {
    grupo: "ventas",
    titulo: "💼 Equipo de Ventas",
    descripcion: "Hudson cuida el pipeline y conecta lo que entra desde marketing con demos reales.",
    mayordomos: [
      {
        id: "hudson",
        nombre: "Hudson",
        avatar: "🎩",
        rol: "CRO — vigila el pipeline de ventas",
        descripcion: "Cada mañana revisa qué leads están parados, qué demos vienen, qué follow-ups urgen. Te avisa si algo necesita acción humana.",
        repo: REPO_CMO,
        modos: [
          { id: "hudson-diario", titulo: "modo diario", workflow: "cro.yml" },
          { id: "hudson-brief", titulo: "modo brief semanal", workflow: "brief-cro-semanal.yml" },
        ],
        subagentes: [],
        herramientas: [],
      },
    ],
  },
  {
    grupo: "producto",
    titulo: "🛠 Equipo de Producto",
    descripcion: "Mayordomos que viven en el repo del producto (cultome/alfredv2). No producen marketing, pero alimentan a Jeeves con cambios del producto y vigilan la calidad visual.",
    mayordomos: [
      {
        id: "pennyworth",
        nombre: "Pennyworth",
        avatar: "🎩",
        rol: "Traductor técnico → humano del producto Alfred",
        descripcion: "Cada vez que se mergea un PR, Pennyworth genera un changelog en español claro. Lo que ves aquí etiquetado 'cambio del producto' es obra suya. Jeeves lo lee para decidir piezas build-in-public.",
        repo: REPO_PRODUCTO,
        modos: [
          { id: "pennyworth", titulo: "después de cada PR merged", workflow: "changelog-humano.yml" },
        ],
        subagentes: [],
        herramientas: [],
      },
      {
        id: "wadsworth",
        nombre: "Wadsworth",
        avatar: "🎩",
        rol: "Reviewer crítico de UX/UI",
        descripcion: "Por cada PR con cambios visuales abre un análisis enfocado en accesibilidad, consistencia y UX B2B. También entrega un brief semanal con tendencias.",
        repo: REPO_PRODUCTO,
        modos: [
          { id: "wadsworth-pr", titulo: "review per-PR", workflow: "wadsworth-pr.yml" },
          { id: "wadsworth-semanal", titulo: "síntesis semanal", workflow: "wadsworth-semanal.yml" },
        ],
        subagentes: [],
        herramientas: [],
      },
    ],
  },
  {
    grupo: "rd",
    titulo: "🧪 R&D",
    descripcion: "Q investiga producto, mercado, sistema de mayordomos y adyacencias. Entrega hipótesis falsables con evidencia. Reporta solo al founder.",
    mayordomos: [
      {
        id: "q",
        nombre: "Q",
        avatar: "🧪",
        rol: "R&D — investigación y experimentación",
        descripcion: "Cada semana rota foco (semana 1=producto, 2=mercado, 3=sistema, 4=adyacencias) y publica 0-3 hipótesis falsables con evidencia + experimento sugerido. Cero es legítimo si no encuentra señal fuerte.",
        repo: REPO_CMO,
        modos: [
          { id: "q-investigacion", titulo: "sesión de investigación (Fase 1: manual)", workflow: "q.yml" },
        ],
        subagentes: [],
        herramientas: [],
      },
    ],
  },
  {
    grupo: "infraestructura",
    titulo: "⚙️ Infraestructura",
    descripcion: "Scripts de soporte. No producen marketing ni ventas, mantienen el tablero funcionando.",
    mayordomos: [],
    herramientas_sueltas: [
      {
        id: "snapshot",
        nombre: "Snapshot del dashboard",
        avatar: "📸",
        workflow: "dashboard-snapshot.yml",
        repo: REPO_CMO,
        descripcion: "Refresca los datos que ves en este tablero. Si falla, los demás mayordomos siguen — solo la vista se atrasa.",
      },
      {
        id: "watchdog",
        nombre: "Watchdog",
        avatar: "🐕",
        workflow: "watchdog.yml",
        repo: REPO_CMO,
        descripcion: "Supervisa que Jeeves y Hudson hayan corrido cada mañana. Si GitHub Actions se duerme y no dispara los crons, este los levanta manualmente y avisa por Slack.",
      },
    ],
  },
];

// Mayordomos planeados pero no implementados todavía. Single section, sin polleo.
// (Q salió de aquí en 2026-05-24 — ahora está activo en equipo R&D.)
const MAYORDOMOS_PLANEADOS = [];

// Lee content/pendientes.json del filesystem y devuelve una vista limpia
// para el dashboard. Mantiene los campos relevantes — copy preview, estado,
// celda, vertical, etapa funnel, audit metadata.
function leerPiezasCola() {
  const pendientesPath = path.join(__dirname, "..", "content", "pendientes.json");
  let piezas = [];
  try {
    piezas = JSON.parse(fs.readFileSync(pendientesPath, "utf-8"));
  } catch {
    return [];
  }
  return piezas.map((p) => ({
    id: p.id,
    fecha_generada: p.fecha_generada,
    red: p.red,
    formato: p.formato,
    celda: p.celda,
    angulo: p.angulo,
    estado: p.estado,
    vertical: p.vertical || null,
    etapa_funnel: p.etapa_funnel || null,
    template_visual: p.template_visual || null,
    copy_preview: (p.contenido?.copy || "").slice(0, 280),
    headline_imagen: p.contenido?.headline_imagen || null,
    imagen_url: p.imagen_url || null,
    rechazo_motivo: p.rechazo_motivo || null,
    degradado_por: p.degradado_por || null,
    degradado_motivo: p.degradado_motivo || null,
    clasificador: p.clasificador || null,
  }));
}

function ghApi(endpoint) {
  try {
    // Comillas obligatorias: los & del query string parten el comando en el
    // shell y se pierde el exit code de gh (errores del API pasan como output).
    const out = execSync(`gh api -H "Accept: application/vnd.github+json" "${endpoint}"`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(out);
  } catch (e) {
    return null;
  }
}

function normalizarRun(run) {
  if (!run) return null;
  return {
    id: run.id,
    run_number: run.run_number,
    status: run.status,
    conclusion: run.conclusion,
    created_at: run.created_at,
    updated_at: run.updated_at,
    html_url: run.html_url,
    head_branch: run.head_branch,
    event: run.event,
    actor: run.actor?.login,
    duration_seconds:
      run.status === "completed"
        ? Math.round((new Date(run.updated_at) - new Date(run.created_at)) / 1000)
        : null,
  };
}

function computarEstado(latest) {
  if (!latest) return "nunca-corrio";
  if (latest.status === "in_progress" || latest.status === "queued") return "trabajando";
  if (latest.status === "completed") {
    if (latest.conclusion === "success") {
      const horasDesde = (Date.now() - new Date(latest.updated_at).getTime()) / 3600000;
      if (horasDesde < 1) return "fresco-exitoso";
      if (horasDesde < 24) return "exitoso";
      return "descansando";
    }
    if (latest.conclusion === "failure") return "fallido";
    if (latest.conclusion === "cancelled") return "cancelado";
    if (latest.conclusion === "skipped") return "saltado";
    return "completado";
  }
  return "desconocido";
}

function consultarWorkflow(repo, workflow) {
  const runs = ghApi(`/repos/${repo}/actions/workflows/${workflow}/runs?per_page=5`);
  const runsNorm = (runs?.workflow_runs || []).map(normalizarRun);
  const latest = runsNorm[0] || null;
  return {
    workflow,
    repo,
    cron_human: WORKFLOWS[`${repo}::${workflow}`]?.cron || "—",
    estado: computarEstado(latest),
    last_run: latest,
    latest_runs: runsNorm,
  };
}

const PESO_ESTADO = {
  fallido: 100,
  "nunca-corrio": 50,
  cancelado: 40,
  saltado: 30,
  trabajando: 20,
  desconocido: 15,
  descansando: 10,
  exitoso: 5,
  "fresco-exitoso": 1,
  completado: 5,
};

function peorEstado(estados) {
  if (!estados.length) return "desconocido";
  return estados.reduce((peor, e) => (PESO_ESTADO[e] > PESO_ESTADO[peor] ? e : peor), estados[0]);
}

function normalizarIssue(issue) {
  if (issue.pull_request) return null;
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    html_url: issue.html_url,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    author: issue.user?.login,
    labels: (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name)),
    comments: issue.comments,
  };
}

function categorizar(issue) {
  const labels = issue.labels || [];
  if (labels.includes("changelog-alfred")) return "changelog";
  if (labels.some((l) => l.startsWith("agent:"))) return "tarea";
  if (labels.includes("cmo-agente")) return "agent-notification";
  if (labels.some((l) => l.startsWith("reporte"))) return "brief";
  return "otro";
}

function snapshot() {
  console.log(`[snapshot] consultando workflows...`);

  // Pulleamos cada workflow único una sola vez y guardamos por key "repo::workflow".
  const estadoPorWorkflow = {};
  for (const key of Object.keys(WORKFLOWS)) {
    const [repo, workflow] = key.split("::");
    estadoPorWorkflow[key] = consultarWorkflow(repo, workflow);
    console.log(`  ${key.padEnd(60)} → ${estadoPorWorkflow[key].estado}`);
  }

  // Enriquecer la estructura del equipo.
  const equipos = EQUIPOS.map((eq) => ({
    ...eq,
    mayordomos: (eq.mayordomos || []).map((m) => {
      const repo = m.repo;
      const modos = m.modos.map((mode) => ({
        ...mode,
        ...estadoPorWorkflow[`${repo}::${mode.workflow}`],
      }));
      const herramientas = (m.herramientas || []).map((h) => ({
        ...h,
        ...estadoPorWorkflow[`${repo}::${h.workflow}`],
      }));
      // Stevens: su estado = el de cmo.yml (donde corre embebido)
      const subagentes = (m.subagentes || []).map((s) => {
        const w = estadoPorWorkflow[`${repo}::${s.embebido_en}`];
        return { ...s, estado: w?.estado || "desconocido", last_run: w?.last_run || null };
      });
      return {
        ...m,
        modos,
        herramientas,
        subagentes,
        estado_general: peorEstado(modos.map((md) => md.estado)),
      };
    }),
    herramientas_sueltas: (eq.herramientas_sueltas || []).map((h) => ({
      ...h,
      ...estadoPorWorkflow[`${h.repo}::${h.workflow}`],
    })),
  }));

  // Cola de piezas (pendientes.json del repo) — útil durante afinación
  // para ver qué Jeeves está produciendo. Lo leemos del filesystem porque
  // el snapshot corre dentro del repo en GH Actions.
  console.log(`\n[snapshot] leyendo cola de piezas...`);
  const piezasCola = leerPiezasCola();
  console.log(`  ${piezasCola.length} piezas en cola`);

  console.log(`\n[snapshot] consultando Issues recientes...`);
  const issuesRaw = ghApi(`/repos/${REPO_CMO}/issues?state=all&per_page=30&sort=updated&direction=desc`);
  const issues = (Array.isArray(issuesRaw) ? issuesRaw : [])
    .map(normalizarIssue)
    .filter(Boolean)
    .map((i) => ({ ...i, categoria: categorizar(i) }));
  console.log(`  ${issues.length} issues encontrados`);

  const state = {
    repo: REPO_CMO,
    generated_at: new Date().toISOString(),
    equipos,
    mayordomos_planeados: MAYORDOMOS_PLANEADOS,
    piezas_cola: piezasCola,
    issues,
  };

  const outFile = path.join(__dirname, "state.json");
  fs.writeFileSync(outFile, JSON.stringify(state, null, 2));
  console.log(`\n[snapshot] ✓ escrito ${path.relative(process.cwd(), outFile)}`);
}

snapshot();
