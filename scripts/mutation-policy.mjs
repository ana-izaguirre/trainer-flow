// Política de mutation testing, sobre el reporte JSON de Stryker.
//
// Stryker solo admite umbrales GLOBALES. Aquí se exige por archivo: los
// módulos que se consideran no negociables no pueden bajar del 100%, y el
// resto se reporta sin romper nada.
//
//   authorization.ts → con RLS en denegación total, es LO ÚNICO que separa
//                      a un cliente de los datos de otro (ADR-010).
//   state-machine.ts → hace imposible que una rutina llegue al cliente sin
//                      aprobación humana.
//   callback-data.ts → parsea el `callback_data` de CUALQUIER botón, dato NO
//                      confiable (lo fabrica quien quiera): es la puerta de
//                      entrada antes de que authorization.ts decida nada.
//   navigation.ts    → decide qué ve cada rol al navegar la rutina
//                      (SPEC-031); usa canViewVersion, no la reimplementa.
//   exercise-library.ts → decide si un ejercicio enlaza a la librería real o
//                      a una búsqueda (SPEC-019 §6, revisada): primero
//                      contra las plantillas, después contra los 601 de
//                      RepDB. Un slug mal elegido llega directo al cliente
//                      — repdb-exercises.ts es solo el dato y no entra
//                      aquí (ver su propio comentario de cabecera).
//   edit-version.ts  → SPEC-004: la edición conversacional. Un fallo de la
//                      IA aquí NUNCA puede tocar el contenido que ya había
//                      — es la misma garantía de degradación que generar,
//                      pero editando en vez de creando.
//   provider-call.ts → el reintento ante el proveedor de IA, compartido
//                      entre generar y editar: la regla de qué falla se
//                      reintenta tiene que ser la MISMA en los dos casos.
//
// validate-draft.ts se mutó desde antes (docs/TESTING.md), pero con deuda
// abierta (mensajes de texto, ~20 guardas redundantes sin documentar aún):
// no entra aquí todavía — ver "La deuda de validate-draft.ts" en ese doc.
//
// Uso: node scripts/mutation-policy.mjs [reports/mutation/mutation.json]
import { appendFileSync, readFileSync } from 'node:fs';

const REQUIRED_100 = [
  'supabase/functions/_core/authorization.ts',
  'supabase/functions/_core/domain/state-machine.ts',
  'supabase/functions/_core/telegram/callback-data.ts',
  'supabase/functions/_core/telegram/navigation.ts',
  'supabase/functions/_core/exercise-library.ts',
  'supabase/functions/_core/ai/edit-version.ts',
  'supabase/functions/_core/ai/provider-call.ts',
];

const reportPath = process.argv[2] ?? 'reports/mutation/mutation.json';
const report = JSON.parse(readFileSync(reportPath, 'utf8'));

// La misma fórmula que Stryker: detectados sobre los que pudieron detectarse.
function score(mutants) {
  const count = (status) => mutants.filter((m) => m.status === status).length;
  const detected = count('Killed') + count('Timeout');
  const undetected = count('Survived') + count('NoCoverage');
  const total = detected + undetected;
  return { detected, undetected, total, pct: total === 0 ? 100 : (100 * detected) / total };
}

const rows = Object.entries(report.files)
  .map(([file, { mutants }]) => ({ file: file.replaceAll('\\', '/'), ...score(mutants) }))
  .toSorted((a, b) => a.file.localeCompare(b.file));

const failures = REQUIRED_100.filter((required) => {
  const row = rows.find((r) => r.file.endsWith(required));
  return row === undefined || row.undetected > 0;
});

const lines = [
  '### Mutation testing',
  '',
  '| Archivo | Score | Sobrevivientes | Exigido |',
  '|---|---|---|---|',
  ...rows.map((r) => {
    const required = REQUIRED_100.some((req) => r.file.endsWith(req));
    return `| \`${r.file.split('/').pop()}\` | ${r.pct.toFixed(1)}% | ${r.undetected} de ${r.total} | ${required ? '100%' : '—'} |`;
  }),
  '',
  failures.length === 0
    ? 'Los módulos exigidos siguen en 100%.'
    : `❌ Bajaron del 100%: ${failures.map((f) => `\`${f.split('/').pop()}\``).join(', ')}. Abre el reporte HTML (artefacto \`mutation-report\`) para ver qué mutante sobrevivió y en qué línea.`,
];

const markdown = lines.join('\n');
console.log(markdown);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

process.exit(failures.length === 0 ? 0 : 1);
