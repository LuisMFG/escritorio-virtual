import { expect, newPerson, test } from '../helpers.js';

test('agenda: marcar reunião com convidado; o convidado vê na agenda', async ({ browser }) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const title = `Daily ${Date.now().toString(36)}`;

  await ana.page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await ana.page.locator('.agenda-new').click();
  await ana.page.locator('input[name=title]').fill(title);
  await ana.page.getByLabel('Buscar convidado').fill(beto.name);
  await ana.page.locator('.agenda-invitees label', { hasText: beto.name }).click();
  await ana.page.getByRole('button', { name: 'Marcar reunião' }).click();
  await expect(ana.page.locator('.agenda-item', { hasText: title })).toBeVisible();

  // Beto recebe o convite e vê a reunião (aguardando resposta) na agenda dele.
  await beto.page.getByRole('button', { name: 'Agenda', exact: true }).click();
  const item = beto.page.locator('.agenda-item', { hasText: title });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: /Vou/ }).click();
});
