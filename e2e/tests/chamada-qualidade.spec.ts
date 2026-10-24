import type { Page } from '@playwright/test';
import { clickTile, expect, newPerson, openCard, test, type Person } from '../helpers.js';

/** O quadro de alguém no painel. */
const tile = (page: Page, name: string) => page.locator('.call-tile', { hasText: name });

/** Vídeo tocando de verdade (quadros chegando) no destaque ou na miniatura de um quadro. */
const playing = (page: Page, name: string, where: 'main' | 'pip') =>
  page.evaluate(
    ([n, w]) => {
      const t = [...document.querySelectorAll('.call-tile')].find((el) =>
        el.textContent?.includes(n!),
      );
      const v = t?.querySelector<HTMLVideoElement>(
        w === 'pip' ? '.call-pip video' : ':scope > video',
      );
      return v && !v.hidden && v.videoWidth > 0 && !v.paused ? v.dataset.kind : null;
    },
    [name, where] as const,
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

async function invite(from: Page, to: Person, adding: boolean) {
  await openCard(from, to.name);
  await from
    .getByRole('button', { name: adding ? 'Adicionar à chamada' : 'Chamar para conversa' })
    .click();
  await from.getByRole('dialog').getByRole('button', { name: 'Chamar' }).click();
  await to.page.locator('.call-card').getByRole('button', { name: 'Aceitar' }).click();
}

test('qualidade das chamadas: câmera e tela juntas, miniatura, conexão, detalhes e qualidade (3 pessoas)', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const caio = await newPerson(browser, 'Caio');
  await walk(beto.page, 6, 17);
  await walk(caio.page, 9, 17);
  await invite(ana.page, beto, false);
  await invite(ana.page, caio, true);
  for (const p of [ana, beto, caio]) await expect(p.page.locator('.call-tile')).toHaveCount(3);

  // Ana liga a câmera e compartilha a tela (fluidez) sem desligar a câmera.
  await ana.page.getByRole('button', { name: 'Câmera', exact: true }).click();
  await ana.page.getByRole('button', { name: 'Tela', exact: true }).click();
  const share = ana.page.getByRole('dialog', { name: 'Compartilhar a tela' });
  await share.getByLabel(/Fluidez/).check();
  await share.getByRole('button', { name: 'Compartilhar' }).click();
  await expect(ana.page.getByRole('button', { name: 'Desligar câmera' })).toBeVisible();

  // Para o Beto: a tela em destaque e a câmera da Ana na miniatura, as duas tocando.
  await expect.poll(() => playing(beto.page, ana.name, 'main'), { timeout: 30_000 }).toBe('screen');
  await expect.poll(() => playing(beto.page, ana.name, 'pip'), { timeout: 30_000 }).toBe('cam');
  await expect(tile(beto.page, ana.name)).toHaveClass(/screen/);
  await beto.page.screenshot({ path: 'e2e-results/shot-chamada-tela-e-camera.png' });

  // Trocar o destaque: a câmera vai para o meio e a tela para a miniatura.
  await beto.page.getByRole('button', { name: `Trocar destaque: câmera de ${ana.name}` }).click();
  await expect.poll(() => playing(beto.page, ana.name, 'main')).toBe('cam');
  await expect.poll(() => playing(beto.page, ana.name, 'pip')).toBe('screen');
  await expect(tile(beto.page, ana.name)).not.toHaveClass(/screen/);
  // E de volta (duplo clique na miniatura).
  // (embaixo, longe dos botões da miniatura)
  const pipBox = (await tile(beto.page, ana.name).locator('.call-pip').boundingBox())!;
  await tile(beto.page, ana.name)
    .locator('.call-pip')
    .dblclick({ position: { x: pipBox.width / 2, y: pipBox.height - 8 } });
  await expect.poll(() => playing(beto.page, ana.name, 'main')).toBe('screen');

  // Esconder e mostrar a miniatura.
  await beto.page.getByRole('button', { name: `Esconder câmera de ${ana.name}` }).click();
  await expect(tile(beto.page, ana.name).locator('.call-pip')).toBeHidden();
  await beto.page.getByRole('button', { name: `Mostrar câmera de ${ana.name}` }).click();
  await expect(tile(beto.page, ana.name).locator('.call-pip')).toBeVisible();

  // Arrastar a miniatura: fica onde soltou, dentro do quadro.
  const pip = tile(beto.page, ana.name).locator('.call-pip');
  const before = (await pip.boundingBox())!;
  await beto.page.mouse.move(before.x + 20, before.y + before.height - 10);
  await beto.page.mouse.down();
  await beto.page.mouse.move(before.x - 40, before.y - 30, { steps: 5 });
  await beto.page.mouse.up();
  const after = (await pip.boundingBox())!;
  expect(after.x).toBeLessThan(before.x - 20);
  const box = (await tile(beto.page, ana.name).boundingBox())!;
  expect(after.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(after.y).toBeGreaterThanOrEqual(box.y - 1);

  // Tela cheia só da câmera (a miniatura).
  await beto.page.getByRole('button', { name: `Tela cheia: câmera de ${ana.name}` }).click();
  await expect
    .poll(() =>
      beto.page.evaluate(
        () =>
          document.fullscreenElement?.tagName === 'VIDEO' ||
          Boolean(document.querySelector('video.pseudo-full')),
      ),
    )
    .toBe(true);
  await beto.page.keyboard.press('Escape');
  await beto.page.evaluate(() => document.fullscreenElement && document.exitFullscreen());

  // Indicador de conexão em cada pessoa (boa/média/ruim, do servidor de mídia).
  await expect
    .poll(() => tile(beto.page, ana.name).locator('.call-link').getAttribute('data-link'), {
      timeout: 30_000,
    })
    .toMatch(/^(bom|medio|ruim)$/);

  // Detalhes: resolução, fps, bitrate e atraso de cada vídeo que chega.
  await beto.page.getByRole('button', { name: 'Detalhes da conexão' }).click();
  const stats = beto.page.getByRole('region', { name: 'Detalhes da conexão' });
  await expect(
    stats.getByRole('row', { name: new RegExp(`${ana.name} \\(tela\\)`) }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await stats
          .getByRole('row', { name: new RegExp(`${ana.name} \\(câmera\\)`) })
          .textContent()) ?? '',
      { timeout: 15_000 },
    )
    .toMatch(/\d+×\d+.*\d+ (kbps|Mbps).*~\d+ ms/);
  await beto.page.screenshot({ path: 'e2e-results/shot-chamada-detalhes.png' });
  await beto.page.getByRole('button', { name: 'Detalhes da conexão' }).click();
  await expect(stats).toBeHidden();

  // Ana troca para nitidez sem escolher a tela de novo; a tela continua chegando.
  await ana.page.getByRole('button', { name: 'Tela: fluidez' }).click();
  await expect(ana.page.getByRole('button', { name: 'Tela: nitidez' })).toBeVisible();
  await expect.poll(() => playing(beto.page, ana.name, 'main'), { timeout: 20_000 }).toBe('screen');

  // Caio escolhe Economia (fica salva) e liga a câmera: sai em 360p no máximo.
  await caio.page.getByRole('button', { name: 'Dispositivos' }).click();
  const dev = caio.page.getByRole('dialog', { name: 'Dispositivos e efeitos' });
  await dev.getByRole('combobox', { name: 'Qualidade do vídeo' }).selectOption('economia');
  await expect(dev.getByText(/Câmera em 360p/)).toBeVisible();
  await caio.page.keyboard.press('Escape');
  expect(
    await caio.page.evaluate(
      () => JSON.parse(localStorage.getItem('ev-call-prefs') ?? '{}').quality,
    ),
  ).toBe('economia');
  await caio.page.getByRole('button', { name: 'Câmera', exact: true }).click();
  await expect.poll(() => playing(ana.page, caio.name, 'main'), { timeout: 30_000 }).toBe('cam');
  await caio.page.getByRole('button', { name: 'Detalhes da conexão' }).click();
  const mine = caio.page
    .getByRole('region', { name: 'Detalhes da conexão' })
    .getByRole('row', { name: /Você mandando \(câmera\)/ });
  await expect
    .poll(
      async () => {
        const res = (await mine.getByRole('cell').nth(1).textContent()) ?? '';
        const heights = [...res.matchAll(/\d+×(\d+)/g)].map((m) => Number(m[1]));
        return heights.length > 0 && Math.max(...heights) <= 360;
      },
      { timeout: 20_000 },
    )
    .toBe(true);

  // Ana para a tela: a câmera dela volta ao destaque, sem miniatura.
  await ana.page.getByRole('button', { name: 'Parar tela' }).click();
  await expect.poll(() => playing(beto.page, ana.name, 'main'), { timeout: 20_000 }).toBe('cam');
  await expect(tile(beto.page, ana.name).locator('.call-pip')).toBeHidden();
  await ana.page.getByRole('button', { name: /Sair/ }).click();
});
