import type { Page } from '@playwright/test';
import { clickTile, expect, newPerson, openCard, test } from '../helpers.js';

/** Quantas conexões de áudio desta aba já estão tocando (trilha de áudio viva). */
const liveAudio = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLAudioElement>('audio[data-call-peer]')].filter((a) =>
        (a.srcObject as MediaStream | null)?.getAudioTracks().some((t) => t.readyState === 'live'),
      ).length,
  );

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

test('chamada por convite: motivo, aceitar, áudio, terceiro entra, recusar e sair', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const caio = await newPerson(browser, 'Caio');
  // Cada um num canto, para clicar no avatar certo.
  await walk(beto.page, 6, 17);
  await walk(caio.page, 9, 17);

  // Ana chama o Beto pelo cartão, com o motivo.
  await openCard(ana.page, beto.name);
  await ana.page.getByRole('button', { name: 'Chamar para conversa' }).click();
  const dialog = ana.page.getByRole('dialog', { name: `Chamar ${beto.name} para conversa` });
  await dialog.getByLabel(/Motivo/).fill('Dúvida no deploy');
  await dialog.getByRole('button', { name: 'Chamar' }).click();

  const card = beto.page.locator('.call-card');
  await expect(card).toContainText(`${ana.name} está chamando você`);
  await expect(card).toContainText('“Dúvida no deploy”');
  await card.getByRole('button', { name: 'Aceitar' }).click();

  // Os dois no painel da chamada e o áudio conectado (WebRTC de verdade, microfone falso).
  // Cada um vê o outro pelo nome e a si mesmo como "Você".
  await expect(ana.page.locator('.call-panel')).toContainText(beto.name);
  await expect(beto.page.locator('.call-panel')).toContainText(ana.name);
  for (const p of [ana.page, beto.page]) {
    await expect(p.locator('.call-tile.mine')).toContainText('Você');
  }
  await expect(ana.page.locator('.toasts')).toContainText(`${beto.name} entrou na chamada.`);
  await expect.poll(() => liveAudio(ana.page), { timeout: 20_000 }).toBe(1);
  await expect.poll(() => liveAudio(beto.page), { timeout: 20_000 }).toBe(1);

  // Em grupo: Ana adiciona o Caio; ele vê quem está na conversa.
  await openCard(ana.page, caio.name);
  await ana.page.getByRole('button', { name: 'Adicionar à chamada' }).click();
  await ana.page.getByRole('dialog').getByRole('button', { name: 'Chamar' }).click();
  const caioCard = caio.page.locator('.call-card');
  await expect(caioCard).toContainText(`Na conversa: `);
  await caioCard.getByRole('button', { name: 'Aceitar' }).click();
  await expect(caio.page.locator('.call-tile')).toHaveCount(3);
  await expect.poll(() => liveAudio(caio.page), { timeout: 20_000 }).toBe(2);

  // Mudo aparece para os outros.
  await caio.page.getByRole('button', { name: /Mudo/ }).click();
  await expect(
    ana.page.locator('.call-tile', { hasText: caio.name }).locator('.call-muted'),
  ).toBeVisible();

  // Caio sai; Beto sai: com uma pessoa só, a chamada acaba.
  await caio.page.getByRole('button', { name: /Sair/ }).click();
  await expect(ana.page.locator('.call-tile')).toHaveCount(2);
  await beto.page.getByRole('button', { name: /Sair/ }).click();
  await expect(ana.page.locator('.call-panel')).toBeHidden();

  // Recusar: quem chamou fica sabendo.
  await openCard(ana.page, beto.name);
  await ana.page.getByRole('button', { name: 'Chamar para conversa' }).click();
  await ana.page.getByRole('dialog').getByRole('button', { name: 'Chamar' }).click();
  await beto.page.locator('.call-card').getByRole('button', { name: 'Recusar' }).click();
  await expect(ana.page.locator('.toasts')).toContainText(`${beto.name} recusou a chamada.`);
});
