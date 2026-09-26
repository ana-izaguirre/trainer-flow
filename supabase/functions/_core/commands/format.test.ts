/**
 * SPEC-007 §3 — Los mensajes de los comandos.
 */
import { describe, expect, it } from 'vitest';
import { tieneCaracterSinEscapar } from '../../../../tests/helpers/markdown.ts';
import type { ClientDetail, ClientSummary } from '../ports/query-ports.ts';
import {
  AYUDA,
  formatAmbiguous,
  formatClientDetail,
  formatClientList,
  formatNotFound,
  formatPending,
  formatStaleCheckins,
  keyboardForDetail,
  PAGE_SIZE,
} from './format.ts';

function resumen(extra: Partial<ClientSummary> = {}): ClientSummary {
  return {
    clientId: 'c1',
    fullName: 'Carlos Pérez',
    versionState: 'SENT',
    versionNumber: 2,
    linked: true,
    pendingCheckinDays: null,
    ...extra,
  };
}

function ficha(extra: Partial<ClientDetail> = {}): ClientDetail {
  return {
    ...resumen(),
    versionId: '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7c',
    goal: 'Ganancia muscular',
    level: 'intermediate',
    daysPerWeek: 4,
    sessionMinutes: 60,
    equipment: 'Gimnasio completo',
    hasLimitations: false,
    sentDaysAgo: 12,
    lastCheckin: null,
    openChangeRequest: null,
    ...extra,
  };
}

/**
 * Las `callback_data` de un teclado, de TODAS sus filas: 'link' vive en una
 * fila aparte (SPEC-014 §3), así que mirar solo la primera se lo perdería.
 */
function accionesDe(t: ReturnType<typeof keyboardForDetail>): string[] {
  return t?.inline_keyboard.flat().map((b) => b.callback_data) ?? [];
}

// ---------------------------------------------------------------------------

describe('la lista de clientes', () => {
  it.each([
    ['sin vincular gana sobre todo lo demás', { linked: false, versionState: 'DRAFT' as const }, 'sin vincular'],
    ['un check-in colgado', { pendingCheckinDays: 5 }, 'sin responder'],
    ['un borrador esperando', { versionState: 'DRAFT' as const }, 'pendiente de revisión'],
    ['generándose', { versionState: 'GENERATING' as const }, 'generándose'],
    ['sin rutina', { versionState: null, versionNumber: null }, 'sin rutina'],
    ['recién creada', { versionState: 'NEW' as const }, 'sin rutina'],
    ['rechazada', { versionState: 'REJECTED' as const }, 'rechazada'],
    ['al día', {}, 'rutina activa'],
  ])('%s', (_n, extra, esperado) => {
    expect(formatClientList([resumen(extra)])[0]).toContain(esperado);
  });

  it('un check-in de UN día todavía no se reclama', () => {
    // Dos días es cuando deja de ser «aún no contestó».
    expect(formatClientList([resumen({ pendingCheckinDays: 1 })])[0]).toContain('rutina activa');
  });

  it('parte en páginas de 20 y dice cuál es cuál', () => {
    const muchos = Array.from({ length: 45 }, (_, i) => resumen({ fullName: `C${i}` }));
    const paginas = formatClientList(muchos);

    expect(paginas).toHaveLength(3);
    expect(paginas[0]).toContain(`1–${PAGE_SIZE} de 45`);
    expect(paginas[2]).toContain('41–45 de 45');
  });

  it('con pocos no numera páginas', () => {
    expect(formatClientList([resumen()])[0]).toContain('\\(1\\)');
  });

  it('escapa un nombre con caracteres de MarkdownV2', () => {
    // El nombre lo escribió un desconocido en Tally.
    expect(formatClientList([resumen({ fullName: 'Ana [la jefa]' })])[0]).toContain('\\[la jefa\\]');
  });
});

