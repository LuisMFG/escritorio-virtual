import { clickFurni, expect, goThroughDoor, newPerson, test } from '../helpers.js';

test('jogo da velha na Copa: dois jogam até alguém vencer', async ({ browser }) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  await goThroughDoor(ana.page, [21, 0], 'pantry');
  await goThroughDoor(beto.page, [21, 0], 'pantry');

  // Ana senta primeiro (X), Beto depois (O).
  for (const p of [ana, beto]) {
    await clickFurni(p.page, 'p-games');
    await expect(p.page.locator('.ttt-panel')).toBeVisible();
    await p.page.locator('.ttt-panel').getByRole('button', { name: 'Jogar' }).click();
    await p.page.waitForTimeout(500);
  }
  await expect(ana.page.locator('.ttt-status')).toHaveText('Sua vez!');

  const cell = (who: typeof ana, i: number) => who.page.locator('.ttt-cell').nth(i).click();
  await cell(ana, 0);
  await cell(beto, 3);
  await cell(ana, 1);
  await cell(beto, 4);
  await cell(ana, 2);
  await expect(ana.page.locator('.ttt-status')).toContainText('Você venceu');
  await expect(beto.page.locator('.ttt-status')).toContainText(`${ana.name} venceu`);
  await expect(beto.page.locator('.chat-log')).toContainText('venceu');
});
