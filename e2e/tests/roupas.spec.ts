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

  // Guarda no look 1 e salva o visual: o Beto vê a peça nova.
  await editor.getByRole('button', { name: 'Guardar no look 1' }).click();
  await expect(editor.getByRole('button', { name: 'Usar look 1' })).toBeEnabled();
  await editor.getByRole('button', { name: 'Salvar visual' }).click();
  await expect
    .poll(() =>
      beto.page.evaluate(
        () => window.__e2e!.players().find((p) => p.name.startsWith('Ana'))?.figure,
      ),
    )
    .toContain(`ch-${id}`);

  // O look continua lá ao reabrir o editor.
  await page.getByRole('button', { name: 'Perfil' }).click();
  await page.getByRole('button', { name: 'Meu visual' }).click();
  await expect(page.locator('.editor').getByRole('button', { name: 'Usar look 1' })).toBeEnabled();
});
