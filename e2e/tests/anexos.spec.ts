import { expect, test } from '@playwright/test';
import { newPerson, openChatHistory } from '../helpers.js';

// PNG 1x1 (vermelho).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

test('anexos: imagem no chat da sala, arquivo na DM, tipo recusado e busca', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const tag = `sprint${Date.now().toString(36)}`;

  // Ana anexa uma imagem com legenda; Beto vê a miniatura e abre ampliada.
  await ana.page
    .locator('.chat-bar input[type=file]')
    .setInputFiles({ name: 'print.png', mimeType: 'image/png', buffer: PNG });
  await expect(ana.page.locator('.chat-bar .attach-draft')).toContainText('print.png');
  const input = ana.page.getByPlaceholder(/Diga algo/);
  await input.fill(`Print da ${tag}`);
  await input.press('Enter');
  await expect(ana.page.locator('.chat-bar .attach-draft')).toBeHidden();

  await openChatHistory(beto.page);
  const msg = beto.page.locator('.chat-log li', { hasText: tag });
  const thumb = msg.getByRole('button', { name: 'Ver imagem print.png' });
  await expect(thumb.locator('img')).toHaveAttribute('src', /^blob:/);
  await expect
    .poll(() => thumb.locator('img').evaluate((i) => (i as HTMLImageElement).naturalWidth))
    .toBe(1);
  await thumb.click();
  await expect(beto.page.locator('.lightbox img')).toBeVisible();
  await beto.page.keyboard.press('Escape');
  await expect(beto.page.locator('.lightbox')).toHaveCount(0);

  // Tipo não aceito: aviso e nada anexado.
  await ana.page
    .locator('.chat-bar input[type=file]')
    .setInputFiles({ name: 'programa.exe', mimeType: 'application/x-msdownload', buffer: PNG });
  await expect(ana.page.locator('body')).toContainText('não é aceito');
  await expect(ana.page.locator('.chat-bar .attach-draft')).toBeHidden();

  // DM com um PDF: Beto recebe o cartão do arquivo.
  await ana.page.getByRole('button', { name: 'Mensagens' }).click();
  await ana.page.getByRole('button', { name: 'Nova conversa' }).click();
  await ana.page.getByLabel('Buscar pessoa').fill(beto.name);
  await ana.page.locator('.dm-conv', { hasText: beto.name }).click();
  await ana.page.locator('.dm-form input[type=file]').setInputFiles({
    name: `relatorio-${tag}.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 relatório de teste'),
  });
  await expect(ana.page.locator('.dm-panel .attach-draft')).toContainText(`relatorio-${tag}.pdf`);
  await ana.page.getByLabel('Mensagem privada').press('Enter');

  await beto.page.getByRole('button', { name: /Mensagens/ }).click();
  await beto.page.locator('.dm-conv', { hasText: ana.name }).click();
  await expect(
    beto.page.getByRole('button', { name: `Baixar relatorio-${tag}.pdf` }),
  ).toBeVisible();

  // Busca: acha a mensagem da sala (pelo texto) e a DM (pelo nome do arquivo).
  await beto.page.keyboard.press('Escape');
  await beto.page.getByRole('button', { name: 'Buscar nas conversas' }).click();
  const panel = beto.page.locator('.search-panel');
  await panel.getByLabel('Buscar').fill(tag);
  await panel.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(panel.locator('.search-hit')).toHaveCount(2);
  await expect(panel.locator('.search-hit', { hasText: 'Recepção' })).toContainText(
    `Print da ${tag}`,
  );
  await expect(panel.locator('.search-hit', { hasText: '✉️' })).toContainText(
    `relatorio-${tag}.pdf`,
  );
  await panel.locator('.search-hit', { hasText: 'Recepção' }).click();
  await expect(msg).toHaveClass(/flash/);
});
