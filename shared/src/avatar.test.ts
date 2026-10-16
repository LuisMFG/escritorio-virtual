import { describe, expect, it } from 'vitest';
import { randomFigure, switchGender, validateFigure, withPart } from './avatar.js';
import { parseFigure } from './figure.js';
import { parseAvatarManifest, type AvatarManifest } from './manifests.js';

const manifest: AvatarManifest = parseAvatarManifest({
  version: 1,
  hotelId: 2,
  imager: 'https://www.habboassets.com/imaging/avatar.png',
  defaults: { M: 'hd-180-1.ch-210-66.lg-270-82', F: 'hd-600-1.ch-630-62.lg-695-62' },
  palettes: {
    '1': [
      { id: 1, hex: '#ffcb98' },
      { id: 2, hex: '#f4ac54' },
    ],
    '2': [
      { id: 45, hex: '#eecb6e' },
      { id: 61, hex: '#2d2d2d' },
    ],
    '3': [
      { id: 62, hex: '#3b5fa0' },
      { id: 66, hex: '#c43b3b' },
      { id: 82, hex: '#4a5b74' },
    ],
  },
  categories: [
    {
      type: 'hd',
      label: 'Pele',
      palette: '1',
      required: true,
      layer: 0,
      sets: [
        { id: 180, gender: 'M', colors: 1, defaultColors: [1] },
        { id: 600, gender: 'F', colors: 1, defaultColors: [1] },
      ],
    },
    {
      type: 'hr',
      label: 'Cabelo',
      palette: '2',
      required: false,
      layer: 6,
      sets: [
        { id: 100, gender: 'M', colors: 0 },
        { id: 115, gender: 'M', colors: 1, defaultColors: [45] },
        { id: 515, gender: 'F', colors: 1, defaultColors: [61] },
      ],
    },
    {
      type: 'ch',
      label: 'Blusa',
      palette: '3',
      required: true,
      layer: 3,
      sets: [
        { id: 210, gender: 'M', colors: 1, defaultColors: [66] },
        { id: 630, gender: 'F', colors: 1, defaultColors: [62] },
        { id: 900, gender: 'U', colors: 2, defaultColors: [62, 66] },
      ],
    },
    {
      type: 'lg',
      label: 'Calça',
      palette: '3',
      required: true,
      layer: 1,
      sets: [
        { id: 270, gender: 'M', colors: 1, defaultColors: [82] },
        { id: 695, gender: 'F', colors: 1, defaultColors: [62] },
      ],
    },
  ],
});

describe('validateFigure', () => {
  it('aceita e normaliza a ordem das peças', () => {
    expect(validateFigure('lg-270-82.hr-115-61.ch-210-66.hd-180-2', 'M', manifest)).toEqual({
      ok: true,
      figure: 'hd-180-2.hr-115-61.ch-210-66.lg-270-82',
    });
  });

  it('aceita uma cor em peça não recolorível (o Habbo ignora)', () => {
    expect(validateFigure('hd-180-1.hr-100-61.ch-210-66.lg-270-82', 'M', manifest).ok).toBe(true);
  });

  it.each([
    ['hd-180-1.ch-210-66', 'Falta escolher: Calça'],
    ['hd-180-1.ch-210-66.lg-270-82.xx-1-1', 'não permitido'],
    ['hd-180-1.ch-999-66.lg-270-82', 'inexistente'],
    ['hd-180-1.ch-630-62.lg-270-82', 'gênero'],
    ['hd-180-1.ch-210-1.lg-270-82', 'Cor inválida'],
    ['hd-180-1.ch-210-66-62.lg-270-82', 'Cores demais'],
    ['hd-180-1.hd-180-2.ch-210-66.lg-270-82', 'repetida'],
    ['hd-180-1.ch-210-66.lg-270-<b>', 'formato'],
    ['', 'vazio'],
  ])('recusa %s', (figure, message) => {
    const res = validateFigure(figure, 'M', manifest);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain(message);
  });

  it('peça unissex de duas cores aceita as duas', () => {
    expect(validateFigure('hd-600-1.ch-900-62-66.lg-695-62', 'F', manifest).ok).toBe(true);
  });
});

describe('edição de visual', () => {
  it('withPart troca a peça e usa as cores padrão se as atuais não servem', () => {
    const f = withPart('hd-180-1.ch-210-66.lg-270-82', manifest, 'hr', 115);
    expect(f).toBe('hd-180-1.hr-115-45.ch-210-66.lg-270-82');
    expect(withPart(f, manifest, 'hr', 115, [61])).toContain('hr-115-61');
    expect(withPart(f, manifest, 'hr', null)).toBe('hd-180-1.ch-210-66.lg-270-82');
  });

  it('withPart mantém a cor ao trocar de modelo na mesma categoria', () => {
    expect(withPart('hd-180-1.ch-210-62.lg-270-82', manifest, 'ch', 900)).toContain('ch-900-62-66');
    expect(withPart('hd-180-1.ch-900-82-66.lg-270-82', manifest, 'ch', 210)).toContain('ch-210-82');
  });

  it('switchGender troca só o que não serve', () => {
    const f = switchGender('hd-180-2.hr-115-45.ch-900-62-66.lg-270-82', 'F', manifest);
    expect(validateFigure(f, 'F', manifest).ok).toBe(true);
    expect(f).toContain('ch-900-62-66');
    expect(f).not.toContain('hr-115');
  });

  it('randomFigure sempre gera visuais válidos', () => {
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 200; i++) {
      const gender = i % 2 ? 'M' : 'F';
      const f = randomFigure(manifest, gender, rng);
      expect(validateFigure(f, gender, manifest)).toMatchObject({ ok: true });
      expect(parseFigure(f).some((p) => p.type === 'hd')).toBe(true);
    }
  });
});
