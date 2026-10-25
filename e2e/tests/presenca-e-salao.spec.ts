import type { Page } from '@playwright/test';
import {
  APP,
  clickFurni,
  clickTile,
  expect,
  goThroughDoor,
  newPerson,
  openCard,
  PASSWORD,
  sendChat,
  test,
  waitRoom,
} from '../helpers.js';

async function walk(page: Page, x: number, y: number) {
  await clickTile(page, x, y);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const h = window.__e2e!;
          const me = h.players().find((p) => p.id === h.mySessionId())!;
          return [me.x, me.y];
        }),
      { timeout: 25_000 },
    )
    .toEqual([x, y]);
}

/** Avatares de uma pessoa na sala (pelo nome). */
const copies = (page: Page, name: string) =>
  page.evaluate((n) => window.__e2e!.players().filter((p) => p.name === n).length, name);

test('uma aba por pessoa: entrar de novo em outro lugar tira a aba anterior, e "Usar aqui" volta', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  await expect.poll(() => copies(beto.page, ana.name)).toBe(1);

  // A Ana entra pela mesma conta noutro navegador (o celular, por exemplo).
  const other = await browser.newContext();
  const phone = await other.newPage();
  await phone.goto(APP);
  await phone.getByRole('tab', { name: 'Entrar' }).click();
  await phone.locator('input[name=username]').fill(ana.username);
  await phone.locator('input[name=password]').fill(PASSWORD);
  await phone.locator('form.login-card button[type=submit]').click();
  await waitRoom(phone, 'reception');

  // A aba antiga sai, com o aviso; na sala, a Ana aparece uma vez só.
  const notice = ana.page.getByRole('alertdialog');
  await expect(notice).toContainText('Você abriu o escritório em outra aba ou aparelho.');
  await expect.poll(() => copies(beto.page, ana.name), { timeout: 15_000 }).toBe(1);
  await ana.page.screenshot({ path: 'e2e-results/shot-aba-substituida.png' });
  // E não volta sozinha depois (a nova continua).
  await ana.page.waitForTimeout(3000);
  await expect(phone.getByRole('alertdialog')).toHaveCount(0);

  // "Usar aqui": a aba antiga volta e a do celular é que sai.
  await notice.getByRole('button', { name: 'Usar aqui' }).click();
  await waitRoom(ana.page, 'reception');
  await expect(phone.getByRole('alertdialog')).toContainText('outra aba ou aparelho');
  await expect.poll(() => copies(beto.page, ana.name), { timeout: 15_000 }).toBe(1);
  await other.close();
});

test('chamada: quem recarrega a página volta sozinho para a chamada', async ({ browser }) => {
  test.setTimeout(120_000);
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  await walk(beto.page, 6, 17);
  await openCard(ana.page, beto.name);
  await ana.page.getByRole('button', { name: 'Chamar para conversa' }).click();
  await ana.page.getByRole('dialog').getByRole('button', { name: 'Chamar' }).click();
  await beto.page.locator('.call-card').getByRole('button', { name: 'Aceitar' }).click();
  await expect(ana.page.locator('.call-tile')).toHaveCount(2);

  // Internet fraca por alguns segundos: aviso só para quem está com ela fraca, com "Usar Economia".
  // (As medições de verdade continuam chegando: a simulação repete a qualidade até mandar parar.)
  const setMyLink = (page: Page, q: string | null) =>
    page.evaluate((link) => {
      const h = window.__e2e!;
      const me = h.players().find((p) => p.id === h.mySessionId())!;
      const w = window as unknown as {
        __e2eCallPanel: { setLinks(m: Map<string, string>): void };
        __fakeLink?: number;
      };
      window.clearInterval(w.__fakeLink);
      if (!link) return;
      const send = () => w.__e2eCallPanel.setLinks(new Map([[me.userId, link]]));
      send();
      w.__fakeLink = window.setInterval(send, 300);
    }, q);
  const weak = beto.page.getByRole('status').filter({ hasText: 'Sua internet está fraca' });
  await setMyLink(beto.page, 'ruim');
  await expect(weak).toBeVisible({ timeout: 8000 });
  await expect(ana.page.getByText('Sua internet está fraca')).toBeHidden();
  await beto.page.screenshot({ path: 'e2e-results/shot-internet-fraca.png' });
  await weak.getByRole('button', { name: 'Usar Economia' }).click();
  await expect(weak).toBeHidden();
  expect(
    await beto.page.evaluate(
      () => JSON.parse(localStorage.getItem('ev-call-prefs') ?? '{}').quality,
    ),
  ).toBe('economia');
  await setMyLink(beto.page, null);

  // O Beto recarrega: para a Ana, ele fica "reconectando" em vez de sair da chamada.
  await beto.page.reload();
  await expect(ana.page.locator('.call-tile.away')).toContainText('reconectando');
  // A página nova volta para a chamada sozinha, com o aviso.
  await waitRoom(beto.page, 'reception');
  await expect(beto.page.getByText('Você voltou para a chamada.')).toBeVisible({ timeout: 20_000 });
  await expect(beto.page.locator('.call-tile')).toHaveCount(2);
  await expect(ana.page.locator('.call-tile.away')).toHaveCount(0, { timeout: 20_000 });
  await expect(ana.page.locator('.call-tile')).toHaveCount(2);

  // Sair de propósito continua saindo na hora.
  await beto.page.getByRole('button', { name: /Sair/ }).click();
  await expect(ana.page.locator('.call-panel')).toBeHidden();
});

