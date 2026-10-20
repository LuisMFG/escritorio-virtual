import { expect, newPerson, test } from '../helpers.js';

test('celular: barra com 5 botões + Mais, gavetas de baixo e chat acima da barra', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const page = ana.page;
  await page.setViewportSize({ width: 390, height: 844 });

  // Barra: Perfil, Foco, Equipe, Mapa, Mensagens e Mais; o resto vai para o Mais.
  for (const name of ['Perfil', 'Modo foco', 'Equipe', 'Mapa', 'Mensagens', 'Mais']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(page.locator('.hud-actions .hud-agenda')).toBeHidden();
  await page.getByRole('button', { name: 'Mais', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Agenda' }).click();
  const agenda = page.locator('.modal-backdrop > .sheet');
  await expect(agenda).toBeVisible();
  // Gaveta: encostada embaixo e da largura da tela.
  const box = (await agenda.boundingBox())!;
  expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(840);
  expect(Math.round(box.width)).toBe(390);
  await page.keyboard.press('Escape');

  // Campo do chat acima da barra, sem nada cortado.
  const bar = (await page.locator('.chat-bar').boundingBox())!;
  const dock = (await page.locator('.hud-actions').boundingBox())!;
  expect(bar.y + bar.height).toBeLessThanOrEqual(dock.y);
  expect(bar.x).toBeGreaterThanOrEqual(0);
  expect(bar.x + bar.width).toBeLessThanOrEqual(390);
});
