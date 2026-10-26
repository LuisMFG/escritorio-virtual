import { expect, newPerson, test, waitRoom } from '../helpers.js';

test('avisos: admin publica, quem está online recebe, "Li" some, quem chega depois vê', async ({
  browser,
}) => {
  const admin = await newPerson(browser, 'Diretora', { username: 'admin.e2e' });
  const beto = await newPerson(browser, 'Beto');
  const title = `Ponto facultativo ${Date.now().toString(36)}`;

  await admin.page.getByRole('button', { name: 'Avisos' }).click();
  await admin.page.locator('.announcement-form input[name=title]').fill(title);
  await admin.page
    .locator('.announcement-form textarea[name=body]')
    .fill('Sexta não tem expediente.');
  await admin.page.getByRole('button', { name: 'Publicar para todos' }).click();
  await expect(admin.page.locator('.announcement-item', { hasText: title })).toBeVisible();
  // Quem publicou não recebe a faixa.
  await expect(admin.page.locator('.announcement-banner')).toHaveCount(0);
  await admin.page.keyboard.press('Escape');

  // Beto, online, recebe ao vivo.
  const banner = beto.page.locator('.announcement-banner');
  await expect(banner).toContainText(title);
  // Foto da faixa como os outros veem (fica no relatório do teste).
  await beto.page.screenshot({ path: test.info().outputPath('faixa-do-aviso.png') });
  await expect(beto.page.getByRole('button', { name: /Avisos \(1 não lidos\)/ })).toBeVisible();
  await banner.getByRole('button', { name: 'Li' }).click();
  await expect(banner).toHaveCount(0);
  await beto.page.reload();
  await waitRoom(beto.page, 'reception');
  await beto.page.waitForTimeout(1500);
  await expect(beto.page.locator('.announcement-banner')).toHaveCount(0);

  // Caio cria a conta depois: vê o aviso ao entrar.
  const caio = await newPerson(browser, 'Caio');
  await expect(caio.page.locator('.announcement-banner')).toContainText(title);
  // No tema claro, a faixa fica clara também (o texto escuro continua legível).
  await caio.page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
  const bg = await caio.page
    .locator('.announcement-banner')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  // `color-mix` pode voltar como `color(srgb 0.9 …)` (0–1) em vez de `rgb(230, …)`.
  const scale = bg.startsWith('color(') ? 255 : 1;
  const [r, g, b] = (bg.match(/[\d.]+/g) ?? []).map((v) => Number(v) * scale);
  expect(((r ?? 0) + (g ?? 0) + (b ?? 0)) / 3).toBeGreaterThan(200);
  await caio.page.screenshot({ path: test.info().outputPath('faixa-do-aviso-tema-claro.png') });

  // O admin vê quantos já leram.
  await admin.page.getByRole('button', { name: 'Avisos' }).click();
  await expect(admin.page.locator('.announcement-item', { hasText: title })).toContainText(
    'lido por 2',
  );
});
