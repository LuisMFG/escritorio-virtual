import type { Page } from '@playwright/test';
import { APP, clickFurni, expect, goThroughDoor, newPerson, test, waitRoom } from '../helpers.js';

const TABLE = 's-pingpong-2';
const pong = (page: Page) => page.evaluate((id) => window.__e2e!.pong(id), TABLE);
const at = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => window.__e2e!.pongPoint(px!, py!), [x, y]);

/** Saca clicando na mesa, atrás da própria linha de fundo. */
async function serve(page: Page, side: 'a' | 'b'): Promise<void> {
  const p = (await at(page, side === 'a' ? -0.2 : 2.94, 0.76))!;
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}

/**
 * Segue a bola com a raquete depois que ela quica do meu lado, até a rebatida valer. Roda dentro
 * da página, a cada quadro (ida e volta ao navegador a cada passo atrasava demais com a máquina
 * carregada).
 */
async function returnBall(page: Page, side: 'a' | 'b'): Promise<void> {
  await page.evaluate(
    ([id, me]) =>
      new Promise<void>((resolve, reject) => {
        const end = performance.now() + 8000;
        const step = () => {
          const b = window.__e2e!.pong(id!)?.ball;
          if (b?.by === me) return resolve();
          if (performance.now() > end) return reject(new Error('a raquete não alcançou a bola'));
          if (b && (me === 'a' ? b.na : b.nb) >= 1) {
            const p = window.__e2e!.pongPoint(b.x, b.y);
            const court = document.querySelector('.arcade-panel.live .arcade-court');
            if (p && court) {
              court.dispatchEvent(
                new PointerEvent('pointermove', { clientX: p.x, clientY: p.y, bubbles: true }),
              );
            }
          }
          requestAnimationFrame(step);
        };
        step();
      }),
    [TABLE, side],
  );
}

test('ping-pong: saque, pontos e rebatida em dois navegadores com 150 ms de atraso; quem assiste vê a bola', async ({
  browser,
}) => {
  // Três pessoas e três pontos jogados de verdade (com a pausa entre os pontos).
  test.setTimeout(150_000);
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const carla = await newPerson(browser, 'Carla');
  // Os dois jogadores com 150 ms de atraso simulado (ida e volta) no ping-pong.
  for (const p of [ana, beto]) {
    await p.page.goto(`${APP}&atraso=150`);
    await waitRoom(p.page, 'reception');
  }
  for (const p of [ana, beto, carla]) await goThroughDoor(p.page, [15, 0], 'games');

  // Ana e Beto entram na mesa; o Beto começa. O painel vira a mesa ao vivo para os dois.
  await clickFurni(ana.page, TABLE);
  await ana.page.getByRole('button', { name: 'Entrar na vaga 1 do lado a' }).click();
  await clickFurni(beto.page, TABLE);
  await beto.page.getByRole('button', { name: 'Entrar na vaga 1 do lado b' }).click();
  await beto.page.getByRole('button', { name: 'Começar' }).click();
  const liveA = ana.page.locator('.arcade-panel.live');
  const liveB = beto.page.locator('.arcade-panel.live');
  await expect(liveA.getByText('Seu saque: clique na mesa.')).toBeVisible();
  await expect(liveB.getByText(`Saque de ${ana.name}.`)).toBeVisible();

  // Carla assiste: abre a mesa e vê a partida ao vivo.
  await clickFurni(carla.page, TABLE);
  const liveC = carla.page.locator('.arcade-panel.live');
  await expect(liveC.getByText('Sets 0 × 0')).toBeVisible();

  // Dois saques da Ana; o Beto não rebate: 2 × 0. A Carla vê a bola em jogo.
  for (const n of [1, 2]) {
    await expect.poll(() => pong(ana.page)).toMatchObject({ phase: 'serve', turn: 'a1' });
    await serve(ana.page, 'a');
    await expect.poll(async () => (await pong(carla.page))?.ball !== null).toBe(true);
    await expect.poll(async () => (await pong(beto.page))?.scoreA, { timeout: 10_000 }).toBe(n);
  }
  await expect(liveC.locator('.arcade-points')).toHaveText('2 × 0');

  // O saque passa para o Beto. A Ana devolve e o Beto não alcança: 3 × 0.
  await expect
    .poll(() => pong(beto.page), { timeout: 10_000 })
    .toMatchObject({
      phase: 'serve',
      turn: 'b1',
    });
  await expect(liveB.getByText('Seu saque: clique na mesa.')).toBeVisible();
  await serve(beto.page, 'b');
  // Depois do saque, a raquete do Beto vai para o canto (para ele não alcançar a devolução).
  const corner = (await at(beto.page, 3.6, -0.45))!;
  await beto.page.mouse.move(corner.x, corner.y);
  await returnBall(ana.page, 'a');
  // Todo mundo vê a bola voltando da Ana.
  await expect.poll(async () => (await pong(carla.page))?.ball?.by).toBe('a');
  await carla.page.screenshot({ path: 'e2e-results/shot-pingpong.png' });
  await ana.page.screenshot({ path: 'e2e-results/shot-pingpong-jogador.png' });
  await expect.poll(async () => (await pong(beto.page))?.scoreA, { timeout: 10_000 }).toBe(3);
  await expect(liveC.locator('.arcade-points')).toHaveText('3 × 0');
  await expect
    .poll(() => carla.page.evaluate((id) => window.__e2e!.arcadeBoard(id), TABLE))
    .toMatch(/ 3 × 0 .*\nSets 0 × 0$/);

  // Beto desiste: a partida acaba para todos.
  await liveB.getByRole('button', { name: 'Desistir' }).click();
  await expect(carla.page.locator('.arcade-status')).toHaveText(
    `🏆 ${ana.name} venceu (desistência)`,
  );
});
