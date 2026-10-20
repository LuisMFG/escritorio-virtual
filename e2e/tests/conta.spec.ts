import { APP, expect, newPerson, PASSWORD, test, waitRoom } from '../helpers.js';

test('cria conta, volta sozinho ao recarregar, sai e entra de novo', async ({ browser }) => {
  const ana = await newPerson(browser, 'Ana');
  const { page } = ana;
  await expect(page.locator('.people-panel, body')).toContainText(ana.name);

  // Recarregar não pede senha (a sessão continua).
  await page.reload();
  await waitRoom(page, 'reception');

  // Sair pelo Perfil e entrar com usuário e senha.
  await page.getByRole('button', { name: 'Perfil' }).click();
  await page.getByRole('tab', { name: 'Conta' }).click();
  await page.locator('[data-logout="one"]').click();
  await expect(page.locator('form.login-card')).toBeVisible();
  await page.goto(APP);
  await page.getByRole('tab', { name: 'Entrar' }).click();
  await page.locator('input[name=username]').fill(ana.username);
  await page.locator('input[name=password]').fill('senha-errada');
  await page.locator('form.login-card button[type=submit]').click();
  await expect(page.locator('.field-error')).toContainText(/incorretos/);
  await expect(page.locator('input[name=password]')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('input[name=password]').fill(PASSWORD);
  await page.locator('form.login-card button[type=submit]').click();
  await waitRoom(page, 'reception');
});
