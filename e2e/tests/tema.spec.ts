import { expect, newPerson, test } from '../helpers.js';

test('tema: troca para claro, fica salvo ao recarregar e volta para escuro', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const html = ana.page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');

  // Ícones dos botões do canto são SVG (sem emoji).
  await expect(ana.page.locator('.hud-team svg.icon')).toBeVisible();

  await ana.page.getByRole('button', { name: 'Usar tema claro' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  const bg = await ana.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(233, 237, 243)');

  await ana.page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await ana.page.getByRole('button', { name: 'Usar tema escuro' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
});
