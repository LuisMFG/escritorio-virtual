import { clickFurni, clickTile, expect, newPerson, openChatHistory, test } from '../helpers.js';

test('móveis interativos: dado rola para todos e teleporte leva para o outro lado', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const page = ana.page;
  const furniOf = (defId: string) =>
    page.evaluate((d) => window.__e2e!.furniList().filter((f) => f.defId === d), defId);
  const me = () =>
    page.evaluate(() => {
      const h = window.__e2e!;
      return h.players().find((p) => p.id === h.mySessionId())!;
    });

  // Coloca um dado e dois teleportes pelo Decorar.
  await page.getByRole('button', { name: 'Decorar' }).click();
  const search = page.getByRole('searchbox', { name: 'Buscar móvel' });
  const place = async (query: string, name: RegExp, tiles: [number, number][]) => {
    await search.fill(query);
    await page.getByRole('button', { name }).first().click();
    await expect(page.locator('.decor-status')).toContainText('Colocando');
    for (const [x, y] of tiles) await clickTile(page, x, y);
    await page.keyboard.press('Escape');
  };
  await place('holo-dado', /Holo-Dado/, [[6, 9]]);
  await place('porta teleporte', /Porta Teleporte/, [
    [8, 9],
    [12, 4],
  ]);
  await expect.poll(async () => (await furniOf('teleport_door')).length).toBe(2);

  // Liga os dois: seleciona um e escolhe o outro na lista.
  const [t1, t2] = await furniOf('teleport_door');
  const near = t1!.x === 8 ? t1! : t2!;
  const far = near === t1 ? t2! : t1!;
  await clickFurni(page, near.id);
  await expect(page.locator('.decor-teleport')).toContainText('Teleporte solto');
  await page.getByRole('combobox', { name: 'Ligar a' }).selectOption(far.id);
  await page.locator('.decor-teleport').getByRole('button', { name: 'Ligar' }).click();
  await expect(page.locator('.decor-teleport')).toContainText('Ligado a: Recepção');
  await page.getByRole('button', { name: 'Concluir', exact: true }).click();

  // Dado: o servidor sorteia e todos veem o resultado no chat.
  const [dice] = await furniOf('edice');
  await clickFurni(page, dice!.id);
  await openChatHistory(beto.page);
  await expect(beto.page.locator('.chat-log')).toContainText(/tirou [1-6] no dado/, {
    timeout: 15_000,
  });

  // Teleporte: anda até o da frente e aparece do lado do outro.
  await clickFurni(page, near.id);
  await expect
    .poll(
      async () => {
        const p = await me();
        return Math.max(Math.abs(p.x - far.x), Math.abs(p.y - far.y)) <= 1;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
});
