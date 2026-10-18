import { expect, newPerson, sendChat, test } from '../helpers.js';

test('modo foco: os outros veem 🍅, menções ficam seguradas e chegam no resumo', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');

  await ana.page.getByRole('button', { name: 'Modo foco' }).click();
  await ana.page.getByRole('button', { name: 'Foco de 25 minutos com pausa de 5' }).click();
  await expect(
    ana.page.getByRole('button', { name: /Em foco, faltam (25:00|24:5\d)/ }),
  ).toBeVisible();
  await expect(ana.page).toHaveTitle(/🍅 2\d:\d\d/);

  // Beto vê a Ana em foco na lista de pessoas.
  await expect(beto.page.locator('.people-list li', { hasText: ana.name })).toContainText(
    '🍅 foco',
  );

  // Menção durante o foco: nada de aviso para a Ana.
  await sendChat(beto.page, `@${ana.name} pode revisar meu PR?`);
  await expect(ana.page.locator('.chat-log')).toContainText('pode revisar meu PR?');
  await ana.page.waitForTimeout(500);
  await expect(ana.page.locator('.toast')).not.toContainText('mencionou você');

  // Parar: resumo com o que ficou segurado.
  await ana.page.getByRole('button', { name: /Em foco/ }).click();
  await ana.page.locator('.focus-popover').getByRole('button', { name: 'Parar' }).click();
  await expect(ana.page.locator('.toast')).toContainText(
    'Foco encerrado. Enquanto isso: 1 menção.',
  );
  await expect(beto.page.locator('.people-list li', { hasText: ana.name })).not.toContainText('🍅');
  await expect(ana.page.getByRole('button', { name: 'Modo foco' })).toBeVisible();
});
