import { describe, expect, it } from 'vitest';
import { DUMMY_HASH, hashPassword, verifyPassword } from './passwords.js';

describe('senhas', () => {
  it('confere a senha certa e recusa a errada', async () => {
    const hash = await hashPassword('minha senha boa');
    expect(hash.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(await verifyPassword('minha senha boa', hash)).toBe(true);
    expect(await verifyPassword('minha senha ruim', hash)).toBe(false);
  });

  it('cada hash tem sal próprio', async () => {
    expect(await hashPassword('igual123')).not.toBe(await hashPassword('igual123'));
  });

  it('hash ausente, malformado ou o de mentira nunca confere', async () => {
    expect(await verifyPassword('x', null)).toBe(false);
    expect(await verifyPassword('x', 'md5$abc')).toBe(false);
    expect(await verifyPassword('', DUMMY_HASH)).toBe(false);
  });
});
