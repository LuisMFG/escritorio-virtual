import {
  ACTIVITY_TTL_MS,
  CODE_SHARE,
  codingText,
  musicText,
  type NowPlaying,
  type CodeShare,
  type CodingActivity,
  editorHeartbeatSchema,
  type EditorHeartbeat,
} from '@office/shared';
import { EventEmitter } from 'node:events';
import type { UserService } from './UserService.js';

interface Coding extends CodingActivity {
  at: number;
}

/**
 * Atividade de cada pessoa fora do escritório, só em memória (some ao reiniciar, e a extensão
 * manda de novo em até um minuto). `changed` avisa salas e lobby para atualizar o texto.
 */
export class ActivityService {
  readonly events = new EventEmitter<{ changed: [userId: string] }>();
  private readonly coding = new Map<string, Coding>();
  private readonly music = new Map<string, NowPlaying & { at: number }>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly users: UserService,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.events.setMaxListeners(100);
  }

  /** Sinal de um editor (o mais recente vale, se a pessoa tiver mais de um aberto). */
  editor(userId: string, input: EditorHeartbeat): void {
    const hb = editorHeartbeatSchema.parse(input);
    const before = this.text(userId);
    if (hb.state === 'active') {
      this.coding.set(userId, {
        editor: hb.editor,
        language: hb.language,
        project: hb.project,
        at: this.now(),
      });
    } else {
      this.coding.delete(userId);
    }
    if (this.text(userId) !== before) this.events.emit('changed', userId);
  }

  /** Música tocando agora (`null` = parou ou escondeu). */
  setMusic(userId: string, playing: NowPlaying | null): void {
    const before = `${this.text(userId)}|${this.url(userId)}`;
    if (playing) this.music.set(userId, { ...playing, at: this.now() });
    else this.music.delete(userId);
    if (`${this.text(userId)}|${this.url(userId)}` !== before) this.events.emit('changed', userId);
  }

  /** Texto para o cartão, já com a privacidade da pessoa (`''` = nada). Uma atividade por linha. */
  text(userId: string): string {
    const lines: string[] = [];
    const c = this.coding.get(userId);
    if (c) lines.push(codingText(c, this.shareOf(userId)));
    const m = this.music.get(userId);
    if (m) lines.push(musicText(m));
    return lines.filter(Boolean).join('\n');
  }

  /** Link da música (linha 🎵), se houver. */
  url(userId: string): string {
    return this.music.get(userId)?.url ?? '';
  }

  /** A pessoa mudou a privacidade: o texto pode mudar. */
  refresh(userId: string): void {
    this.events.emit('changed', userId);
  }

  /** Tira quem parou de mandar sinal. */
  sweep(): void {
    const limit = this.now() - ACTIVITY_TTL_MS;
    for (const map of [this.coding, this.music] as Map<string, { at: number }>[]) {
      for (const [userId, c] of map) {
        if (c.at >= limit) continue;
        map.delete(userId);
        this.events.emit('changed', userId);
      }
    }
  }

  start(everyMs = 30_000): void {
    this.timer = setInterval(() => this.sweep(), everyMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private shareOf(userId: string): CodeShare {
    const share = this.users.findById(userId)?.codeShare;
    return (CODE_SHARE as readonly string[]).includes(share ?? '')
      ? (share as CodeShare)
      : 'language';
  }
}
