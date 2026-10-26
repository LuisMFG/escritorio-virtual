import type { Locator } from '@playwright/test';
import { adminPerson, expect, newPerson, test } from '../helpers.js';

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

async function overlaps(a: Locator, b: Locator): Promise<boolean> {
  const p = (await a.boundingBox())!;
  const q = (await b.boundingBox())!;
  return p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
}

test('celular: começa perto de você e acompanha; aviso sem cobrir o topo; barra com nomes', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const admin = await adminPerson(browser);
  const ana = await newPerson(browser, 'Ana', { context: PHONE });
  const page = ana.page;
  const me = await page.evaluate(() => window.__e2e!.mySessionId());
  const pos = () => page.evaluate((id) => window.__e2e!.avatar(id), me);

  // Em 1× (não a sala inteira miudinha): um tile tem 64 px de largura.
  const [a, b] = await page.evaluate(() => [window.__e2e!.tile(0, 0), window.__e2e!.tile(1, 0)]);
  expect(Math.hypot(b!.x - a!.x, b!.y - a!.y)).toBeGreaterThan(30);
  // E você aparece na tela.
  const start = (await pos())!;
  expect(start.x).toBeGreaterThan(0);
  expect(start.x).toBeLessThan(390);

  // Andando até a beirada da tela, a câmera vai junto: você volta para o miolo.
  const origin = () => page.evaluate(() => window.__e2e!.tile(0, 0));
  const before = (await origin())!;
  const tileOf = () => page.evaluate((id) => window.__e2e!.players().find((p) => p.id === id), me);
  const from = (await tileOf())!;
  await page.touchscreen.tap(30, 560);
  await expect
    .poll(async () => {
      const t = (await tileOf())!;
      return t.x !== from.x || t.y !== from.y;
    })
    .toBe(true);
  await page.waitForTimeout(4000);
  const after = (await pos())!;
  expect(after.x).toBeGreaterThan(390 * 0.15);
  expect(after.x).toBeLessThan(390 * 0.85);
  expect((await origin())!.x).not.toBe(before.x);

  // A barra de baixo diz o que é cada botão.
  await expect(page.locator('.hud-actions .hud-action .lbl', { hasText: 'Equipe' })).toBeVisible();

  // Aviso urgente: não cobre o nome da sala, a lista nem a coluna de botões.
  await admin.page.getByRole('button', { name: 'Avisos' }).click();
  await admin.page.locator('.announcement-form input[name=title]').fill('Servidor em manutenção');
  await admin.page.locator('.announcement-form textarea[name=body]').fill('Hoje às 18h.');
  await admin.page.locator('.announcement-form input[name=urgent]').check();
  await admin.page.getByRole('button', { name: 'Publicar para todos' }).click();
  const banner = page.locator('.announcement-banner');
  await expect(banner).toBeVisible();
  await page.waitForTimeout(500);
  expect(await overlaps(banner, page.locator('.people summary'))).toBe(false);
  expect(await overlaps(banner, page.locator('.hud-zoom'))).toBe(false);
  await page.screenshot({ path: test.info().outputPath('celular-aviso.png') });
});

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
