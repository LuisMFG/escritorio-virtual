/** Converte `#rrggbb` em número. */
export function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/** Clareia (f > 1) ou escurece (f < 1) uma cor. */
export function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * f));
  const b = Math.min(255, Math.round((color & 255) * f));
  return (r << 16) | (g << 8) | b;
}

const FALLBACK_COLORS = [
  0x3b5fa0, 0xc43b3b, 0x4f9d69, 0xe0a030, 0x7a4fa0, 0x2d9ca8, 0xd16a8b, 0x5a5a66,
];

/** Cor estável derivada de um texto, para peças sem cor conhecida. */
export function colorFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length]!;
}