describe('la ficha', () => {
  it('lleva objetivo, nivel y logística', () => {
    const t = formatClientDetail(ficha());
    expect(t).toContain('Ganancia muscular');
    expect(t).toContain('Intermedio');
    expect(t).toContain('4 días');
  });

  it('dice QUE hay limitación, no cuál', () => {
    // El detalle vive en la rutina, que es donde el entrenador lo necesita.
    const t = formatClientDetail(ficha({ hasLimitations: true }));
    expect(t).toContain('Declaró limitaciones');
  });

  it('sin evaluación no inventa el objetivo', () => {
    const t = formatClientDetail(
      ficha({ goal: null, level: null, daysPerWeek: null, sessionMinutes: null, equipment: null }),
    );
    expect(t).not.toContain('Objetivo');
    expect(t).toContain('Carlos');
  });

  it('sin rutina lo dice', () => {
    expect(formatClientDetail(ficha({ versionState: null, versionNumber: null }))).toContain(
      'Sin rutina',
    );
  });

  it('una rutina que aún no salió muestra su estado', () => {
    expect(formatClientDetail(ficha({ versionState: 'DRAFT' }))).toContain('DRAFT');
  });

  it('enviada ayer se dice en singular', () => {
    expect(formatClientDetail(ficha({ sentDaysAgo: 1 }))).toContain('hace 1 día');
  });

  it('avisa si no abrió su enlace', () => {
    expect(formatClientDetail(ficha({ linked: false }))).toContain('no ha abierto su enlace');
  });

  // SPEC-030 regla 11.
  describe('la solicitud de cambio abierta', () => {
    it('muestra el motivo y hace cuántos días, sin el comentario', () => {
      const t = formatClientDetail(
        ficha({ openChangeRequest: { reason: 'too_hard', daysAgo: 2 } }),
      );
      expect(t).toContain('Pidió un cambio hace 2 días');
      expect(t).toContain('Muy difícil');
    });

    it('pedida hoy, dice «hoy»', () => {
      const t = formatClientDetail(ficha({ openChangeRequest: { reason: 'other', daysAgo: 0 } }));
      expect(t).toContain('Pidió un cambio hoy');
    });

    it('pedida ayer, en singular', () => {
      const t = formatClientDetail(
        ficha({ openChangeRequest: { reason: 'too_easy', daysAgo: 1 } }),
      );
      expect(t).toContain('hace 1 día:');
    });

    it('sin solicitud abierta, no aparece nada', () => {
      expect(formatClientDetail(ficha())).not.toContain('Pidió un cambio');
    });
  });

  it('el último check-in, con su molestia', () => {
    const t = formatClientDetail(
      ficha({
        lastCheckin: { weekNumber: 2, sessions: 3, feeling: 'good', discomfort: 'hombro' },
      }),
    );
    expect(t).toContain('semana 2');
    expect(t).toContain('💪 Bien');
    expect(t).toContain('hombro');
  });

  it('un check-in a medias no inventa respuestas', () => {
    const t = formatClientDetail(
      ficha({ lastCheckin: { weekNumber: 1, sessions: null, feeling: null, discomfort: '' } }),
    );
    expect(t).toContain('sin contestar');
    expect(t).not.toContain('⚠️ ');
  });

  it('un estado que no está en la tabla de nivel no revienta', () => {
    expect(formatClientDetail(ficha({ level: 'raro' as never }))).toContain('raro');
  });

  it('con objetivo pero sin nivel, no cuelga un separador suelto', () => {
    const t = formatClientDetail(ficha({ level: null }));
    expect(t).toContain('Ganancia muscular');
    expect(t).not.toContain('Ganancia muscular ·');
  });

  it('sin equipamiento pone un guion, no «null»', () => {
    const t = formatClientDetail(ficha({ equipment: null }));
    expect(t).toContain('—');
    expect(t).not.toContain('null');
  });

  it('una sensación que no conocemos se muestra tal cual', () => {
    // Si algún día se añade un botón, el resumen no se queda en blanco.
    const t = formatClientDetail(
      ficha({ lastCheckin: { weekNumber: 1, sessions: 2, feeling: 'raro', discomfort: null } }),
    );
    expect(t).toContain('raro');
  });
});

