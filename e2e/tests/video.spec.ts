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
  await expect(ana.page.locator('.call-tile')).toHaveCount(2);

  // Ana liga a câmera: prévia dela e o vídeo chegando para o Beto.
  await ana.page.getByRole('button', { name: 'Câmera', exact: true }).click();
  await expect.poll(() => tilePlaying(ana.page, /^Você$/), { timeout: 15_000 }).toBe(true);
  await expect
    .poll(() => tilePlaying(beto.page, new RegExp(ana.name)), { timeout: 20_000 })
    .toBe(true);
  await expect(beto.page.locator('.call-tile.has-video', { hasText: ana.name })).toBeVisible();

  // Arrastar a janela pela barra: fica onde soltou, em cada modo (pequena e ampliada).
  const panel = beto.page.locator('.call-panel');
  const dragBy = async (dx: number, dy: number) => {
    const head = await beto.page.locator('.call-panel-head strong').boundingBox();
    await beto.page.mouse.move(head!.x + 5, head!.y + 5);
    await beto.page.mouse.down();
    await beto.page.mouse.move(head!.x + 5 + dx / 2, head!.y + 5 + dy / 2, { steps: 4 });
    await beto.page.mouse.move(head!.x + 5 + dx, head!.y + 5 + dy, { steps: 4 });
    await beto.page.mouse.up();
  };
  const before = (await panel.boundingBox())!;
  await dragBy(-300, 250);
  const small = (await panel.boundingBox())!;
  expect(Math.round(small.x - before.x)).toBe(-300);
  expect(Math.round(small.y - before.y)).toBe(250);

  // Ampliar (no meio, até arrastar), arrastar ampliada e voltar: a pequena volta para onde estava.
  await beto.page.getByRole('button', { name: 'Ampliar' }).click();
  await expect(panel).toHaveClass(/expanded/);
  const big = (await panel.boundingBox())!;
  await dragBy(40, 30);
  expect(Math.round((await panel.boundingBox())!.x - big.x)).toBe(40);
  await beto.page.getByRole('button', { name: 'Diminuir' }).click();
  await expect
    .poll(async () => Math.round((await panel.boundingBox())!.x))
    .toBe(Math.round(small.x));
  // Duplo clique na barra: volta ao lugar de sempre.
  await beto.page.locator('.call-panel-head strong').dblclick();
  await expect
    .poll(async () => Math.round((await panel.boundingBox())!.x))
    .toBe(Math.round(before.x));

  // Beto compartilha a tela: aparece em destaque para a Ana.
  await beto.page.getByRole('button', { name: 'Tela', exact: true }).click();
  await expect(ana.page.locator('.call-tile.screen')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => tilePlaying(ana.page, /· tela$/), { timeout: 20_000 }).toBe(true);
  await beto.page.getByRole('button', { name: 'Parar tela' }).click();
  await expect(ana.page.locator('.call-tile.screen')).toBeHidden();

  // Câmera desligada: o vídeo some para o Beto (fica o rosto do avatar).
  await ana.page.getByRole('button', { name: 'Desligar câmera' }).click();
  await expect(beto.page.locator('.call-tile.has-video')).toHaveCount(0);
  await expect(
    beto.page.locator('.call-tile', { hasText: ana.name }).locator('.call-face img'),
  ).toBeVisible();
  await ana.page.getByRole('button', { name: /Sair/ }).click();
});
