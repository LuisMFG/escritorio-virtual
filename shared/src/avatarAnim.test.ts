import { describe, expect, it } from 'vitest';
import { emotePose, nextBlinkDelay, talkDurationMs, walkFrame } from './avatarAnim.js';
import { STEP_MS } from './constants.js';
import { EMOTE_IDS, parseEmoteCommand } from './social.js';

describe('animações do avatar', () => {
  it('andar: 4 quadros por passo', () => {
    expect([0, 1, 2, 3, 4].map((q) => walkFrame((q * STEP_MS) / 4))).toEqual([0, 1, 2, 3, 0]);
  });

  it('fala proporcional ao texto, com limites', () => {
    expect(talkDurationMs('oi')).toBe(800);
    expect(talkDurationMs('a'.repeat(30))).toBe(2100);
    expect(talkDurationMs('a'.repeat(500))).toBe(4000);
  });

  it('piscar a cada 2,5–6 s', () => {
    expect(nextBlinkDelay(() => 0)).toBe(2500);
    expect(nextBlinkDelay(() => 1)).toBe(6000);
  });

  it('cada emote vira gesto e/ou expressão', () => {
    expect(emotePose('wave', 0)).toEqual({ gesture: 'wav', gestureFrame: 0 });
    expect(emotePose('wave', 300)).toEqual({ gesture: 'wav', gestureFrame: 1 });
    expect(emotePose('hand', 900)).toEqual({ gesture: 'wav', gestureFrame: 0 });
    expect(emotePose('thumbs', 500).gesture).toBe('respect');
    expect(emotePose('heart', 0)).toMatchObject({ gesture: 'blw', expression: 'sml' });
    expect(emotePose('coffee', 0)).toEqual({ gesture: 'drk' });
    expect(emotePose('laugh', 130)).toEqual({ expression: 'sml', talk: true, talkFrame: 1 });
    expect(
      ['smile', 'sad', 'angry', 'surprised'].map((id) => emotePose(id as 'smile', 0).expression),
    ).toEqual(['sml', 'sad', 'agr', 'srp']);
    expect(emotePose('dance', 160)).toMatchObject({ posture: 'wlk', frame: 1 });
    // Todo emote tem pose (o `switch` cobre todos).
    for (const id of EMOTE_IDS) expect(emotePose(id, 0)).toBeTypeOf('object');
  });

  it('comandos novos no chat', () => {
    expect(['/sorrir', '/Triste', '/bravo', '/surpreso', '/mão'].map(parseEmoteCommand)).toEqual([
      'smile',
      'sad',
      'angry',
      'surprised',
      'hand',
    ]);
  });
});
