import type { Page } from '@playwright/test';
import { clickFurni, expect, goThroughDoor, newPerson, test } from '../helpers.js';

const POOL = 's-sinuca-2';
const PONG = 's-pingpong-1';
const pool = (page: Page) => page.evaluate((id) => window.__e2e!.pool(id), POOL);
const pong = (page: Page) => page.evaluate((id) => window.__e2e!.pong(id), PONG);
const at = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => window.__e2e!.poolPoint(px!, py!), [x, y]);
const bar = (page: Page, f: number) => page.evaluate((v) => window.__e2e!.poolPower(v), f);

/** Arrasta de um ponto da mesa de sinuca (metros) até outro. */
async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const a = (await at(page, ...from))!;
  const b = (await at(page, ...to))!;
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
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

test('sinuca sozinho: treino livre (mexer nas bolas, repetir e arrumar) e pedir a mesa', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  for (const p of [ana, beto]) await goThroughDoor(p.page, [15, 0], 'games');

  // A Ana senta sozinha: aparecem as opções de jogar sozinho.
  await clickFurni(ana.page, POOL);
  const panelA = ana.page.locator('.arcade-panel');
  await panelA.getByRole('button', { name: 'Entrar na vaga 1 do lado a' }).click();
  await panelA
    .getByRole('dialog', { name: 'Como jogar sinuca' })
    .getByRole('button', { name: 'Pular' })
    .click();
  const solo = panelA.getByRole('group', { name: 'Jogar sozinho' });
  await expect(solo).toContainText('Não conta no ranking');
  await solo.getByRole('button', { name: 'Treino livre' }).click();
  await expect(panelA.locator('.pool-turn-title')).toHaveText('Treino');
  await expect(panelA.locator('.pool-clock')).toHaveText('');

  // Arrasta a bola 1 (a ponta do triângulo) para perto da caçapa do canto.
  const start = (await pool(ana.page))!;
  const one = start.balls![1]!;
  await drag(ana.page, one, [2.0, 0.95]);
  // (O mouse anda em pixels: a bola fica a menos de 1 cm de onde foi solta.)
  await expect
    .poll(async () => {
      const b = (await pool(ana.page))?.balls?.[1];
      return b ? Math.hypot(b[0] - 2.0, b[1] - 0.95) : 1;
    })
    .toBeLessThan(0.01);
  const before = (await pool(ana.page))!.balls!;

  // Mira no triângulo e taca; as bolas andam.
  const p = (await at(ana.page, 1.7, 0.56))!;
  await ana.page.mouse.move(p.x, p.y);
  await ana.page.mouse.down();
  await ana.page.mouse.up();
  await pull(ana.page, 0.8);
  await expect.poll(async () => (await pool(ana.page))?.phase, { timeout: 20_000 }).toBe('shot');
  await expect.poll(async () => (await pool(ana.page))?.phase, { timeout: 30_000 }).toBe('aim');
  expect((await pool(ana.page))!.balls).not.toEqual(before);
  // Continua a vez dela (treino), sem relógio.
  expect((await pool(ana.page))!.turn).toBe('a1');

  // Repetir: as bolas voltam para antes da tacada.
  await panelA.getByRole('button', { name: 'Repetir a última tacada' }).click();
  await expect.poll(async () => (await pool(ana.page))!.balls!.slice(1)).toEqual(before.slice(1));
  await expect(panelA.locator('.pool-log li').first()).toHaveText(
    'As bolas voltaram para antes da última tacada.',
  );
  // Arrumar de novo: o triângulo volta.
  await panelA.getByRole('button', { name: 'Arrumar de novo' }).click();
  await expect(panelA.locator('.pool-log li').first()).toHaveText('Mesa arrumada de novo.');
  await ana.page.screenshot({ path: 'e2e-results/shot-sinuca-treino.png' });

  // O Beto assiste e pede a mesa; a Ana é avisada e aceita: viram adversários.
  await clickFurni(beto.page, POOL);
  const panelB = beto.page.locator('.arcade-panel');
  await expect(panelB.getByRole('group', { name: 'Jogar sozinho' })).toContainText(
    `${ana.name} está treinando.`,
  );
  await panelB.getByRole('button', { name: 'Pedir a mesa' }).click();
  await expect(panelB).toContainText(`Esperando ${ana.name} responder`);
  const prompt = panelA.getByRole('alertdialog', { name: 'Pedido da mesa' });
  await expect(prompt).toContainText(`${beto.name} quer jogar nesta mesa`);
  await ana.page.screenshot({ path: 'e2e-results/shot-pedido-da-mesa.png' });
  await prompt.getByRole('button', { name: `Jogar contra ${beto.name}` }).click();
  await expect(beto.page.getByText(`${ana.name} liberou a mesa: vocês jogam agora.`)).toBeVisible();
  await expect.poll(async () => (await pool(beto.page))?.status).toBe('waiting');
  await expect(panelB.getByText(`${beto.name} (você)`)).toBeVisible();
  await expect(panelA.getByRole('button', { name: 'Começar' })).toBeVisible();
});

test('ping-pong contra o computador: ele devolve; e a máquina de bolas lança sozinha', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ana = await newPerson(browser, 'Ana');
  await goThroughDoor(ana.page, [15, 0], 'games');
  await clickFurni(ana.page, PONG);
  const panel = ana.page.locator('.arcade-panel');
  await panel.getByRole('button', { name: 'Entrar na vaga 1 do lado a' }).click();
  const solo = panel.getByRole('group', { name: 'Jogar sozinho' });
  await solo.getByRole('combobox', { name: 'Dificuldade' }).selectOption('dificil');
  await solo.getByRole('button', { name: 'Contra o computador' }).click();
  await expect(panel.locator('.arcade-names.b')).toHaveText('Computador (difícil)');

  // A Ana saca (espaço); o computador devolve.
  await expect.poll(async () => (await pong(ana.page))?.phase).toBe('serve');
  await ana.page.locator('.arcade-panel.live .arcade-court').focus();
  await ana.page.keyboard.press('Space');
  await expect.poll(async () => (await pong(ana.page))?.ball?.by, { timeout: 10_000 }).toBe('b');
  await ana.page.screenshot({ path: 'e2e-results/shot-pingpong-computador.png' });

  // Desiste e vai para a máquina de bolas: ela lança sozinha para a Ana.
  await panel.getByRole('button', { name: 'Desistir' }).click();
  await expect(panel.locator('.arcade-status')).toContainText('venceu');
  await panel
    .getByRole('group', { name: 'Jogar sozinho' })
    .getByRole('button', { name: 'Máquina de bolas' })
    .click();
  await expect(panel.locator('.arcade-sets')).toHaveText('Devolvidas × perdidas');
  await expect.poll(async () => (await pong(ana.page))?.ball?.by, { timeout: 10_000 }).toBe('b');
  // A bola não volta (ninguém rebate): perdida, e a máquina lança de novo.
  await expect.poll(async () => (await pong(ana.page))?.scoreB, { timeout: 15_000 }).toBe(1);
  await panel.getByRole('button', { name: 'Parar treino' }).click();
  await expect.poll(async () => (await pong(ana.page))?.phase).toBe('');
});
