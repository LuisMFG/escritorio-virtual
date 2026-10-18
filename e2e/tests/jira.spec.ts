import { expect, test } from '@playwright/test';
import { clickFurni, newPerson, positionOf, waitRoom } from '../helpers.js';

test('jira: conectar no Perfil, demanda no cartão e Quadro de Demandas', async ({ browser }) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');

  // Ana conecta: token errado é recusado; o certo conecta.
  await ana.page.getByRole('button', { name: 'Perfil' }).click();
  const jira = ana.page.locator('.profile-jira');
  await jira.getByLabel('E-mail do Jira').fill('ana@empresa.com');
  await jira.getByLabel('Token de API do Jira').fill('token-errado-0000');
  await jira.getByRole('button', { name: 'Conectar Jira' }).click();
  await expect(jira).toContainText('recusado');
  await jira.getByLabel('Token de API do Jira').fill('token-e2e-valido-123');
  await jira.getByRole('button', { name: 'Conectar Jira' }).click();
  await expect(jira).toContainText('Conectado como ana (Jira)');
  await ana.page.keyboard.press('Escape');

  // Beto clica na Ana e vê a demanda em andamento, com link para o Jira.
  await expect.poll(() => positionOf(beto.page, ana.name)).not.toBeNull();
  const openCard = async () => {
    const pos = await positionOf(beto.page, ana.name);
    const p = await beto.page.evaluate(([x, y]) => window.__e2e!.tile(x!, y!), [pos!.x, pos!.y]);
    await beto.page.mouse.click(p.x, p.y - 15);
  };
  await openCard();
  const line = beto.page.locator('.card-activity', { hasText: '📋' });
  await expect(line).toHaveText('📋 E2E-1 · Ajustar relatório de vendas');
  await expect(line.locator('a')).toHaveAttribute('href', 'http://127.0.0.1:2601/browse/E2E-1');

  // Privacidade: só o código.
  await ana.page.getByRole('button', { name: 'Perfil' }).click();
  await ana.page.locator('.profile-jira select').selectOption('key');
  // A lista de pessoas atualiza ao vivo; o cartão é reaberto.
  await expect(beto.page.locator('.people-body')).not.toContainText('Ajustar relatório');
  await beto.page.keyboard.press('Escape');
  await openCard();
  await expect(line).toHaveText('📋 E2E-1');

  // Quadro de Demandas na Sala de reunião.
  await beto.page.keyboard.press('Escape');
  // (Pelo mapa: com a suíte inteira a Recepção fica cheia de avatares na frente da porta.)
  await beto.page.getByRole('button', { name: 'Mapa' }).click();
  await beto.page.getByRole('button', { name: 'Ir para Sala de reunião' }).click();
  await waitRoom(beto.page, 'meeting');
  await clickFurni(beto.page, 'm-jira');
  const board = beto.page.locator('.jira-board');
  await expect(board.getByRole('region', { name: 'Em andamento' })).toContainText('E2E-1');
  await expect(board.getByRole('region', { name: 'Em andamento' })).toContainText(ana.name);
  await expect(board.getByRole('region', { name: 'A fazer' })).toContainText(
    'Revisar acessos da VPN',
  );
  await expect(board).toContainText('1 pessoa conectada');
});
