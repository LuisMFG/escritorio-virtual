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

  it('ids únicos e grupos por franquia', () => {
    expect(new Set(COSTUMES.map((c) => c.id)).size).toBe(COSTUMES.length);
    const themes = costumeThemes();
    expect(themes[0]).toMatchObject({ theme: 'Cavaleiros do Zodíaco' });
    expect(themes[0]!.costumes.map((c) => c.label)).toEqual([
      'Seiya',
      'Seiya com asas',
      'Seiya (armadura azul)',
    ]);
    const names = COSTUMES.map((c) => c.label);
    for (const n of ['Goku', 'Ichigo', 'Sukuna', 'Gojo (venda)', 'Hatsune Miku', 'Ash', 'Snorlax'])
      expect(names).toContain(n);
    expect(names).toEqual(expect.arrayContaining(['Gengar', 'Darth Vader', 'Pikachu']));
  });

  it('óculos e itens da fantasia entram no lugar dos seus e saem ao trocar', () => {
    const byId = (id: string) => COSTUMES.find((c) => c.id === id)!;
    const mine = 'hd-180-1.hr-100-61.ea-1404-64.ch-210-66.lg-270-82';
    // Gojo traz a venda: ela substitui os óculos da pessoa.
    const gojo = applyCostume(mine, byId('gojo'), 'M');
    expect(gojo).toMatch(/\bea-5156\b/);
    expect(gojo).not.toContain('ea-1404');
    // Trocando para o Darth Vader: a venda sai e o sabre entra.
    const vader = applyCostume(gojo, byId('darth-vader'), 'M');
    expect(types(vader)).not.toContain('ea');
    expect(vader).toContain('mc-6424-96');
    // E do Vader para o Goku: o sabre sai junto.
    const goku = applyCostume(vader, byId('goku'), 'M');
    expect(types(goku)).not.toContain('mc');
    expect(wearsCostume(goku, byId('goku'), 'M')).toBe(true);
    // Os óculos da própria pessoa ficam numa fantasia que não traz óculos.
    expect(applyCostume(mine, byId('goku'), 'M').split('.')).toContain('ea-1404-64');
  });
});
