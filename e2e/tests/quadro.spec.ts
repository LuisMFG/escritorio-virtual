import type { Page } from '@playwright/test';
import { clickFurni, expect, newPerson, test } from '../helpers.js';

/** Quantos pixels escuros (tinta) há no canvas. */
const ink = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const c = document.querySelector<HTMLCanvasElement>(sel)!;
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! > 0 && data[i]! < 120 && data[i + 1]! < 120 && data[i + 2]! < 120) n++;
    }
    return n;
  }, selector);

test('quadro: quem está com ele aberto vê o traço ao vivo, e o traço pronto fica', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  for (const p of [ana, beto]) {
    await clickFurni(p.page, 'r-quadro');
    await expect(p.page.locator('.wb-canvas')).toBeVisible();
  }
  const before = await ink(beto.page, '.wb-canvas');

  // A Ana desenha devagar, sem soltar o botão: o Beto vê o rascunho chegando.
  const box = (await ana.page.locator('.wb-canvas').boundingBox())!;
  await ana.page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.4);
  await ana.page.mouse.down();
  await ana.page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 12 });
  await expect.poll(() => ink(beto.page, '.wb-live'), { timeout: 5000 }).toBeGreaterThan(0);

  // Soltou: o traço vai para o quadro de todos.
  await ana.page.mouse.up();
  await expect.poll(() => ink(beto.page, '.wb-canvas'), { timeout: 5000 }).toBeGreaterThan(before);

  // A Ana limpa o quadro e se arrepende: "Desfazer" traz o traço de volta para todos.
  await ana.page.locator('.wb-clear').click();
  await ana.page.locator('.confirm-backdrop').getByRole('button', { name: 'Limpar' }).click();
  await expect.poll(() => ink(beto.page, '.wb-canvas')).toBe(before);
  await ana.page.getByRole('button', { name: 'Desfazer limpeza' }).click();
  await expect.poll(() => ink(beto.page, '.wb-canvas'), { timeout: 5000 }).toBeGreaterThan(before);
});

test('editar a sala (cor do piso) não fecha o quadro aberto de quem está nela', async ({
  browser,
}) => {
  const admin = await newPerson(browser, 'Diretora', { username: 'admin.e2e' });
  const beto = await newPerson(browser, 'Beto');
  await clickFurni(beto.page, 'r-quadro');
  const panel = beto.page.locator('.wb-canvas');
  await expect(panel).toBeVisible();

  // A diretora muda a cor do piso da Recepção (a sala é remontada para todos).
  const status = await admin.page.evaluate(async () => {
    const { token } = JSON.parse(localStorage.getItem('escritorio.sessao')!) as { token: string };
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const room = await (await fetch('/api/rooms/reception', { headers })).json();
    const { name, heightmap, spawn, wallColor, ambient, doors } = room;
    const res = await fetch('/api/rooms/reception', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        name,
        heightmap,
        spawn,
        wallColor,
        ambient,
        doors,
        floorColor: '#7a5c3e',
      }),
    });
    return res.status;
  });
  expect(status).toBe(200);
  await beto.page.waitForTimeout(1500);
  await expect(panel).toBeVisible();
});
