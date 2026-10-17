import { expect, test } from '@playwright/test';
import { newPerson, openChatHistory, sendChat } from '../helpers.js';

test('enquete: criar por comando, votar, trocar o voto, encerrar; anônima pelo menu', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const q = `Almoço ${Date.now().toString(36)}?`;

  await sendChat(ana.page, `/enquete ${q} | Restaurante | Marmita | Delivery`);
  // O histórico do chat abre para ver o cartão.
  await openChatHistory(beto.page);
  const card = beto.page.locator('.poll-card', { hasText: q });
  await expect(card).toBeVisible();

  await card.getByRole('button', { name: /^Marmita/ }).click();
  const anaCard = ana.page.locator('.poll-card', { hasText: q });
  await expect(anaCard).toContainText('1 voto(s)');
  await expect(anaCard.locator('.poll-option', { hasText: 'Marmita' })).toHaveAttribute(
    'title',
    beto.name,
  );

  // Troca o voto: continua 1 voto, agora em Delivery.
  await card.getByRole('button', { name: /^Marmita/ }).waitFor();
  await card.getByRole('button', { name: /^Delivery/ }).click();
  await expect(card.locator('.poll-option.mine')).toContainText('Delivery');
  await expect(anaCard.locator('.poll-option', { hasText: 'Delivery' })).toContainText('1 · 100%');

  // Só a Ana (quem criou) tem "Encerrar"; depois disso ninguém vota.
  await expect(card.getByRole('button', { name: 'Encerrar' })).toHaveCount(0);
  await openChatHistory(ana.page);
  await anaCard.getByRole('button', { name: 'Encerrar' }).click();
  await expect(card).toContainText('encerrada');
  await expect(card.getByRole('button', { name: /^Restaurante/ })).toBeDisabled();

  // Beto cria uma anônima pelo menu 😊 → 📊 Enquete.
  await beto.page.getByRole('button', { name: 'Emotes' }).click();
  await beto.page.getByRole('menuitem', { name: /Enquete/ }).click();
  await beto.page.locator('.poll-form input[name=question]').fill('Nota da sprint?');
  await beto.page.getByLabel('Opção 1').fill('Boa');
  await beto.page.getByLabel('Opção 2').fill('Ruim');
  await beto.page.getByText('Anônima', { exact: false }).click();
  await beto.page.getByRole('button', { name: 'Criar enquete' }).click();
  const anon = ana.page.locator('.poll-card', { hasText: 'Nota da sprint?' });
  await expect(anon).toContainText('anônima');
  await anon.getByRole('button', { name: /^Boa/ }).click();
  await expect(anon.locator('.poll-option', { hasText: 'Boa' })).not.toHaveAttribute('title', /./);
});
