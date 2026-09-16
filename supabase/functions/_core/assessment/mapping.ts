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
};
