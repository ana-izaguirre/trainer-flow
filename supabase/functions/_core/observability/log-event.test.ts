/**
 * Formato de los logs estructurados.
 *
 * La parte pura vive aquí para poder probarla. El `console.log` lo hace
 * `_shared/logger.ts`, porque escribir a stdout es I/O (ADR-001).
 */
import { describe, expect, it } from 'vitest';
import { formatLogLine } from './log-event.ts';

describe('formatLogLine', () => {
  it('produce JSON en una sola línea', () => {
    const line = formatLogLine({ event: 'webhook.recibido', requestId: 'r-1', level: 'info' });

    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toMatchObject({ event: 'webhook.recibido', requestId: 'r-1' });
  });

  it('incluye siempre event, level y requestId', () => {
    const parsed = JSON.parse(formatLogLine({ event: 'x', requestId: 'r', level: 'error' }));
    expect(parsed).toMatchObject({ event: 'x', level: 'error', requestId: 'r' });
  });

  it('arrastra los campos extra', () => {
    const parsed = JSON.parse(
      formatLogLine({ event: 'x', requestId: 'r', level: 'info', versionId: 'v1', durationMs: 42 }),
    );

    expect(parsed).toMatchObject({ versionId: 'v1', durationMs: 42 });
  });

  it('omite los campos undefined en vez de escribir null', () => {
    const line = formatLogLine({ event: 'x', requestId: 'r', level: 'info', versionId: undefined });
    expect(line).not.toContain('versionId');
  });

  // ─── Lo que NUNCA puede aparecer en un log ───
  it.each([
    ['limitationsDetail', { limitationsDetail: 'hernia discal L4-L5' }],
    ['comment', { comment: 'me duele la rodilla' }],
    ['linkToken', { linkToken: 'abc123secreto' }],
    ['apiKey', { apiKey: 'AIzaSy-xxx' }],
    ['token', { token: 'bot123:ABC' }],
    ['secret', { secret: 'shhh' }],
    ['password', { password: 'hunter2' }],
    ['authorization', { authorization: 'Bearer xyz' }],
  ])('redacta el campo %s', (campo, extra) => {
    const line = formatLogLine({ event: 'x', requestId: 'r', level: 'info', ...extra });

    expect(line).not.toContain(Object.values(extra)[0] as string);
    expect(JSON.parse(line)[campo]).toBe('[redactado]');
  });

  it('redacta sin distinguir mayúsculas ni guiones', () => {
    const line = formatLogLine({
      event: 'x',
      requestId: 'r',
      level: 'info',
      'X-Api-Key': 'secreta',
      PROVIDER_TOKEN: 'otra',
    });

    expect(line).not.toContain('secreta');
    expect(line).not.toContain('otra');
  });

  it('no redacta campos inocentes que solo suenan parecido', () => {
    const parsed = JSON.parse(
      formatLogLine({ event: 'x', requestId: 'r', level: 'info', tokenCount: 1500 }),
    );

    // tokenCount es una métrica, no una credencial.
    expect(parsed.tokenCount).toBe(1500);
  });

  it('sobrevive a un valor que no se puede serializar', () => {
    const circular: Record<string, unknown> = { event: 'x', requestId: 'r', level: 'info' };
    circular['self'] = circular;

    expect(() => formatLogLine(circular as never)).not.toThrow();
  });
});
