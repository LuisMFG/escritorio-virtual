import type { Page } from '@playwright/test';
import { APP, clickFurni, expect, goThroughDoor, newPerson, test, waitRoom } from '../helpers.js';

const TABLE = 's-pingpong-2';
const pong = (page: Page) => page.evaluate((id) => window.__e2e!.pong(id), TABLE);
const at = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => window.__e2e!.pongPoint(px!, py!), [x, y]);

/** Espera (a cada quadro, dentro da página) a bola aparecer em jogo para quem assiste. */
const sawBall = (page: Page) =>
  page.evaluate(
    (id) =>
      new Promise<boolean>((resolve) => {
        const end = performance.now() + 10_000;
        const step = () => {
          if (window.__e2e!.pong(id)?.ball) return resolve(true);
          if (performance.now() > end) return resolve(false);
          requestAnimationFrame(step);
        };
        step();
      }),
    TABLE,
  );

/**
 * Devolve só com o teclado (lado A): segura → ou ← até a raquete chegar perto da linha da bola;
 * daí o ímã termina o serviço. Roda dentro da página, a cada quadro.
 */
async function returnWithKeys(page: Page): Promise<void> {
  await page.evaluate(
    (id) =>
      new Promise<void>((resolve, reject) => {
        const end = performance.now() + 12_000;
        let held = '';
        const press = (key: string) => {
          if (held === key) return;
          if (held) window.dispatchEvent(new KeyboardEvent('keyup', { key: held }));
          if (key) window.dispatchEvent(new KeyboardEvent('keydown', { key }));
          held = key;
        };
        const step = () => {
          const g = window.__e2e!.pong(id);
          const b = g?.ball;
          if (b?.by === 'a') {
            press('');
            return resolve();
          }
          if (performance.now() > end) return reject(new Error('o teclado não alcançou a bola'));
          const me = g?.paddles.a1;
          if (b && me) {
            const d = b.y - me.y;
            press(Math.abs(d) < 0.1 ? '' : d > 0 ? 'ArrowRight' : 'ArrowLeft');
          }
          requestAnimationFrame(step);
        };
        step();
      }),
    TABLE,
  );
}

/** Onde a raquete espera (atrás da linha de fundo): é aí que o mouse aponta para os lados. */
const home = (side: 'a' | 'b') => (side === 'a' ? -0.25 : 2.99);

/** Saca clicando na mesa, com a raquete no meio. */
async function serve(page: Page, side: 'a' | 'b'): Promise<void> {
  const p = (await at(page, home(side), 0.76))!;
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
          if (b && b.by !== me) {
            // Só para os lados: o mouse aponta para a linha da bola; a raquete avança sozinha.
            const p = window.__e2e!.pongPoint(me === 'a' ? -0.25 : 2.99, b.y);
            if (p) {
              window.dispatchEvent(
                new PointerEvent('pointermove', {
                  clientX: p.x,
                  clientY: p.y,
                  pointerType: 'mouse',
                  bubbles: true,
                }),
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
  await expect(liveA.getByText('Seu saque: clique, aperte espaço ou espere.')).toBeVisible();
  await expect(liveB.getByText(`Saque de ${ana.name}.`)).toBeVisible();

  // Carla assiste: abre a mesa e vê a partida ao vivo.
  await clickFurni(carla.page, TABLE);
  const liveC = carla.page.locator('.arcade-panel.live');
  await expect(liveC.getByText('Sets 0 × 0')).toBeVisible();

  // Dois saques da Ana; o Beto deixa a raquete no canto e não rebate: 2 × 0. A Carla vê a bola.
  const away = (await at(beto.page, home('b'), -0.45))!;
  await beto.page.mouse.move(away.x, away.y);
  for (const n of [1, 2]) {
    await expect.poll(() => pong(ana.page)).toMatchObject({ phase: 'serve', turn: 'a1' });
    const seen = sawBall(carla.page);
    await serve(ana.page, 'a');
    expect(await seen).toBe(true);
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
  await expect(liveB.getByText('Seu saque: clique, aperte espaço ou espere.')).toBeVisible();
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

  // O Beto saca de novo, agora sozinho (sem clicar), e a Ana devolve só com o teclado: 4 × 0.
  await expect
    .poll(() => pong(beto.page), { timeout: 10_000 })
    .toMatchObject({ phase: 'serve', turn: 'b1' });
  await ana.page.locator('.arcade-panel.live .arcade-court').focus();
  await returnWithKeys(ana.page);
  await expect.poll(async () => (await pong(beto.page))?.scoreA, { timeout: 10_000 }).toBe(4);

  // Beto desiste: a partida acaba para todos.
  await liveB.getByRole('button', { name: 'Desistir' }).click();
  await expect(carla.page.locator('.arcade-status')).toHaveText(
    `🏆 ${ana.name} venceu (desistência)`,
  );
});