describe('los botones de la ficha — SPEC-007 regla 7', () => {
  it('sin ninguna versión, no hay teclado', () => {
    expect(keyboardForDetail(ficha({ versionId: null }))).toBeNull();
  });

  it('NEW ofrece los cuatro orígenes, incluida la evaluación', () => {
    const acciones = accionesDe(keyboardForDetail(ficha({ versionState: 'NEW' })));
    for (const accion of ['intake', 'generate', 'template', 'manual']) {
      expect(acciones.some((c) => c.startsWith(`act:${accion}:`)), accion).toBe(true);
    }
  });

  it('GENERATING solo ofrece ver la evaluación: no hay nada más que hacer', () => {
    const t = keyboardForDetail(ficha({ versionState: 'GENERATING' }));
    expect(t?.inline_keyboard[0]).toHaveLength(1);
    expect(accionesDe(t)[0]).toContain('act:intake:');
  });

  it('DRAFT ofrece aprobar y rechazar, pero NUNCA editar', () => {
    // El flujo de edición no existe: ese botón cae hoy en «no está listo».
    const acciones = accionesDe(keyboardForDetail(ficha({ versionState: 'DRAFT' })));
    expect(acciones.some((c) => c.startsWith('act:approve:'))).toBe(true);
    expect(acciones.some((c) => c.startsWith('act:reject:'))).toBe(true);
    expect(acciones.some((c) => c.startsWith('act:edit:'))).toBe(false);
  });

  it('APPROVED puede rechazarse, pero NUNCA ofrece crear una v2', () => {
    // Crear v2 aquí movería current_version_id con la v1 todavía sin entregar.
    const acciones = accionesDe(keyboardForDetail(ficha({ versionState: 'APPROVED' })));
    expect(acciones.some((c) => c.startsWith('act:reject:'))).toBe(true);
    expect(acciones.some((c) => c.startsWith('act:revise:'))).toBe(false);
  });

  it.each(['SENT', 'REJECTED'] as const)(
    '%s ofrece crear una v2 y ver la evaluación: los dos callejones sin salida de esta sesión',
    (estado) => {
      const acciones = accionesDe(keyboardForDetail(ficha({ versionState: estado })));
      expect(acciones.some((c) => c.startsWith('act:revise:'))).toBe(true);
      expect(acciones.some((c) => c.startsWith('act:intake:'))).toBe(true);
    },
  );

  it('una combinación que no debería darse (versionId sin versionState) falla a lo seguro', () => {
    // En datos reales van juntos: sin versión no hay versionId. Si algún día
    // no fuera así, mejor ningún botón que uno que no sepa a qué estado
    // corresponde.
    expect(keyboardForDetail(ficha({ versionState: null }))).toBeNull();
  });

  describe('«🔗 Reenviar enlace» — SPEC-014 §3, ortogonal al estado', () => {
    it('vinculado, nunca aparece', () => {
      const acciones = accionesDe(keyboardForDetail(ficha({ versionState: 'SENT', linked: true })));
      expect(acciones.some((c) => c.startsWith('act:link:'))).toBe(false);
    });

    // SPEC-027 regla 3. Vinculado, en su lugar va «📝 Pedir actualización»:
    // sin vincular no hay a quién mandarle el enlace del formulario.
    it.each(['NEW', 'GENERATING', 'DRAFT', 'APPROVED', 'SENT', 'REJECTED'] as const)(
      'vinculado, ofrece pedir la actualización de datos (%s), en su propia fila',
      (estado) => {
        const t = keyboardForDetail(ficha({ versionState: estado, linked: true }))!;
        const ultimaFila = t.inline_keyboard.at(-1)!.map((b) => b.callback_data);
        expect(ultimaFila).toEqual([`act:reassess:${t.inline_keyboard[0]![0]!.callback_data.split(':')[2]}`]);
      },
    );

    it('sin vincular, NO ofrece pedir la actualización', () => {
      const acciones = accionesDe(keyboardForDetail(ficha({ versionState: 'SENT', linked: false })));
      expect(acciones.some((c) => c.startsWith('act:reassess:'))).toBe(false);
    });

    it.each(['NEW', 'GENERATING', 'DRAFT', 'APPROVED', 'SENT', 'REJECTED'] as const)(
      'sin vincular, aparece pase lo que pase con el estado (%s)',
      (estado) => {
        const acciones = accionesDe(keyboardForDetail(ficha({ versionState: estado, linked: false })));
        expect(acciones.some((c) => c.startsWith('act:link:'))).toBe(true);
      },
    );

    it('va en su propia fila, no mezclado con los botones de estado', () => {
      const t = keyboardForDetail(ficha({ versionState: 'SENT', linked: false }))!;

      expect(t.inline_keyboard).toHaveLength(2);
      const ultimaFila = t.inline_keyboard.at(-1)!.map((b) => b.callback_data);
      expect(ultimaFila.every((c) => c.startsWith('act:link:'))).toBe(true);
    });
  });
});

describe('búsqueda sin resultado claro', () => {
  const ID_MARTA = '11111111-1111-4111-8111-111111111111';
  const ID_ANA = '22222222-2222-4222-8222-222222222222';

  /** El texto y el `callback_data` de cada botón, en orden. */
  const botones = (m: { keyboard?: { inline_keyboard: readonly (readonly { text: string; callback_data: string }[])[] } | null }) =>
    (m.keyboard?.inline_keyboard ?? []).flat().map((b) => [b.text, b.callback_data]);

  // SPEC-022 M4. Antes era una lista de texto: había que volver a escribir
  // el comando con el apellido.
  it('CA-M4 · cada coincidencia es un botón que abre su ficha', () => {
    const [mensaje, ...resto] = formatAmbiguous([
      { clientId: ID_MARTA, fullName: 'Marta' },
      { clientId: ID_ANA, fullName: 'Ana-María López' },
    ]);

    expect(resto).toEqual([]);
    expect(mensaje!.text).toContain('Hay varios que encajan');
    expect(botones(mensaje!)).toEqual([
      ['Marta', `cli:${ID_MARTA}`],
      // El texto de un botón NO es MarkdownV2: va tal cual, sin escapar.
      ['Ana-María López', `cli:${ID_ANA}`],
    ]);
  });

  it('un botón por fila: dos nombres largos no se aprietan en una', () => {
    const [mensaje] = formatAmbiguous([
      { clientId: ID_MARTA, fullName: 'Marta' },
      { clientId: ID_ANA, fullName: 'Ana' },
    ]);
    expect(mensaje!.keyboard!.inline_keyboard.every((fila) => fila.length === 1)).toBe(true);
  });

  it('CA-M6 · el texto pasa MarkdownV2', () => {
    for (const m of formatAmbiguous([{ clientId: ID_ANA, fullName: 'Ana-María' }])) {
      expect(tieneCaracterSinEscapar(m.text)).toBe(false);
    }
  });

  it('con 25 coincidencias salen dos mensajes con los 25 (regla 4)', () => {
    const muchas = Array.from({ length: 25 }, (_, i) => ({
      clientId: `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`,
      fullName: `Ana ${i}`,
    }));

    const mensajes = formatAmbiguous(muchas);

    expect(mensajes).toHaveLength(2);
    expect(mensajes.flatMap(botones)).toHaveLength(25);
  });

  it('con sugerencias, se ofrecen', () => {
    expect(formatNotFound([{ fullName: 'Marta' }])).toContain('Marta');
  });

  it('sin sugerencias, no se ofrece nada vacío', () => {
    const t = formatNotFound([]);
    expect(t).toContain('No tengo a nadie');
    expect(t).not.toContain('•');
  });
});

