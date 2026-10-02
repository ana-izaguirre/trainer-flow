/**
 * SPEC-019 — el nombre del ejercicio, como enlace.
 */
import { describe, expect, it } from 'vitest';
import { exerciseUrl, TEMPLATE_EXERCISE_SLUGS } from './exercise-library.ts';
import { REPDB_EXERCISE_SLUGS } from './repdb-exercises.ts';

describe('exerciseUrl', () => {
  it('un ejercicio de la librería enlaza a su página de RepDB', () => {
    expect(exerciseUrl('Sentadilla con barra')).toBe('https://exercise-dataset.com/exercise/squat/');
  });

  it('el slug es exactamente el de TEMPLATE_EXERCISE_SLUGS, no uno armado a mano', () => {
    for (const [name, slug] of Object.entries(TEMPLATE_EXERCISE_SLUGS)) {
      expect(exerciseUrl(name)).toBe(`https://exercise-dataset.com/exercise/${slug}/`);
    }
  });

  it('uno que no está en la librería cae a la búsqueda de YouTube', () => {
    const url = exerciseUrl('Movilidad de cadera');
    expect(url).toContain('youtube.com/results?search_query=');
    expect(url).toContain(encodeURIComponent('Movilidad de cadera'));
  });

  it('la búsqueda no inventa nada: se arma solo con el nombre recibido', () => {
    const url = exerciseUrl('Ejercicio inventado que no existe');
    expect(decodeURIComponent(url)).toContain('Ejercicio inventado que no existe');
  });

  it('un nombre con caracteres especiales se codifica bien en la búsqueda', () => {
    const url = exerciseUrl('Press (inclinado) 30°');
    // Si no estuviera bien codificado, esto rompería la URL o el MarkdownV2
    // que la envuelve más adelante (format.ts).
    expect(() => new URL(url)).not.toThrow();
  });

  it('cadena vacía también cae a búsqueda, no revienta', () => {
    expect(() => exerciseUrl('')).not.toThrow();
    expect(exerciseUrl('')).toContain('youtube.com');
  });
});

