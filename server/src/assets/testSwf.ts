/** SWF mínimo para os testes da montagem do avatar. */
import { deflateSync } from 'node:zlib';

function tag(type: number, data: Buffer): Buffer {
  const head = Buffer.alloc(6);
  head.writeUInt16LE((type << 6) | 0x3f, 0);
  head.writeUInt32LE(data.length, 2);
  return Buffer.concat([head, data]);
}

/** SWF mínimo: uma imagem 4×3 com borda transparente, o nome da classe e o manifesto. */
export function tinySwf(): Buffer {
  // ARGB pré-multiplicado: só o pixel (1,1) é opaco (vermelho) e (2,1) meio transparente.
  const argb = Buffer.alloc(4 * 3 * 4);
  argb.set([255, 255, 0, 0], (1 * 4 + 1) * 4);
  argb.set([128, 0, 64, 0], (1 * 4 + 2) * 4);
  const bits = Buffer.alloc(7);
  bits.writeUInt16LE(1, 0);
  bits[2] = 5;
  bits.writeUInt16LE(4, 3);
  bits.writeUInt16LE(3, 5);
  const name = 'hh_test_h_std_hr_5_2_0';
  const symbol = Buffer.concat([Buffer.from([1, 0, 1, 0]), Buffer.from(`${name}\0`)]);
  const manifest = `<?xml version='1.0'?><manifest><library name='hh_test'><assets><asset name='h_std_hr_5_2_0' mimeType='image/png' ><param key='offset' value='-10,40' /></asset></assets><aliases><alias name='h_lay_hr_5_2_0' link='h_std_hr_5_2_0' fliph='0' flipv='0' /></aliases></library></manifest>`;
  const binary = Buffer.concat([Buffer.from([2, 0, 0, 0, 0, 0]), Buffer.from(manifest)]);
  const body = Buffer.concat([
    Buffer.from([0x00, 0, 24, 1, 0]), // RECT vazio, 24 fps, 1 quadro
    tag(36, Buffer.concat([bits, deflateSync(argb)])),
    tag(76, symbol),
    tag(87, binary),
    Buffer.from([0, 0]),
  ]);
  const header = Buffer.alloc(8);
  header.write('CWS', 0, 'latin1');
  header[3] = 10;
  header.writeUInt32LE(body.length + 8, 4);
  return Buffer.concat([header, deflateSync(body)]);
}
