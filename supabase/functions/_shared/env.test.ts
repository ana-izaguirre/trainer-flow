/**
 * SPEC-011 — `requireEnv` es lo que decide si la función arranca.
 *
 * Corre en Deno, no en Node: `Deno.env` no existe en el otro runtime. Es la
 * consecuencia directa del ADR-001, no una preferencia.
 */
import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { optionalEnv, requireEnv } from './env.ts';

const NOMBRE = 'TRAINERFLOW_PRUEBA';

function conEntorno(valor: string | undefined, prueba: () => void): void {
  const previo = Deno.env.get(NOMBRE);
  if (valor === undefined) Deno.env.delete(NOMBRE);
  else Deno.env.set(NOMBRE, valor);

  try {
    prueba();
  } finally {
    if (previo === undefined) Deno.env.delete(NOMBRE);
    else Deno.env.set(NOMBRE, previo);
  }
}

Deno.test('requireEnv devuelve el valor cuando está', () => {
  conEntorno('valor', () => assertEquals(requireEnv(NOMBRE), 'valor'));
});

Deno.test('requireEnv lanza cuando falta, y NOMBRA la variable', () => {
  // Que el mensaje lleve el nombre es el punto: un despliegue que falla
  // diciendo «falta algo» no sirve de nada a las 11 de la noche.
  conEntorno(undefined, () => {
    const error = assertThrows(() => requireEnv(NOMBRE)) as Error;
    assertEquals(error.message.includes(NOMBRE), true);
  });
});

Deno.test('requireEnv trata la cadena vacía como ausente', () => {
  // `supabase secrets set X=` deja la variable definida y vacía. Aceptarla
  // sería arrancar con un secreto en blanco.
  conEntorno('', () => assertThrows(() => requireEnv(NOMBRE)));
});

Deno.test('optionalEnv devuelve null en vez de lanzar', () => {
  conEntorno(undefined, () => assertEquals(optionalEnv(NOMBRE), null));
  conEntorno('', () => assertEquals(optionalEnv(NOMBRE), null));
  conEntorno('valor', () => assertEquals(optionalEnv(NOMBRE), 'valor'));
});
