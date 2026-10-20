import { clickFurni, expect, goThroughDoor, newPerson, test, waitRoom } from '../helpers.js';

const me = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const hook = window.__e2e!;
    const p = hook.players().find((x) => x.id === hook.mySessionId())!;
    return { x: p.x, y: p.y, action: p.action };
  });

test('minha mesa: escolher a estação, voltar de outra sala direto para ela e achar pela lista', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const page = ana.page;
  const chip = page.locator('.desk-chip');

  // Senta numa estação livre e fica com ela.
  await expect(page.getByRole('button', { name: 'Minha mesa' })).toBeHidden();
  await clickFurni(page, 'r-fila-3-cadeira');
  await expect.poll(() => me(page), { timeout: 15_000 }).toMatchObject({ action: 'sit', x: 8 });
  await expect(chip).toContainText('Mesa livre');
  await chip.getByRole('button', { name: 'Ficar com esta mesa' }).click();
  await expect(chip).toContainText('Sua mesa');
  await expect(page.getByRole('button', { name: 'Minha mesa' })).toBeVisible();

  // O Beto, sentado na mesma cadeira depois, vê de quem é.
  await goThroughDoor(page, [21, 0], 'pantry');
  await clickFurni(beto.page, 'r-fila-3-cadeira');
  await expect(beto.page.locator('.desk-chip')).toContainText(`Mesa de ${ana.name}`, {
    timeout: 15_000,
  });
  await beto.page.locator('.people').evaluate((d) => ((d as HTMLDetailsElement).open = true));
  await beto.page.getByRole('button', { name: `Ir até ${ana.name} (Copa)` }).isVisible();
  await clickFurni(beto.page, 'r-sofa');
  await expect.poll(() => me(beto.page), { timeout: 20_000 }).not.toMatchObject({ x: 8, y: 3 });

  // Da Copa, "Minha mesa" volta para a Recepção e senta na estação.
  await page.getByRole('button', { name: 'Minha mesa' }).click();
  await waitRoom(page, 'reception');
  await expect
    .poll(() => me(page), { timeout: 20_000 })
    .toMatchObject({ action: 'sit', x: 8, y: 3 });

  // Beto acha a Ana pela lista (câmera vai até ela).
  await beto.page.getByRole('button', { name: `Achar ${ana.name} na sala` }).click();

  // Ao recarregar, convite para ir à mesa; depois larga a mesa.
  await page.reload();
  await waitRoom(page, 'reception');
  await expect(chip).toContainText('Sua mesa está esperando');
  await chip.getByRole('button', { name: 'Ir para minha mesa' }).click();
  await expect(chip).toContainText('Sua mesa', { timeout: 20_000 });
  await chip.getByRole('button', { name: 'Deixar mesa' }).click();
  await expect(chip).toContainText('Mesa livre');
  await expect(page.getByRole('button', { name: 'Minha mesa' })).toBeHidden();
});
