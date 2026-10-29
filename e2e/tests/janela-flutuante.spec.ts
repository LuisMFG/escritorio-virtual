import type { Page } from '@playwright/test';
import { expect, newPerson, openCard, test } from '../helpers.js';

/** Onde o meu avatar está (tile). */
const myTile = (page: Page) =>
  page.evaluate(() => {
    const h = window.__e2e!;
    const me = h.players().find((p) => p.id === h.mySessionId())!;
    return [me.x, me.y];
  });

/** Clica no tile pela página `on` (a aba ou a janela) e espera o avatar chegar. */
async function walk(page: Page, on: Page, x: number, y: number) {
  const p = await page.evaluate(([tx, ty]) => window.__e2e!.tile(tx!, ty!), [x, y]);
  await on.mouse.click(p.x, p.y);
  await expect.poll(() => myTile(page), { timeout: 25_000 }).toEqual([x, y]);
}

test('janela flutuante: anda, conversa, atende chamada e volta para a aba', async ({ browser }) => {
  test.setTimeout(120_000);
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const page = ana.page;

  // Abre: a sala vai para a janela e a aba mostra o aviso para trazer de volta.
  const opened = page.context().waitForEvent('page');
  await page.locator('.hud-pip').click();
  const pip = await opened;
  await expect(pip.locator('.pip-canvas-box canvas')).toBeVisible();
  await expect(page.locator('#app canvas')).toHaveCount(0);
  await expect(page.locator('.pip-placeholder')).toBeVisible();
  await expect(page.locator('.hud-pip')).toHaveAttribute('aria-pressed', 'true');
  // As preferências do <html> (tema, animações) vão junto.
  expect(await pip.evaluate(() => document.documentElement.dataset.motion)).toBe(
    await page.evaluate(() => document.documentElement.dataset.motion),
  );
  // Sem chamada, nada de botões de chamada.
  await expect(pip.locator('.pip-btn-mic')).toBeHidden();
  await expect(pip.locator('.pip-btn-call-leave')).toBeHidden();
  await expect(pip.locator('.pip-call-pill')).toBeHidden();

  // Anda clicando no chão da janela.
  await walk(page, pip, 6, 17);

  // Conversa pela barra da janela: o Beto recebe.
  await pip.locator('.pip-chat-input').fill('oi da janela');
  await pip.locator('.pip-chat-input').press('Enter');
  await expect(beto.page.locator('.chat-history')).toContainText('oi da janela');

  // Clicar no Beto dentro da janela abre o cartão dele lá; clicar fora fecha.
  const at = await page.evaluate((n) => {
    const h = window.__e2e!;
    const who = h.players().find((p) => p.name === n)!;
    return h.avatar(who.id);
  }, beto.name);
  await pip.mouse.click(at!.x, at!.y);
  await expect(pip.locator('.avatar-card')).toBeVisible();
  await expect(pip.locator('.avatar-card')).toContainText(beto.name);
  await pip.locator('.pip-topbar').click({ position: { x: 5, y: 5 } });
  await expect(pip.locator('.avatar-card')).toBeHidden();

  // O Beto chama: o convite aparece na janela, e atender liga a chamada.
  await openCard(beto.page, ana.name);
  await beto.page.getByRole('button', { name: 'Chamar para conversa' }).click();
  await beto.page.getByRole('dialog').getByRole('button', { name: 'Chamar' }).click();
  const invite = pip.locator('.pip-incoming-call-card');
  await expect(invite).toContainText(`${beto.name} está chamando você`);
  await invite.getByRole('button', { name: /Atender/ }).click();
  await expect(invite).toHaveCount(0);
  await expect(pip.locator('.call-panel')).toContainText(beto.name);
  await expect(pip.locator('.pip-call-pill')).toBeVisible();
  await expect(pip.locator('.pip-btn-mic')).toBeVisible();
  // Sai pela barra da janela: os botões de chamada somem de novo.
  await pip.locator('.pip-btn-call-leave').click();
  await expect(pip.locator('.pip-btn-call-leave')).toBeHidden();
  await expect(pip.locator('.pip-call-pill')).toBeHidden();

  // Painel aberto na aba fica na aba (não pula para a janela).
  await page.getByRole('button', { name: 'Equipe', exact: true }).first().click();
  await expect(page.locator('.modal-backdrop')).toBeVisible();
  await expect(pip.locator('.modal-backdrop')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);

  // Fecha pela barra: a sala volta para a aba, do tamanho dela, e dá para andar.
  await pip.setViewportSize({ width: 640, height: 420 });
  await pip.locator('.pip-btn-restore').click();
  await expect(page.locator('#app canvas')).toBeVisible();
  await expect(page.locator('.pip-placeholder')).toHaveCount(0);
  await expect(page.locator('.hud-pip')).toHaveAttribute('aria-pressed', 'false');
  const size = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#app canvas')!;
    return [c.clientWidth, c.clientHeight, innerWidth, innerHeight];
  });
  expect(size.slice(0, 2)).toEqual(size.slice(2));
  await walk(page, page, 9, 17);
  // E lembra o tamanho para a próxima vez.
  expect(await page.evaluate(() => localStorage.getItem('escritorio.pip.tamanho'))).toBe(
    JSON.stringify({ width: 640, height: 420 }),
  );
});
