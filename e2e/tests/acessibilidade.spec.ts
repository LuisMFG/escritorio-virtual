import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { APP, expect, newPerson, test } from '../helpers.js';

/** Problemas graves/críticos do axe na tela atual (o canvas da sala fica de fora). */
async function serious(page: Page, label: string): Promise<string[]> {
  const result = await new AxeBuilder({ page }).exclude('#app canvas').analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `[${label}] ${v.id}: ${v.help} → ${v.nodes
          .slice(0, 4)
          .map((n) => n.target.join(' '))
          .join(' | ')}`,
    );
}

test('acessibilidade: telas principais sem problemas graves (axe)', async ({ browser }) => {
  const problems: string[] = [];

  // Tela de entrada.
  const context = await browser.newContext();
  const login = await context.newPage();
  await login.goto(APP);
  await expect(login.locator('form.login-card')).toBeVisible();
  problems.push(...(await serious(login, 'entrada')));
  await context.close();

  const ana = await newPerson(browser, 'Ana');
  const page = ana.page;
  problems.push(...(await serious(page, 'sala')));

  const screens: [string, () => Promise<void>][] = [
    ['perfil', () => page.getByRole('button', { name: 'Perfil' }).click()],
    ['equipe', () => page.getByRole('button', { name: 'Equipe' }).click()],
    ['mensagens', () => page.getByRole('button', { name: 'Mensagens' }).click()],
    ['configurações', () => page.getByRole('button', { name: 'Configurações' }).click()],
    ['agenda', () => page.getByRole('button', { name: 'Agenda', exact: true }).click()],
    ['mapa', () => page.getByRole('button', { name: 'Mapa' }).click()],
  ];
  for (const [label, open] of screens) {
    await open();
    await page.waitForTimeout(600);
    problems.push(...(await serious(page, label)));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  await page.getByRole('button', { name: 'Decorar' }).click();
  await page.waitForTimeout(600);
  problems.push(...(await serious(page, 'decorar')));
  await page.getByRole('button', { name: 'Concluir', exact: true }).click();

  // Ajuda e as abas do Perfil.
  await page.getByRole('button', { name: 'Mais', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Ajuda (?)' }).click();
  await page.waitForTimeout(300);
  problems.push(...(await serious(page, 'ajuda')));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Perfil' }).click();
  for (const tab of ['Pet', 'Conquistas', 'Efeitos', 'Integrações', 'Conta']) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(400);
    problems.push(...(await serious(page, `perfil/${tab}`)));
  }
  await page.keyboard.press('Escape');

  // Tema claro: o contraste também precisa passar.
  await page.evaluate(() => localStorage.setItem('ev-theme', 'light'));
  await page.reload();
  await expect(page.locator('.hud-card')).toBeVisible();
  await page.waitForTimeout(800);
  problems.push(...(await serious(page, 'claro/sala')));
  await page.getByRole('button', { name: 'Perfil' }).click();
  await page.getByRole('tab', { name: 'Perfil' }).click();
  await page.waitForTimeout(400);
  problems.push(...(await serious(page, 'claro/perfil')));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Configurações' }).click();
  problems.push(...(await serious(page, 'claro/configurações')));

  expect(problems, problems.join('\n')).toEqual([]);
});

test('teclado: Perfil, Equipe e Mensagens só com o teclado', async ({ browser }) => {
  const ana = await newPerson(browser, 'Ana');
  const page = ana.page;
  const inside = (sel: string) =>
    page.evaluate((q) => Boolean(document.activeElement?.closest(q)), sel);

  for (const name of ['Perfil', 'Equipe']) {
    const button = page.getByRole('button', { name, exact: true });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.modal-backdrop')).toBeVisible();
    await expect.poll(() => inside('.modal-backdrop')).toBe(true);
    // Tab roda dentro da janela, sem escapar para a sala.
    for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
    expect(await inside('.modal-backdrop')).toBe(true);
    await page.keyboard.press('Shift+Tab');
    expect(await inside('.modal-backdrop')).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-backdrop')).toBeHidden();
    await expect(button).toBeFocused();
  }

  // Mensagens: painel lateral; o foco entra, Esc fecha e volta para o botão.
  const dm = page.getByRole('button', { name: 'Mensagens', exact: true });
  await dm.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => inside('.dm-panel')).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.dm-panel')).toBeHidden();
  await expect(dm).toBeFocused();
});
