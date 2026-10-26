import { expect, goThroughDoor, newPerson, test } from '../helpers.js';

test('pessoas online: chamar para conversa quem está em outra sala, pelo menu da lista', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  await goThroughDoor(beto.page, [21, 0], 'pantry');

  // Na lista da Ana, o Beto aparece na Copa; clicar abre o menu dele.
  const people = ana.page.locator('.people');
  await people.evaluate((d) => ((d as HTMLDetailsElement).open = true));
  await people.getByRole('button', { name: `Opções para ${beto.name} (Copa)` }).click();
  const menu = ana.page.getByRole('menu', { name: beto.name });
  await expect(menu.getByRole('menuitem')).toHaveText([
    '📞 Chamar para conversa',
    '✉️ Mensagem',
    /Ir até lá \(Copa/,
    '🙌 Elogiar',
  ]);
  await ana.page.screenshot({ path: test.info().outputPath('menu-da-pessoa.png') });
  await menu.getByRole('menuitem', { name: /Chamar para conversa/ }).click();
  await ana.page.getByRole('dialog').getByRole('button', { name: 'Chamar' }).click();

  // O Beto, em outra sala, recebe o convite.
  await expect(beto.page.locator('.call-card')).toContainText(ana.name);

  // Esc fecha o menu sem fazer nada.
  await people.getByRole('button', { name: `Opções para ${beto.name} (Copa)` }).click();
  await expect(menu).toBeVisible();
  await ana.page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});
