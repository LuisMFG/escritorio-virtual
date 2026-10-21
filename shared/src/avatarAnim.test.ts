import { describe, expect, it } from 'vitest';
import {
  EMOTE_ANIMS,
  emoteBodyDy,
  emotePose,
  frameAt,
  nextBlinkDelay,
  talkDurationMs,
  walkFrame,
} from './avatarAnim.js';
import { STEP_MS } from './constants.js';
import {
  EMOTE_IDS,
  EMOTES,
  emotePosture,
  emoteRefusal,
  findPersonByName,
  parseEmoteCommand,
  parseHighFiveCommand,
  type EmoteDef,
} from './social.js';

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

describe('emotes novos (Fase 54)', () => {
  it('cada emote novo tem animação, e as que não repetem cabem no tempo do emote', () => {
    const fresh = [
      'clap',
      'facepalm',
      'point',
      'bow',
      'jump',
      'cry',
      'sleep',
      'think',
      'celebrate',
      'highfive',
    ] as const;
    for (const id of fresh) {
      const anim = EMOTE_ANIMS[id]!;
      expect(anim, id).toBeDefined();
      const total = anim.frames.reduce((n, f) => n + f.ms, 0);
      if (!anim.loop) expect(total, id).toBeLessThanOrEqual(EMOTES[id].durationMs);
      expect(total, id).toBeGreaterThan(0);
    }
  });

  it('frameAt: repete com loop; sem loop, fica no último quadro', () => {
    const anim = { frames: [{ ms: 100 }, { ms: 50, bodyDy: -3 }] };
    expect(frameAt(anim, 0)).toBe(anim.frames[0]);
    expect(frameAt(anim, 120)).toBe(anim.frames[1]);
    expect(frameAt(anim, 500)).toBe(anim.frames[1]);
    expect(frameAt({ ...anim, loop: true }, 160)).toBe(anim.frames[0]);
  });

  it('palmas: as mãos se juntam e se afastam; toca aqui: mão para cima e a batida', () => {
    expect(emotePose('clap', 0).parts).toMatchObject({
      leftArm: { action: 'crr', dx: 2 },
      rightArm: { action: 'crr', dx: -2 },
    });
    expect(emotePose('clap', 160).parts).toMatchObject({
      leftArm: { dx: -2 },
      rightArm: { dx: 2 },
    });
    expect(emotePose('highfive', 100).parts).toEqual({ leftArm: { action: 'wav', frame: 0 } });
    expect(emotePose('highfive', 300).parts?.leftArm).toMatchObject({ action: 'wav', frame: 1 });
    expect(emotePose('facepalm', 800)).toMatchObject({
      expression: 'eyb',
      parts: { rightArm: { action: 'drk' }, head: { dy: 2 } },
    });
  });

  it('pular e comemorar sobem o corpo; os outros não', () => {
    expect(emoteBodyDy('jump', 300)).toBe(-12);
    expect(emoteBodyDy('celebrate', 250)).toBe(-6);
    expect(emoteBodyDy('clap', 0)).toBe(0);
    expect(emoteBodyDy('wave', 0)).toBeNull();
  });

  it('sentado não mexe tronco e pernas; deitado, só o rosto', () => {
    const bow = emotePose('bow', 600);
    expect(Object.keys(bow.parts ?? {}).sort()).toEqual(['head', 'leftArm', 'rightArm', 'torso']);
    expect(Object.keys(emotePose('bow', 600, 'sit').parts ?? {}).sort()).toEqual([
      'head',
      'leftArm',
      'rightArm',
    ]);
    const cry = emotePose('cry', 100, 'lay');
    expect(cry.parts).toBeUndefined();
    expect(cry.expression).toBe('sad');
  });

  it('postura: sentado só os que fazem sentido; deitado só os de rosto', () => {
    expect(emotePosture('sit')).toBe('sit');
    expect(emotePosture('walk')).toBe('stand');
    expect(emoteRefusal('jump', 'sit')).toBe('Levante para pular.');
    expect(emoteRefusal('dance', 'sit')).toBe('Levante para dançar.');
    expect(emoteRefusal('bow', 'sit')).toBe('Levante para fazer a reverência.');
    expect(emoteRefusal('clap', 'sit')).toBeNull();
    expect(emoteRefusal('clap', 'lay')).toMatch(/Deitado, só dá para emotes de rosto/);
    for (const id of ['cry', 'sleep', 'smile', 'laugh'] as const) {
      expect(emoteRefusal(id, 'lay'), id).toBeNull();
    }
  });

  it('comandos: cada emote novo tem o seu; /tocaaqui precisa do nome', () => {
    expect(
      [
        '/palmas',
        '/facepalm',
        '/apontar',
        '/reverência',
        '/pular',
        '/chorar',
        '/dormir',
        '/pensar',
        '/comemorar',
      ].map(parseEmoteCommand),
    ).toEqual(['clap', 'facepalm', 'point', 'bow', 'jump', 'cry', 'sleep', 'think', 'celebrate']);
    expect(parseEmoteCommand('/tocaaqui')).toBeNull();
    expect(parseHighFiveCommand('/tocaaqui Ana Paula')).toBe('Ana Paula');
    expect(parseHighFiveCommand('/Toca aqui beto')).toBe('beto');
    expect(parseHighFiveCommand('/tocaaqui')).toBe('');
    expect(parseHighFiveCommand('/palmas')).toBeNull();
    // Todo emote tem comando único.
    const cmds = EMOTE_IDS.map((id) => (EMOTES[id] as EmoteDef).command);
    expect(new Set(cmds).size).toBe(cmds.length);
  });

  it('acha a pessoa pelo nome inteiro ou pelo começo, sem ambiguidade', () => {
    const people = [{ name: 'Ana Paula' }, { name: 'Ana Lima' }, { name: 'Bêto' }];
    expect(findPersonByName('ana paula', people)).toEqual({ person: people[0] });
    expect(findPersonByName('beto', people)).toEqual({ person: people[2] });
    expect(findPersonByName('ana', people)).toEqual({ ambiguous: [people[0], people[1]] });
    expect(findPersonByName('carla', people)).toBeNull();
  });
});
