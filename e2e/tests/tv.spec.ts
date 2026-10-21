import type { Page } from '@playwright/test';
import { clickFurni, clickTile, expect, newPerson, test } from '../helpers.js';

/** O que a tela de mentira da TV está passando (id do vídeo e se está tocando). */
const screen = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.tv-fake-screen');
    return el ? { video: el.dataset.video, playing: el.dataset.playing === 'true' } : null;
  });

test('TV: fila igual para todos, pausar vale para quem assiste e pular por votação', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const count = () => beto.page.evaluate(() => window.__e2e!.furniList().length);
  const before = await count();

  // Ana põe uma TV na sala.
  await ana.page.getByRole('button', { name: 'Decorar' }).click();
  await ana.page.getByLabel('Buscar móvel').fill('TV Club');
  await ana.page.getByRole('button', { name: 'TV Club', exact: true }).click();
  await clickTile(ana.page, 12, 13);
  await expect.poll(count).toBe(before + 1);
  await ana.page.getByRole('button', { name: 'Concluir', exact: true }).click();
  const tv = await beto.page.evaluate(
    () =>
      window.__e2e!.furniList().find((f) => f.defId === 'hc_tv' && f.x === 12 && f.y === 13)!.id,
  );

  // Os dois abrem a TV.
  for (const p of [ana.page, beto.page]) {
    await clickFurni(p, tv);
    await expect(p.locator('.tv-panel')).toBeVisible();
  }
  await expect(ana.page.locator('.tv-viewers')).toHaveText(/2 assistindo/);

  // Ana cola um link: começa para os dois; o segundo vai para a fila.
  await ana.page.getByLabel('Link do YouTube').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await ana.page.getByRole('button', { name: 'Adicionar' }).click();
  await expect(beto.page.locator('.tv-now-title')).toHaveText('Vídeo dQw4w9WgXcQ');
  await expect.poll(() => screen(beto.page)).toEqual({ video: 'dQw4w9WgXcQ', playing: true });
  await ana.page.getByLabel('Link do YouTube').fill('youtu.be/jNQXAC9IVRw');
  await ana.page.getByRole('button', { name: 'Adicionar' }).click();
  await expect(beto.page.locator('.tv-queue-item')).toHaveCount(1);
  await expect(beto.page.locator('.tv-queue-title')).toHaveText('Vídeo jNQXAC9IVRw');
  // Link que não é do YouTube: aviso, e nada entra.
  await beto.page.getByLabel('Link do YouTube').fill('https://vimeo.com/123');
  await beto.page.getByRole('button', { name: 'Adicionar' }).click();
  await expect(beto.page.locator('.tv-status')).toHaveText(/link de vídeo ou playlist do YouTube/);

  // Beto pausa: pausa para a Ana também.
  await beto.page.locator('.tv-panel').getByRole('button', { name: 'Pausar', exact: true }).click();
  await expect.poll(() => screen(ana.page)).toEqual({ video: 'dQw4w9WgXcQ', playing: false });
  const play = ana.page.locator('.tv-panel').getByRole('button', { name: 'Tocar', exact: true });
  await expect(play).toBeVisible();
  await play.click();
  await expect.poll(() => screen(beto.page)).toEqual({ video: 'dQw4w9WgXcQ', playing: true });

  // Beto vota para pular (1 de 2); Ana, que pôs o vídeo, pula na hora.
  await beto.page.getByRole('button', { name: /Votar para pular \(0\/2\)/ }).click();
  await expect(ana.page.locator('.tv-skip')).toBeVisible();
  await expect(beto.page.getByRole('button', { name: /Votar para pular \(1\/2\)/ })).toBeVisible();
  await ana.page.getByRole('button', { name: 'Pular', exact: true }).click();
  await expect.poll(() => screen(beto.page)).toEqual({ video: 'jNQXAC9IVRw', playing: true });
  await expect(beto.page.locator('.tv-queue-item')).toHaveCount(0);

  // Beto fecha a TV: agora a Ana assiste sozinha (e o vídeo continua).
  await beto.page.getByRole('button', { name: 'Fechar a TV' }).click();
  await expect(beto.page.locator('.tv-panel')).toHaveCount(0);
  await expect(ana.page.locator('.tv-viewers')).toHaveText(/1 assistindo/);

  // A janela da TV também arrasta pela barra de cima.
  const panel = ana.page.locator('.tv-panel');
  const start = (await panel.boundingBox())!;
  const title = (await ana.page.locator('.tv-title').boundingBox())!;
  await ana.page.mouse.move(title.x + 10, title.y + 5);
  await ana.page.mouse.down();
  await ana.page.mouse.move(title.x + 210, title.y + 85, { steps: 5 });
  await ana.page.mouse.up();
  const moved = (await panel.boundingBox())!;
  expect([Math.round(moved.x - start.x), Math.round(moved.y - start.y)]).toEqual([200, 80]);
});