test('olhar para quem fala: quem está perto vira a cabeça por alguns segundos', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  await walk(ana.page, 6, 17);
  await walk(beto.page, 9, 17);
  // A Ana fica virada para baixo (direção 4); o Beto está à direita dela (direção 2).
  const anaDir = () =>
    ana.page.evaluate(() => {
      const h = window.__e2e!;
      return h.avatarDir(h.mySessionId());
    });
  for (let i = 0; i < 8 && (await anaDir()) !== 4; i++) {
    await ana.page.locator('body').press('ArrowRight');
    await ana.page.waitForTimeout(250);
  }
  expect(await anaDir()).toBe(4);
  const anaLook = (page: Page) =>
    page.evaluate((n) => {
      const h = window.__e2e!;
      const me = h.players().find((p) => p.name === n)!;
      return h.avatarLook(me.id);
    }, ana.name);
  expect(await anaLook(beto.page)).toBe(0);

  // De perto, para a foto mostrar a cabeça.
  await beto.page.evaluate(() => window.__e2e!.look(7.5, 17, 3));
  await sendChat(beto.page, 'Bom dia, Ana!');
  // Para todo mundo na sala, a cabeça da Ana vira para o Beto (2 direções), sem mexer o corpo.
  await expect.poll(() => anaLook(beto.page)).toBe(-2);
  await expect.poll(() => anaLook(ana.page)).toBe(-2);
  expect(await anaDir()).toBe(4);
  await beto.page.screenshot({ path: 'e2e-results/shot-olhar-quem-fala.png' });
  // Depois de alguns segundos, volta a olhar para a frente.
  await expect.poll(() => anaLook(beto.page), { timeout: 6000 }).toBe(0);
});

test('Salão de Jogos: torcida de quem assiste e ranking com sequência de vitórias', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const carla = await newPerson(browser, 'Carla');
  const table = 's-pingpong-1';
  for (const p of [ana, beto, carla]) await goThroughDoor(p.page, [15, 0], 'games');

  await clickFurni(ana.page, table);
  const panelA = ana.page.locator('.arcade-panel');
  await panelA.getByRole('button', { name: 'Entrar na vaga 1 do lado a' }).click();
  await clickFurni(beto.page, table);
  const panelB = beto.page.locator('.arcade-panel');
  await panelB.getByRole('button', { name: 'Entrar na vaga 1 do lado b' }).click();
  // Quem joga não vê os botões da torcida.
  await expect(panelA.getByRole('group', { name: 'Torcida' })).toBeHidden();

  // Duas vitórias seguidas da Ana (o Beto desiste).
  for (let i = 0; i < 2; i++) {
    await panelA.getByRole('button', { name: 'Começar' }).click();
    await panelB.getByRole('button', { name: 'Desistir' }).click();
    await expect(panelA.getByText(`🏆 ${ana.name} venceu (desistência)`)).toBeVisible();
  }

  // A Carla assiste e torce: o emoji pula sobre a mesa no painel de quem joga também.
  await clickFurni(carla.page, table);
  const panelC = carla.page.locator('.arcade-panel');
  const cheers = panelC.getByRole('group', { name: 'Torcida' });
  await expect(cheers).toBeVisible();
  await cheers.getByRole('button', { name: 'Torcer: Aplausos' }).click();
  await expect(panelA.locator('.arcade-cheer-pop')).toHaveText('👏');
  await expect(panelC.locator('.arcade-cheer-pop')).toHaveText('👏');

  // Ranking do ping-pong: a Ana com 2 vitórias e 2 seguidas; a Carla ainda não jogou.
  await panelC.getByText('🏅 Ranking do ping-pong').click();
  const list = panelC.locator('.arcade-ranking-list');
  await expect(list.locator('li', { hasText: ana.name })).toContainText('2 V · 0 D · 🔥 2');
  await expect(panelC.locator('.arcade-ranking-me')).toHaveText('Você ainda não jogou aqui.');
  await cheers.getByRole('button', { name: 'Torcer: Uuh!' }).click();
  await carla.page.screenshot({ path: 'e2e-results/shot-salao-torcida-ranking.png' });
});
