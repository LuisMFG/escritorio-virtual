import { expect, type Browser, type Page } from '@playwright/test';

/** O que `window.__e2e` (client/src/e2e.ts) devolve. */
interface Hook {
  roomId(): string;
  mySessionId(): string;
  tile(x: number, y: number): { x: number; y: number };
  furni(id: string): { x: number; y: number } | null;
  furniList(): { id: string; defId: string; x: number; y: number }[];
  players(): { id: string; name: string; x: number; y: number; action: string }[];
  furniAt(x: number, y: number): string | null;
}
declare global {
  interface Window {
    __e2e?: Hook;
  }
}

export const INVITE = 'convite-e2e';
export const PASSWORD = 'senha-e2e-123';
/** Arte provisória (sem internet) e o gancho de testes ligados. */
export const APP = '/?offline=1&e2e=1';

let seq = 0;
/** Sufixo curto e único por execução (os testes dividem o mesmo banco). */
export function uniq(): string {
  return `${Date.now().toString(36).slice(-4)}${seq++}`;
}

export interface Person {
  page: Page;
  name: string;
  username: string;
}

/** Abre um navegador novo e cria uma conta pela tela de verdade. */
export async function newPerson(browser: Browser, base: string): Promise<Person> {
  const id = uniq();
  const name = `${base} ${id}`;
  const username = `${base.toLowerCase()}.${id}`;
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(APP);
  await page.getByRole('tab', { name: 'Criar conta' }).click();
  await page.locator('input[name=invite]').fill(INVITE);
  await page.locator('input[name=name]').fill(name);
  await page.locator('input[name=username]').fill(username);
  await page.locator('input[name=password]').fill(PASSWORD);
  await page.locator('form.login-card button[type=submit]').click();
  await waitRoom(page, 'reception');
  return { page, name, username };
}

export async function waitRoom(page: Page, roomId: string): Promise<void> {
  await page.waitForFunction((id) => window.__e2e?.roomId() === id, roomId, { timeout: 20_000 });
}

/** Clica com o mouse no meio de um tile da sala. */
export async function clickTile(page: Page, x: number, y: number): Promise<void> {
  const p = await page.evaluate(([tx, ty]) => window.__e2e!.tile(tx!, ty!), [x, y]);
  await page.mouse.click(p.x, p.y);
}

/**
 * Clica no desenho de um móvel, num ponto em que ele é o que está por cima (uma cadeira na
 * frente da mesa, por exemplo, pegaria o clique no meio dela).
 */
export async function clickFurni(page: Page, furniId: string): Promise<void> {
  const p = await page.evaluate((id) => {
    const c = window.__e2e!.furni(id);
    if (!c) return null;
    for (let r = 0; r <= 30; r += 3) {
      for (const [dx, dy] of [
        [0, -r],
        [0, r],
        [-r, 0],
        [r, 0],
        [-r, -r],
        [r, -r],
        [-r, r],
        [r, r],
      ]) {
        if (window.__e2e!.furniAt(c.x + dx!, c.y + dy!) === id)
          return { x: c.x + dx!, y: c.y + dy! };
      }
    }
    return null;
  }, furniId);
  expect(p, `ponto clicável do móvel ${furniId}`).not.toBeNull();
  await page.mouse.click(p!.x, p!.y);
}

/** Posição de alguém (pelo nome) no estado da sala que `page` está vendo. */
export async function positionOf(page: Page, name: string) {
  return page.evaluate((n) => window.__e2e!.players().find((p) => p.name === n) ?? null, name);
}

export async function sendChat(page: Page, text: string): Promise<void> {
  const input = page.getByPlaceholder(/Diga algo/);
  await input.fill(text);
  await input.press('Enter');
}

/** Anda até a porta (tile) e espera chegar na outra sala. */
export async function goThroughDoor(page: Page, door: [number, number], roomId: string) {
  await clickTile(page, door[0], door[1]);
  await waitRoom(page, roomId);
}
