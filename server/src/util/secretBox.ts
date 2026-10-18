import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Cifra segredos guardados no banco (tokens de integrações) com AES-256-GCM. */
export class SecretBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('A chave de cifra precisa ter 32 bytes.');
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), data]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  open(sealed: string): string {
    const [v, iv, tag, data] = sealed.split('.');
    if (v !== 'v1' || !iv || !tag || data === undefined)
      throw new Error('Segredo em formato inválido.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}

/**
 * Chave de `SECRET_KEY` (base64, 32 bytes) ou do arquivo `file` (criado na primeira vez, só o
 * dono lê). Perder a chave só obriga as pessoas a conectar o Jira de novo.
 */
export function loadSecretKey(env: string | undefined, file: string): Buffer {
  if (env?.trim()) {
    const key = Buffer.from(env.trim(), 'base64');
    if (key.length !== 32)
      throw new Error('SECRET_KEY precisa ser 32 bytes em base64 (openssl rand -base64 32).');
    return key;
  }
  if (existsSync(file)) return Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
  const key = randomBytes(32);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${key.toString('base64')}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return key;
}
