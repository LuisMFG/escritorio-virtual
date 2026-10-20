import { expect, goThroughDoor, newPerson, positionOf, test, waitRoom } from '../helpers.js';

test('mapa: ver quem está em cada sala e ir até alguém de outra sala', async ({ browser }) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  await goThroughDoor(beto.page, [21, 0], 'pantry');

  await ana.page.getByRole('button', { name: 'Mapa' }).click();
  const map = ana.page.locator('.minimap');
  // A Recepção é onde a Ana está; a Copa (acima, pela porta do fundo) tem o Beto.
  await expect(map.locator('.minimap-room.here')).toContainText('Recepção');
  const copa = map.locator('.minimap-room', { hasText: 'Copa' });
  await expect(copa).toContainText(beto.name);
  const recepcao = await map.locator('.minimap-room.here').boundingBox();
  const copaBox = await copa.boundingBox();
  expect(copaBox!.y).toBeLessThan(recepcao!.y);

  // Ir até o Beto: troca de sala e anda até perto dele.
  await copa.getByRole('button', { name: `Ir até ${beto.name}` }).click();
  await waitRoom(ana.page, 'pantry');
  await expect
    .poll(
      async () => {
        const a = await positionOf(ana.page, ana.name);
        const b = await positionOf(ana.page, beto.name);
        return a && b ? Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) : 99;
      },
      { timeout: 15_000 },
    )
    .toBeLessThanOrEqual(1);
});
