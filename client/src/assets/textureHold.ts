import type { Texture } from 'pixi.js';

/**
 * Texturas na tela (Fase 52): quem mostra uma textura a "segura"; os caches só destroem as que
 * ninguém segura. Antes uma pose descartada pelo LRU podia ser destruída ainda na tela: o
 * avatar sumia e o desenho do Pixi quebrava, parando a cena.
 */
const held = new Map<Texture, number>();
const doomed = new Set<Texture>();

/** Passou a mostrar a textura. */
export function holdTexture(texture: Texture): void {
  held.set(texture, (held.get(texture) ?? 0) + 1);
}

/** Parou de mostrar a textura (se o cache já a descartou, é destruída agora). */
export function dropTexture(texture: Texture): void {
  const n = (held.get(texture) ?? 0) - 1;
  if (n > 0) return void held.set(texture, n);
  held.delete(texture);
  if (doomed.delete(texture)) texture.destroy(true);
}

/** O cache não precisa mais da textura: destrói, ou espera quem a mostra largar. */
export function disposeTexture(texture: Texture): void {
  if (texture.destroyed) return;
  if (held.has(texture)) doomed.add(texture);
  else texture.destroy(true);
}
