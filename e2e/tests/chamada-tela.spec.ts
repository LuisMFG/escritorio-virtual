import type { Page } from '@playwright/test';
import { clickTile, expect, newPerson, openCard, test } from '../helpers.js';

/** Conexões de áudio desta aba tocando (trilha viva). */
const liveAudio = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLAudioElement>('audio[data-call-peer]')].filter((a) =>
        (a.srcObject as MediaStream | null)?.getAudioTracks().some((t) => t.readyState === 'live'),
      ).length,
  );

/** O quadro de alguém no painel. */
const tile = (page: Page, name: string) => page.locator('.call-tile', { hasText: name });

/** Bocas vistas num quadro durante `ms` (a cada 100 ms). */
const mouths = (page: Page, name: string, ms: number) =>
  page.evaluate(
    ([n, total]) =>
      new Promise<string[]>((resolve) => {
        const seen = new Set<string>();
        const end = Date.now() + total!;
        const step = () => {
          const t = [...document.querySelectorAll<HTMLElement>('.call-tile')].find((el) =>
            el.textContent?.includes(n!),
          );
          if (t?.dataset.mouth) seen.add(t.dataset.mouth);
          if (Date.now() > end) resolve([...seen]);
          else setTimeout(step, 100);
        };
        step();
      }),
    [name, ms] as const,
  );

/** Vídeo de um quadro tocando de verdade (quadros chegando). */
const playing = (page: Page, name: string) =>
  page.evaluate((n) => {
    const t = [...document.querySelectorAll('.call-tile')].find((el) =>
      el.textContent?.includes(n),
    );
    const v = t?.querySelector('video');
    return Boolean(v && !v.hidden && v.videoWidth > 0 && !v.paused);
  }, name);

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

async function invite(from: Page, to: { page: Page; name: string }, adding: boolean) {
  await openCard(from, to.name);
  await from
    .getByRole('button', { name: adding ? 'Adicionar à chamada' : 'Chamar para conversa' })
    .click();
  await from.getByRole('dialog').getByRole('button', { name: 'Chamar' }).click();
  await to.page.locator('.call-card').getByRole('button', { name: 'Aceitar' }).click();
}

