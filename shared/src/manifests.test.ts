import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFigure, serializeFigure } from './figure.js';
import {
  nextRotation,
  parseAvatarManifest,
  parseFurniManifest,
  renderDirection,
  rotations,
} from './manifests.js';

const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

const item = {
  id: 'chair_norja',
  name: 'Cadeira Norja',
  category: 'cadeiras',
  width: 1,
  depth: 1,
  height: 1,
  directions: [0, 2, 4, 6],
};

describe('parseFurniManifest', () => {
  it('aplica valores padrão', () => {
    const m = parseFurniManifest({ version: 1, hotelId: 2, items: [item] });
    expect(m.items[0]).toMatchObject({
      canSit: false,
      canWalk: false,
      source: 'habboassets',
      anchors: {},
    });
  });

  it('recusa ids duplicados', () => {
    expect(() => parseFurniManifest({ version: 1, hotelId: 2, items: [item, item] })).toThrow(
      /duplicado/,
    );
  });

  it('recusa âncora de direção que o móvel não tem', () => {
    const bad = { ...item, directions: [0], anchors: { '2': [10, 10] } };
    expect(() => parseFurniManifest({ version: 1, hotelId: 2, items: [bad] })).toThrow(
      /não suportada/,
    );
  });

  it('recusa dimensões inválidas', () => {
    expect(() =>
      parseFurniManifest({ version: 1, hotelId: 2, items: [{ ...item, width: 0 }] }),
    ).toThrow();
  });

  it('o manifesto real do cliente é válido', () => {
    const m = parseFurniManifest(readJson('../../client/public/assets/furni/manifest.json'));
    expect(m.hotelId).toBe(2);
    expect(m.items.length).toBeGreaterThan(0);
  });
});

describe('renderDirection', () => {
  it('usa a direção pedida, a oposta ou a primeira disponível', () => {
    expect(renderDirection({ directions: [0, 2, 4, 6] }, 4)).toBe(4);
    expect(renderDirection({ directions: [0, 2] }, 4)).toBe(0);
    expect(renderDirection({ directions: [0, 2] }, 6)).toBe(2);
    expect(renderDirection({ directions: [0] }, 2)).toBe(0);
  });
});

describe('parseAvatarManifest', () => {
  it('o manifesto real do cliente é válido', () => {
    const m = parseAvatarManifest(readJson('../../client/public/assets/avatar/manifest.json'));
    expect(m.defaults.M).toMatch(/^hd-/);
  });

  it('recusa categoria com paleta inexistente', () => {
    expect(() =>
      parseAvatarManifest({
        version: 1,
        hotelId: 2,
        imager: 'https://www.habboassets.com/imaging/avatar.png',
        defaults: { M: 'hd-180-1', F: 'hd-600-1' },
        palettes: {},
        categories: [
          { type: 'hr', label: 'Cabelo', palette: 'hair', required: false, layer: 6, sets: [] },
        ],
      }),
    ).toThrow(/paleta inexistente/);
  });
});

describe('figure string', () => {
  it('faz ida e volta', () => {
    const fig = 'hd-180-1.ch-210-66.lg-270-82.sh-290-80.hr-115-45-61';
    expect(serializeFigure(parseFigure(fig))).toBe(fig);
    expect(parseFigure(fig).at(-1)).toEqual({ type: 'hr', setId: 115, colors: [45, 61] });
  });

  it('ignora peças malformadas', () => {
    expect(parseFigure('hd-180-1..xx.ch-abc-1.<b>-1-1')).toEqual([
      { type: 'hd', setId: 180, colors: [1] },
    ]);
  });
});

describe('giro (R) só pelas direções que o móvel tem', () => {
  it('arquivo com 2 e 4 alterna entre os dois; cadeira passa pelas 4; mesa redonda não gira', () => {
    expect(rotations({ directions: [4, 2] })).toEqual([2, 4]);
    expect(nextRotation({ directions: [4, 2] }, 2)).toBe(4);
    expect(nextRotation({ directions: [4, 2] }, 4)).toBe(2);
    // Rotação antiga que não existe (ex.: 0 num arquivo): vai para a primeira válida.
    expect(nextRotation({ directions: [4, 2] }, 0)).toBe(2);
    expect(nextRotation({ directions: [0, 6, 4, 2] }, 6)).toBe(0);
    expect(nextRotation({ directions: [0] }, 0)).toBe(0);
  });
});
