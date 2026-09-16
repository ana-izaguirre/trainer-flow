/**
 * SPEC-011 — el logger escribe a stdout, que es lo que Supabase Logs captura.
 *
 * La redacción vive en `_core/observability/log-event.ts` y ya tiene sus
 * tests. Aquí se comprueba lo que aquel no puede: que esto escriba de verdad,
 * y que lo escrito siga redactado.
 */
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { createLogger } from './logger.ts';

function capturar(accion: (log: ReturnType<typeof createLogger>) => void): string[] {
  const lineas: string[] = [];
  const original = console.log;
  console.log = (linea: string) => void lineas.push(linea);

  try {
    accion(createLogger('req-123'));
  } finally {
    console.log = original;
  }

  return lineas;
}

Deno.test('emite una línea por evento, con el requestId', () => {
  const lineas = capturar((log) => log.info('algo.paso', { dato: 1 }));

  assertEquals(lineas.length, 1);
  assertStringIncludes(lineas[0]!, 'req-123');
  assertStringIncludes(lineas[0]!, 'algo.paso');
});

Deno.test('cada nivel llega a la salida', () => {
  const lineas = capturar((log) => {
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
  });

  assertEquals(lineas.length, 4);
});

Deno.test('un campo sin datos extra no rompe', () => {
  assertEquals(capturar((log) => log.info('solo.evento')).length, 1);
});

Deno.test('lo que se escribe sigue redactado', () => {
  // El logger no redacta: delega en formatLogLine. Este test existe para que
  // cambiar el logger no se salte esa delegación sin que nadie lo note.
  const lineas = capturar((log) =>
    log.warn('telegram.error', { apiKey: 'no-debe-salir', limitationsDetail: 'rodilla' }),
  );

  assertEquals(lineas[0]!.includes('no-debe-salir'), false);
  assertEquals(lineas[0]!.includes('rodilla'), false);
});