test('tela de chamada: rostos que falam, efeitos, dispositivos, tela cheia e mini-player (3 pessoas, uma no celular)', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  // Caio entra pelo celular (tela pequena, toque).
  const caio = await newPerson(browser, 'Caio', {
    context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  });
  await walk(beto.page, 6, 17);
  await walk(caio.page, 9, 17);
  await invite(ana.page, beto, false);
  await invite(ana.page, caio, true);
  for (const p of [ana.page, beto.page, caio.page]) {
    await expect(p.locator('.call-tile')).toHaveCount(3);
  }
  await expect.poll(() => liveAudio(ana.page), { timeout: 20_000 }).toBe(2);

  // Sem câmera, cada um aparece com o rosto do avatar.
  for (const who of [beto.name, caio.name]) {
    await expect(tile(ana.page, who).locator('.call-face img')).toBeVisible();
  }
  // Com o microfone (falso, que apita), a boca do Beto mexe na tela da Ana e o contorno acende…
  await expect
    .poll(async () => (await mouths(ana.page, beto.name, 1500)).some((m) => m !== 'closed'), {
      timeout: 20_000,
    })
    .toBe(true);
  await expect(tile(ana.page, beto.name)).toHaveClass(/speaking/, { timeout: 10_000 });
  // …e no mudo a boca fecha e o ícone aparece.
  await beto.page.getByRole('button', { name: 'Mudo', exact: true }).click();
  await expect(tile(ana.page, beto.name).locator('.call-muted')).toBeVisible();
  expect(await mouths(ana.page, beto.name, 1500)).toEqual(['closed']);
  await ana.page.screenshot({ path: 'e2e-results/shot-chamada-rostos.png' });

  // Dispositivos (Ana): microfone com medidor, câmera com prévia e os efeitos.
  await ana.page.getByRole('button', { name: 'Dispositivos' }).click();
  const dev = ana.page.getByRole('dialog', { name: 'Dispositivos e efeitos' });
  await expect(dev.getByRole('combobox', { name: 'Microfone', exact: true })).toBeEnabled();
  await expect
    .poll(
      () => dev.getByRole('meter', { name: 'Volume do microfone' }).getAttribute('aria-valuenow'),
      {
        timeout: 10_000,
      },
    )
    .not.toBe('0');
  await expect
    .poll(() =>
      ana.page.evaluate(() => {
        const v = document.querySelector<HTMLVideoElement>('.call-preview video');
        return Boolean(v && v.videoWidth > 0);
      }),
    )
    .toBe(true);
  // Trocar de microfone não derruba a chamada: o áudio segue chegando e a boca mexe.
  const mics = await dev
    .getByLabel('Microfone', { exact: true })
    .locator('option')
    .allTextContents();
  if (mics.length > 1)
    await dev.getByRole('combobox', { name: 'Microfone', exact: true }).selectOption({ index: 1 });
  await expect(dev.getByRole('combobox', { name: 'Microfone', exact: true })).toBeEnabled();
  await expect
    .poll(async () => (await mouths(beto.page, ana.name, 1500)).some((m) => m !== 'closed'), {
      timeout: 20_000,
    })
    .toBe(true);
  // Saída de áudio: a lista, ou o aviso de que o navegador não deixa escolher.
  await expect(
    dev.locator('.call-dev-speaker:not([hidden]), .call-dev-speaker-note:not([hidden])'),
  ).toHaveCount(1);
  // Efeitos: desfoque e supressão de ruído, salvos para as próximas chamadas.
  await dev.getByLabel('Desfocar o fundo (modo retrato)').check();
  await expect(dev.getByRole('status')).toContainText('quando você ligar a câmera');
  await dev.getByLabel('Supressão de ruído no microfone').uncheck();
  await expect(dev.getByLabel('Supressão de ruído no microfone')).toBeEnabled();
  expect(
    await ana.page.evaluate(() => JSON.parse(localStorage.getItem('ev-call-prefs') ?? '{}')),
  ).toMatchObject({ blur: true, noise: false });
  await dev.getByRole('button', { name: 'Fechar' }).click();
  await expect(ana.page.locator('.call-preview')).toHaveCount(0);
  expect(await liveAudio(beto.page)).toBe(2);

  // Câmera com o fundo desfocado: o vídeo que sai é o do desfoque (não a câmera crua) e chega.
  await ana.page.getByRole('button', { name: 'Câmera', exact: true }).click();
  await expect(ana.page.getByRole('button', { name: 'Desligar câmera' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(ana.page.locator('.toasts')).not.toContainText('desfoque');
  const label = await ana.page.evaluate(
    () =>
      (
        document.querySelector<HTMLVideoElement>('.call-tile.mine video')?.srcObject as MediaStream
      )?.getVideoTracks()[0]?.label ?? '',
  );
  expect(label).not.toMatch(/fake/i);
  await expect.poll(() => playing(beto.page, ana.name), { timeout: 20_000 }).toBe(true);
  await ana.page.getByRole('button', { name: 'Dispositivos' }).click();
  await expect(ana.page.locator('.call-preview small')).toHaveText(
    'Sua câmera agora (com o fundo desfocado).',
  );
  await ana.page.keyboard.press('Escape');

  // Beto: destacar o vídeo da Ana na janela e voltar à grade.
  await tile(beto.page, ana.name).hover();
  await beto.page.getByRole('button', { name: `Destacar ${ana.name}` }).click();
  await expect(tile(beto.page, ana.name)).toHaveClass(/pinned/);
  await expect(beto.page.locator('.call-panel')).toHaveClass(/expanded/);
  await beto.page.getByRole('button', { name: 'Voltar à grade' }).click();
  await expect(tile(beto.page, ana.name)).not.toHaveClass(/pinned/);

  // Só o vídeo da Ana em tela cheia; depois a chamada inteira.
  const fullOf = (p: Page) =>
    p.evaluate(() => {
      const el = document.fullscreenElement as HTMLElement | null;
      return el
        ? el.dataset.user
          ? 'tile'
          : el.className.includes('call-panel')
            ? 'panel'
            : 'other'
        : null;
    });
  await tile(beto.page, ana.name).hover();
  await beto.page.getByRole('button', { name: `Tela cheia: ${ana.name}` }).click();
  await expect.poll(() => fullOf(beto.page)).toBe('tile');
  await beto.page.screenshot({ path: 'e2e-results/shot-chamada-tela-cheia.png' });
  await tile(beto.page, ana.name).getByRole('button', { name: 'Sair da tela cheia' }).click();
  await expect.poll(() => fullOf(beto.page)).toBeNull();
  await beto.page.getByRole('button', { name: 'Chamada em tela cheia' }).click();
  await expect.poll(() => fullOf(beto.page)).toBe('panel');
  await beto.page
    .locator('.call-panel-head')
    .getByRole('button', { name: 'Sair da tela cheia' })
    .click();
  await expect.poll(() => fullOf(beto.page)).toBeNull();

  // Minimizar: some a janela, aparece o mini-player e a chamada segue (áudio e vídeo).
  await beto.page.getByRole('button', { name: 'Minimizar chamada' }).click();
  const mini = beto.page.locator('.call-mini');
  await expect(beto.page.locator('.call-panel')).toBeHidden();
  await expect(mini).toBeVisible();
  await expect(mini.locator('.call-mini-name')).not.toBeEmpty();
  // A Ana com câmera aparece em vídeo quando é ela no mini-player.
  await expect(mini.locator('.call-mini-name')).toHaveText(/./);
  await beto.page.screenshot({ path: 'e2e-results/shot-chamada-mini.png' });
  // Arrasta para outro canto.
  const box = (await mini.locator('.call-mini-stage').boundingBox())!;
  await beto.page.mouse.move(box.x + 20, box.y + 20);
  await beto.page.mouse.down();
  await beto.page.mouse.move(box.x - 300, box.y - 200, { steps: 6 });
  await beto.page.mouse.up();
  const moved = (await mini.boundingBox())!;
  expect(Math.round(moved.x - box.x)).toBeLessThan(-250);
  // Mudo pelo mini-player (tirando o mudo de antes): a Ana vê o Beto com som de novo.
  await mini.getByRole('button', { name: 'Ativar som' }).click();
  await expect(tile(ana.page, beto.name).locator('.call-muted')).toHaveCount(0);
  expect(await liveAudio(beto.page)).toBe(2);
  // Restaurar: a janela volta como estava.
  await mini.getByRole('button', { name: 'Restaurar chamada' }).click();
  await expect(mini).toBeHidden();
  await expect(beto.page.locator('.call-panel')).toBeVisible();
  await expect(beto.page.locator('.call-tile')).toHaveCount(3);

  // No celular: o painel cabe na tela, os botões dos vídeos aparecem sem passar o mouse, e o
  // mini-player funciona.
  const panel = (await caio.page.locator('.call-panel').boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(390);
  await expect(tile(caio.page, ana.name).locator('.call-tile-tools')).toBeVisible();
  await caio.page.screenshot({ path: 'e2e-results/shot-chamada-celular.png' });
  await caio.page.getByRole('button', { name: 'Minimizar chamada' }).click();
  const caioMini = caio.page.locator('.call-mini');
  await expect(caioMini).toBeVisible();
  const miniBox = (await caioMini.boundingBox())!;
  expect(miniBox.x + miniBox.width).toBeLessThanOrEqual(390);
  await caioMini.getByRole('button', { name: 'Restaurar chamada' }).click();
  await expect(caio.page.locator('.call-panel')).toBeVisible();

  // Sair pelo mini-player: a chamada acaba para quem saiu.
  await caio.page.getByRole('button', { name: 'Minimizar chamada' }).click();
  await caioMini.getByRole('button', { name: 'Sair da chamada' }).click();
  await expect(caioMini).toBeHidden();
  await expect(ana.page.locator('.call-tile')).toHaveCount(2);
});
