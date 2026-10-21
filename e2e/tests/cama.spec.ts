import { clickFurni, expect, newPerson, sendChat, test, clickTile } from '../helpers.js';

test('cama: deita com a cabeça no travesseiro, levanta para o café e a cama sai depois', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const me = () =>
    ana.page.evaluate(() => {
      const h = window.__e2e!;
      return h.players().find((p) => p.id === h.mySessionId())!;
    });
  const seenByBeto = () =>
    beto.page.evaluate(() => window.__e2e!.players().find((p) => p.name.startsWith('Ana')) ?? null);
  const list = () => ana.page.evaluate(() => window.__e2e!.furniList());

  // Ana põe uma cama de solteiro num canto livre da Recepção.
  await ana.page.getByRole('button', { name: 'Decorar' }).click();
  await ana.page.getByLabel('Buscar móvel').fill('Cama de Solteiro');
  // Há várias "Cama de Solteiro" no catálogo: escolhe pelo id.
  await ana.page.locator('button[data-id="bed_budget_one"]').click();
  await clickTile(ana.page, 11, 17);
  await expect
    .poll(async () => (await list()).some((f) => f.defId === 'bed_budget_one'))
    .toBe(true);
  await ana.page.keyboard.press('Escape');
  await ana.page.getByRole('button', { name: 'Concluir', exact: true }).click();
  const bed = (await list()).find((f) => f.defId === 'bed_budget_one')!;

  // Clicar na cama: anda até ela e deita na fileira da cabeceira (o Beto vê igual).
  await clickFurni(ana.page, bed.id);
  await expect.poll(async () => (await me()).action, { timeout: 15_000 }).toBe('lay');
  const lying = await me();
  expect([lying.x, lying.y]).toEqual([bed.x, bed.y]);
  await expect.poll(async () => (await seenByBeto())?.action).toBe('lay');
  await ana.page.screenshot({ path: 'e2e-results/shot-cama.png' });

  // Deitada, clicar na máquina de café: levanta, vai até ela e pega o copo.
  await clickFurni(ana.page, 'r-cafe');
  await expect
    .poll(async () => (await seenByBeto())?.handItem ?? 0, { timeout: 20_000 })
    .toBeGreaterThan(0);
  expect((await me()).action).not.toBe('lay');
  await sendChat(ana.page, '/largar');
  await expect.poll(async () => (await seenByBeto())?.handItem ?? 0).toBe(0);

  // Arruma a sala: a cama sai (não fica no caminho de outros testes).
  await ana.page.getByRole('button', { name: 'Decorar' }).click();
  await clickFurni(ana.page, bed.id);
  await ana.page.keyboard.press('Delete');
  await expect.poll(async () => (await list()).some((f) => f.id === bed.id)).toBe(false);
  await ana.page.getByRole('button', { name: 'Concluir', exact: true }).click();
});
