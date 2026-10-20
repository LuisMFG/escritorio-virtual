import { expect, newPerson, test, waitRoom } from '../helpers.js';

/** Cantos da Recepção (23×20) na tela, e as caixas da interface em volta. */
async function layout(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const hook = window.__e2e!;
    const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
    const history = document.querySelector<HTMLDetailsElement>('.chat-history')!;
    return {
      corners: [hook.tile(0, 0), hook.tile(22, 0), hook.tile(0, 19), hook.tile(22, 19)],
      left: history.open ? box('.chat-history').right : 0,
      right: box('.hud-zoom').left,
      bottom: Math.min(box('.hud-actions').top, box('.chat-bar').top),
    };
  });
}

test('tela principal: a sala inteira cabe ao lado da conversa, que recolhe e é lembrada', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const page = ana.page;
  await expect(page.locator('.hud-card')).toHaveText('Recepção');
  // Sem dicas nem selo de assets; no "Mais" quem não é admin só vê a Ajuda.
  await expect(page.locator('.hud-status')).toBeHidden();
  await page.getByRole('button', { name: 'Mais' }).click();
  await expect(page.getByRole('menuitem', { name: 'Ajuda (?)' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Admin' })).toBeHidden();
  await page.getByRole('button', { name: 'Mais' }).click();
  await expect(page.getByRole('menuitem', { name: 'Ajuda (?)' })).toBeHidden();
  await expect(page.getByRole('group', { name: 'Conversas' })).toBeVisible();

  const history = page.locator('details.chat-history');
  await expect(history).toHaveAttribute('open', '');
  let l = await layout(page);
  for (const c of l.corners) {
    expect(c.x).toBeGreaterThan(l.left);
    expect(c.x).toBeLessThan(l.right);
    expect(c.y).toBeLessThan(l.bottom);
  }

  // Recolher: a sala reenquadra e a escolha fica salva ao recarregar.
  await history.locator('summary').click();
  await expect(history).not.toHaveAttribute('open', '');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ev-chat-open'))).toBe('0');
  await page.reload();
  await waitRoom(page, 'reception');
  await expect(history).not.toHaveAttribute('open', '');
  l = await layout(page);
  for (const c of l.corners) {
    expect(c.x).toBeGreaterThan(0);
    expect(c.x).toBeLessThan(l.right);
  }

  // Câmera: aproximar, enquadrar de novo e centralizar em mim.
  await page.getByRole('button', { name: 'Aproximar' }).click();
  await page.getByRole('button', { name: 'Enquadrar a sala' }).click();
  await page.getByRole('button', { name: 'Centralizar em mim' }).click();
});
