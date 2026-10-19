import { clickFurni, clickTile, expect, newPerson, test } from '../helpers.js';

test('catálogo completo: busca, quadro na parede, cores e categorias escondidas', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const page = ana.page;
  const betoSees = (defPrefix: string) =>
    beto.page.evaluate(
      (prefix) => window.__e2e!.furniList().find((f) => f.defId.startsWith(prefix)) ?? null,
      defPrefix,
    );

  await page.getByRole('button', { name: 'Decorar' }).click();
  const search = page.getByRole('searchbox', { name: 'Buscar móvel' });

  // Jogos começam escondidos: a busca não acha.
  await search.fill('Armadilha de Folhas');
  await expect(page.locator('.decor-grid')).toContainText('Nada encontrado');

  // Quadro na parede: escolhe, aponta a parede do fundo e clica.
  await search.fill('familia da recepcao');
  await page.getByRole('button', { name: /A Família da Recepção/ }).click();
  await expect(page.locator('.decor-status')).toContainText('Colocando: A Família da Recepção');
  const wall = await page.evaluate(() => window.__e2e!.wall(5, 1, 2, 1.5));
  await page.mouse.move(wall.x, wall.y);
  await page.mouse.click(wall.x, wall.y);
  await expect.poll(() => betoSees('diamond_painting64')).toMatchObject({ x: 5, y: 1 });
  const painting = (await betoSees('diamond_painting64'))!;
  expect(await beto.page.evaluate((id) => window.__e2e!.furniZ(id), painting.id)).toBe(1.5);
  // O Beto nunca viu esse móvel: buscou a definição e desenhou.
  await expect
    .poll(() => beto.page.evaluate((id) => window.__e2e!.furni(id) !== null, painting.id))
    .toBe(true);
  await page.keyboard.press('Escape');

  // Móvel com cores: coloca, seleciona e troca a cor no lugar.
  await search.fill('circular pura escuro');
  await page.getByRole('button', { name: /Circular Pura Escuro/ }).click();
  await expect(page.locator('.decor-status')).toContainText('Colocando');
  await clickTile(page, 10, 8);
  await expect.poll(() => betoSees('purablk_c16_round')).toMatchObject({ x: 10, y: 8 });
  await page.keyboard.press('Escape');
  const chair = (await betoSees('purablk_c16_round'))!;
  await clickFurni(page, chair.id);
  const swatches = page.getByRole('group', { name: 'Cores' }).getByRole('button');
  await expect(swatches).toHaveCount(10);
  await swatches.nth(2).click();
  await expect
    .poll(async () => (await betoSees('purablk_c16_round'))?.defId)
    .toBe('purablk_c16_round*3');
  await expect(swatches.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Concluir', exact: true }).click();
});
