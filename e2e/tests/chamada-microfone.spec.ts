import type { Page } from '@playwright/test';
import { clickTile, expect, newPerson, openCard, test } from '../helpers.js';

/**
 * Microfone demorando para abrir (a pessoa ainda clicando em "Permitir"): a oferta da conexão
 * chega antes e a resposta precisa esperar o microfone, senão essa pessoa fica muda para o outro.
 * O teste segura o microfone de cada um e solta em ordens diferentes (uma delas é a que quebrava).
 */
async function holdMic(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __pcs: RTCPeerConnection[];
      __releaseMic: () => void;
      RTCPeerConnection: typeof RTCPeerConnection;
    };
    const Orig = RTCPeerConnection;
    w.__pcs = [];
    w.RTCPeerConnection = function (cfg?: RTCConfiguration) {
      const pc = new Orig(cfg);
      w.__pcs.push(pc);
      return pc;
    } as unknown as typeof RTCPeerConnection;
    const md = navigator.mediaDevices;
    const gum = md.getUserMedia.bind(md);
    md.getUserMedia = (c) =>
      new Promise((resolve, reject) => {
        w.__releaseMic = () => gum(c).then(resolve, reject);
      });
  });
}

/** Bytes de áudio enviados e recebidos na conexão mais recente. */
const audioBytes = (page: Page) =>
  page.evaluate(async () => {
    const pcs = (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs;
    const pc = pcs[pcs.length - 1];
    let sent = 0;
    let received = 0;
    (await pc?.getStats())?.forEach(
      (r: { type: string; kind?: string; bytesSent?: number; bytesReceived?: number }) => {
        if (r.kind !== 'audio') return;
        if (r.type === 'outbound-rtp') sent = r.bytesSent ?? 0;
        if (r.type === 'inbound-rtp') received = r.bytesReceived ?? 0;
      },
    );
    return { sent, received };
  });

test('chamada: quem demora a liberar o microfone também é ouvido', async ({ browser }) => {
  test.setTimeout(120_000);
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  await holdMic(ana.page);
  await holdMic(beto.page);
  await clickTile(beto.page, 6, 17);
  await beto.page.waitForTimeout(5000);

  for (const [first, second] of [
    [ana, beto],
    [beto, ana],
  ] as const) {
    await openCard(ana.page, beto.name);
    await ana.page.getByRole('button', { name: 'Chamar para conversa' }).click();
    await ana.page.getByRole('dialog').getByRole('button', { name: 'Chamar' }).click();
    await beto.page.locator('.call-card').getByRole('button', { name: 'Aceitar' }).click();
    await expect(ana.page.locator('.call-members li')).toHaveCount(2);

    await first.page.waitForTimeout(500);
    await first.page.evaluate(() =>
      (window as unknown as { __releaseMic: () => void }).__releaseMic(),
    );
    await first.page.waitForTimeout(2500);
    await second.page.evaluate(() =>
      (window as unknown as { __releaseMic: () => void }).__releaseMic(),
    );

    for (const p of [ana.page, beto.page]) {
      await expect
        .poll(async () => Math.min(...Object.values(await audioBytes(p))), { timeout: 20_000 })
        .toBeGreaterThan(2000);
    }
    await ana.page.getByRole('button', { name: /Sair/ }).click();
    await expect(beto.page.locator('.call-panel')).toBeHidden();
  }
});
