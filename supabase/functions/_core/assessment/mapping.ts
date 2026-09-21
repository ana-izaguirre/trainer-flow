/**
 * SPEC-001 — Qué pregunta del formulario alimenta cada campo del dominio.
 *
 * Es **configuración, no código**. Cambiar el texto de una pregunta en Tally
 * es cambiar una línea aquí; el parser no se toca.
 *
 * La comparación ignora mayúsculas, acentos y espacios sobrantes. Lo único
 * que desconecta un campo es **renombrar** la pregunta, y para eso está el
 * test de `pipeline.test.ts` que comprueba que toda etiqueta de aquí existe
 * en el formulario real.
 */
import type { FieldMapping } from './field-mapping.ts';

export const TALLY_MAPPING: FieldMapping = {
  fullName: { label: 'Nombre' },
  goal: { label: 'Objetivo' },
  level: {
    label: 'Nivel',
    // El formulario dice «Principiante (Menos de 6 meses)»; el dominio,
    // «beginner». La clave se compara como prefijo, así que editar el
    // paréntesis no rompe la ingesta.
    valueMap: { Principiante: 'beginner', Intermedio: 'intermediate', Avanzado: 'advanced' },
  },
  daysPerWeek: { label: '¿Cuántos días a la semana entrenas?', numeric: true },
  sessionMinutes: { label: 'Tiempo por sesión', numeric: true },
  lifestyle: { label: 'Estilo de vida' },
  equipment: { label: 'Equipamiento disponible' },
  // «Ninguna» convive con las partes del cuerpo y Tally deja marcar las dos.
  // Ante la contradicción, `true`: este campo dispara el aviso de seguridad.
  hasLimitations: { label: 'Lesiones, dolor o limitaciones', falseWhen: ['Ninguna'] },
  limitationsDetail: { label: 'Cuéntanos brevemente qué debemos tener en cuenta.' },
  notes: { label: '¿Hay algo más que tu entrenador deba saber?' },

  // ── SPEC-016 ────────────────────────────────────────────────────────────
  //
  // ┌─ ESTAS ETIQUETAS HAY QUE CONFIRMARLAS ─────────────────────────────┐
  // │ El mapeo busca por etiqueta (prefijo, sin acentos ni mayúsculas).  │
  // │ Estas van como mejor conjetura: si en Tally se llaman distinto, el │
  // │ dato se pierde EN SILENCIO.                                        │
  // │                                                                    │
  // │ Por eso el webhook emite `tally.campos_ausentes` con los nombres   │
  // │ de los que no encontró. Un envío de prueba con                     │
  // │ `scripts/simular-tally.sh` dice cuáles ajustar.                    │
  // └────────────────────────────────────────────────────────────────────┘
  gender: { label: 'Género' },
  // Respaldo por si un formulario pregunta la edad directa en vez de la
  // fecha. `conditional` porque su ausencia es lo NORMAL y reportarla sería
  // una falsa alarma en cada envío.
  age: { label: 'Edad', numeric: true, conditional: true },
  weightKg: { label: 'Peso' },
  heightCm: { label: 'Altura' },
  lastWeighed: { label: 'Última vez que te pesaste' },
  quitReasons: { label: '¿Qué es lo que más te frena?' },
  // Solo se le muestra a quien marcó «Mujer» en Género: por eso `conditional`.
  menopauseStage: { label: '¿En qué etapa hormonal te encuentras?', conditional: true },
  chronicConditions: { label: '¿Tienes alguna de estas condiciones?' },
  familyConditions: { label: '¿Y en tu familia cercana?' },
  equipmentDetail: { label: '¿Qué pesos tienes disponibles?', conditional: true },
  birthDate: { label: 'Fecha de nacimiento' },
  medications: { label: 'Tomas algún fármaco' },
};
