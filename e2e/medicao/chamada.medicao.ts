import { chromium, type Browser, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clickTile, expect, newPerson, openCard, test, type Person } from '../helpers.js';
import { sonda } from './sonda.js';

/**
 * Medição da qualidade das chamadas (não roda com os outros testes: `npm run medir:chamada`).
 *
 * Três pessoas, cada uma num navegador em Docker próprio, com a janela da chamada ampliada.
 * Ana liga a câmera e compartilha a tela; Beto e Caio ligam a câmera. Duas fases de 25 s: rede boa para todos, depois rede
 * ruim só para o Caio (4G fraco: 80 ms ± 20, 2% de perda, 1,5 Mbit/s de subida e 2 de descida).
 * Sai uma tabela com resolução, fps, bitrate e atraso medido de verdade (relógio no vídeo).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGE = 'escritorio-medicao';
const NOMES = ['Ana', 'Beto', 'Caio'] as const;
const FASE_MS = 25_000;
const ROTULO = process.env.MEDICAO ?? 'medicao';
const RUIM = 'Caio';

const docker = (...args: string[]) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Rede ruim no contêiner: atraso, perda e banda limitada na subida (netem) e descida (police). */
function redeRuim(container: string) {
  docker(
    'exec',
    container,
    'sh',
    '-c',
    [
      'tc qdisc add dev eth0 root netem delay 80ms 20ms distribution normal loss 2% rate 1500kbit',
      'tc qdisc add dev eth0 handle ffff: ingress',
      'tc filter add dev eth0 parent ffff: protocol ip u32 match u32 0 0 police rate 2mbit burst 64k drop flowid :1',
    ].join(' && '),
  );
}

interface Snap {
  t: number;
  /** Por pessoa que manda: bytes de vídeo enviados (soma das conexões) e as codificações agora. */
  out: { bytes: number; enc: string[]; limit: string[] };
  /** Bytes de vídeo recebidos (soma) e congelamentos. */
  inBytes: number;
  freezes: number;
  /** Quadros vistos por vídeo (nome [tipo]) e a resolução de cada vídeo agora. */
  frames: Record<string, number>;
  res: Record<string, string>;
  rtt: number[];
}

/** Lê as estatísticas da página (todas as conexões WebRTC) e o que a sonda contou. */
async function snap(page: Page): Promise<Snap> {
  return page.evaluate(async () => {
    const w = window as unknown as {
      __pcs: RTCPeerConnection[];
      __frames: Record<string, number>;
    };
    const out = { bytes: 0, enc: [] as string[], limit: [] as string[] };
    let inBytes = 0;
    let freezes = 0;
    const rtt: number[] = [];
    for (const pc of w.__pcs) {
      if (pc.connectionState === 'closed') continue;
      const stats = await pc.getStats();
      stats.forEach((s: Record<string, unknown>) => {
        if (s.type === 'outbound-rtp' && s.kind === 'video') {
          out.bytes += Number(s.bytesSent ?? 0);
          if (s.frameWidth) {
            out.enc.push(
              `${String(s.frameWidth)}x${String(s.frameHeight)}@${Math.round(Number(s.framesPerSecond ?? 0))}`,
            );
          }
          const reason = String(s.qualityLimitationReason ?? 'none');
          if (reason !== 'none') out.limit.push(reason);
        }
        if (s.type === 'inbound-rtp' && s.kind === 'video') {
          inBytes += Number(s.bytesReceived ?? 0);
          freezes += Number(s.freezeCount ?? 0);
        }
        if (s.type === 'candidate-pair' && s.nominated && s.currentRoundTripTime !== undefined) {
          rtt.push(Number(s.currentRoundTripTime) * 1000);
        }
      });
    }
    const res: Record<string, string> = {};
    document
      .querySelectorAll<HTMLVideoElement>('.call-tile video, .call-pip video')
      .forEach((v) => {
        const tile = v.closest('.call-tile');
        if (!tile || tile.classList.contains('mine') || !v.videoWidth) return;
        const nome = (tile.querySelector('figcaption span')?.textContent ?? '?')
          .trim()
          .replace(/ · tela$/, '');
        const kind = v.dataset.kind ?? (tile.classList.contains('screen') ? 'screen' : 'cam');
        res[`${nome} [${kind === 'screen' ? 'tela' : 'câmera'}]`] =
          `${v.videoWidth}x${v.videoHeight}`;
      });
    return { t: Date.now(), out, inBytes, freezes, frames: { ...w.__frames }, res, rtt };
  });
}

const takeLat = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __lat: Record<string, number[]> };
    const lat = w.__lat;
    w.__lat = {};
    return lat;
  });

const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

interface Linha {
  quem: string;
  video: string;
  res: string;
  fps: number;
  atrasoMediana: number;
  atrasoP95: number;
}
interface Fase {
  nome: string;
  envio: {
    quem: string;
    kbps: number;
    enc: string;
    limite: string;
    captura: string;
    cpu: string;
  }[];
  recebe: { quem: string; kbps: number; congelamentos: number; rtt: number }[];
  videos: Linha[];
}

