import { expect, newPerson, test } from '../helpers.js';

test('configurações: tema claro e texto maior ficam salvos; perfil em abas', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const page = ana.page;
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');

  // Ícones dos botões são SVG (sem emoji).
  await expect(page.locator('.hud-team svg.icon')).toBeVisible();

  await page.getByRole('button', { name: 'Configurações' }).click();
  const settings = page.getByRole('dialog', { name: 'Configurações' });
  await settings.getByRole('radio', { name: 'Claro' }).check({ force: true });
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    'rgb(233, 237, 243)',
  );
  await settings.getByRole('radio', { name: 'Maior' }).check({ force: true });
  await settings.getByRole('radio', { name: 'Reduzir' }).check({ force: true });
  await expect(html).toHaveAttribute('data-motion', 'reduce');
  // Som de mensagem: o sino da coluna acompanha.
  await settings.getByRole('switch', { name: 'Som de mensagem e menções' }).click();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(page.getByRole('button', { name: /Som de mensagem ligado/ })).toBeVisible();

  await page.reload();
  await expect(page.locator('.hud-card')).toBeVisible();
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--font-scale').trim(),
    ),
  ).toBe('1.3');

  // Perfil em abas: troca sem rolar e lembra a aba.
  await page.getByRole('button', { name: 'Perfil' }).click();
  await page.getByRole('tab', { name: 'Conquistas' }).click();
  await expect(page.getByRole('region', { name: 'Conquistas' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Meu pet' })).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Efeitos' })).toHaveAttribute('aria-selected', 'true');
});
