import { clickFurni, clickTile, expect, newPerson, test } from '../helpers.js';

test('decorar: colocar uma cadeira aparece para os outros; remover e desfazer', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const count = () => beto.page.evaluate(() => window.__e2e!.furniList().length);
  const before = await count();

  await ana.page.getByRole('button', { name: 'Decorar' }).click();
  await ana.page.getByRole('button', { name: 'Cadeira Norja', exact: true }).click();
  await clickTile(ana.page, 14, 11);
  await expect.poll(count).toBe(before + 1);
  const placed = await beto.page.evaluate(() =>
    window.__e2e!.furniList().find((f) => f.x === 14 && f.y === 11),
  );
  expect(placed?.defId).toBe('chair_norja');

  // Remover (Delete) e desfazer pelo aviso: a cadeira volta no mesmo lugar.
  await ana.page.keyboard.press('Escape');
  await clickFurni(ana.page, placed!.id);
  await ana.page.keyboard.press('Delete');
  await expect.poll(count).toBe(before);
  const toasts = ana.page.locator('.toasts');
  await expect(toasts).toContainText('removido');
  await toasts.getByRole('button', { name: 'Desfazer' }).click();
  await expect.poll(count).toBe(before + 1);
  const back = await beto.page.evaluate(() =>
    window.__e2e!.furniList().find((f) => f.x === 14 && f.y === 11),
  );
  expect(back?.defId).toBe('chair_norja');
  await ana.page.getByRole('button', { name: 'Concluir', exact: true }).click();
});
