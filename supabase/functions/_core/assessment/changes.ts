/**
 * SPEC-027 regla 8 — Qué cambió entre dos envíos del formulario.
 *
 * ┌─ ESTO NO ES «DIFFING ENTRE VERSIONES» ─────────────────────────────────┐
 * │ CLAUDE.md lo excluye de V1, y sigue excluido: aquí no se comparan      │
 * │ rutinas. Se comparan dos respuestas a un formulario, campo por campo,  │
 * │ para que el entrenador sepa si hace falta una v2.                      │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ LO SENSIBLE VA POR NOMBRE, NUNCA POR CONTENIDO ───────────────────────┐
 * │ El aviso se ve en la pantalla de bloqueo del móvil. «limitaciones»     │
 * │ dice que hay que mirar; «rodilla operada» no tiene por qué leerlo      │
 * │ nadie que pase al lado. El detalle está en 📄 Ver evaluación, igual    │
 * │ que en el aviso de evaluación nueva (SPEC-015 §1).                     │
 * │                                                                        │
 * │ Solo los cinco campos cerrados muestran antes → después. El texto      │
 * │ libre tampoco: no se sabe qué escribió el cliente ahí.                 │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { LEVEL_LABELS, type Level } from '../domain/assessment.ts';
import type { ParsedAssessment } from './validate-assessment.ts';

/** Lo que se compara: la evaluación sin el nombre, que no cambia al cliente. */
export type ComparableAssessment = Omit<ParsedAssessment, 'fullName'>;

export type AssessmentChange =
  | { readonly label: string; readonly before: string | null; readonly after: string | null }
  /** Sensible o texto libre: solo se nombra. */
  | { readonly label: string };

type Campo = keyof ComparableAssessment;

/** Los que se muestran antes → después, en el orden en que se leen. */
const VISIBLES: readonly (readonly [Campo, string])[] = [
  ['goal', 'objetivo'],
  ['level', 'nivel'],
  ['daysPerWeek', 'días'],
  ['sessionMinutes', 'minutos'],
  ['equipment', 'equipamiento'],
];

/**
 * Los que solo se nombran. Varios campos pueden compartir nombre: la edad
 * y la fecha de nacimiento dicen lo mismo, y se cuentan una vez.
 */
const SOLO_NOMBRE: readonly (readonly [readonly Campo[], string])[] = [
  [['hasLimitations', 'limitationsDetail'], 'limitaciones'],
  [['medications'], 'medicamentos'],
  [['chronicConditions'], 'condiciones de salud'],
  [['menopauseStage'], 'etapa hormonal'],
  [['weightKg'], 'peso'],
  [['heightCm'], 'altura'],
  [['age', 'birthDate'], 'edad'],
  [['gender'], 'género'],
  [['lifestyle'], 'estilo de vida'],
  [['notes'], 'notas'],
  [['lastWeighed'], 'último pesaje'],
  [['quitReasons'], 'lo que lo frena'],
  [['equipmentDetail'], 'detalle del equipamiento'],
];

/**
 * Un valor, como texto comparable. Vacío y null son lo mismo, los espacios
 * de más no cuentan, y un número vale lo mismo venga como número o como
 * texto (`numeric` de PostgreSQL llega como texto en algunos drivers).
 */
function comparable(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const texto = String(value).trim();
  return texto.length === 0 ? null : texto;
}

function mostrar(campo: Campo, value: unknown): string | null {
  const texto = comparable(value);
  return campo === 'level' && texto !== null ? (LEVEL_LABELS[texto as Level] ?? texto) : texto;
}

/** `previous` es `null` si el plan no tenía evaluación: todo cuenta como nuevo. */
export function assessmentChanges(
  previous: ComparableAssessment | null,
  next: ComparableAssessment,
): AssessmentChange[] {
  const antes = (campo: Campo): unknown => previous?.[campo] ?? null;
  const cambio = (campo: Campo) => comparable(antes(campo)) !== comparable(next[campo]);

  return [
    ...VISIBLES.filter(([campo]) => cambio(campo)).map(([campo, label]) => ({
      label,
      before: mostrar(campo, antes(campo)),
      after: mostrar(campo, next[campo]),
    })),
    ...SOLO_NOMBRE.filter(([campos]) => campos.some(cambio)).map(([, label]) => ({ label })),
  ];
}

/** `días (3 → 2) · limitaciones`. Texto plano: quien lo pinta lo escapa. */
export function formatChanges(changes: readonly AssessmentChange[]): string {
  return changes
    .map((c) =>
      'after' in c ? `${c.label} (${c.before === null ? '' : `${c.before} `}→ ${c.after ?? '—'})` : c.label,
    )
    .join(' · ');
}
