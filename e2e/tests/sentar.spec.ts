import { clickFurni, clickTile, expect, newPerson, sendChat, test } from '../helpers.js';

test('sentar e deitar: dois no mesmo sofá e comandos no chão', async ({ browser }) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const me = (page: typeof ana.page) =>
    page.evaluate(() => {
      const h = window.__e2e!;
      return h.players().find((p) => p.id === h.mySessionId())!;
    });

  // Os dois clicam no sofá de dois lugares: cada um senta num lugar.
  await clickFurni(ana.page, 'r-sofa');
  await expect.poll(async () => (await me(ana.page)).action, { timeout: 15_000 }).toBe('sit');
  await clickFurni(beto.page, 'r-sofa');
  await expect.poll(async () => (await me(beto.page)).action, { timeout: 15_000 }).toBe('sit');
  const [a, b] = [await me(ana.page), await me(beto.page)];
  expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1);

  // Ana levanta, anda e senta no chão; depois deita.
  await sendChat(ana.page, '/levantar');
  await expect.poll(async () => (await me(ana.page)).action).toBe('idle');
  await clickTile(ana.page, 15, 10);
  await expect
    .poll(
      async () => {
        const p = await me(ana.page);
        return `${p.x},${p.y},${p.action}`;
      },
      { timeout: 15_000 },
    )
    .toBe('15,10,idle');
  await sendChat(ana.page, '/sentar');
  await expect.poll(async () => (await me(ana.page)).action).toBe('sit');
  await sendChat(ana.page, '/deitar');
  await expect.poll(async () => (await me(ana.page)).action).toBe('lay');
  // O Beto vê a Ana deitada.
  await expect
    .poll(() =>
      beto.page.evaluate(
        () => window.__e2e!.players().find((p) => p.name.startsWith('Ana'))?.action,
      ),
    )
    .toBe('lay');
});
