import type { Ambient } from '@office/shared';

const KEY = 'escritorio.ambiente';

interface Saved {
  on: boolean;
  volume: number;
}

/**
 * Som ambiente da sala, gerado na hora com WebAudio (sem arquivos de áudio: nada de licença
 * para registrar). Escritório = zumbido grave + teclas de vez em quando; cafeteria = burburinho
 * + xícaras; chuva = ruído filtrado + pingos. Desligado por padrão; volume salvo no navegador.
 */
export class AmbientSound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private stopCurrent: (() => void) | null = null;
  private ambient: Ambient = 'none';
  /** Jukebox ligada na sala (Fase 37): toca música no lugar do ambiente. */
  private jukebox = false;
  private saved: Saved;

  constructor() {
    let saved: Saved = { on: false, volume: 0.5 };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) saved = { ...saved, ...(JSON.parse(raw) as Partial<Saved>) };
    } catch {
      // sem armazenamento: começa desligado
    }
    this.saved = saved;
    // Navegadores só deixam tocar depois de um gesto: retoma no primeiro clique.
    if (saved.on) {
      const resume = () => {
        void this.ctx?.resume();
        this.apply();
        document.removeEventListener('pointerdown', resume);
      };
      document.addEventListener('pointerdown', resume);
    }
  }

  get enabled(): boolean {
    return this.saved.on;
  }

  get volume(): number {
    return this.saved.volume;
  }

  get current(): Ambient {
    return this.ambient;
  }

  setEnabled(on: boolean): void {
    this.saved.on = on;
    this.save();
    this.apply();
  }

  setVolume(v: number): void {
    this.saved.volume = Math.min(1, Math.max(0, v));
    this.save();
    if (this.master) this.master.gain.value = this.saved.volume * 0.35;
  }

  /** A sala atual mudou (ou o ambiente dela foi editado). */
  setAmbient(ambient: Ambient): void {
    if (ambient === this.ambient) return;
    this.ambient = ambient;
    this.apply();
  }

  /** Alguma jukebox da sala está ligada? */
  setJukebox(on: boolean): void {
    if (on === this.jukebox) return;
    this.jukebox = on;
    this.apply();
  }

  get jukeboxOn(): boolean {
    return this.jukebox;
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.saved));
    } catch {
      // vale só nesta visita
    }
  }

  private apply(): void {
    this.stopCurrent?.();
    this.stopCurrent = null;
    if (!this.saved.on || (this.ambient === 'none' && !this.jukebox)) return;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    void this.ctx.resume();
    this.master!.gain.value = this.saved.volume * 0.35;
    this.stopCurrent = this.jukebox
      ? jukeboxMusic(this.ctx, this.master!)
      : GENERATORS[this.ambient as Exclude<Ambient, 'none'>](this.ctx, this.master!);
  }
}

type Generator = (ctx: AudioContext, out: AudioNode) => () => void;

/** Ruído em loop (branco, rosa ou marrom), 4 s. */
function noise(ctx: AudioContext, kind: 'white' | 'pink' | 'brown'): AudioBufferSourceNode {
  const len = ctx.sampleRate * 4;
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (kind === 'white') data[i] = white;
    else if (kind === 'brown') {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    } else {
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.95 * b2 + white * 0.048;
      data[i] = (b0 + b1 + b2 + white * 0.02) * 0.9;
    }
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  return src;
}