/** Processador de cada contêiner agora (100% = um núcleo inteiro). */
function cpus(): Record<string, string> {
  const out = docker('stats', '--no-stream', '--format', '{{.Name}} {{.CPUPerc}}');
  return Object.fromEntries(out.split('\n').map((l) => l.split(' ') as [string, string]));
}

async function fase(nome: string, people: Person[], short: Map<string, string>): Promise<Fase> {
  const a = await Promise.all(people.map((p) => snap(p.page)));
  await Promise.all(people.map((p) => takeLat(p.page)));
  await new Promise((r) => setTimeout(r, FASE_MS / 2));
  const cpu = cpus();
  await new Promise((r) => setTimeout(r, FASE_MS / 2));
  const b = await Promise.all(people.map((p) => snap(p.page)));
  const lats = await Promise.all(people.map((p) => takeLat(p.page)));
  const curto = (s: string) => {
    for (const [full, nick] of short) s = s.replace(full, nick);
    return s;
  };
  const out: Fase = { nome, envio: [], recebe: [], videos: [] };
  people.forEach((p, i) => {
    const s0 = a[i]!;
    const s1 = b[i]!;
    const dt = (s1.t - s0.t) / 1000;
    const quem = short.get(p.name)!;
    const captura = Object.entries(s1.frames)
      .filter(([k]) => k.startsWith('__eu'))
      .map(([k, f]) => `${k.slice(5)} ${Math.round((f - (s0.frames[k] ?? 0)) / dt)}`)
      .join(', ');
    out.envio.push({
      quem,
      kbps: Math.round(((s1.out.bytes - s0.out.bytes) * 8) / dt / 1000),
      enc: s1.out.enc.join(', ') || '—',
      limite: [...new Set(s1.out.limit)].join(', ') || '—',
      captura: captura || '—',
      cpu: cpu[containers[i]!] ?? '?',
    });
    out.recebe.push({
      quem,
      kbps: Math.round(((s1.inBytes - s0.inBytes) * 8) / dt / 1000),
      congelamentos: s1.freezes - s0.freezes,
      rtt: Math.round(pct(s1.rtt, 50)),
    });
    for (const [video, frames] of Object.entries(s1.frames)) {
      if (video.startsWith('__eu')) continue;
      const lat = lats[i]![video] ?? [];
      out.videos.push({
        quem,
        video: curto(video),
        res: s1.res[video] ?? '—',
        fps: Math.round((frames - (s0.frames[video] ?? 0)) / dt),
        atrasoMediana: Math.round(pct(lat, 50)),
        atrasoP95: Math.round(pct(lat, 95)),
      });
    }
  });
  return out;
}

function markdown(fases: Fase[]): string {
  const l: string[] = [`# Medição das chamadas: ${ROTULO}`, ''];
  for (const f of fases) {
    l.push(
      `## ${f.nome}`,
      '',
      '| Quem manda | Captura (fps) | Upload de vídeo | Codificações agora | Limitado por | CPU |',
    );
    l.push('|---|---|---|---|---|---|');
    for (const e of f.envio) {
      l.push(`| ${e.quem} | ${e.captura} | ${e.kbps} kbps | ${e.enc} | ${e.limite} | ${e.cpu} |`);
    }
    l.push('', '| Quem recebe | Download de vídeo | Congelamentos | RTT |', '|---|---|---|---|');
    for (const r of f.recebe) {
      l.push(`| ${r.quem} | ${r.kbps} kbps | ${r.congelamentos} | ${r.rtt} ms |`);
    }
    l.push('', '| Quem vê | Vídeo de | Resolução | fps | Atraso (mediana) | Atraso (p95) |');
    l.push('|---|---|---|---|---|---|');
    for (const v of f.videos.sort((x, y) => x.quem.localeCompare(y.quem))) {
      l.push(
        `| ${v.quem} | ${v.video} | ${v.res} | ${v.fps} | ${v.atrasoMediana} ms | ${v.atrasoP95} ms |`,
      );
    }
    l.push('');
  }
  return l.join('\n');
}

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

const containers = NOMES.map((n) => `medicao-${n.toLowerCase()}`);
/** Rede própria: os navegadores falam com o servidor de mídia direto, pelo IP do contêiner. */
const REDE = 'medicao';
const LIVEKIT = 'medicao-livekit';
const LIVEKIT_IP = '172.30.0.10';
const browsers: Browser[] = [];

