/**
 * Arte própria da mesa de ping-pong (Fase 57), em pixel art isométrica no tamanho dos móveis do
 * Habbo (2×1, como a mesa de sinuca "Snooker"). O Habbo não tem mesa de ping-pong.
 *
 *   npx tsx server/scripts/pingpong-art.ts
 *
 * Gera client/public/assets/local/furni/pingpong_table_{0,2}.png e mostra as âncoras (o pixel do
 * vértice de baixo do footprint), que vão na curadoria (server/src/assets/furniCatalog.ts).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { ROOT_DIR } from '../src/config.js';

type Rgba = readonly [number, number, number, number];
type P3 = readonly [number, number, number];

const hex = (h: string, a = 255): Rgba => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
  a,
];
const C = {
  top: hex('#2a64b0'),
  topBack: hex('#3a7bcb'),
  line: hex('#eef3f8'),
  sideFront: hex('#1d4a86'),
  sideEnd: hex('#163b6d'),
  legFront: hex('#5a606a'),
  legEnd: hex('#3d424a'),
  foot: hex('#2a2e34'),
  net: hex('#d9e0e8', 235),
  netShadow: hex('#1b4378'),
  cord: hex('#ffffff'),
  post: hex('#2b2f36'),
  outline: hex('#1a1d22'),
};

const TOP = 0.75;
const SLAB = 0.08;
const NET = 0.2;
const MARGIN = 2;

/**
 * Desenha a mesa numa direção: 0 = comprida no eixo x (2×1), 2 = comprida no eixo y (1×2).
 * As coordenadas são `a` ao longo da mesa (0–2) e `b` na largura (0–1), em tiles; `h` em
 * unidades de altura (32 px).
 */
