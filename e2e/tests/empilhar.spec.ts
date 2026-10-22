import { clickFurni, clickTile, expect, newPerson, test } from '../helpers.js';

test('empilhar: computador e impressora em cima da mesa; não dá para tirar a mesa com coisas em cima', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const list = () => beto.page.evaluate(() => window.__e2e!.furniList());
  const pick = async (name: string) => {
    await ana.page.getByLabel('Buscar móvel').fill(name);
    await ana.page.getByRole('button', { name, exact: true }).click();
  };

  await ana.page.getByRole('button', { name: 'Decorar' }).click();
  await pick('Mesa Norja');
  await clickTile(ana.page, 14, 6);
  await expect
    .poll(async () => (await list()).some((f) => f.defId === 'table_norja_med'))
    .toBe(true);
  const table = (await list()).find((f) => f.defId === 'table_norja_med')!;

  // Apontando para o tampo da mesa: o computador vai em cima, na altura do tampo (0,8).
  await pick('Computador');
  const top = await ana.page.evaluate((id) => window.__e2e!.furni(id), table.id);
  await ana.page.mouse.click(top!.x, top!.y - 4);
  const onTable = (f: { x: number; y: number }) =>
    f.x >= table.x && f.x <= table.x + 1 && f.y >= table.y && f.y <= table.y + 1;
  await expect
    .poll(async () => (await list()).find((f) => f.defId === 'computer_flatscreen' && onTable(f)))
    .toMatchObject({ z: expect.closeTo(0.8, 3) });
  const pc = (await list()).find((f) => f.defId === 'computer_flatscreen' && onTable(f))!;

  // A impressora num canto livre da mesa. O de trás do computador fica escondido pelo tampo dele
  // (Fase 56: o computador também é base), então vale um dos lados.
  await pick('Impressora');
  const free = [
    [table.x, table.y],
    [table.x + 1, table.y],
    [table.x, table.y + 1],
    [table.x + 1, table.y + 1],
  ].find(([x, y]) => (x !== pc.x || y !== pc.y) && (x !== pc.x - 1 || y !== pc.y - 1))!;
  // O tile do tampo, visto de cima: o ponto do tile no piso, subindo a altura do tampo.
  const p = await ana.page.evaluate(([x, y]) => window.__e2e!.tile(x!, y!), free);
  await ana.page.mouse.click(p.x, p.y - 0.8 * 32 * (await zoomOf(ana.page)));
  await expect
    .poll(async () => (await list()).find((f) => f.defId === 'exe_c15_printer' && onTable(f)))
    .toMatchObject({ z: expect.closeTo(0.8, 3), x: free[0], y: free[1] });
  await ana.page.screenshot({ path: 'e2e-results/shot-empilhar.png' });

  // Tirar a mesa com coisas em cima: não deixa (e avisa).
  await ana.page.keyboard.press('Escape');
  await clickFurni(ana.page, table.id);
  await ana.page.keyboard.press('Delete');
  await expect(ana.page.getByText('Tire o que está em cima primeiro.')).toBeVisible();
  expect((await list()).some((f) => f.id === table.id)).toBe(true);
  await ana.page.getByRole('button', { name: 'Concluir', exact: true }).click();
});

test('empilhar avançado (Fase 56): a mesa leva o computador; altura pelo painel e por Shift + roda', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const page = ana.page;
  const list = () => beto.page.evaluate(() => window.__e2e!.furniList());
  const byId = async (id: string) => (await list()).find((f) => f.id === id);
  const pick = async (name: string) => {
    await page.getByLabel('Buscar móvel').fill(name);
    await page.getByRole('button', { name, exact: true }).click();
  };
  /** Ponto do tampo (altura 0,8) de um tile, visto de cima. */
  const onTop = async (x: number, y: number) => {
    const p = await page.evaluate(([tx, ty]) => window.__e2e!.tile(tx!, ty!), [x, y]);
    return { x: p.x, y: p.y - 0.8 * 32 * (await zoomOf(page)) };
  };

  await page.getByRole('button', { name: 'Decorar' }).click();
  await page.evaluate(() => window.__e2e!.look(3, 17, 1.5));
  await pick('Mesa Norja');
  await clickTile(page, 2, 17);
  await expect
    .poll(async () => (await list()).find((f) => f.defId === 'table_norja_med' && f.x === 2))
    .toMatchObject({ y: 17, z: 0 });
  const table = (await list()).find((f) => f.defId === 'table_norja_med' && f.x === 2)!;
  await pick('Computador');
  const spot = await onTop(3, 17);
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.click(spot.x, spot.y);
  await expect
    .poll(async () => (await list()).find((f) => f.defId === 'computer_flatscreen' && f.x === 3))
    .toMatchObject({ y: 17, z: expect.closeTo(0.8, 3) });
  const pc = (await list()).find((f) => f.defId === 'computer_flatscreen' && f.x === 3)!;
  await page.keyboard.press('Escape');

  // Arrastar a mesa pelo tampo, um tile para a direita: o computador vai junto, no tampo.
  const [from, to] = [await onTop(2, 18), await onTop(3, 18)];
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  }
  await page.mouse.up();
  await expect.poll(() => byId(table.id)).toMatchObject({ x: 3, y: 17 });
  await expect.poll(() => byId(pc.id)).toMatchObject({ x: 4, y: 17, z: expect.closeTo(0.8, 3) });

  // A mesa ficou selecionada: ▲ três vezes sobe 0,3, com o computador junto (Beto vê).
  const panel = page.locator('.decor-panel');
  for (let i = 0; i < 3; i++) await panel.getByRole('button', { name: 'Subir' }).click();
  await expect.poll(async () => (await byId(table.id))?.z).toBeCloseTo(0.3, 3);
  await expect.poll(async () => (await byId(pc.id))?.z).toBeCloseTo(1.1, 3);
  await expect(panel.locator('.decor-height output')).toHaveText('0,3');

  // Shift + roda do mouse: mais dois passos (sem dar zoom).
  const zoom = await zoomOf(page);
  const over = await onTop(4, 18);
  await page.mouse.move(over.x, over.y);
  await page.keyboard.down('Shift');
  for (let i = 0; i < 2; i++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(150);
  }
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await byId(table.id))?.z).toBeCloseTo(0.5, 3);
  await expect.poll(async () => (await byId(pc.id))?.z).toBeCloseTo(1.3, 3);
  expect(await zoomOf(page)).toBeCloseTo(zoom, 3);
  await page.screenshot({ path: 'e2e-results/shot-empilhar-altura.png' });

  // Desfazer: a altura volta numa ação só; depois a mesa volta para o lugar com o computador.
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await byId(table.id))?.z).toBeCloseTo(0, 3);
  await expect.poll(async () => (await byId(pc.id))?.z).toBeCloseTo(0.8, 3);
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(() => byId(table.id)).toMatchObject({ x: 2, y: 17 });
  await expect.poll(() => byId(pc.id)).toMatchObject({ x: 3, y: 17, z: expect.closeTo(0.8, 3) });
  await panel.getByRole('button', { name: 'Concluir', exact: true }).click();
});

/** Escala da câmera (px de tela por px do mundo). */
async function zoomOf(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const a = window.__e2e!.tile(0, 0);
    const b = window.__e2e!.tile(1, 0);
    return Math.hypot(b.x - a.x, b.y - a.y) / Math.hypot(32, 16);
  });
}
