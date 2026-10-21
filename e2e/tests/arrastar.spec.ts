import type { Page } from '@playwright/test';
import { clickFurni, expect, newPerson, test } from '../helpers.js';

/** Ponto mais alto do desenho de um móvel em que o clique ainda pega ele (a parte de cima). */
async function topPoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  const p = await page.evaluate((fid) => {
    const h = window.__e2e!;
    const c = h.furni(fid);
    if (!c) return null;
    for (let dy = -200; dy <= 0; dy += 2) {
      if (h.furniAt(c.x, c.y + dy) === fid) return { x: c.x, y: c.y + dy + 3 };
    }
    return null;
  }, id);
  expect(p, `parte de cima de ${id}`).not.toBeNull();
  return p!;
}

const ghost = (page: Page) => page.evaluate(() => window.__e2e!.decorGhost());
const shown = (page: Page, id: string) => page.evaluate((fid) => window.__e2e!.furniShown(fid), id);
const placed = (page: Page, id: string) =>
  page.evaluate((fid) => window.__e2e!.furniList().find((f) => f.id === fid) ?? null, id);
const tile = (page: Page, x: number, y: number) =>
  page.evaluate(([tx, ty]) => window.__e2e!.tile(tx!, ty!), [x, y]);

test('arrastar no Decorar: pela parte de cima, em cima da mesa, R no arrasto, Esc e desfazer', async ({
  browser,
}) => {
  const { page } = await newPerson(browser, 'Ana');
  const pc = 'r-fila-4-pc';
  await page.getByRole('button', { name: 'Decorar' }).click();
  await page.evaluate(() => window.__e2e!.look(10, 2, 1.5));
  const start = (await placed(page, pc))!;
  expect(start).toMatchObject({ x: 10, y: 2 });
  const rot0 = (await shown(page, pc))!.rot;
  const [t10, t11] = [await tile(page, 10, 2), await tile(page, 11, 2)];
  const step = { x: t11.x - t10.x, y: t11.y - t10.y };

  // Pela tela do computador (bem acima do tile): ele vai para o outro lado da mesa, no tampo.
  const top = await topPoint(page, pc);
  await page.mouse.move(top.x, top.y);
  await page.mouse.down();
  await page.mouse.move(top.x + step.x / 2, top.y + step.y / 2, { steps: 6 });
  // No meio do caminho continua em cima da mesa (antes pulava para o chão atrás dela).
  expect(await ghost(page)).toMatchObject({ y: 2, z: expect.closeTo(start.z, 2) });
  await page.mouse.move(top.x + step.x, top.y + step.y, { steps: 6 });
  expect(await ghost(page)).toMatchObject({ x: 11, y: 2, ok: true });
  await page.mouse.up();
  // Soltou: a tela já mostra o lugar novo, sem esperar o servidor (e sem piscar de volta).
  expect(await shown(page, pc)).toMatchObject({ x: 11, y: 2 });
  await expect.poll(() => placed(page, pc)).toMatchObject({ x: 11, y: 2 });
  await page.screenshot({ path: 'e2e-results/shot-arrastar.png' });

  // R durante o arrasto gira o fantasma; solto, o computador fica girado.
  const top2 = await topPoint(page, pc);
  await page.mouse.move(top2.x, top2.y);
  await page.mouse.down();
  await page.mouse.move(top2.x - step.x, top2.y - step.y, { steps: 8 });
  await page.keyboard.press('r');
  const turned = (await ghost(page))!;
  expect(turned).toMatchObject({ x: 10, y: 2, ok: true });
  expect(turned.rot).not.toBe(rot0);
  await page.mouse.up();
  await expect.poll(() => placed(page, pc)).toMatchObject({ x: 10, y: 2 });
  expect((await shown(page, pc))!.rot).toBe(turned.rot);

  // Esc no meio do arrasto cancela: nada muda.
  const top3 = await topPoint(page, pc);
  await page.mouse.move(top3.x, top3.y);
  await page.mouse.down();
  await page.mouse.move(top3.x + step.x, top3.y + step.y, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await ghost(page)).toBeNull();
  await page.waitForTimeout(300);
  expect(await placed(page, pc)).toMatchObject({ x: 10, y: 2 });

  // Tirar a mesa com o computador em cima é recusado, sem o aviso de "removido"…
  await clickFurni(page, 'r-fila-4-mesa');
  await page.keyboard.press('Delete');
  const toasts = page.locator('.toasts');
  await expect(toasts).toContainText('Tire o que está em cima primeiro.');
  await expect(toasts).not.toContainText('removido');
  expect(await placed(page, 'r-fila-4-mesa')).not.toBeNull();
  // …e o Ctrl+Z desfaz a última ação aceita (o giro), depois a primeira (volta ao começo).
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(() => shown(page, pc)).toMatchObject({ x: 11, y: 2, rot: rot0 });
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(() => placed(page, pc)).toMatchObject({ x: 10, y: 2 });
  await page.getByRole('button', { name: 'Concluir', exact: true }).click();
});

