import { describe, expect, it } from 'vitest';
import { parseCallPrefs } from '../net/callPrefs.js';
import { LOUD_LEVEL, mouthFor, SPEAKING_LEVEL, spotlightOf } from './callFace.js';

describe('rosto do avatar na chamada', () => {
  it('a boca fecha em silêncio ou no mudo e mexe enquanto fala', () => {
    expect(mouthFor(0, 0)).toBe('closed');
    expect(mouthFor(SPEAKING_LEVEL, 1)).toBe('closed');
    expect(mouthFor(0.3, 1, true)).toBe('closed');
    // Falando baixo: alterna entreaberta e aberta.
    const soft = [0, 1, 2, 3].map((t) => mouthFor(SPEAKING_LEVEL * 1.5, t));
    expect(soft).toEqual(['half', 'open', 'half', 'open']);
    // Falando alto: aberta quase sempre.
    const loud = [0, 1, 2].map((t) => mouthFor(LOUD_LEVEL * 2, t));
    expect(loud).toEqual(['open', 'open', 'half']);
  });

  it('o mini-player mostra quem fala, depois quem falou por último, depois outra pessoa', () => {
    const all = ['ana', 'beto', 'caio'];
    expect(spotlightOf(all, 'ana', new Set(['caio']), null)).toBe('caio');
    expect(spotlightOf(all, 'ana', new Set(['ana', 'beto']), 'caio')).toBe('beto');
    // Só eu falando: continua em quem falou por último.
    expect(spotlightOf(all, 'ana', new Set(['ana']), 'caio')).toBe('caio');
    expect(spotlightOf(all, 'ana', new Set(), 'caio')).toBe('caio');
    // Quem falou por último saiu: a primeira outra pessoa.
    expect(spotlightOf(['ana', 'beto'], 'ana', new Set(), 'caio')).toBe('beto');
    expect(spotlightOf(['ana'], 'ana', new Set(), null)).toBe('ana');
    expect(spotlightOf([], 'ana', new Set(), null)).toBeNull();
  });
});

const PADRAO = { blur: false, noise: true, quality: 'auto', screenMode: 'nitidez' };

describe('escolhas da chamada salvas', () => {
  it('padrão sem nada salvo e com salvo corrompido', () => {
    expect(parseCallPrefs(null)).toEqual(PADRAO);
    expect(parseCallPrefs('{nada')).toEqual(PADRAO);
    expect(parseCallPrefs('[1,2]')).toEqual(PADRAO);
  });

  it('lê efeitos, qualidade, tela e dispositivos, e aproveita os dispositivos antigos', () => {
    const saved = JSON.stringify({
      blur: true,
      noise: false,
      quality: 'economia',
      screenMode: 'fluidez',
      mic: 'm1',
      speaker: 's1',
      cam: 7,
    });
    expect(parseCallPrefs(saved, { cam: 'c-antiga' })).toEqual({
      blur: true,
      noise: false,
      quality: 'economia',
      screenMode: 'fluidez',
      mic: 'm1',
      cam: 'c-antiga',
      speaker: 's1',
    });
    expect(parseCallPrefs(null, { mic: 'm-antigo', cam: '' })).toEqual({
      ...PADRAO,
      mic: 'm-antigo',
    });
    // Qualidade ou modo desconhecidos voltam ao padrão.
    expect(parseCallPrefs(JSON.stringify({ quality: 'ultra', screenMode: 1 }))).toEqual(PADRAO);
  });
});