describe('pendientes y check-ins', () => {
  it('cada versión lleva su propio teclado', () => {
    const m = formatPending([
      { versionId: '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b', clientName: 'Carlos', versionNumber: 1, daysWaiting: 2 },
    ]);

    expect(m).toHaveLength(1);
    expect(m[0]?.keyboard).not.toBeNull();
    expect(m[0]?.text).toContain('2 días');
  });

  it('una que espera desde ayer, en singular', () => {
    const m = formatPending([
      { versionId: '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b', clientName: 'C', versionNumber: 1, daysWaiting: 1 },
    ]);
    expect(m[0]?.text).toContain('1 día');
  });

  // SPEC-030 regla 14 — la segunda lista: APPROVED esperando enlace.
  describe('SPEC-030 · la segunda lista de /pendientes', () => {
    const DRAFT = { versionId: '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b', clientName: 'Ana', versionNumber: 1, daysWaiting: 2 };
    const ESPERANDO = { versionId: '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7c', clientName: 'Carlos', versionNumber: 2, daysWaiting: 3 };

    it('con las dos listas, cada una lleva su título', () => {
      const m = formatPending([DRAFT], [ESPERANDO]);

      expect(m.map((x) => x.text).join('\n')).toContain('Esperando tu decisión');
      expect(m.map((x) => x.text).join('\n')).toContain('Esperando que abran su enlace');
      expect(m.some((x) => x.text.includes('Carlos') && x.text.includes('Aprobada'))).toBe(true);
    });

    it('esperando desde ayer, en singular', () => {
      const m = formatPending([], [{ ...ESPERANDO, daysWaiting: 1 }]);
      expect(m[0]?.text).toContain('Aprobada hace 1 día');
    });

    it('la segunda lista usa el botón de reenviar enlace', () => {
      const m = formatPending([], [ESPERANDO]);
      const conBoton = m.find((x) => x.keyboard !== undefined);
      const k = conBoton?.keyboard as unknown as { inline_keyboard: { callback_data: string }[][] };
      expect(k.inline_keyboard.flat()[0]?.callback_data).toContain('link');
    });

    it('con solo una lista, no hay título de sección', () => {
      const m = formatPending([DRAFT]);
      expect(m).toHaveLength(1);
      expect(m[0]?.text).not.toContain('Esperando tu decisión');
    });

    it('con las dos vacías, dice que no hay nada pendiente', () => {
      const m = formatPending([], []);
      expect(m).toHaveLength(1);
      expect(m[0]?.text).toContain('No hay nada pendiente');
    });
  });

  it('sin pendientes, un solo mensaje sin botones', () => {
    const m = formatPending([]);
    expect(m).toHaveLength(1);
    expect(m[0]?.keyboard).toBeUndefined();
  });

  it('los check-ins colgados dicen si ya se recordó', () => {
    const t = formatStaleCheckins([
      { clientName: 'Luis', weekNumber: 3, daysWaiting: 5, reminded: true },
      { clientName: 'Ana', weekNumber: 1, daysWaiting: 3, reminded: false },
    ]);
    expect(t).toContain('ya recordado');
    expect(t.split('\n').filter((l) => l.startsWith('•'))).toHaveLength(2);
  });

  it('sin ninguno colgado lo dice', () => {
    expect(formatStaleCheckins([])).toContain('al día');
  });
});

describe('la ayuda', () => {
  it('nombra los cinco comandos', () => {
    for (const c of ['/clientes', '/cliente', '/pendientes', '/checkins', '/ayuda']) {
      expect(AYUDA).toContain(c);
    }
  });
});
