import type { Page } from '@playwright/test';
import { clickTile, expect, newPerson, sendChat, test } from '../helpers.js';

/** Dança e quadro que esta página mostra para alguém (pelo começo do nome). */
const danceOf = (page: Page, name: string) =>
  page.evaluate((n) => {
    const h = window.__e2e!;
    const p = h.players().find((q) => q.name.startsWith(n));
    return p ? h.avatarDance(p.id) : null;
  }, name);

/** Distância entre dois quadros de uma dança que repete (o último encosta no primeiro). */
const gap = (a: number, b: number, frames: number) => {
  const d = Math.abs(a - b) % frames;
  return Math.min(d, frames - d);
};

test('danças: perto, no mesmo quadro; quem chega depois vê no tempo; andar e /parar param', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');

  // O antigo /dancar abre a escolha de dança.
  await sendChat(ana.page, '/dancar');
  const menu = ana.page.getByRole('menu', { name: 'Danças' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: /Macarena/ }).click();
  await expect.poll(() => danceOf(beto.page, 'Ana')).toMatchObject({ id: 'macarena' });

  // O Beto (que entrou pela mesma porta, perto) começa a mesma dança depois: mesmo compasso.
  await ana.page.waitForTimeout(900);
  await sendChat(beto.page, '/macarena');
  await expect.poll(() => danceOf(ana.page, 'Beto')).toMatchObject({ id: 'macarena' });
  for (const page of [ana.page, beto.page]) {
    await expect
      .poll(async () => {
        const [a, b] = [await danceOf(page, 'Ana'), await danceOf(page, 'Beto')];
        return a && b ? gap(a.frame, b.frame, a.frames) : 99;
      })
      .toBeLessThanOrEqual(1);
  }

  // Quem entra depois vê a dança da Ana no mesmo quadro que a tela da própria Ana.
  const carla = await newPerson(browser, 'Carla');
  await expect.poll(() => danceOf(carla.page, 'Ana')).toMatchObject({ id: 'macarena' });
  const [own, late] = await Promise.all([danceOf(ana.page, 'Ana'), danceOf(carla.page, 'Ana')]);
  expect(gap(own!.frame, late!.frame, own!.frames)).toBeLessThanOrEqual(1);

  // Andar para a dança; /parar também.
  await clickTile(ana.page, 3, 5);
  await expect.poll(() => danceOf(beto.page, 'Ana')).toBeNull();
  await sendChat(beto.page, '/parar');
  await expect.poll(() => danceOf(ana.page, 'Beto')).toBeNull();
});