function draw(dir: 0 | 2): { png: PNG; anchor: [number, number] } {
  const [W, D] = dir === 0 ? [2, 1] : [1, 2];
  const toUV = (a: number, b: number): [number, number] => (dir === 0 ? [a, b] : [b, a]);
  /** Tela relativa ao vértice de baixo do footprint. */
  const project = ([a, b, h]: P3): [number, number] => {
    const [u, v] = toUV(a, b);
    return [(u - W - (v - D)) * 32, (u - W + (v - D)) * 16 - h * 32];
  };
  const shapes: { pts: P3[]; color: Rgba }[] = [];
  const quad = (color: Rgba, ...pts: P3[]) => shapes.push({ pts, color });

  // Caixa (pés e tampo): as faces que aparecem são as de +u (direita) e +v (esquerda) e a de cima.
  const box = (
    a0: number,
    a1: number,
    b0: number,
    b1: number,
    h0: number,
    h1: number,
    c: {
      top?: Rgba;
      end: Rgba;
      front: Rgba;
    },
  ) => {
    // Em coordenadas da mesa: o fim do eixo `a` e o fim do eixo `b` viram +u/+v conforme a direção.
    const [ea, eb] = [a1, b1];
    const faceA: P3[] = [
      [ea, b0, h1],
      [ea, b1, h1],
      [ea, b1, h0],
      [ea, b0, h0],
    ];
    const faceB: P3[] = [
      [a0, eb, h1],
      [a1, eb, h1],
      [a1, eb, h0],
      [a0, eb, h0],
    ];
    // Na direção 0, `a` é x (face da direita, mais escura); na 2, `a` é y (face da esquerda).
    quad(dir === 0 ? c.end : c.front, ...faceA);
    quad(dir === 0 ? c.front : c.end, ...faceB);
    if (c.top) {
      quad(c.top, [a0, b0, h1], [a1, b0, h1], [a1, b1, h1], [a0, b1, h1]);
    }
  };

  // Pés: quatro, de trás para a frente.
  const legs: [number, number][] = [
    [0.3, 0.22],
    [1.7, 0.22],
    [0.3, 0.78],
    [1.7, 0.78],
  ];
  legs.sort(([a1, b1], [a2, b2]) => {
    const [u1, v1] = toUV(a1, b1);
    const [u2, v2] = toUV(a2, b2);
    return u1 + v1 - (u2 + v2);
  });
  for (const [a, b] of legs) {
    box(a - 0.05, a + 0.05, b - 0.05, b + 0.05, 0, TOP - SLAB, {
      end: C.legEnd,
      front: C.legFront,
      top: C.foot,
    });
  }
  // Tampo.
  const [a0, a1, b0, b1] = [0.06, 1.94, 0.1, 0.9];
  box(a0, a1, b0, b1, TOP - SLAB, TOP, { top: C.top, end: C.sideEnd, front: C.sideFront });

  // Linhas e rede, desenhadas depois do contorno.
  const lines: { from: P3; to: P3; color: Rgba }[] = [];
  const line = (color: Rgba, from: P3, to: P3) => lines.push({ from, to, color });
  const i = 0.05;
  line(C.topBack, [a0, b0, TOP], [a1, b0, TOP]);
  line(C.topBack, [a0, b0, TOP], [a0, b1, TOP]);
  line(C.line, [a0 + i, b0 + i, TOP], [a1 - i, b0 + i, TOP]);
  line(C.line, [a0 + i, b1 - i, TOP], [a1 - i, b1 - i, TOP]);
  line(C.line, [a0 + i, b0 + i, TOP], [a0 + i, b1 - i, TOP]);
  line(C.line, [a1 - i, b0 + i, TOP], [a1 - i, b1 - i, TOP]);
  line(C.line, [a0 + i, 0.5, TOP], [a1 - i, 0.5, TOP]);

  // Tamanho da imagem: o desenho e o footprint inteiro (a âncora fica dentro, como no Habbo).
  const all = [
    ...shapes.flatMap((s) => s.pts),
    [1, 0.02, TOP + NET] as P3,
    [1, 0.98, TOP + NET] as P3,
    ...([
      [0, 0],
      [2, 0],
      [2, 1],
      [0, 1],
    ].map(([a, b]) => [a, b, 0]) as P3[]),
  ].map(project);
  const minX = Math.floor(Math.min(...all.map((p) => p[0]))) - MARGIN;
  const maxX = Math.ceil(Math.max(...all.map((p) => p[0]))) + MARGIN;
  const minY = Math.floor(Math.min(...all.map((p) => p[1]))) - MARGIN;
  const maxY = Math.ceil(Math.max(...all.map((p) => p[1]))) + MARGIN;
  const png = new PNG({ width: maxX - minX, height: maxY - minY });
  const px = (p: [number, number]): [number, number] => [p[0] - minX, p[1] - minY];
  const set = (x: number, y: number, c: Rgba) => {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
    const o = (y * png.width + x) * 4;
    const a = c[3] / 255;
    for (let k = 0; k < 3; k++)
      png.data[o + k] = Math.round(c[k]! * a + png.data[o + k]! * (1 - a));
    png.data[o + 3] = Math.max(png.data[o + 3]!, c[3]);
  };
  const fill = (poly: [number, number][], c: Rgba) => {
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
        if (inside(poly, x + 0.5, y + 0.5)) set(x, y, c);
      }
    }
  };
  const stroke = (from: [number, number], to: [number, number], c: Rgba) => {
    const n = Math.ceil(Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1])));
    for (let k = 0; k <= n; k++) {
      const t = n ? k / n : 0;
      set(
        Math.floor(from[0] + (to[0] - from[0]) * t),
        Math.floor(from[1] + (to[1] - from[1]) * t),
        c,
      );
    }
  };
  for (const s of shapes)
    fill(
      s.pts.map((p) => px(project(p))),
      s.color,
    );
  // Contorno escuro em volta do desenho, como nos móveis do Habbo.
  const solid = (x: number, y: number) =>
    x >= 0 &&
    y >= 0 &&
    x < png.width &&
    y < png.height &&
    png.data[(y * png.width + x) * 4 + 3]! > 0;
  const edge: [number, number][] = [];
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (
        !solid(x, y) &&
        (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))
      )
        edge.push([x, y]);
    }
  }
  for (const [x, y] of edge) set(x, y, C.outline);
  for (const l of lines) stroke(px(project(l.from)), px(project(l.to)), l.color);

  // Rede no meio: sombra no tampo, tela quadriculada, cordão em cima e postes nas pontas.
  const [n0, n1] = [0.02, 0.98];
  stroke(px(project([1.03, b0, TOP])), px(project([1.03, b1, TOP])), C.netShadow);
  const net = [
    [1, n0, TOP],
    [1, n1, TOP],
    [1, n1, TOP + NET],
    [1, n0, TOP + NET],
  ].map((p) => px(project(p as unknown as P3)));
  const xs = net.map((p) => p[0]);
  const ys = net.map((p) => p[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
    for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
      if (inside(net, x + 0.5, y + 0.5)) set(x, y, (x + y) % 2 === 0 ? C.net : C.netShadow);
    }
  }
  stroke(px(project([1, n0, TOP + NET])), px(project([1, n1, TOP + NET])), C.cord);
  for (const b of [n0, n1]) {
    stroke(px(project([1, b, TOP - 0.06])), px(project([1, b, TOP + NET])), C.post);
  }
  return { png, anchor: px([0, 0]) };
}

/** Ponto dentro do polígono convexo (qualquer sentido). */
function inside(poly: [number, number][], x: number, y: number): boolean {
  let sign = 0;
  for (let k = 0; k < poly.length; k++) {
    const [ax, ay] = poly[k]!;
    const [bx, by] = poly[(k + 1) % poly.length]!;
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cross === 0) continue;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

const outDir = resolve(ROOT_DIR, 'client', 'public', 'assets', 'local', 'furni');
mkdirSync(outDir, { recursive: true });
for (const dir of [0, 2] as const) {
  const { png, anchor } = draw(dir);
  const file = resolve(outDir, `pingpong_table_${dir}.png`);
  writeFileSync(file, PNG.sync.write(png));
  console.log(
    `direção ${dir}: ${png.width}×${png.height}, âncora [${anchor[0]}, ${anchor[1]}] → ${file}`,
  );
}
