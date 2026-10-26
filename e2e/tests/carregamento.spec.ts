import type { Page } from '@playwright/test';
import { expect, newPerson, test } from '../helpers.js';

/** Arquivos do servidor de mídia das chamadas que a página já baixou. */
const livekitFiles = (page: Page) =>
  page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => /livekit-client/.test(n)),
  );

test('o servidor de mídia das chamadas só é baixado quando alguém entra numa chamada', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  await ana.page.waitForTimeout(1000);
  expect(await livekitFiles(ana.page)).toEqual([]);

  // A Ana chama o Beto pelo menu da lista; ao entrar na chamada, o arquivo à parte é baixado.
  const people = ana.page.locator('.people');
  await people.evaluate((d) => ((d as HTMLDetailsElement).open = true));
  await people.getByRole('button', { name: `Opções para ${beto.name}`, exact: true }).click();
  await ana.page.getByRole('menuitem', { name: /Chamar para conversa/ }).click();
  await ana.page.getByRole('dialog').getByRole('button', { name: 'Chamar' }).click();
  await beto.page.locator('.call-card').getByRole('button', { name: 'Aceitar' }).click();
  await expect.poll(() => livekitFiles(beto.page), { timeout: 15_000 }).toHaveLength(1);
});
