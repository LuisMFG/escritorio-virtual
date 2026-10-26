import { expect, newPerson, sendChat, test } from '../helpers.js';

/** Guarda os WebSockets abertos pela página (para derrubar a conexão da sala no teste). */
const SPY = `(() => {
  const Native = window.WebSocket;
  window.__sockets = [];
  window.WebSocket = class extends Native {
    constructor(...args) {
      super(...args);
      window.__sockets.push(this);
    }
  };
})();`;

test('queda curta: a conexão volta sozinha e o chat que passou no meio aparece', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana', { initScript: SPY });
  const beto = await newPerson(browser, 'Beto');
  await sendChat(beto.page, 'antes da queda');
  await expect(ana.page.locator('.chat-history')).toContainText('antes da queda');

  // Derruba só a conexão da sala (a primeira aberta; depois vem a do canal global), como uma
  // rede oscilando.
  const dropped = await ana.page.evaluate(() => {
    const ws = (window as unknown as { __sockets: WebSocket[] }).__sockets[0];
    ws?.close(3001, 'queda de teste');
    return ws?.url ?? '';
  });
  expect(dropped).not.toBe('');
  await sendChat(beto.page, 'durante a queda');
  // Voltou na mesma sessão: o que o Beto disse no meio aparece para a Ana.
  await expect(ana.page.locator('.chat-history')).toContainText('durante a queda', {
    timeout: 15_000,
  });
  // Foi uma queda de verdade: a página abriu outra conexão para a mesma sala.
  const reopened = await ana.page.evaluate(
    (url) =>
      (window as unknown as { __sockets: WebSocket[] }).__sockets.filter(
        (s) =>
          s.url !== url && s.url.split('/')[4]?.split('?')[0] === url.split('/')[4]?.split('?')[0],
      ).length,
    dropped,
  );
  expect(reopened).toBe(1);
  await sendChat(beto.page, 'depois da queda');
  await expect(ana.page.locator('.chat-history')).toContainText('depois da queda');
});
