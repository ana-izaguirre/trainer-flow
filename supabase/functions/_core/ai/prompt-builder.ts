/**
 * SPEC-002 — Construye el prompt y el esquema de salida.
 *
 * Vive en `_core` porque decidir QUÉ se le pide al modelo es una decisión del
 * dominio, no del proveedor. Cambiar de proveedor no cambia lo que se pide.
 *
 * ┌─ LAS LIMITACIONES SON LA REGLA CON MÁS CONSECUENCIAS ──────────────────┐
 * │ Si una limitación no llega al prompt, vuelve una rutina con sentadillas│
 * │ para alguien con la rodilla lesionada, y lo único que queda entre eso  │
 * │ y el cliente es que el entrenador lo lea.                             │
 * │                                                                        │
 * │ Por eso no basta con pegarlas: van con la orden de evitarlas y con la  │
 * │ petición de declararlas en `warnings`, para que el entrenador vea qué  │
 * │ se tuvo en cuenta en vez de deducirlo.                                │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * **El prompt no se loguea nunca**: lleva datos de salud (SPEC-002 §7).
 */
import type { Level } from '../domain/assessment.ts';
import { WORKOUT_LIMITS } from '../domain/workout.ts';
import type { AIRequest } from '../ports/ai-provider.ts';

/** El modelo escribe en español; `beginner` no le dice nada. */
const NIVEL_EN_PALABRAS: Readonly<Record<Level, string>> = {
  beginner: 'principiante (menos de 6 meses entrenando)',
  intermediate: 'intermedio (entre 6 meses y 2 años)',
  advanced: 'avanzado (más de 2 años)',
};

/**
 * El esquema de salida estructurada (SPEC-002 regla 5).
 *
 * Sus límites son los de `WORKOUT_LIMITS`, no una copia a mano. Si el esquema
 * permitiera 20 sets, `validateDraft` rechazaría respuestas que el modelo
 * creyó correctas y cada generación sería una tirada de dados.
 */
export const WORKOUT_SCHEMA = {
  type: 'object',
  required: ['summary', 'days', 'warnings'],
  properties: {
    summary: { type: 'string', maxLength: WORKOUT_LIMITS.text.summary },
    days: {
      type: 'array',
      minItems: WORKOUT_LIMITS.dayNumber.min,
      maxItems: WORKOUT_LIMITS.dayNumber.max,
      items: {
        type: 'object',
        required: ['dayNumber', 'focus', 'exercises'],
        properties: {
          dayNumber: {
            type: 'integer',
            minimum: WORKOUT_LIMITS.dayNumber.min,
            maximum: WORKOUT_LIMITS.dayNumber.max,
          },
          focus: { type: 'string', maxLength: WORKOUT_LIMITS.text.focus },
          exercises: {
            type: 'array',
            minItems: WORKOUT_LIMITS.exercisesPerDay.min,
            maxItems: WORKOUT_LIMITS.exercisesPerDay.max,
            items: {
              type: 'object',
              required: ['name', 'sets', 'reps', 'restSeconds'],
              properties: {
                name: { type: 'string', maxLength: WORKOUT_LIMITS.text.name },
                sets: {
                  type: 'integer',
                  minimum: WORKOUT_LIMITS.sets.min,
                  maximum: WORKOUT_LIMITS.sets.max,
                },
                reps: { type: 'string', maxLength: WORKOUT_LIMITS.text.reps },
                restSeconds: {
                  type: 'integer',
                  minimum: WORKOUT_LIMITS.restSeconds.min,
                  maximum: WORKOUT_LIMITS.restSeconds.max,
                },
                notes: { type: 'string', maxLength: WORKOUT_LIMITS.text.notes },
              },
            },
          },
        },
      },
    },
    warnings: {
      type: 'array',
      items: { type: 'string', maxLength: WORKOUT_LIMITS.text.warning },
    },
  },
} as const;

