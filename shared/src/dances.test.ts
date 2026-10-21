import { describe, expect, it } from 'vitest';
import {
  DANCE_IDS,
  DANCE_NEAR,
  DANCES,
  danceFrame,
  danceFrameIndex,
  danceSchema,
  danceStartFor,
  parseDanceCommand,
} from './dances.js';
import { EMOTE_IDS, EMOTES } from './social.js';

const loopMs = (id: (typeof DANCE_IDS)[number]) =>
  DANCES[id].anim.frames.reduce((n, f) => n + f.ms, 0);

describe('danças (Fase 55)', () => {
  it('as sete danças existem, repetem e têm comando próprio (sem bater com os emotes)', () => {
    expect(DANCE_IDS).toEqual([
      'macarena',
      'thriller',
      'gangnam',
      'ymca',
      'floss',
      'robot',
      'moonwalk',
    ]);
    const emoteCommands = new Set<string>(EMOTE_IDS.map((id) => EMOTES[id].command));
    for (const id of DANCE_IDS) {
      const anim = DANCES[id].anim;
      expect(anim.loop, id).toBe(true);
      expect(anim.frames.length, id).toBeGreaterThan(1);
      expect(emoteCommands.has(DANCES[id].command), id).toBe(false);
    }
  });

  it('o quadro sai do relógio: o mesmo tempo dá o mesmo quadro, e repete ao fim da volta', () => {
    for (const id of DANCE_IDS) {
      const total = loopMs(id);
      for (const t of [0, 123, total / 3, total - 1]) {
        expect(danceFrame(id, t + total), id).toBe(danceFrame(id, t));
        expect(danceFrame(id, t + 5 * total), id).toBe(danceFrame(id, t));
      }
    }
    // Macarena a 103 bpm: um quadro por batida (~583 ms).
    expect(danceFrameIndex('macarena', 0)).toBe(0);
    expect(danceFrameIndex('macarena', 600)).toBe(1);
    expect(danceFrameIndex('macarena', 583 * 15 + 10)).toBe(15);
    // Antes do começo (relógio um pouco atrás) fica no primeiro quadro.
    expect(danceFrameIndex('floss', -50)).toBe(0);
  });

  it('a Macarena vira um quarto a cada volta; o moonwalk volta ao lugar no fim', () => {
    const turns = new Set(DANCES.macarena.anim.frames.map((f) => f.bodyDd ?? 0));
    expect([...turns].sort()).toEqual([0, 2, 4, 6]);
    const moon = DANCES.moonwalk.anim.frames;
    expect(moon.at(-1)!.bodyDx ?? 0).toBe(0);
    expect(Math.min(...moon.map((f) => f.bodyDx ?? 0))).toBe(-12);
  });

  it('perto de quem dança a mesma (até 5 tiles), entra no mesmo compasso', () => {
    const others = [
      { x: 10, y: 10, dance: 'macarena', danceStart: 1000 },
      { x: 13, y: 10, dance: 'macarena', danceStart: 2000 },
      { x: 11, y: 11, dance: 'thriller', danceStart: 3000 },
    ];
    // O mais perto dos que dançam a mesma.
    expect(danceStartFor('macarena', { x: 12, y: 10 }, 9999, others)).toBe(2000);
    expect(danceStartFor('macarena', { x: 9, y: 10 }, 9999, others)).toBe(1000);
    // Até DANCE_NEAR conta; um a mais, não.
    expect(danceStartFor('macarena', { x: 10 + DANCE_NEAR + 3, y: 10 }, 9999, others)).toBe(2000);
    expect(danceStartFor('macarena', { x: 13 + DANCE_NEAR + 1, y: 10 }, 9999, others)).toBe(9999);
    // Outra dança perto não conta.
    expect(danceStartFor('ymca', { x: 11, y: 10 }, 9999, others)).toBe(9999);
  });

  it('comandos: /dancar abre a escolha, /dancar nome e /nome dançam, /parar para', () => {
    expect(parseDanceCommand('/dancar')).toEqual({ menu: true });
    expect(parseDanceCommand('/Dançar macarena')).toEqual({ dance: 'macarena' });
    expect(parseDanceCommand('/dancar Gangnam Style')).toEqual({ dance: 'gangnam' });
    expect(parseDanceCommand('/thriller')).toEqual({ dance: 'thriller' });
    expect(parseDanceCommand('/robô')).toEqual({ dance: 'robot' });
    expect(parseDanceCommand('/YMCA')).toEqual({ dance: 'ymca' });
    expect(parseDanceCommand('/parar')).toEqual({ stop: true });
    expect(parseDanceCommand('/dancar valsa')).toEqual({ unknown: 'valsa' });
    expect(parseDanceCommand('/palmas')).toBeNull();
    expect(parseDanceCommand('macarena')).toBeNull();
  });

  it('o pedido aceita as danças e o vazio (parar)', () => {
    expect(danceSchema.safeParse({ dance: 'floss' }).success).toBe(true);
    expect(danceSchema.safeParse({ dance: '' }).success).toBe(true);
    expect(danceSchema.safeParse({ dance: 'valsa' }).success).toBe(false);
  });
});
