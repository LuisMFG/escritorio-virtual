import { expect, test } from '@playwright/test';
import { clickFurni, newPerson } from '../helpers.js';

test('elogios: elogiar pela Equipe, aviso para quem recebeu, mural no quadro', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const msg = `Resolveu o problema do servidor ${Date.now().toString(36)}`;

  await ana.page.getByRole('button', { name: 'Equipe' }).click();
  await ana.page.getByRole('button', { name: `Elogiar ${beto.name}` }).click();
  await ana.page.getByRole('radio', { name: /Ajudou muito/ }).click();
  await ana.page.getByLabel('Mensagem do elogio').fill(msg);
  await ana.page.getByRole('button', { name: 'Enviar elogio' }).click();
  await expect(ana.page.locator('body')).toContainText(`Elogio enviado para ${beto.name}`);

  // Beto recebe o aviso na hora.
  await expect(beto.page.locator('body')).toContainText(`${ana.name} te elogiou`);

  // O Quadro de Elogios da Recepção abre o mural.
  await clickFurni(beto.page, 'r-kudos');
  const wall = beto.page.locator('.kudos-wall');
  await expect(wall).toBeVisible();
  await wall.getByRole('tab', { name: 'Recebidos por mim' }).click();
  const item = wall.locator('.kudos-item', { hasText: msg });
  await expect(item).toContainText(beto.name);
  await expect(item).toContainText(`de ${ana.name}`);
  await expect(item).toContainText('Ajudou muito');

  // Não dá para se elogiar: o próprio nome não está na lista do mural.
  await expect(wall.locator('.kudos-picker option', { hasText: beto.name })).toHaveCount(0);
});
