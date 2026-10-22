import type { Page } from '@playwright/test';
import { clickFurni, expect, goThroughDoor, newPerson, test } from '../helpers.js';

const TABLE = 's-sinuca-1';
const pool = (page: Page) => page.evaluate((id) => window.__e2e!.pool(id), TABLE);
const at = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => window.__e2e!.poolPoint(px!, py!), [x, y]);
const bar = (page: Page, f: number) => page.evaluate((v) => window.__e2e!.poolPower(v), f);

/** Mira clicando num ponto da mesa (metros): a linha vai da branca até ali. */
async function aim(page: Page, x: number, y: number): Promise<void> {
  const p = (await at(page, x, y))!;
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
}

/** Puxa a barra de força até `f` (0–1) e solta: a tacada sai. */
async function pull(page: Page, f: number): Promise<void> {
  const top = (await bar(page, 0))!;
  const end = (await bar(page, f))!;
  await page.mouse.move(top.x, top.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

test('sinuca: abertura e tacada em dois navegadores; todos veem as mesmas bolas e o placar', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const carla = await newPerson(browser, 'Carla');
  for (const p of [ana, beto, carla]) await goThroughDoor(p.page, [15, 0], 'games');

  // Ana e Beto entram na mesa de sinuca; o Beto começa. A Ana abre, com bola na mão.
  await clickFurni(ana.page, TABLE);
  await ana.page.getByRole('button', { name: 'Entrar na vaga 1 do lado a' }).click();
  await clickFurni(beto.page, TABLE);
  await beto.page.getByRole('button', { name: 'Entrar na vaga 1 do lado b' }).click();
  await beto.page.getByRole('button', { name: 'Começar' }).click();
  const liveA = ana.page.locator('.arcade-panel.live');
  const liveB = beto.page.locator('.arcade-panel.live');
  await expect(liveA.locator('.arcade-status')).toHaveText('Sua vez! Bola na mão.');
  await expect(liveA.locator('.pool-hint')).toHaveText(/^Abertura: arraste a branca/);
  await expect(liveA.locator('.pool-clock')).toHaveText(/^⏱ \d+ s$/);
  await expect(liveB.locator('.arcade-status')).toHaveText(`Vez de ${ana.name} (bola na mão).`);

  // Carla assiste: a mesa ao vivo, a mesa aberta e o placar sobre a mesa na sala.
  await clickFurni(carla.page, TABLE);
  const liveC = carla.page.locator('.arcade-panel.live');
  await expect(liveC.locator('.arcade-status')).toHaveText(`👀 Vez de ${ana.name} (bola na mão).`);
  await expect(liveC.locator('.pool-left.a')).toHaveText('mesa aberta');
  await expect
    .poll(() => carla.page.evaluate((id) => window.__e2e!.arcadeBoard(id), TABLE))
    .toMatch(/^🎱 Ana .* 0 × 0 Beto.*\nMesa aberta$/);

  // A Ana mira no triângulo (a linha-guia aparece) e abre com força.
  await aim(ana.page, 1.68, 0.565);
  await ana.page.screenshot({ path: 'e2e-results/shot-sinuca-mira.png' });
  await pull(ana.page, 0.9);
  await expect.poll(async () => (await pool(carla.page))?.shot !== null).toBe(true);
  await expect(liveC.locator('.arcade-status')).toHaveText(`🎱 Tacada de ${ana.name}…`);
  await carla.page.waitForTimeout(600);
  await carla.page.screenshot({ path: 'e2e-results/shot-sinuca.png' });

  // As bolas param: as mesmas posições nos três navegadores, iguais à simulação de cada página.
  await expect.poll(async () => (await pool(carla.page))?.phase, { timeout: 20_000 }).toBe('aim');
  const [a, b, c] = await Promise.all([pool(ana.page), pool(beto.page), pool(carla.page)]);
  expect(a!.breakShot).toBe(false);
  expect(b!.balls).toEqual(a!.balls);
  expect(c!.balls).toEqual(a!.balls);
  for (const s of [a!, b!, c!]) {
    // (a 8 encaçapada na abertura volta para a mesa: só ela pode diferir da simulação)
    expect(s.final!.map((p, i) => (i === 8 ? null : p))).toEqual(
      s.balls!.map((p, i) => (i === 8 ? null : p)),
    );
  }
  await expect(liveC.locator('.arcade-points')).toHaveText(`${c!.scoreA} × ${c!.scoreB}`);
  await expect(liveC.locator('.arcade-sets')).toHaveText(c!.detail);

  // Quem tem a vez agora taca de novo (fraco, para a tabela de baixo); todos veem o mesmo fim.
  const shooter = c!.turn === 'a1' ? ana : beto;
  const before = c!.shot!.t0;
  const cue = c!.balls![0] ?? [0.5, 0.56];
  if (c!.inHand) {
    await expect(shooter.page.locator('.pool-hint')).toHaveText(/^Bola na mão/);
  }
  await aim(shooter.page, cue[0], 1.0);
  await pull(shooter.page, 0.3);
  await expect.poll(async () => (await pool(carla.page))?.shot?.t0).not.toBe(before);
  await expect.poll(async () => (await pool(carla.page))?.phase, { timeout: 20_000 }).toBe('aim');
  const [a2, c2] = await Promise.all([pool(ana.page), pool(carla.page)]);
  expect(c2!.balls).toEqual(a2!.balls);
  expect(c2!.final).toEqual(c2!.balls);

  // Beto desiste: a partida acaba para todos, e as bolas continuam à mostra.
  await liveB.getByRole('button', { name: 'Desistir' }).click();
  await expect(liveC.locator('.arcade-status')).toHaveText(`🏆 ${ana.name} venceu (desistência)`);
  await expect(liveC.locator('.arcade-court')).toBeVisible();
});
