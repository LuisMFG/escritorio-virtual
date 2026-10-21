import { expect, newPerson, test } from '../helpers.js';

test('catálogo completo: buscar "terno", vestir, guardar look e o outro vê', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const page = ana.page;
  await page.getByRole('button', { name: 'Perfil' }).click();
  await page.getByRole('button', { name: 'Meu visual' }).click();
  const editor = page.locator('.editor');
  await editor.getByRole('tab', { name: 'Blusa' }).click();
  await editor.getByLabel('Buscar peças').fill('terno');
  await expect(editor.locator('.editor-count')).toHaveText(/^[1-9]\d* peças?$/);
  const item = editor.locator('.editor-sets .set-item[title*="suit"]').first();
  const id = /#(\d+)/.exec((await item.getAttribute('title')) ?? '')![1]!;
  await item.click();
  await expect(item).toHaveAttribute('aria-selected', 'true');

  // Guarda no look 1 (clicando no espaço vazio) e salva o visual: o Beto vê a peça nova.
  await editor.getByRole('button', { name: 'Guardar o visual atual no look 1' }).click();
  await expect(editor.getByRole('button', { name: 'Usar look 1' })).toBeEnabled();
  await expect(editor.locator('.look-status')).toHaveText('Look 1 guardado ✓');
  // Desfazer volta a peça anterior (e refaz escolhendo de novo).
  await editor.getByRole('button', { name: 'Desfazer' }).click();
  await expect(item).toHaveAttribute('aria-selected', 'false');
  await item.click();
  await editor.getByRole('button', { name: 'Salvar visual' }).click();
  await expect
    .poll(() =>
      beto.page.evaluate(
        () => window.__e2e!.players().find((p) => p.name.startsWith('Ana'))?.figure,
      ),
    )
    .toContain(`ch-${id}`);

  // O look continua lá ao reabrir o editor (e só abre um editor).
  await page.getByRole('button', { name: 'Perfil' }).click();
  await page.getByRole('button', { name: 'Meu visual' }).click();
  await expect(page.locator('.editor').getByRole('button', { name: 'Usar look 1' })).toBeEnabled();
  await expect(page.locator('.editor')).toHaveCount(1);
});

test('fantasia: veste a armadura de Pégaso sem mudar rosto e cabelo', async ({ browser }) => {
  const ana = await newPerson(browser, 'Ana');
  const page = ana.page;
  const mine = () =>
    page.evaluate(() => {
      const h = window.__e2e!;
      return h.players().find((p) => p.id === h.mySessionId())!.figure;
    });
  const before = await mine();
  const keep = before.split('.').filter((p) => /^(hd|hr)-/.test(p));

  await page.getByRole('button', { name: 'Perfil' }).click();
  await page.getByRole('button', { name: 'Meu visual' }).click();
  const editor = page.locator('.editor');
  await editor.getByRole('tab', { name: 'Fantasias' }).click();
  // A busca filtra as fantasias pelo nome ou pela franquia.
  await editor.getByLabel('Buscar peças').fill('pokemon');
  await expect(editor.locator('.editor-count')).toHaveText('4 fantasias');
  await expect(editor.getByRole('option', { name: 'Pokémon: Gengar' })).toBeVisible();
  await editor.getByLabel('Buscar peças').fill('');
  const classic = editor.getByRole('option', { name: 'Cavaleiros do Zodíaco: Seiya', exact: true });
  await classic.click();
  await expect(classic).toHaveAttribute('aria-selected', 'true');
  await editor.getByRole('button', { name: 'Salvar visual' }).click();

  await expect.poll(mine).toContain('he-4022');
  const after = (await mine()).split('.');
  expect(after).toEqual(expect.arrayContaining([...keep, 'cc-3609-92-96', 'lg-3607-92-96']));
});

test('meu visual em tela baixa: tudo à vista, peças e prévia com rolagem própria', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const page = ana.page;
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.getByRole('button', { name: 'Perfil' }).click();
  await page.getByRole('button', { name: 'Meu visual' }).click();
  const editor = page.locator('.editor');
  await editor.getByRole('tab', { name: 'Blusa' }).click();
  // O editor cabe na tela e os botões de baixo aparecem.
  const box = (await editor.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(600);
  await expect(editor.getByRole('button', { name: 'Salvar visual' })).toBeInViewport();
  // A lista de peças rola sozinha (a roda do mouse em cima dela).
  const sets = editor.locator('.editor-sets');
  const scroll = () => sets.evaluate((el) => el.scrollTop);
  expect(await sets.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await sets.hover();
  await page.mouse.wheel(0, 400);
  await expect.poll(scroll).toBeGreaterThan(0);
  // A coluna da prévia (com os looks) também rola, em vez de cortar.
  const preview = editor.locator('.editor-preview');
  expect(await preview.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
});