test.beforeAll(async () => {
  test.setTimeout(600_000);
  docker('build', '-q', '-t', IMAGE, HERE);
  for (const c of [...containers, LIVEKIT]) {
    try {
      docker('rm', '-f', c);
    } catch {
      /* não existia */
    }
  }
  try {
    docker('network', 'create', '--subnet', '172.30.0.0/24', REDE);
  } catch {
    /* já existe */
  }
  // Servidor de mídia (LiveKit, modo de desenvolvimento), anunciando o IP dele nesta rede.
  docker(
    'run',
    '-d',
    '--rm',
    '--name',
    LIVEKIT,
    '--network',
    REDE,
    '--ip',
    LIVEKIT_IP,
    '-p',
    '7880:7880',
    'livekit/livekit-server:v1.13.9',
    '--dev',
    '--bind',
    '0.0.0.0',
    '--node-ip',
    LIVEKIT_IP,
  );
  containers.forEach((c, i) => {
    docker(
      'run',
      '-d',
      '--rm',
      '--init',
      '--network',
      REDE,
      '--cap-add',
      'NET_ADMIN',
      // O Chrome precisa de memória compartilhada; e o teto evita que um navegador pesado
      // derrube o Docker inteiro.
      '--shm-size',
      '512m',
      '--memory',
      '1500m',
      '--add-host',
      'host.docker.internal:host-gateway',
      '--name',
      c,
      '-e',
      `LIVEKIT_HOST=${LIVEKIT_IP}`,
      '-p',
      `${3101 + i}:3000`,
      IMAGE,
    );
  });
  for (let i = 0; i < containers.length; i++) {
    const ws = `ws://127.0.0.1:${3101 + i}/`;
    for (let tries = 0; ; tries++) {
      try {
        browsers.push(await chromium.connect(ws));
        break;
      } catch (err) {
        if (tries > 30) throw err;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }
});

test.afterAll(async () => {
  await Promise.all(browsers.map((b) => b.close().catch(() => undefined)));
  for (const c of [...containers, LIVEKIT]) {
    try {
      docker('rm', '-f', c);
    } catch {
      /* já foi */
    }
  }
});

test('medição: 3 pessoas, câmera e tela, rede boa e rede ruim', async () => {
  test.setTimeout(600_000);
  const people: Person[] = [];
  for (let i = 0; i < NOMES.length; i++) {
    const p = await newPerson(browsers[i]!, NOMES[i]!);
    p.page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') console.log(`[${NOMES[i]}] ${m.text()}`);
    });
    p.page.on('pageerror', (e) => console.log(`[${NOMES[i]}] erro: ${e.message}`));
    await p.page.addInitScript(sonda);
    await p.page.reload();
    // Sem contexto seguro não há microfone nem câmera: melhor parar já com a causa.
    expect(await p.page.evaluate(() => [isSecureContext, Boolean(navigator.mediaDevices)])).toEqual(
      [true, true],
    );
    await expect(p.page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
    people.push(p);
  }
  const [ana, beto, caio] = people as [Person, Person, Person];
  const short = new Map(people.map((p, i) => [p.name, NOMES[i]!]));
  await walk(beto.page, 6, 17);
  await walk(caio.page, 9, 17);
  await invite(ana.page, beto, false);
  await expect(ana.page.locator('.call-tile')).toHaveCount(2, { timeout: 20_000 });
  await invite(ana.page, caio, true);
  for (const p of people) await expect(p.page.locator('.call-tile')).toHaveCount(3);
  // Janela ampliada: quadros grandes, como numa conversa de verdade.
  for (const p of people) await p.page.getByRole('button', { name: 'Ampliar' }).click();

  for (const p of people) {
    await p.page.getByRole('button', { name: 'Câmera', exact: true }).click();
  }
  await ana.page.getByRole('button', { name: 'Tela', exact: true }).click();
  // Escolha de nitidez/fluidez (se a versão tiver): fica na automática.
  await ana.page
    .getByRole('dialog')
    .getByRole('button', { name: 'Compartilhar' })
    .click({ timeout: 3000 })
    .catch(() => undefined);
  // Tempo para a qualidade subir (o controle de banda começa baixo).
  await new Promise((r) => setTimeout(r, 15_000));

  const fases: Fase[] = [];
  fases.push(await fase('Rede boa para todos', people, short));
  // Ana e Caio destacam a câmera do Beto (quadro grande): a qualidade dela deve subir.
  for (const p of [ana, caio]) {
    await p.page.getByRole('button', { name: `Destacar ${beto.name}` }).click();
  }
  await new Promise((r) => setTimeout(r, 8_000));
  fases.push(await fase('Rede boa, câmera do Beto em destaque', people, short));
  for (const p of [ana, caio]) {
    await p.page.getByRole('button', { name: 'Voltar à grade' }).click();
  }
  redeRuim(containers[NOMES.indexOf(RUIM)]!);
  await new Promise((r) => setTimeout(r, 5_000));
  fases.push(await fase(`Rede ruim só para o ${RUIM}`, people, short));

  // Fora do e2e-results (o Playwright limpa aquela pasta a cada rodada).
  const dir = join(HERE, 'resultados');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `medicao-${ROTULO}.json`), JSON.stringify(fases, null, 2));
  writeFileSync(join(dir, `medicao-${ROTULO}.md`), markdown(fases));
  console.log(markdown(fases));
});
