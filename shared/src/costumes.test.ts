import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateFigure } from './avatar.js';
import { applyCostume, COSTUMES, costumeThemes, wearsCostume } from './costumes.js';
import { parseFigure } from './figure.js';
import { parseAvatarManifest } from './manifests.js';

const manifest = parseAvatarManifest(
  JSON.parse(
    readFileSync(
      new URL('../../client/public/assets/avatar/manifest.json', import.meta.url),
      'utf8',
    ),
  ),
);
const types = (figure: string) => parseFigure(figure).map((p) => p.type);

describe('fantasias', () => {
  it('toda fantasia monta um visual válido nos dois gêneros, com as peças do catálogo', () => {
    for (const c of COSTUMES) {
      for (const g of ['M', 'F'] as const) {
        const figure = applyCostume(manifest.defaults[g], c, g);
        const res = validateFigure(figure, g, manifest);
        expect(res, `${c.id} (${g})`).toMatchObject({ ok: true });
        // O validador não tirou nem trocou nenhuma peça da fantasia.
        if (res.ok) expect(wearsCostume(res.figure, c, g), `${c.id} (${g})`).toBe(true);
      }
    }
  });

  it('troca só a roupa e os acessórios: rosto, cabelo, óculos e máscara ficam', () => {
    const mine = 'hd-185-10.hr-828-45.ea-1404-64.fa-1201.ha-1002-70.ch-215-66.lg-270-82.wa-2001';
    const pegaso = COSTUMES.find((c) => c.id === 'pegaso-classica')!;
    const out = applyCostume(mine, pegaso, 'M');
    const parts = parseFigure(out);
    for (const keep of ['hd-185-10', 'hr-828-45', 'ea-1404-64', 'fa-1201'])
      expect(out.split('.')).toContain(keep);
    // O chapéu e o cinto antigos saem; entram a tiara alada e a armadura.
    expect(types(out)).not.toContain('ha');
    expect(types(out)).not.toContain('wa');
    expect(parts.find((p) => p.type === 'he')?.setId).toBe(4022);
    expect(parts.find((p) => p.type === 'cc')?.setId).toBe(3609);
    expect(wearsCostume(out, pegaso, 'M')).toBe(true);
    expect(wearsCostume(mine, pegaso, 'M')).toBe(false);
  });

  it('agrupa por tema', () => {
    const themes = costumeThemes();
    expect(themes[0]).toMatchObject({ theme: 'Seiya de Pégaso' });
    expect(themes[0]!.costumes.map((c) => c.label)).toEqual([
      'Armadura clássica',
      'Com asas',
      'Armadura azul',
    ]);
  });
});
