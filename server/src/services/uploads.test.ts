import { RECEPTION } from '@office/shared';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client.js';
import { createServices } from './index.js';
import { LinkPreviewService, isPrivateAddress, parsePreview } from './LinkPreviewService.js';
import { likePattern } from './SearchService.js';
import { UploadService } from './UploadService.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PDF = Buffer.from('%PDF-1.4 teste');

function setup() {
  const svc = createServices(
    openDatabase(':memory:'),
    { inviteCode: 'x' },
    undefined,
    { dir: mkdtempSync(join(tmpdir(), 'esc-bk-')), keep: 1 },
    mkdtempSync(join(tmpdir(), 'esc-up-')),
  );
  const mk = (name: string) => svc.users.create(name, 'hd-180-1').user;
  return { svc, ana: mk('ana'), beto: mk('beto'), caio: mk('caio') };
}

describe('anexos', () => {
  it('aceita só tipos conhecidos com conteúdo que confere', () => {
    const { svc, ana } = setup();
    const ok = svc.uploads.save(ana.id, 'foto.PNG', 'image/png', PNG);
    expect(ok).toMatchObject({
      name: 'foto.PNG',
      mime: 'image/png',
      size: PNG.length,
      image: true,
    });
    expect(
      svc.uploads.save(ana.id, 'relatorio.pdf', 'application/octet-stream', PDF),
    ).toMatchObject({
      mime: 'application/pdf',
      image: false,
    });
    expect(svc.uploads.save(ana.id, 'virus.exe', 'application/x-msdownload', PNG)).toMatch(
      /não é aceito/,
    );
    expect(svc.uploads.save(ana.id, 'falsa.png', 'image/png', PDF)).toMatch(/não confere/);
    expect(svc.uploads.save(ana.id, 'pagina.html', 'text/html', Buffer.from('<script>'))).toMatch(
      /não é aceito/,
    );
    expect(svc.uploads.save(ana.id, 'vazio.txt', 'text/plain', Buffer.alloc(0))).toMatch(/vazio/);
    expect(
      svc.uploads.save(ana.id, 'grande.txt', 'text/plain', Buffer.alloc(10 * 1024 * 1024 + 1, 97)),
    ).toMatch(/10 MB/);
    expect(
      svc.uploads.save(ana.id, '../../etc/passwd.txt', 'text/plain', Buffer.from('oi')),
    ).toMatchObject({
      name: expect.not.stringMatching(/[/\\]/),
    });
  });

  it('quem pode baixar: sala = todos; DM = só a dupla; não usado = só quem enviou', () => {
    const { svc, ana, beto, caio } = setup();
    const save = () => {
      const a = svc.uploads.save(ana.id, 'f.png', 'image/png', PNG);
      if (typeof a === 'string') throw new Error(a);
      return a;
    };
    const solto = save();
    expect(svc.uploads.canRead(solto.id, ana.id)).toBe(true);
    expect(svc.uploads.canRead(solto.id, beto.id)).toBe(false);

    const naSala = save();
    const msg = svc.chat.add(RECEPTION.id, ana, '', '', undefined, 'text', naSala.id);
    expect(msg.attachment).toEqual(naSala);
    expect(svc.chat.recent(RECEPTION.id).at(-1)?.attachment).toEqual(naSala);
    expect(svc.uploads.canRead(naSala.id, caio.id)).toBe(true);

    const naDm = save();
    const dm = svc.dms.send(ana.id, beto.id, 'segue', undefined, naDm.id);
    expect(dm.attachment).toEqual(naDm);
    expect(svc.uploads.canRead(naDm.id, beto.id)).toBe(true);
    expect(svc.uploads.canRead(naDm.id, caio.id)).toBe(false);
    expect(svc.uploads.owns(naDm.id, beto.id)).toBe(false);
  });

  it('limpa anexos com mais de um dia que nenhuma mensagem usa', () => {
    const { svc, ana } = setup();
    let now = new Date('2026-10-18T10:00:00Z');
    const uploads = new UploadService(svc.db, svc.uploads.dir, () => now);
    const solto = uploads.save(ana.id, 'a.txt', 'text/plain', Buffer.from('a'));
    const usado = uploads.save(ana.id, 'b.txt', 'text/plain', Buffer.from('b'));
    if (typeof solto === 'string' || typeof usado === 'string') throw new Error('falhou');
    svc.chat.add(RECEPTION.id, ana, 'olha', '', undefined, 'text', usado.id);
    expect(uploads.cleanup()).toBe(0);
    now = new Date('2026-10-19T11:00:00Z');
    expect(uploads.cleanup()).toBe(1);
    expect(uploads.find(solto.id)).toBeUndefined();
    expect(existsSync(uploads.pathOf(solto.id))).toBe(false);
    expect(existsSync(uploads.pathOf(usado.id))).toBe(true);
  });
});

