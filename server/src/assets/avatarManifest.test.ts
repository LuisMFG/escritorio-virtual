import { describe, expect, it } from 'vitest';
import { buildAvatarManifest, type CategoryCuration, type ClothingInfo } from './avatarManifest.js';

const palette = (id: number, hex: string, selectable = true) => ({ id, hex, club: 0, selectable });

const infos = new Map<string, ClothingInfo>([
  [
    'hh_human_body',
    {
      library: 'hh_human_body',
      latest: '2',
      revisions: [
        {
          revision: '2',
          sets: [
            {
              id: 180,
              type: 'hd',
              gender: 'M',
              club: 0,
              colors: 1,
              palette: 1,
              defaultColors: [1],
            },
            {
              id: 600,
              type: 'hd',
              gender: 'F',
              club: 0,
              colors: 1,
              palette: 1,
              defaultColors: [1],
            },
            { id: 3000, type: 'hd', gender: 'U', club: 0, colors: 1, palette: 1 },
          ],
        },
        { revision: '1', sets: [] },
      ],
      palettes: { '1': [palette(1, 'FFCB98'), palette(2, 'F4AC54'), palette(9, '000000', false)] },
    },
  ],
  [
    'hh_human_shirt',
    {
      library: 'hh_human_shirt',
      latest: '5',
      revisions: [
        {
          revision: '5',
          sets: [
            {
              id: 210,
              type: 'ch',
              gender: 'M',
              club: 0,
              colors: 1,
              palette: 3,
              defaultColors: [66],
            },
            { id: 630, type: 'ch', gender: 'F', club: 2, colors: 1, palette: 3 },
            { id: 3001, type: 'cc', gender: 'U', club: 0, colors: 2, palette: 3 },
            { id: 3002, type: 'ch', gender: 'U', club: 0, colors: 1, palette: 3, wearable: false },
          ],
        },
      ],
      palettes: { '3': [palette(66, 'C43B3B'), palette(62, '3B5FA0')] },
    },
  ],
]);

const curation: CategoryCuration[] = [
  {
    type: 'hd',
    label: 'Pele',
    required: true,
    layer: 0,
    libraries: ['hh_human_body'],
    genders: ['M', 'F'],
  },
  { type: 'ch', label: 'Blusa', required: true, layer: 3, libraries: ['hh_human_shirt'] },
  { type: 'cc', label: 'Casaco', required: false, layer: 5, libraries: ['hh_human_shirt'] },
];

describe('buildAvatarManifest', () => {
  const m = buildAvatarManifest(infos, curation, {
    M: 'hd-180-1.ch-210-66',
    F: 'hd-600-2.ch-630-62',
  });

  it('separa as categorias pelo tipo e aplica a curadoria', () => {
    expect(m.categories.map((c) => c.type)).toEqual(['hd', 'ch', 'cc']);
    expect(m.categories[0]!.sets.map((s) => s.id)).toEqual([180, 600]);
    expect(m.categories[1]!.sets.map((s) => s.id)).toEqual([210, 630]);
    expect(m.categories[2]!.sets[0]).toMatchObject({
      id: 3001,
      colors: 2,
      library: 'hh_human_shirt',
    });
  });

  it('paletas mantêm a ordem, só cores selecionáveis e hex com #', () => {
    expect(m.palettes['1']).toEqual([
      { id: 1, hex: '#ffcb98' },
      { id: 2, hex: '#f4ac54' },
    ]);
    expect(m.categories[1]!.palette).toBe('3');
  });

  it('recusa visuais padrão que não validam', () => {
    expect(() =>
      buildAvatarManifest(infos, curation, { M: 'hd-180-1', F: 'hd-600-1.ch-630-62' }),
    ).toThrow(/padrão M/);
  });

  it('acusa biblioteca faltando', () => {
    expect(() =>
      buildAvatarManifest(new Map(), curation, {
        M: 'hd-180-1.ch-210-66',
        F: 'hd-600-2.ch-630-62',
      }),
    ).toThrow(/não baixada/);
  });
});

describe('catálogo completo (Fase 35)', () => {
  it('junta peças de todas as bibliotecas (`*`), com paleta própria, revisão e animação', () => {
    const extra = new Map(infos);
    extra.set('shirt_M_suit', {
      library: 'shirt_M_suit',
      latest: '9',
      revisions: [
        {
          revision: '9',
          sets: [
            { id: 6462, type: 'ch', gender: 'M', club: 0, colors: 1, palette: 1, animated: true },
          ],
        },
      ],
      palettes: { '1': [palette(1, 'FFCB98')] },
    });
    const all = curation.map((c) => ({ ...c, libraries: ['*'] }));
    const m = buildAvatarManifest(extra, all, { M: 'hd-180-1.ch-210-66', F: 'hd-600-2.ch-630-62' });
    const ch = m.categories.find((c) => c.type === 'ch')!;
    expect(ch.palette).toBe('3');
    expect(ch.sets.find((s) => s.id === 6462)).toMatchObject({
      library: 'shirt_M_suit',
      rev: 9,
      palette: '1',
      animated: true,
    });
    // As básicas não levam revisão (a miniatura vem do imager).
    expect(ch.sets.find((s) => s.id === 210)?.rev).toBeUndefined();
  });
});
