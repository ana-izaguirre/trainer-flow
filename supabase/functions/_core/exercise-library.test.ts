/**
 * SPEC-019 — el nombre del ejercicio, como enlace.
 */
import { describe, expect, it } from 'vitest';
import { exerciseUrl, TEMPLATE_EXERCISE_SLUGS } from './exercise-library.ts';

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
