import { clickFurni, expect, newPerson, sendChat, test } from '../helpers.js';

test('primeira entrada: tour guiado até sentar na mesa e falar; ajuda com ?', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana', { tour: true });
  const page = ana.page;
  const card = page.locator('.tour-card');
  await expect(card).toContainText(`Bem-vindo ao escritório, ${ana.name}!`);
  await card.getByRole('button', { name: 'Começar' }).click();

  // Andar: conclui sozinho ao andar.
  await expect(card).toContainText('Andar');
  await clickFurni(page, 'r-fila-4-cadeira');
  // A cadeira leva a andar e sentar: as etapas "Andar" e depois "Sua mesa".
  await expect(card).toContainText('Sua mesa', { timeout: 15_000 });
  await page.locator('.desk-chip').getByRole('button', { name: 'Ficar com esta mesa' }).click({
    timeout: 15_000,
  });
  await expect(card).toContainText('Conversar');
  await sendChat(page, 'oi, cheguei!');
  await expect(card).toContainText('Emotes');
  await card.getByRole('button', { name: 'Pular etapa' }).click();
  await expect(card).toContainText('Decorar');
  await card.getByRole('button', { name: 'Próximo' }).click();
  await card.getByRole('button', { name: 'Concluir' }).click();
  await expect(card).toBeHidden();
  // Larga a mesa (as estações são poucas para os outros testes).
  await page.locator('.desk-chip').getByRole('button', { name: 'Deixar mesa' }).click();

  // Ajuda: tecla ? (fora do chat) e "Refazer o tour".
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Ajuda' });
  await expect(help).toContainText('/dado');
  await help.getByRole('tab', { name: 'Atalhos' }).click();
  await expect(help).toContainText('Mostra o nome de todo mundo');
  await help.getByRole('button', { name: 'Refazer o tour guiado' }).click();
  await expect(card).toContainText('Bem-vindo');
  await card.getByRole('button', { name: 'Pular tour' }).click();
  await expect(card).toBeHidden();
});
