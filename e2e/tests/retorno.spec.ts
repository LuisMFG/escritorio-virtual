import { expect, newPerson, openChatHistory, sendChat, test } from '../helpers.js';

test('apagar mensagem com desfazer: some na hora, volta ao desfazer e só apaga depois', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  await sendChat(ana.page, 'mensagem para apagar');
  await openChatHistory(ana.page);
  await openChatHistory(beto.page);
  const mine = ana.page.locator('.chat-log li', { hasText: 'mensagem para apagar' });
  await expect(mine).toBeVisible();

  // Apagar e desfazer: volta e o Beto nunca deixou de ver.
  await mine.hover();
  await mine.getByRole('button', { name: 'Apagar' }).click();
  await expect(mine).toBeHidden();
  const toasts = ana.page.locator('.toasts');
  await toasts.getByRole('button', { name: 'Desfazer' }).click();
  await expect(mine).toBeVisible();
  await expect(beto.page.locator('.chat-log')).toContainText('mensagem para apagar');

  // Apagar de novo e deixar o aviso sumir: some para o Beto também.
  await mine.hover();
  await mine.getByRole('button', { name: 'Apagar' }).click();
  await expect(beto.page.locator('.chat-log')).not.toContainText('mensagem para apagar', {
    timeout: 12_000,
  });
});
