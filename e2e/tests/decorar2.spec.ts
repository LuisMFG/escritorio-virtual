import { clickTile, expect, newPerson, test } from '../helpers.js';

test('decorar sem esforço: recentes, favoritos, desfazer e refazer', async ({ browser }) => {
  const ana = await newPerson(browser, 'Ana');
  const page = ana.page;
  const count = () => page.evaluate(() => window.__e2e!.furniList().length);
  const at = (x: number, y: number) =>
    page.evaluate(
      ([tx, ty]) => window.__e2e!.furniList().find((f) => f.x === tx && f.y === ty),
      [x, y],
    );

  await page.getByRole('button', { name: 'Decorar' }).click();
  const panel = page.locator('.decor-panel');
  // Favoritar a Cadeira Norja pela estrela: aparece a aba Favoritos.
  await panel.getByRole('button', { name: 'Favoritar Cadeira Norja' }).click();
  await expect(panel.getByRole('button', { name: /Favoritos \(1\)/ })).toBeVisible();

  const before = await count();
  await panel.getByRole('button', { name: 'Cadeira Norja', exact: true }).click();
  await clickTile(page, 15, 15);
  await expect.poll(count).toBe(before + 1);
  // Recentes: a cadeira colocada aparece lá.
  await expect(panel.getByRole('button', { name: /Recentes \(1\)/ })).toBeVisible();
  await page.screenshot({ path: 'e2e-results/decorar-painel.png' });

  // Desfazer (botão) tira; refazer (Ctrl+Shift+Z) põe de volta.
  const undo = panel.getByRole('button', { name: 'Desfazer' });
  await expect(undo).toBeEnabled({ timeout: 5000 });
  await page.keyboard.press('Escape');
  await undo.click();
  await expect.poll(count).toBe(before);
  await page.keyboard.press('ControlOrMeta+Shift+Z');
  await expect.poll(count).toBe(before + 1);
  expect((await at(15, 15))?.defId).toBe('chair_norja');

  // Limpa: desfaz de novo.
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(count).toBe(before);
  await panel.getByRole('button', { name: 'Concluir', exact: true }).click();
});
