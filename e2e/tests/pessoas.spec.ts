import { expect, goThroughDoor, newPerson, sendChat, test } from '../helpers.js';

test('pessoas online: chamar para conversa quem está em outra sala, pelo menu da lista', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  await goThroughDoor(beto.page, [21, 0], 'pantry');

  // Na lista da Ana, o Beto aparece na Copa; clicar abre o menu dele.
  const people = ana.page.locator('.people');
  await people.evaluate((d) => ((d as HTMLDetailsElement).open = true));
  await people.getByRole('button', { name: `Opções para ${beto.name} (Copa)` }).click();
  const menu = ana.page.getByRole('menu', { name: beto.name });
  await expect(menu.getByRole('menuitem')).toHaveText([
    '📞 Chamar para conversa',
    '✉️ Mensagem',
    /Ir até lá \(Copa/,
    '🙌 Elogiar',
  ]);
  await ana.page.screenshot({ path: test.info().outputPath('menu-da-pessoa.png') });
  await menu.getByRole('menuitem', { name: /Chamar para conversa/ }).click();
  await ana.page.getByRole('dialog').getByRole('button', { name: 'Chamar' }).click();

  // O Beto, em outra sala, recebe o convite.
  await expect(beto.page.locator('.call-card')).toContainText(ana.name);

  // Esc fecha o menu sem fazer nada.
  await people.getByRole('button', { name: `Opções para ${beto.name} (Copa)` }).click();
  await expect(menu).toBeVisible();
  await ana.page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('status na barra (os outros veem) e aviso de menção com "Responder"', async ({ browser }) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');

  // A Ana fica ocupada pelo botão da barra; o Beto vê na lista.
  await ana.page.getByRole('button', { name: 'Seu status: Disponível' }).click();
  await ana.page.screenshot({ path: test.info().outputPath('status-na-barra.png') });
  await ana.page.getByRole('menuitemradio', { name: 'Ocupado' }).click();
  await expect(ana.page.getByRole('button', { name: 'Seu status: Ocupado' })).toBeVisible();
  await beto.page.locator('.people').evaluate((d) => ((d as HTMLDetailsElement).open = true));
  await expect(beto.page.locator('.people-list li', { hasText: ana.name })).toHaveAttribute(
    'data-status',
    'busy',
  );

  // O Beto menciona a Ana: o aviso dela tem "Responder", que abre a resposta no chat.
  await sendChat(beto.page, `@${ana.name} pode olhar o PR?`);
  const toast = ana.page.locator('.toast-item', { hasText: `${beto.name} mencionou você` });
  await toast.getByRole('button', { name: 'Responder' }).click();
  await expect(ana.page.locator('.reply-bar')).toContainText(beto.name);
  await expect(ana.page.getByPlaceholder(/Diga algo/)).toBeFocused();
});

test('mensagens: a busca da "Nova conversa" não se apaga quando alguém entra', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  await ana.page.getByRole('button', { name: 'Mensagens', exact: true }).click();
  await ana.page.getByRole('button', { name: 'Nova conversa' }).click();
  const search = ana.page.getByRole('searchbox', { name: 'Buscar pessoa', exact: true });
  await search.fill(beto.name.slice(0, 4));
  await expect(ana.page.locator('.dm-list .dm-conv-name')).toHaveText([beto.name]);

  // Alguém entra no escritório (a lista de quem está online muda): a busca continua.
  await newPerson(browser, 'Caio');
  await ana.page.waitForTimeout(1000);
  await expect(search).toHaveValue(beto.name.slice(0, 4));
  await expect(search).toBeFocused();
  await expect(ana.page.locator('.dm-list .dm-conv-name')).toHaveText([beto.name]);
});
