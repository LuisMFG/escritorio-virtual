import {
  clickFurni,
  expect,
  goThroughDoor,
  newPerson,
  sendChat,
  test,
  waitRoom,
} from '../helpers.js';

test('efeito no Perfil e café na mão, vistos pelo outro', async ({ browser }) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const seenByBeto = () =>
    beto.page.evaluate(() => window.__e2e!.players().find((p) => p.name.startsWith('Ana')) ?? null);

  // Brilho é liberado para todos: escolhe no Perfil.
  await ana.page.getByRole('button', { name: 'Perfil' }).click();
  await ana.page.getByRole('tab', { name: 'Efeitos' }).click();
  const fx = ana.page.locator('.profile-effects');
  await expect(fx.getByRole('button', { name: 'Corações (Receba 3 elogios)' })).toBeDisabled();
  await fx.getByRole('button', { name: 'Brilho', exact: true }).click();
  await expect(fx.getByRole('button', { name: 'Brilho', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect.poll(async () => (await seenByBeto())?.effect).toBe('twinkle');
  await ana.page.keyboard.press('Escape');

  // Os dois vão à Copa; a Ana pega um café e depois larga.
  await goThroughDoor(ana.page, [21, 0], 'pantry');
  await goThroughDoor(beto.page, [21, 0], 'pantry');
  await waitRoom(beto.page, 'pantry');
  await clickFurni(ana.page, 'p-coffee');
  await expect.poll(async () => (await seenByBeto())?.handItem, { timeout: 15_000 }).toBe(6);
  await sendChat(ana.page, '/largar');
  await expect.poll(async () => (await seenByBeto())?.handItem).toBe(0);
});
