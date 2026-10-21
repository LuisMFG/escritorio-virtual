import type { Page } from '@playwright/test';
import { expect, newPerson, openCard, sendChat, test } from '../helpers.js';

/** Emote que alguém (pelo começo do nome) está fazendo, visto desta página. */
const emoteOf = (page: Page, name: string) =>
  page.evaluate((n) => {
    const h = window.__e2e!;
    const p = h.players().find((q) => q.name.startsWith(n));
    return p ? h.avatarEmote(p.id) : null;
  }, name);
/** Direção do Habbo de `from` olhando para `to` (vizinhos). */
function facing(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  const dirs = [
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
  ];
  return dirs.findIndex(([x, y]) => x === dx && y === dy);
}
const playerOf = (page: Page, name: string) =>
  page.evaluate((n) => window.__e2e!.players().find((q) => q.name.startsWith(n)) ?? null, name);

test('emotes novos: menu, comando e toca aqui em dois navegadores', async ({ browser }) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  // Os dois entram pela mesma porta e ficam perto um do outro (o toca aqui anda se precisar).
  await expect
    .poll(async () => (await playerOf(beto.page, 'Ana'))?.action, { timeout: 15_000 })
    .toBe('idle');

  // Menu: Palmas. O Beto vê a Ana batendo palmas.
  await ana.page.getByRole('button', { name: 'Emotes' }).click();
  await ana.page.getByRole('menuitem', { name: /Palmas/ }).click();
  await expect.poll(() => emoteOf(beto.page, 'Ana')).toBe('clap');

  // Comando: /pular.
  await sendChat(ana.page, '/pular');
  await expect.poll(() => emoteOf(beto.page, 'Ana')).toBe('jump');

  // Toca aqui pelo cartão do Beto: os dois batem as mãos e ficam virados um para o outro.
  await openCard(ana.page, beto.name);
  await ana.page.getByRole('button', { name: /Toca aqui/ }).click();
  await expect.poll(() => emoteOf(beto.page, 'Ana')).toBe('highfive');
  expect(await emoteOf(beto.page, 'Beto')).toBe('highfive');
  // Lado a lado e virados um para o outro.
  await expect
    .poll(async () => {
      const [a, b] = [(await playerOf(beto.page, 'Ana'))!, (await playerOf(beto.page, 'Beto'))!];
      const near = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) === 1;
      return near && a.dir === facing(a, b) && b.dir === facing(b, a);
    })
    .toBe(true);
  await beto.page.screenshot({ path: 'e2e-results/shot-tocaaqui.png' });

  // Pelo comando com o nome (o limite de emotes repõe um a cada 2 s).
  await ana.page.waitForTimeout(2200);
  await sendChat(beto.page, `/tocaaqui ${ana.name.split(' ')[0]}`);
  await expect.poll(() => emoteOf(ana.page, 'Beto')).toBe('highfive');

  // Sentada, os emotes de corpo inteiro ficam apagados no menu.
  await sendChat(ana.page, '/sentar');
  await expect.poll(async () => (await playerOf(ana.page, 'Ana'))?.action).toBe('sit');
  await ana.page.getByRole('button', { name: 'Emotes' }).click();
  await expect(ana.page.getByRole('menuitem', { name: /Pular/ })).toBeDisabled();
  await expect(ana.page.getByRole('menuitem', { name: /Palmas/ })).toBeEnabled();
});
