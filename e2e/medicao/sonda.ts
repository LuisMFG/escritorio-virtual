/**
 * Sonda que roda dentro de cada navegador da medição (via `addInitScript`).
 *
 * - Câmera e tela viram canvas com conteúdo realista (movimento, texto) e um relógio em blocos
 *   no canto: quem recebe lê o relógio de cada quadro e mede o atraso de verdade, da captura até
 *   o quadro na tela. Todos os navegadores rodam na mesma máquina (mesmo relógio).
 * - Guarda as conexões WebRTC para ler as estatísticas (bitrate, resolução, fps, motivo de
 *   limitação) sem mexer no código do app.
 */
export function sonda(): void {
  type W = Window & {
    __pcs: RTCPeerConnection[];
    __lat: Record<string, number[]>;
    __frames: Record<string, number>;
    __tela?: { movendo: boolean };
  };
  const w = window as unknown as W;
  w.__pcs = [];
  w.__lat = {};
  w.__frames = {};

  const Orig = window.RTCPeerConnection;
  window.RTCPeerConnection = function (this: unknown, cfg?: RTCConfiguration) {
    const pc = new Orig(cfg);
    w.__pcs.push(pc);
    return pc;
  } as unknown as typeof RTCPeerConnection;
  window.RTCPeerConnection.prototype = Orig.prototype;
  Object.setPrototypeOf(window.RTCPeerConnection, Orig);

  // 2 linhas de 16 blocos = 32 bits do relógio (ms), mais 2 blocos de referência (preto/branco).
  const BITS = 32;
  const COLS = 17;
  const desenhaRelogio = (ctx: CanvasRenderingContext2D, w0: number) => {
    const b = Math.floor(w0 / 24);
    const t = Date.now() >>> 0;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, b * COLS, b * 2);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, b, b); // referência branca (0,0); preta em (0,1)
    for (let i = 0; i < BITS; i++) {
      if ((t >>> i) & 1) ctx.fillRect(b * (1 + (i % 16)), b * Math.floor(i / 16), b, b);
    }
  };

  const num = (v: unknown, def: number): number => {
    if (typeof v === 'number') return v;
    if (v && typeof v === 'object') {
      const o = v as { exact?: number; ideal?: number; max?: number };
      return o.exact ?? o.ideal ?? o.max ?? def;
    }
    return def;
  };

  const canvasStream = (
    width: number,
    height: number,
    fps: number,
    desenha: (ctx: CanvasRenderingContext2D, f: number) => void,
  ): MediaStream => {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d')!;
    let f = 0;
    // setInterval segue rodando com a aba em segundo plano (o requestAnimationFrame pararia).
    setInterval(() => {
      desenha(ctx, f++);
      desenhaRelogio(ctx, width);
    }, 1000 / fps);
    desenha(ctx, 0);
    return c.captureStream(fps);
  };

  /** Câmera: cena com movimento (como uma pessoa mexendo), na resolução pedida. */
  const camera = (width: number, height: number, fps: number) =>
    canvasStream(width, height, fps, (ctx, f) => {
      const g = ctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, `hsl(${(f * 2) % 360} 50% 35%)`);
      g.addColorStop(1, `hsl(${(f * 2 + 120) % 360} 50% 55%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      // "Rosto": um círculo que balança, com detalhe fino (textura) para pesar como vídeo real.
      const cx = width / 2 + Math.sin(f / 9) * width * 0.08;
      const cy = height / 2 + Math.cos(f / 13) * height * 0.05;
      ctx.fillStyle = '#e8b796';
      ctx.beginPath();
      ctx.arc(cx, cy, height * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let i = 0; i < 400; i++) {
        const x = (Math.sin(i * 12.9898 + f * 0.3) * 43758.5453) % 1;
        const y = (Math.sin(i * 78.233 + f * 0.2) * 12345.678) % 1;
        ctx.fillRect(Math.abs(x) * width, Math.abs(y) * height, 3, 3);
      }
    });

  /** Tela: código parado (texto pequeno) e, quando `__tela.movendo`, rolagem contínua. */
  const tela = (width: number, height: number, fps: number) => {
    w.__tela = { movendo: false };
    let scroll = 0;
    return canvasStream(width, height, fps, (ctx) => {
      if (w.__tela!.movendo) scroll += 6;
      ctx.fillStyle = '#1e1e1e';
      ctx.fillRect(0, 0, width, height);
      ctx.font = '14px monospace';
      const linha = 19;
      const first = Math.floor(scroll / linha);
      for (let i = 0; i < height / linha + 1; i++) {
        const n = first + i;
        ctx.fillStyle = n % 7 === 0 ? '#c586c0' : n % 3 === 0 ? '#4ec9b0' : '#d4d4d4';
        ctx.fillText(
          `${String(n).padStart(4)}  const valor${n} = calcula(${n}, 'texto de exemplo ${n}') // linha ${n}`,
          60,
          40 + i * linha - (scroll % linha),
        );
      }
    });
  };

  const md = navigator.mediaDevices;
  const origUser = md.getUserMedia.bind(md);
  md.getUserMedia = async (c?: MediaStreamConstraints) => {
    if (!c?.video) return origUser(c);
    const v = (typeof c.video === 'object' ? c.video : {}) as MediaTrackConstraints;
    const stream = camera(num(v.width, 640), num(v.height, 480), num(v.frameRate, 30));
    if (c.audio)
      for (const t of (await origUser({ audio: c.audio })).getTracks()) stream.addTrack(t);
    return stream;
  };
  md.getDisplayMedia = async (c?: DisplayMediaStreamOptions) => {
    const v = (typeof c?.video === 'object' ? c.video : {}) as MediaTrackConstraints;
    return tela(1920, 1080, num(v.frameRate, 30));
  };

  // Quem recebe: lê o relógio de cada quadro de cada vídeo de outra pessoa.
  const leitor = document.createElement('canvas');
  const lctx = leitor.getContext('2d', { willReadFrequently: true })!;
  const nomeDe = (v: HTMLVideoElement): string | null => {
    const tile = v.closest('.call-tile');
    if (!tile) return null;
    const kindOf = v.dataset.kind || (tile.classList.contains('screen') ? 'screen' : 'cam');
    // A própria prévia: conta os quadros da captura (para separar câmera lenta de rede lenta).
    if (tile.classList.contains('mine')) return `__eu ${kindOf === 'screen' ? 'tela' : 'câmera'}`;
    const nome = tile.querySelector('figcaption span')?.textContent?.trim() ?? '?';
    return `${nome.replace(/ · tela$/, '')} [${kindOf === 'screen' ? 'tela' : 'câmera'}]`;
  };
  const lendo = new WeakSet<HTMLVideoElement>();
  const ler = (v: HTMLVideoElement) => {
    if (lendo.has(v)) return;
    lendo.add(v);
    const passo = () => {
      const nome = nomeDe(v);
      if (nome && v.videoWidth > 0) {
        w.__frames[nome] = (w.__frames[nome] ?? 0) + 1;
      }
      if (nome && !nome.startsWith('__eu') && v.videoWidth > 0) {
        const b = v.videoWidth / 24;
        leitor.width = Math.ceil(b * COLS);
        leitor.height = Math.ceil(b * 2);
        lctx.drawImage(v, 0, 0, leitor.width, leitor.height, 0, 0, leitor.width, leitor.height);
        const lum = (bx: number, by: number) => {
          const d = lctx.getImageData(
            Math.floor(bx * b + b / 2),
            Math.floor(by * b + b / 2),
            1,
            1,
          ).data;
          return (d[0]! + d[1]! + d[2]!) / 3;
        };
        const meio = (lum(0, 0) + lum(0, 1)) / 2;
        let t = 0;
        for (let i = 0; i < BITS; i++)
          if (lum(1 + (i % 16), Math.floor(i / 16)) > meio) t |= 1 << i;
        const atraso = ((Date.now() >>> 0) - (t >>> 0)) >>> 0;
        if (atraso < 10_000) (w.__lat[nome] ??= []).push(atraso);
      }
      if (v.isConnected) v.requestVideoFrameCallback(passo);
      else lendo.delete(v);
    };
    v.requestVideoFrameCallback(passo);
  };
  setInterval(() => document.querySelectorAll('video').forEach(ler), 500);
}