function filter(
  ctx: AudioContext,
  type: BiquadFilterType,
  freq: number,
  q = 0.7,
): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function gain(ctx: AudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

/** Som curto (clique, pingo, tilintar) com envelope rápido. */
function blip(
  ctx: AudioContext,
  out: AudioNode,
  opts: { freq: number; type?: OscillatorType; dur: number; vol: number; noisy?: boolean },
): void {
  const t = ctx.currentTime;
  const env = gain(ctx, 0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(opts.vol, t + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
  env.connect(out);
  if (opts.noisy) {
    const n = noise(ctx, 'white');
    const f = filter(ctx, 'bandpass', opts.freq, 3);
    n.connect(f).connect(env);
    n.start(t);
    n.stop(t + opts.dur + 0.05);
  } else {
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.value = opts.freq;
    o.connect(env);
    o.start(t);
    o.stop(t + opts.dur + 0.05);
  }
}

/** Repete `fn` em intervalos aleatórios entre `min` e `max` ms até parar. */
function every(min: number, max: number, fn: () => void): () => void {
  let timer = 0;
  const tick = () => {
    fn();
    timer = window.setTimeout(tick, min + Math.random() * (max - min));
  };
  timer = window.setTimeout(tick, min + Math.random() * (max - min));
  return () => clearTimeout(timer);
}

const GENERATORS: Record<Exclude<Ambient, 'none'>, Generator> = {
  office: (ctx, out) => {
    const hum = noise(ctx, 'brown');
    hum
      .connect(filter(ctx, 'lowpass', 260))
      .connect(gain(ctx, 0.5))
      .connect(out);
    hum.start();
    // Rajadas de teclado: alguns cliques seguidos, de tempos em tempos.
    const stopKeys = every(900, 4500, () => {
      const n = 3 + Math.floor(Math.random() * 10);
      for (let i = 0; i < n; i++) {
        window.setTimeout(
          () =>
            blip(ctx, out, {
              freq: 2500 + Math.random() * 1500,
              dur: 0.03,
              vol: 0.12,
              noisy: true,
            }),
          i * (70 + Math.random() * 90),
        );
      }
    });
    return () => {
      hum.stop();
      stopKeys();
    };
  },
  cafe: (ctx, out) => {
    const murmur = noise(ctx, 'pink');
    const band = filter(ctx, 'bandpass', 600, 0.5);
    const level = gain(ctx, 0.45);
    // Burburinho que sobe e desce devagar.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.15;
    const depth = gain(ctx, 0.15);
    lfo.connect(depth).connect(level.gain);
    murmur.connect(band).connect(level).connect(out);
    murmur.start();
    lfo.start();
    const stopCups = every(2500, 9000, () => {
      blip(ctx, out, { freq: 2200 + Math.random() * 900, type: 'triangle', dur: 0.35, vol: 0.06 });
    });
    return () => {
      murmur.stop();
      lfo.stop();
      stopCups();
    };
  },
  rain: (ctx, out) => {
    const rain = noise(ctx, 'white');
    rain
      .connect(filter(ctx, 'highpass', 900))
      .connect(filter(ctx, 'lowpass', 7000))
      .connect(gain(ctx, 0.28))
      .connect(out);
    rain.start();
    const stopDrops = every(120, 700, () => {
      blip(ctx, out, { freq: 1200 + Math.random() * 2500, dur: 0.06, vol: 0.05, noisy: true });
    });
    return () => {
      rain.stop();
      stopDrops();
    };
  },
};

/** Acordes do loop da jukebox (lo-fi: Dó7M, Lá m7, Ré m7, Sol7), em Hz. */
const CHORDS = [
  [261.63, 329.63, 392.0, 493.88],
  [220.0, 261.63, 329.63, 392.0],
  [293.66, 349.23, 440.0, 523.25],
  [196.0, 246.94, 293.66, 349.23],
];

/**
 * Música da jukebox, gerada na hora: acordes suaves, baixo, batida e um arpejo, 84 batidas por
 * minuto (como o resto do som ambiente, sem arquivos de áudio).
 */
function jukeboxMusic(ctx: AudioContext, out: AudioNode): () => void {
  const beat = 60 / 84;
  const level = gain(ctx, 0.9);
  level.connect(out);
  let next = ctx.currentTime + 0.1;
  let bar = 0;
  const note = (freq: number, t: number, dur: number, vol: number, type: OscillatorType) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const env = gain(ctx, 0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vol, t + 0.03);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(env).connect(level);
    o.start(t);
    o.stop(t + dur + 0.05);
  };
  const hit = (t: number, freq: number, dur: number, vol: number) => {
    const n = noise(ctx, 'white');
    const env = gain(ctx, 0);
    env.gain.setValueAtTime(vol, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(filter(ctx, freq > 1000 ? 'highpass' : 'lowpass', freq))
      .connect(env)
      .connect(level);
    n.start(t);
    n.stop(t + dur + 0.05);
  };
  // Agenda um compasso (4 batidas) por vez, sempre um pouco à frente.
  const schedule = () => {
    while (next < ctx.currentTime + 1.5) {
      const chord = CHORDS[bar % CHORDS.length]!;
      for (const f of chord) note(f, next, beat * 4, 0.05, 'triangle');
      note(chord[0]! / 2, next, beat * 1.5, 0.16, 'sine');
      note(chord[0]! / 2, next + beat * 2, beat * 1.5, 0.14, 'sine');
      for (let i = 0; i < 4; i++) {
        const t = next + i * beat;
        if (i % 2 === 0) note(55, t, 0.25, 0.3, 'sine');
        else hit(t, 1800, 0.12, 0.12);
        hit(t + beat / 2, 6000, 0.05, 0.05);
        note(chord[(i + bar) % 4]! * 2, t + beat / 2, beat * 0.6, 0.03, 'sine');
      }
      next += beat * 4;
      bar++;
    }
  };
  schedule();
  const timer = window.setInterval(schedule, 500);
  return () => {
    clearInterval(timer);
    level.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    window.setTimeout(() => level.disconnect(), 400);
  };
}
