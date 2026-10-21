import type { Page } from '@playwright/test';
import { clickTile, expect, newPerson, openCard, test } from '../helpers.js';

/** Vídeo de alguém tocando de verdade na grade (quadros chegando). */
const tilePlaying = (page: Page, caption: RegExp) =>
  page.evaluate((src) => {
    const re = new RegExp(src);
    const tile = [...document.querySelectorAll('.call-tile')].find((t) =>
      re.test(t.querySelector('figcaption')?.textContent ?? ''),
    );
    const v = tile?.querySelector('video');
    return Boolean(v && v.videoWidth > 0 && !v.paused);
  }, caption.source);

test('vídeo: câmera chega para o outro, tela em destaque e ampliar', async ({ browser }) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  await clickTile(beto.page, 6, 17);
  await expect
    .poll(
      () =>
        beto.page.evaluate(() => {
          const h = window.__e2e!;
          const me = h.players().find((p) => p.id === h.mySessionId())!;
          return [me.x, me.y];
        }),
      { timeout: 25_000 },
    )
    .toEqual([6, 17]);

  await openCard(ana.page, beto.name);
  await ana.page.getByRole('button', { name: 'Chamar para conversa' }).click();
  await ana.page.getByRole('dialog').getByRole('button', { name: 'Chamar' }).click();
  await beto.page.locator('.call-card').getByRole('button', { name: 'Aceitar' }).click();
  await expect(ana.page.locator('.call-members li')).toHaveCount(2);

  // Ana liga a câmera: prévia dela e o vídeo chegando para o Beto.
  await ana.page.getByRole('button', { name: 'Câmera', exact: true }).click();
  await expect.poll(() => tilePlaying(ana.page, /^Você$/), { timeout: 15_000 }).toBe(true);
  await expect
    .poll(() => tilePlaying(beto.page, new RegExp(ana.name)), { timeout: 20_000 })
    .toBe(true);
  await expect(
    beto.page.locator('.call-members li', { hasText: ana.name }).locator('svg'),
  ).toBeVisible();

  // Ampliar e voltar.
  await beto.page.getByRole('button', { name: 'Ampliar' }).click();
  await expect(beto.page.locator('.call-panel')).toHaveClass(/expanded/);
  await beto.page.getByRole('button', { name: 'Diminuir' }).click();

  // Beto compartilha a tela: aparece em destaque para a Ana.
  await beto.page.getByRole('button', { name: 'Tela', exact: true }).click();
  await expect(ana.page.locator('.call-tile.screen')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => tilePlaying(ana.page, /· tela$/), { timeout: 20_000 }).toBe(true);
  await beto.page.getByRole('button', { name: 'Parar tela' }).click();
  await expect(ana.page.locator('.call-tile.screen')).toBeHidden();

  // Câmera desligada: o vídeo some para o Beto.
  await ana.page.getByRole('button', { name: 'Desligar câmera' }).click();
  await expect(beto.page.locator('.call-tile')).toHaveCount(0);
  await ana.page.getByRole('button', { name: /Sair/ }).click();
});
