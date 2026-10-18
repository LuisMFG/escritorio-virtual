import {
  clickTile,
  expect,
  goThroughDoor,
  newPerson,
  positionOf,
  sendChat,
  test,
} from '../helpers.js';

test('duas pessoas: andar, conversar e trocar de sala', async ({ browser }) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');

  // Ana anda; Beto vê ela chegar no tile.
  await clickTile(ana.page, 6, 7);
  await expect
    .poll(async () => positionOf(beto.page, ana.name), { timeout: 15_000 })
    .toMatchObject({ x: 6, y: 7 });

  // Conversa: a mensagem chega para o outro.
  const text = `Bom dia do teste ${Date.now()}`;
  await sendChat(ana.page, text);
  await expect(beto.page.locator('.chat-log')).toContainText(text);

  // Porta do fundo leva para a Copa; Beto vê Ana na lista da outra sala.
  await goThroughDoor(ana.page, [9, 0], 'pantry');
  await expect.poll(async () => positionOf(beto.page, ana.name)).toBeNull();
  await expect(beto.page.getByText('Copa', { exact: false }).first()).toBeVisible();
  await expect(beto.page.locator('body')).toContainText(ana.name);
});
