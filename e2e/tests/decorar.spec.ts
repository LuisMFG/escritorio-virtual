import { clickTile, expect, newPerson, test } from '../helpers.js';

test('decorar: colocar uma cadeira aparece para os outros', async ({ browser }) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const count = () => beto.page.evaluate(() => window.__e2e!.furniList().length);
  const before = await count();

  await ana.page.getByRole('button', { name: 'Decorar' }).click();
  await ana.page.getByRole('button', { name: /Cadeira Norja/ }).click();
  await clickTile(ana.page, 4, 9);
  await expect.poll(count).toBe(before + 1);
  const placed = await beto.page.evaluate(() =>
    window.__e2e!.furniList().find((f) => f.x === 4 && f.y === 9),
  );
  expect(placed?.defId).toBe('chair_norja');
  await ana.page.getByRole('button', { name: 'Concluir', exact: true }).click();
});