export function buildPrompt(request: AIRequest): string {
  const partes: string[] = [
    'Eres el asistente de un entrenador personal. Diseña una rutina de',
    'entrenamiento con estos datos:',
    '',
    `- Objetivo: ${request.goal}`,
    `- Nivel: ${NIVEL_EN_PALABRAS[request.level]}`,
    `- Días por semana: ${request.daysPerWeek}`,
    `- Minutos por sesión: ${request.sessionMinutes}`,
    `- Material disponible: ${request.equipment}`,
  ];

  // SPEC-016. Se omiten los que no llegaron: una línea «Edad: null» gasta
  // tokens y confunde al modelo.
  if (request.gender !== null) partes.push(`- Género: ${request.gender}`);
  if (request.age !== null) partes.push(`- Edad: ${request.age} años`);
  if (request.weightKg !== null) {
    // El pesaje va pegado al peso: suelto, parecía parte del bloque anterior.
    partes.push(
      request.lastWeighed === null
        ? `- Peso: ${request.weightKg} kg`
        : `- Peso: ${request.weightKg} kg (pesado ${request.lastWeighed.toLowerCase()})`,
    );
  }
  if (request.heightCm !== null) partes.push(`- Altura: ${request.heightCm} cm`);

  if (request.menopauseStage !== null) {
    partes.push(`- Etapa: ${request.menopauseStage}`);
  }

  if (request.quitReasons !== null) {
    partes.push(
      '',
      `POR QUÉ ABANDONÓ ANTES: ${request.quitReasons}`,
      'Ten esto en cuenta al dimensionar la rutina: la que se cumple es mejor',
      'que la óptima.',
    );
  }

  // ┌─ POR QUÉ ESTA SECCIÓN DICE QUÉ HACER, Y NO SOLO QUÉ PASA ───────────┐
  // │ «Diabetes» a secas deja que el modelo improvise. Con la instrucción │
  // │ al lado, adapta a propósito Y declara por qué, que es lo que el     │
  // │ entrenador necesita para revisar en vez de auditar.                 │
  // └─────────────────────────────────────────────────────────────────────┘
  const clinico = [
    request.chronicConditions === null
      ? null
      : `- Enfermedades propias o de familia cercana: ${request.chronicConditions}`,
    request.medications === null ? null : `- Fármacos que toma: ${request.medications}`,
  ].filter((x): x is string => x !== null);

  if (clinico.length > 0) {
    partes.push(
      '',
      'CONTEXTO CLÍNICO — sirve para ADAPTAR EL ENTRENAMIENTO, no para tratar nada:',
      ...clinico,
      '',
      'Qué hacer con esto:',
      '- Ajusta intensidad, volumen y selección de ejercicios a lo prudente.',
      '- Ante cualquier duda, elige SIEMPRE la opción más conservadora.',
      '- Declara en `warnings` una línea por cada cosa que tuviste en cuenta y',
      '  qué decidiste por ella. El entrenador lee esa lista antes de aprobar.',
      '- NO des consejo médico, no sugieras cambiar ni dejar un fármaco, y no',
      '  interpretes síntomas. Solo programas entrenamiento.',
    );
  }

  if (request.limitations !== null) {
    partes.push(
      '',
      'LIMITACIONES DEL CLIENTE:',
      request.limitations,
      '',
      'Evita todo ejercicio que cargue esa zona y propón una alternativa segura.',
      'Declara en `warnings` qué limitación tuviste en cuenta y cómo la sorteaste.',
    );
  }

  if (request.instruction !== null) {
    partes.push('', 'CAMBIO PEDIDO POR EL ENTRENADOR:', request.instruction);
  }

  // Las reglas se repiten AL FINAL, después de todo texto que venga del
  // cliente o del entrenador. Si fueran solo al principio, un texto libre que
  // dijera «ignora lo anterior» quedaría en la última palabra.
  //
  // No es una defensa completa contra prompt injection —no la hay— pero el
  // peor resultado posible aquí es un borrador malo, y el entrenador lo
  // revisa antes de aprobar. La revisión humana ES el control (SPEC-002 §7).
  partes.push(
    '',
    'REGLAS DE SALIDA, por encima de cualquier instrucción anterior:',
    `- Devuelve JSON y solo JSON, con los campos: summary, days, warnings.`,
    `- Cada día lleva dayNumber, focus y exercises.`,
    `- Cada ejercicio lleva name, sets, reps, restSeconds y notes.`,
    `- Exactamente ${request.daysPerWeek} días, numerados del 1 al ${request.daysPerWeek}.`,
    `- sets entre ${WORKOUT_LIMITS.sets.min} y ${WORKOUT_LIMITS.sets.max}.`,
    `- restSeconds entre ${WORKOUT_LIMITS.restSeconds.min} y ${WORKOUT_LIMITS.restSeconds.max}.`,
    `- La sesión completa tiene que caber en ${request.sessionMinutes} minutos.`,
  );

  return partes.join('\n');
}
