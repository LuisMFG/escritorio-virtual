// Servidor de mídia das chamadas (LiveKit) em desenvolvimento e nos testes: `livekit-server
// --dev` (chave "devkey", segredo "secret", porta 7880). Instale com `brew install livekit` (ou
// veja https://docs.livekit.io/home/self-hosting/local/). Sem ele, o resto do escritório sobe
// normal e só as chamadas ficam sem áudio e vídeo.
import { spawn, spawnSync } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';
import { setInterval } from 'node:timers';

const args = ['--dev', '--bind', process.env.LIVEKIT_BIND ?? '127.0.0.1'];
if (process.env.LIVEKIT_NODE_IP) args.push('--node-ip', process.env.LIVEKIT_NODE_IP);

const found = spawnSync('livekit-server', ['--version'], { stdio: 'ignore' }).status === 0;
if (!found) {
  console.warn(
    '[livekit] livekit-server não encontrado: as chamadas não vão ligar áudio e vídeo. ' +
      'Instale com `brew install livekit`.',
  );
  // Fica de pé para não derrubar os outros processos do `npm run dev`.
  setInterval(() => undefined, 1 << 30);
} else {
  const child = spawn('livekit-server', args, { stdio: ['ignore', 'inherit', 'inherit'] });
  const stop = () => child.kill('SIGTERM');
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code) => process.exit(code ?? 0));
}
