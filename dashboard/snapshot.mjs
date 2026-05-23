// ============================================================================
// SNAPSHOT — captura el estado actual de los workflows de GH Actions y los
// convierte en JSON que el dashboard pixel-office consume.
//
// Corre desde dentro del repo (npm script o GH Action). Usa `gh api`
// para evitar manejo de auth manual — gh ya está autenticado en GH Actions
// (vía GITHUB_TOKEN) y en local (gh CLI).
//
// Output: dashboard/state.json con shape:
//   {
//     generated_at: ISO timestamp,
//     agents: [{ id, role, label, last_run: {...}, latest_runs: [...] }]
//   }
// ============================================================================

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = "ldomen-png/alfred-cmo-agente";

// Mapeo workflow → personaje de la oficina.
const AGENTES = [
  {
    id: "cmo-generador",
    workflow: "generar.yml",
    role: "CMO Generador",
    descripcion: "Diario L-V 8am CDMX — genera piezas de marketing",
    desk: { x: 1, y: 1 },
    sprite: "cmo",
  },
  {
    id: "publisher",
    workflow: "publicar.yml",
    role: "Publisher",
    descripcion: "Diario L-V 10am CDMX — publica lo aprobado a Meta/LinkedIn",
    desk: { x: 3, y: 1 },
    sprite: "publisher",
  },
  {
    id: "metricas-bot",
    workflow: "metricas.yml",
    role: "Métricas Bot",
    descripcion: "Diario 4pm CDMX — pulla counters Meta para aprendizaje",
    desk: { x: 5, y: 1 },
    sprite: "metricas",
  },
  {
    id: "cmo-autonomo",
    workflow: "cmo.yml",
    role: "CMO Autónomo",
    descripcion: "Workflow dispatch — agente CMO con tool use",
    desk: { x: 1, y: 3 },
    sprite: "cmo-auto",
  },
  {
    id: "cro",
    workflow: "cro.yml",
    role: "CRO",
    descripcion: "Diario L-V 9am CDMX — revisa pipeline de sales",
    desk: { x: 3, y: 3 },
    sprite: "cro",
  },
  {
    id: "brief-cmo",
    workflow: "brief-semanal.yml",
    role: "Brief CMO",
    descripcion: "Domingo 4pm CDMX — síntesis semanal CMO",
    desk: { x: 5, y: 3 },
    sprite: "brief-cmo",
  },
  {
    id: "brief-cro",
    workflow: "brief-cro-semanal.yml",
    role: "Brief CRO",
    descripcion: "Domingo 5:30pm CDMX — síntesis semanal CRO + atribución",
    desk: { x: 7, y: 3 },
    sprite: "brief-cro",
  },
];

function ghApi(endpoint) {
  try {
    const out = execSync(`gh api -H "Accept: application/vnd.github+json" ${endpoint}`, {
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
    status: run.status, // queued, in_progress, completed
    conclusion: run.conclusion, // success, failure, cancelled, skipped, null
    created_at: run.created_at,
    updated_at: run.updated_at,
    html_url: run.html_url,
    head_branch: run.head_branch,
    event: run.event, // schedule, workflow_dispatch, push
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

function snapshot() {
  console.log(`[snapshot] consultando workflows de ${REPO}...`);

  const agentes = AGENTES.map((a) => {
    // 5 últimas runs de este workflow
    const runs = ghApi(
      `/repos/${REPO}/actions/workflows/${a.workflow}/runs?per_page=5`
    );
    const runsNorm = (runs?.workflow_runs || []).map(normalizarRun);
    const latest = runsNorm[0] || null;
    const estado = computarEstado(latest);

    console.log(
      `  ${a.id.padEnd(20)} → ${estado.padEnd(20)} (${runsNorm.length} runs encontrados)`
    );

    return {
      ...a,
      estado,
      last_run: latest,
      latest_runs: runsNorm,
    };
  });

  const state = {
    repo: REPO,
    generated_at: new Date().toISOString(),
    agents: agentes,
  };

  const outFile = path.join(__dirname, "state.json");
  fs.writeFileSync(outFile, JSON.stringify(state, null, 2));
  console.log(`\n[snapshot] ✓ escrito ${path.relative(process.cwd(), outFile)}`);
}

snapshot();
