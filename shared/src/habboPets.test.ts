import { describe, expect, it } from 'vitest';
import { habboPetType, petPosture, petVisualUrl } from './habboPets.js';
import { isPetSpecies, petSchema } from './pets.js';

describe('pets do Habbo (Fase 38)', () => {
  it('espécie: desenhada ou hh: + tipo conhecido', () => {
    expect(isPetSpecies('dog')).toBe(true);
    expect(isPetSpecies('hh:dragon')).toBe(true);
    expect(isPetSpecies('hh:fools')).toBe(false);
    expect(isPetSpecies('dragon')).toBe(false);
    expect(habboPetType('hh:cat')).toBe('cat');
    expect(habboPetType('cat')).toBeNull();
  });

  it('cor padrão branca e pelagem antiga limitada', () => {
    expect(petSchema.parse({ name: 'Rex', species: 'hh:dog', color: 12 })).toMatchObject({
      tint: 'ffffff',
    });
    expect(petSchema.safeParse({ name: 'Rex', species: 'dog', color: 3 }).success).toBe(false);
  });

  it('postura de cada ação, com o que o tipo tiver', () => {
    const dog = { std: 0, sit: 10, lay: 6, mv: 13 };
    expect(petPosture('idle', false, dog)).toBe('std');
    expect(petPosture('idle', true, dog)).toBe('mv');
    expect(petPosture('sit', false, dog)).toBe('sit');
    expect(petPosture('lie', false, dog)).toBe('lay');
    // Sem `lay`, deita sentando; sem `mv`, anda com `wlk`.
    expect(petPosture('lie', false, { std: 0, sit: 1, wlk: 2 })).toBe('sit');
    expect(petPosture('walk', true, { std: 0, sit: 1, wlk: 2 })).toBe('wlk');
    expect(petVisualUrl('dog', 5, 2, 'png')).toBe('/hh/pet/dog.png?revision=5&palette=2&v=2');
  });
});
