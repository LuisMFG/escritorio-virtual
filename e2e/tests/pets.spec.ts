import { expect, newPerson, sendChat, test } from '../helpers.js';

test('pet do Habbo: adotar no Perfil com padrão e cor, o outro vê e ele obedece', async ({
  browser,
}) => {
  const ana = await newPerson(browser, 'Ana');
  const beto = await newPerson(browser, 'Beto');
  const page = ana.page;

  await page.getByRole('button', { name: 'Perfil' }).click();
  await page.getByRole('tab', { name: 'Pet' }).click();
  const section = page.getByRole('region', { name: 'Meu pet' });
  await section.getByLabel('Nome do pet').fill('Rex');
  await section.getByLabel('Espécie').selectOption('hh:dog');
  await section.getByRole('radio', { name: 'Padrão 3' }).click();
  await section.getByRole('radio', { name: 'Cor 2' }).click();
  await section.getByRole('button', { name: 'Adotar' }).click();
  await expect(section).toContainText('Cachorro');
  await page.keyboard.press('Escape');

  const rexForBeto = () =>
    beto.page.evaluate(() => window.__e2e!.pets().find((p) => p.name === 'Rex') ?? null);
  await expect.poll(rexForBeto).toMatchObject({ species: 'hh:dog', color: 2, tint: 'c98a4b' });

  await sendChat(page, '/senta');
  await expect.poll(async () => (await rexForBeto())?.action).toBe('sit');
});
