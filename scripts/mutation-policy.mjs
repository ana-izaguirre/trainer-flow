// Política de mutation testing, sobre el reporte JSON de Stryker.
//
// Stryker solo admite umbrales GLOBALES. Aquí se exige por archivo: los dos
// módulos que CLAUDE.md declara no negociables no pueden bajar del 100%, y
// el resto se reporta sin romper nada.
//
//   authorization.ts → con RLS en denegación total, es LO ÚNICO que separa
//                      a un cliente de los datos de otro (ADR-010).
//   state-machine.ts → hace imposible que una rutina llegue al cliente sin
//                      aprobación humana.
//
// Uso: node scripts/mutation-policy.mjs [reports/mutation/mutation.json]
import { appendFileSync, readFileSync } from 'node:fs';

const REQUIRED_100 = [
  'supabase/functions/_core/authorization.ts',
  'supabase/functions/_core/domain/state-machine.ts',
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