describe('TEMPLATE_EXERCISE_SLUGS', () => {
  it('ningún slug tiene espacios, mayúsculas ni caracteres fuera de a-z0-9-', () => {
    for (const [name, slug] of Object.entries(TEMPLATE_EXERCISE_SLUGS)) {
      expect(slug, `${name} -> ${slug}`).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('ningún nombre ni slug está vacío ni con espacios de más', () => {
    for (const [name, slug] of Object.entries(TEMPLATE_EXERCISE_SLUGS)) {
      expect(name.trim()).toBe(name);
      expect(name.length).toBeGreaterThan(0);
      expect(slug.trim()).toBe(slug);
    }
  });

  // Regla 2 de SPEC-019: una variante sin coincidencia exacta no cae a su
  // base. «Remo con mancuerna» es a UN BRAZO («12 por brazo» en las
  // plantillas); «Remo inclinado con dos mancuernas» es bilateral. Son dos
  // ejercicios distintos, no el mismo repetido con otro nombre.
  it('«Remo con mancuerna» y «Remo inclinado con dos mancuernas» llevan slugs distintos', () => {
    expect(TEMPLATE_EXERCISE_SLUGS['Remo con mancuerna']).toBe('single-arm-db-row');
    expect(TEMPLATE_EXERCISE_SLUGS['Remo inclinado con dos mancuernas']).toBe('bent-over-db-row');
    expect(TEMPLATE_EXERCISE_SLUGS['Remo con mancuerna']).not.toBe(
      TEMPLATE_EXERCISE_SLUGS['Remo inclinado con dos mancuernas'],
    );
  });
});

// SPEC-019 §6 (revisada): en vez del enum+IA de la fase 2 original, el
// mismo diccionario se amplía a los 601 ejercicios reales de RepDB — así
// un ejercicio generado por IA también puede matchear, sin tocar el
// dominio ni el prompt (ver la spec para la decisión completa).
describe('REPDB_EXERCISE_SLUGS — fallback ampliado a los 601 reales', () => {
  it('un ejercicio que solo está en RepDB (no en templates) enlaza a su página', () => {
    expect(REPDB_EXERCISE_SLUGS['Rueda Abdominal']).toBe('ab-wheel-rollout');
    expect(TEMPLATE_EXERCISE_SLUGS['Rueda Abdominal']).toBeUndefined();
    expect(exerciseUrl('Rueda Abdominal')).toBe('https://exercise-dataset.com/exercise/ab-wheel-rollout/');
  });

  // El name_es de RepDB no sigue un único estilo de mayúsculas, y nada
  // garantiza cómo capitaliza el nombre quien genera la rutina — por eso
  // el match ignora mayúsculas/minúsculas (sigue siendo EXACTO en todo lo
  // demás: ni fuzzy, ni "el más parecido").
  it('matchea el ejercicio sin importar cómo esté capitalizado el nombre', () => {
    expect(exerciseUrl('rueda abdominal')).toBe('https://exercise-dataset.com/exercise/ab-wheel-rollout/');
    expect(exerciseUrl('RUEDA ABDOMINAL')).toBe('https://exercise-dataset.com/exercise/ab-wheel-rollout/');
    expect(exerciseUrl('rUeDa AbDoMiNaL')).toBe('https://exercise-dataset.com/exercise/ab-wheel-rollout/');
  });

  it('el slug de cada uno de los 601 es exactamente el de REPDB_EXERCISE_SLUGS, no uno armado a mano', () => {
    for (const [name, slug] of Object.entries(REPDB_EXERCISE_SLUGS)) {
      expect(exerciseUrl(name)).toBe(`https://exercise-dataset.com/exercise/${slug}/`);
    }
  });

  it('trae exactamente los 601 ejercicios reales de RepDB', () => {
    expect(Object.keys(REPDB_EXERCISE_SLUGS)).toHaveLength(601);
  });

  it('ningún slug tiene espacios, mayúsculas ni caracteres fuera de a-z0-9-', () => {
    for (const [name, slug] of Object.entries(REPDB_EXERCISE_SLUGS)) {
      expect(slug, `${name} -> ${slug}`).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('ningún nombre ni slug está vacío ni con espacios de más', () => {
    for (const [name, slug] of Object.entries(REPDB_EXERCISE_SLUGS)) {
      expect(name.trim()).toBe(name);
      expect(name.length).toBeGreaterThan(0);
      expect(slug.trim()).toBe(slug);
    }
  });

  // Las 13 veces que un nombre de plantilla también existe en RepDB
  // (case-insensitive), ambas fuentes concuerdan en el slug hoy — dato
  // real, no supuesto. Si algún día dejaran de concordar, la entrada de
  // templates sigue ganando (documentado en exercise-library.ts), pero
  // este test avisa si esa concordancia se rompe.
  it('donde templates y RepDB coinciden en el nombre, coinciden también en el slug', () => {
    const templateNamesLower = new Map(
      Object.keys(TEMPLATE_EXERCISE_SLUGS).map((name) => [name.toLowerCase(), name]),
    );
    const repdbByLower = new Map(Object.entries(REPDB_EXERCISE_SLUGS).map(([name, slug]) => [name.toLowerCase(), slug]));

    const coincidencias = [...templateNamesLower.entries()].filter(([lower]) => repdbByLower.has(lower));
    expect(coincidencias).toHaveLength(13);
    for (const [lower, templateName] of coincidencias) {
      expect(repdbByLower.get(lower)).toBe(TEMPLATE_EXERCISE_SLUGS[templateName]);
    }
  });
});

// Reportado por Ana en testing real con Carlos: «Puente de Glúteos»,
// «Flexiones» y «Zancadas» caían a YouTube pese a estar en el diccionario
// tal cual — porque TEMPLATE_EXERCISE_SLUGS exige mayúsculas exactas, y el
// fallback a RepDB no quita tildes. Ninguno de los dos es un fuzzy match:
// siguen exigiendo las mismas palabras, solo toleran cómo se escribieron.
describe('normalización de mayúsculas y tildes (reportado en testing real)', () => {
  it('TEMPLATE_EXERCISE_SLUGS ya no exige mayúsculas exactas', () => {
    expect(exerciseUrl('flexiones')).toBe('https://exercise-dataset.com/exercise/push-up/');
    expect(exerciseUrl('FLEXIONES')).toBe('https://exercise-dataset.com/exercise/push-up/');
    expect(exerciseUrl('zancadas')).toBe('https://exercise-dataset.com/exercise/lunge/');
  });

  it('una tilde de más o de menos ya no rompe el match', () => {
    // «Sentadilla Búlgara» (RepDB) escrito sin tilde en «bulgara».
    expect(exerciseUrl('Sentadilla bulgara')).toBe(
      'https://exercise-dataset.com/exercise/bulgarian-split-squat/',
    );
    // «Puente de Glúteos» (TEMPLATE_EXERCISE_SLUGS) escrito sin tilde.
    expect(exerciseUrl('Puente de Gluteos')).toBe('https://exercise-dataset.com/exercise/glute-bridge/');
  });

  it('sigue sin inventar entre variantes distintas — la normalización no las funde', () => {
    expect(exerciseUrl('remo con mancuerna')).toBe(
      'https://exercise-dataset.com/exercise/single-arm-db-row/',
    );
    expect(exerciseUrl('remo inclinado con dos mancuernas')).toBe(
      'https://exercise-dataset.com/exercise/bent-over-db-row/',
    );
  });
});

describe('alias genéricos para nombres sin calificador (reportado en testing real)', () => {
  it('«Sentadilla» sola va a la sentadilla estándar, igual que «Sentadilla con barra»', () => {
    expect(exerciseUrl('Sentadilla')).toBe('https://exercise-dataset.com/exercise/squat/');
  });

  it('«Elevaciones de gemelos» es el mismo músculo que «Elevación de talones»', () => {
    expect(exerciseUrl('Elevaciones de gemelos')).toBe(
      'https://exercise-dataset.com/exercise/standing-calf-raise/',
    );
    expect(TEMPLATE_EXERCISE_SLUGS['Elevaciones de gemelos']).toBe(
      TEMPLATE_EXERCISE_SLUGS['Elevación de talones'],
    );
  });
});
