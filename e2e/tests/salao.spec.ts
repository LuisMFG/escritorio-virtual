import { clickFurni, expect, goThroughDoor, newPerson, openChatHistory, test } from '../helpers.js';

test('Salão de Jogos: porta na Recepção, vagas na mesa e quem assiste vê o placar ao vivo', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const carla = await newPerson(browser, 'Carla');
  const table = 's-pingpong-1';
  const board = (page: typeof ana.page) =>
    page.evaluate((id) => window.__e2e!.arcadeBoard(id), table);

  // A porta nova da Recepção (parede do fundo, perto do café) leva ao Salão de Jogos.
  for (const p of [ana, beto, carla]) await goThroughDoor(p.page, [15, 0], 'games');

  // Ana abre a mesa: o painel mostra as vagas; ela entra no lado A e anda até a ponta da mesa.
  await clickFurni(ana.page, table);
  const panelA = ana.page.locator('.arcade-panel');
  await expect(panelA.getByRole('heading', { name: '🏓 Ping-pong' })).toBeVisible();
  await expect(panelA.getByText('Mesa livre. Escolha uma vaga para jogar.')).toBeVisible();
  await panelA.getByRole('button', { name: 'Entrar na vaga 1 do lado a' }).click();
  await expect(panelA.getByText(`${ana.name} (você)`)).toBeVisible();
  await expect
    .poll(() =>
      ana.page.evaluate(() => window.__e2e!.players().find((p) => p.name.startsWith('Ana'))),
    )
    .toMatchObject({ x: 3, y: 6, dir: 2 });

  // Beto entra no lado B e começa.
  await clickFurni(beto.page, table);
  const panelB = beto.page.locator('.arcade-panel');
  await panelB.getByRole('button', { name: 'Entrar na vaga 1 do lado b' }).click();
  await panelB.getByRole('button', { name: 'Começar' }).click();

  // Carla não joga: abre a mesa e assiste, com o placar no painel e sobre a mesa na sala.
  await clickFurni(carla.page, table);
  const panelC = carla.page.locator('.arcade-panel');
  await expect(panelC.getByText('👀 Você está assistindo.')).toBeVisible();
  await expect(panelC.locator('.arcade-points')).toHaveText('0 × 0');
  await expect(panelC.locator('.arcade-names.a')).toHaveText(ana.name);
  await expect(panelC.locator('.arcade-names.b')).toHaveText(beto.name);
  await expect.poll(() => board(carla.page)).toMatch(/^🏓 Ana .* 0 × 0 Beto/);
  await carla.page.screenshot({ path: 'e2e-results/shot-salao.png' });

  // Beto desiste: todo mundo vê o resultado, e o chat avisa.
  await panelB.getByRole('button', { name: 'Desistir' }).click();
  await expect(panelC.getByText(`🏆 ${ana.name} venceu (desistência)`)).toBeVisible();
  await expect.poll(() => board(carla.page)).toMatch(/^🏆 Ana .* venceu \(desistência\)$/);
  await openChatHistory(carla.page);
  await expect(
    carla.page.getByText(`🏆 venceu ${beto.name} no ping-pong (desistência)`).first(),
  ).toBeVisible();

  // Os dois saem da vaga: a mesa fica livre e o placar some.
  await panelA.getByRole('button', { name: 'Sair da vaga' }).click();
  await panelB.getByRole('button', { name: 'Sair da vaga' }).click();
  await expect.poll(() => board(carla.page)).toBeNull();
  await expect(panelC.getByText('Mesa livre. Escolha uma vaga para jogar.')).toBeVisible();
});
