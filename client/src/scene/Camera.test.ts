import { describe, expect, it } from 'vitest';
import { fitZoom as zoomFor } from './Camera.js';

describe('fitZoom', () => {
  it('abaixo de 1× usa o maior zoom (de 0,05 em 0,05) em que a sala cabe inteira', () => {
    // Recepção (~1400×800 em 1×) num notebook descontando a conversa e a barra de baixo.
    expect(zoomFor(1400, 800, 1100, 780)).toBe(0.75);
    expect(zoomFor(1500, 800, 1024, 780)).toBe(0.65);
    expect(zoomFor(1400, 800, 1500, 900)).toBe(1);
  });

  it('salas pequenas aproximam, mas no máximo 2×', () => {
    expect(zoomFor(400, 250, 1400, 800)).toBe(2);
    expect(zoomFor(600, 350, 1000, 700)).toBe(1.5);
  });

  it('se nada couber, fica no menor zoom', () => {
    expect(zoomFor(2000, 1200, 375, 600)).toBe(0.4);
  });
});