describe('busca', () => {
  it('acha no chat das salas e só nas próprias DMs (inclui nome do anexo)', () => {
    const { svc, ana, beto, caio } = setup();
    svc.chat.add(RECEPTION.id, ana, 'Deploy da sprint às 15h', '');
    svc.chat.add(RECEPTION.id, beto, 'café?', '');
    svc.dms.send(ana.id, beto.id, 'o deploy quebrou');
    svc.dms.send(caio.id, beto.id, 'deploy secreto');
    const f = svc.uploads.save(beto.id, 'Plano-Deploy.pdf', 'application/pdf', PDF);
    if (typeof f === 'string') throw new Error(f);
    svc.dms.send(beto.id, ana.id, '', undefined, f.id);

    const hits = svc.search.search(ana.id, 'DEPLOY', 50);
    // (Mensagens no mesmo milissegundo podem vir em qualquer ordem.)
    expect(hits.map((h) => [h.kind, h.whereName, h.text]).sort()).toEqual([
      ['dm', 'beto', 'o deploy quebrou'],
      ['dm', 'beto', '📎 Plano-Deploy.pdf'],
      ['room', RECEPTION.name, 'Deploy da sprint às 15h'],
    ]);
    expect(svc.search.search(ana.id, '%', 50)).toEqual([]);
  });

  it('escapa curingas do LIKE', () => {
    expect(likePattern('50%_a\\b')).toBe('%50\\%\\_a\\\\b%');
  });
});

describe('prévia de link', () => {
  it('reconhece endereços internos', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.0.10',
      '172.20.0.1',
      '169.254.169.254',
      '::1',
      'fe80::1',
      'fd00::5',
      '::ffff:127.0.0.1',
      '0.0.0.0',
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '151.101.1.69', '2606:4700::1111'])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('lê título e descrição (Open Graph primeiro)', () => {
    const html = `<html><head><title>Fallback</title>
      <meta property="og:title" content="Escritório &amp; Cia">
      <meta content="Uma descrição" name="description">
      <meta property="og:site_name" content="Exemplo"></head></html>`;
    expect(parsePreview('https://www.exemplo.com/x', html)).toEqual({
      url: 'https://www.exemplo.com/x',
      title: 'Escritório & Cia',
      description: 'Uma descrição',
      site: 'Exemplo',
    });
    expect(parsePreview('https://www.exemplo.com/', '<title> Só título </title>')).toMatchObject({
      title: 'Só título',
      site: 'exemplo.com',
    });
  });

  it('segue redirecionamentos, guarda em cache e recusa o que não é http', async () => {
    const calls: string[] = [];
    let t = 0;
    const svc = new LinkPreviewService(
      async (url) => {
        calls.push(url.href);
        if (url.pathname === '/curto')
          return { status: 301, headers: { location: '/longo' }, body: '' };
        if (url.pathname === '/longo')
          return {
            status: 200,
            headers: { 'content-type': 'text/html' },
            body: '<title>Página</title>',
          };
        throw new Error('Endereço interno não é permitido.');
      },
      () => t,
    );
    expect(await svc.preview('https://a.com/curto')).toMatchObject({
      title: 'Página',
      url: 'https://a.com/curto',
    });
    expect(await svc.preview('https://a.com/curto')).toMatchObject({ title: 'Página' });
    expect(calls).toEqual(['https://a.com/curto', 'https://a.com/longo']);
    expect(await svc.preview('http://interno/')).toBeNull();
    expect(await svc.preview('file:///etc/passwd')).toBeNull();
    expect(await svc.preview('javascript:alert(1)')).toBeNull();
    t += 2 * 60 * 60_000;
    await svc.preview('https://a.com/curto');
    expect(calls).toHaveLength(5);
  });
});