test('arrastar no Decorar: móvel alto do fundo pela parte de cima; duplo clique põe um só', async ({
  browser,
}) => {
  const { page } = await newPerson(browser, 'Ana');
  const cabinet = 'r-arquivo-1';
  await page.getByRole('button', { name: 'Decorar' }).click();
  await page.evaluate(() => window.__e2e!.look(13, 2, 1.5));
  expect(await placed(page, cabinet)).toMatchObject({ x: 12, y: 1 });

  // O arquivo encosta na parede do fundo: pegando pela parte de cima (sobre a parede) ele vem
  // junto. Antes o fantasma sumia, e soltar não fazia nada.
  const top = await topPoint(page, cabinet);
  const [from, to] = [await tile(page, 12, 1), await tile(page, 14, 3)];
  await page.mouse.move(top.x, top.y);
  await page.mouse.down();
  await page.mouse.move(top.x + to.x - from.x, top.y + to.y - from.y, { steps: 12 });
  expect(await ghost(page)).toMatchObject({ x: 14, y: 3, z: 0, ok: true });
  await page.mouse.up();
  await expect.poll(() => placed(page, cabinet)).toMatchObject({ x: 14, y: 3 });
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(() => placed(page, cabinet)).toMatchObject({ x: 12, y: 1 });

  // Botão direito não arrasta (antes deixava um arrasto "armado" seguindo o mouse).
  const top2 = await topPoint(page, cabinet);
  await page.mouse.move(top2.x, top2.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(top2.x + 60, top2.y + 40, { steps: 6 });
  expect(await ghost(page)).toBeNull();
  await page.mouse.up({ button: 'right' });
  expect(await placed(page, cabinet)).toMatchObject({ x: 12, y: 1 });

  // Planta só tem uma direção: R avisa em vez de não fazer nada.
  await page.keyboard.press('Escape');
  await clickFurni(page, 'r-planta-2');
  await page.keyboard.press('r');
  await expect(page.locator('.toasts')).toContainText('Esse móvel só tem uma direção.');

  // Duplo clique colocando uma mesa (que tem tampo): uma mesa só, nada empilhado.
  const count = () =>
    page.evaluate(() =>
      window.__e2e!.furniList().filter((f) => f.defId === 'table_norja_med' && f.x === 12),
    );
  await page.getByLabel('Buscar móvel').fill('Mesa Norja');
  await page.getByRole('button', { name: 'Mesa Norja', exact: true }).click();
  await page.evaluate(() => window.__e2e!.look(12, 17, 1));
  const spot = await tile(page, 12, 17);
  await page.mouse.move(spot.x, spot.y);
  expect(await ghost(page)).toMatchObject({ x: 12, y: 17, ok: true });
  await page.mouse.dblclick(spot.x, spot.y);
  await expect.poll(async () => (await count()).length).toBe(1);
  await page.waitForTimeout(500);
  expect(await count()).toEqual([expect.objectContaining({ y: 17, z: 0 })]);
  // Arruma: sai do "colocar" e desfaz.
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await count()).length).toBe(0);
  await page.getByRole('button', { name: 'Concluir', exact: true }).click();
});

test('Decorar no celular: tocar posiciona o fantasma e "Colocar aqui" confirma', async ({
  browser,
}) => {
  const { page } = await newPerson(browser, 'Ana', {
    context: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  });
  const chairs = () =>
    page.evaluate(() => window.__e2e!.furniList().filter((f) => f.defId === 'chair_norja').length);
  await page.getByRole('button', { name: 'Mais', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Decorar' }).click();
  await page.getByLabel('Buscar móvel').fill('Cadeira Norja');
  await page.getByRole('button', { name: 'Cadeira Norja', exact: true }).click();
  const before = await chairs();

  // O painel cobre a metade de baixo: o tile fica no meio da parte de cima da tela.
  await page.evaluate(() => {
    window.__e2e!.look(16, 13, 1);
  });
  const spot = await tile(page, 16, 13);
  await page.touchscreen.tap(spot.x, spot.y);
  // Tocar só posiciona (antes colocava às cegas, sem mostrar onde).
  await expect.poll(() => ghost(page)).toMatchObject({ x: 16, y: 13, ok: true });
  expect(await chairs()).toBe(before);
  await page.getByRole('button', { name: 'Colocar aqui' }).click();
  await expect.poll(chairs).toBe(before + 1);
  // Arruma: Desfazer pelo botão do painel.
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await page.locator('.decor-panel').getByRole('button', { name: 'Desfazer' }).click();
  await expect.poll(chairs).toBe(before);
});

test('Decorar: o fantasma fica vermelho quando alguém entra no lugar, sem mexer o mouse', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  await ana.page.getByRole('button', { name: 'Decorar' }).click();
  await ana.page.getByLabel('Buscar móvel').fill('Cadeira Norja');
  await ana.page.getByRole('button', { name: 'Cadeira Norja', exact: true }).click();
  await ana.page.evaluate(() => window.__e2e!.look(15, 12, 1));
  const spot = await tile(ana.page, 15, 12);
  await ana.page.mouse.move(spot.x, spot.y);
  expect(await ghost(ana.page)).toMatchObject({ x: 15, y: 12, ok: true });
  // O Beto anda até lá: o fantasma da Ana avisa sozinho (antes ficava verde até mexer o mouse).
  await beto.page.evaluate(() => window.__e2e!.look(15, 12, 1));
  const there = await tile(beto.page, 15, 12);
  await beto.page.mouse.click(there.x, there.y);
  await expect.poll(() => ghost(ana.page), { timeout: 15_000 }).toMatchObject({ ok: false });
  await ana.page.keyboard.press('Escape');
});
