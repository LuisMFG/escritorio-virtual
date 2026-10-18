import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { buildFigureData, type FigureLibInfo } from './figureData.js';
import { buildFigureSheet, parseEffectAnimation, readSwf } from './swfFigure.js';
import { tinySwf } from './testSwf.js';

describe('biblioteca de roupa (SWF → folha)', () => {
  it('lê a imagem, corta a borda transparente e corrige o deslocamento pelo corte', () => {
    const swf = readSwf(tinySwf());
    expect(swf.bitmaps.get('hh_test_h_std_hr_5_2_0')).toMatchObject({ width: 4, height: 3 });
    const { sheet, png } = buildFigureSheet('hh_test', swf);
    // Corte começa em (1,1): o deslocamento anda junto (−10 − 1, 40 − 1).
    expect(sheet.assets.h_std_hr_5_2_0).toEqual({ x: -11, y: 39 });
    expect(sheet.frames.h_std_hr_5_2_0).toMatchObject({ w: 2, h: 1 });
    expect(sheet.assets.h_lay_hr_5_2_0).toEqual({ x: -11, y: 39, source: 'h_std_hr_5_2_0' });
    const img = PNG.sync.read(png);
    const f = sheet.frames.h_std_hr_5_2_0!;
    const at = (x: number) => [
      ...img.data.subarray((f.y * img.width + f.x + x) * 4, (f.y * img.width + f.x + x) * 4 + 4),
    ];
    expect(at(0)).toEqual([255, 0, 0, 255]);
    // Meio transparente: tira a pré-multiplicação (64/128 → 128).
    expect(at(1)).toEqual([0, 128, 0, 128]);
  });

  it('recusa o que não é SWF', () => {
    expect(() => readSwf(Buffer.from('nada aqui'))).toThrow('SWF');
  });
});

describe('animação dos efeitos', () => {
  it('lê camadas (brilho, frente/trás por direção) e quadros com deslocamento', () => {
    const xml = `<?xml version='1.0'?><animation name="fx.9" desc="Love">
      <sprite id="fx9_1" ink="33" member="std_fx9_1_1"><direction id="0" dz="1" /><direction id="4" dz="-1" /></sprite>
      <sprite id="fx9_2" member="std_fx9_2_1" />
      <frame><fx id="fx9_1" action="Default" frame="0" /></frame>
      <frame><fx id="fx9_1" frame="1" dx="2" dy="-3" /><fx id="fx9_2" frame="0" /></frame>
    </animation>`;
    const anim = parseEffectAnimation(xml);
    expect(anim.sprites).toEqual([
      { id: 'fx9_1', member: 'std_fx9_1_1', ink: 33, dz: { '0': 1, '4': -1 } },
      { id: 'fx9_2', member: 'std_fx9_2_1', ink: 0, dz: {} },
    ]);
    expect(anim.frames).toEqual([
      [{ id: 'fx9_1', frame: 0, dx: 0, dy: 0 }],
      [
        { id: 'fx9_1', frame: 1, dx: 2, dy: -3 },
        { id: 'fx9_2', frame: 0, dx: 0, dy: 0 },
      ],
    ]);
  });

  it('manifesto com aspas duplas também é lido', () => {
    const swf = readSwf(tinySwf());
    const quoted = { ...swf, manifest: swf.manifest.replace(/'/g, '"') };
    expect(buildFigureSheet('hh_test', quoted).sheet.assets.h_std_hr_5_2_0).toEqual({
      x: -11,
      y: 39,
    });
  });
});

describe('dados de montagem', () => {
  it('junta partes, conjuntos, camadas escondidas e paletas; completa partes omitidas', () => {
    const infos: FigureLibInfo[] = [
      {
        library: 'hh_human_hair',
        latest: '50491',
        figuremap: '<lib><part id="501" type="hr"/></lib>',
        figuredata: [
          {
            json: {
              type: 'hr',
              paletteid: 2,
              set: {
                id: 828,
                part: [
                  { id: 501, type: 'hr', colorable: 1, colorindex: 1 },
                  { id: 501, type: 'hrb', colorable: 1, colorindex: 1 },
                ],
              },
            },
          },
        ],
        palettes: { '2': [{ id: 61, hex: '2d2d2d' }] },
      },
      {
        library: 'hh_human_hats',
        latest: 2,
        figuremap: '<lib><part id="9" type="ha"/><part id="501" type="hr"/></lib>',
        figuredata: [
          {
            json: {
              type: 'ha',
              paletteid: 3,
              set: [
                {
                  id: 1009,
                  part: { id: 9, type: 'ha', colorable: 0, colorindex: 1 },
                  hiddenlayers: { layer: { parttype: 'hrb' } },
                },
              ],
            },
          },
        ],
      },
    ];
    const data = buildFigureData(infos, {
      hh_human_hair: 'https://cdn/x.swf',
      hh_human_hats: 'https://cdn/y.swf',
    });
    expect(data.libs).toEqual({ hh_human_hair: 50491, hh_human_hats: 2 });
    // A primeira biblioteca que declara a parte vence; `hrb` omitida vai junto da irmã.
    expect(data.partLib).toMatchObject({
      'hr:501': 'hh_human_hair',
      'hrb:501': 'hh_human_hair',
      'ha:9': 'hh_human_hats',
    });
    expect(data.sets['hr:828']).toEqual({
      p: 2,
      parts: [
        ['hr', 501, 1, 1],
        ['hrb', 501, 1, 1],
      ],
    });
    expect(data.sets['ha:1009']).toEqual({ p: 3, parts: [['ha', 9, 0, 1]], hide: ['hrb'] });
    expect(data.palettes['2']).toEqual({ '61': '2D2D2D' });
    expect(() => buildFigureData(infos, {})).toThrow('SWF');
  });
});
