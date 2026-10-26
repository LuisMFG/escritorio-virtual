import type {
  CallInvite,
  CallInviteResult,
  CallMedia,
  CallState,
  CallToken,
  IceServer,
} from '@office/shared';
import type * as Livekit from 'livekit-client';
import type {
  ConnectionQuality,
  DisconnectReason,
  LocalAudioTrack,
  LocalTrackPublication,
  Participant,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  TrackPublishOptions,
  VideoPreset,
  VideoQuality,
} from 'livekit-client';
import { SPEAKING_LEVEL } from '../ui/callFace.js';
import { BackgroundBlur } from './backgroundBlur.js';
import {
  loadCallPrefs,
  saveCallPrefs,
  type CallPrefs,
  type CallQuality,
  type ScreenMode,
} from './callPrefs.js';
import type { LobbyConnection } from './LobbyConnection.js';

/**
 * O cliente do servidor de mídia é um terço do código da página: baixado só quando alguém usa
 * a chamada (conectar, câmera, tela), não ao abrir o escritório.
 */
let lk: typeof Livekit | null = null;
let lkLoading: Promise<typeof Livekit> | null = null;
export function loadLivekit(): Promise<typeof Livekit> {
  lkLoading ??= import('livekit-client').then((m) => {
    // Só avisos e erros do servidor de mídia no console (o resto é detalhe interno da conexão).
    m.setLogLevel('warn');
    lk = m;
    return m;
  });
  return lkLoading;
}
/** O módulo já carregado (quem chama passou antes por `loadLivekit`, ou há uma sala). */
function L(): typeof Livekit {
  if (!lk) throw new Error('Servidor de mídia ainda não carregado.');
  return lk;
}

/** De quanto em quanto medir o volume (ms): o anel de quem fala e a boca do avatar. */
const LEVEL_EVERY_MS = 100;
/**
 * Quanto do volume da medida anterior sobra na seguinte: um som curto (uma sílaba) segura a
 * boca aberta e o contorno aceso por alguns décimos, em vez de piscar; parando de falar, cai
 * abaixo do limite em meio segundo.
 */
const LEVEL_DECAY = 0.6;
/** Esperas antes de reconectar ao servidor de mídia depois de cair (ms). */
const RECONNECT_MS = [1000, 2000, 5000, 10_000];

/**
 * Câmera e tela em cada qualidade. A câmera sai em até 3 camadas (simulcast): o servidor de
 * mídia entrega a cada pessoa a camada que cabe na conexão e no tamanho do quadro dela, e quem
 * tem conexão boa continua recebendo a maior. A tela tem prioridade alta na banda (a câmera,
 * baixa): com as duas ligadas e a rede apertada, a câmera cede primeiro.
 */
interface QualityPlan {
  cam: { capture: VideoPreset; layers: VideoPreset[] };
  screen: Record<ScreenMode, { maxBitrate: number; fps: number; layers: VideoPreset[] }>;
  /** Camada máxima que pede ao servidor (câmeras e telas dos outros). */
  receive: { cam: VideoQuality; screen: VideoQuality };
}

const cam = (w: number, h: number, kbps: number, fps: number) =>
  new (L().VideoPreset)(w, h, kbps * 1000, fps, 'low');

let plans: Record<CallQuality, QualityPlan> | null = null;
/** Câmera e tela em cada qualidade (montado depois que o servidor de mídia carrega). */
export function qualityPlans(): Record<CallQuality, QualityPlan> {
  plans ??= buildPlans();
  return plans;
}

function buildPlans(): Record<CallQuality, QualityPlan> {
  const { VideoPreset, VideoQuality } = L();
  return {
    auto: {
      cam: {
        capture: cam(1920, 1080, 3000, 30),
        layers: [cam(320, 180, 160, 15), cam(960, 540, 900, 30)],
      },
      screen: {
        nitidez: {
          maxBitrate: 3_000_000,
          fps: 15,
          layers: [new VideoPreset(1280, 720, 800_000, 5, 'high')],
        },
        fluidez: {
          maxBitrate: 4_000_000,
          fps: 30,
          layers: [new VideoPreset(1280, 720, 1_200_000, 15, 'high')],
        },
      },
      receive: { cam: VideoQuality.HIGH, screen: VideoQuality.HIGH },
    },
    alta: {
      cam: {
        capture: cam(1920, 1080, 5000, 30),
        layers: [cam(320, 180, 200, 15), cam(960, 540, 1500, 30)],
      },
      screen: {
        nitidez: {
          maxBitrate: 5_000_000,
          fps: 30,
          layers: [new VideoPreset(1280, 720, 1_200_000, 15, 'high')],
        },
        fluidez: {
          maxBitrate: 6_000_000,
          fps: 60,
          layers: [new VideoPreset(1280, 720, 1_500_000, 30, 'high')],
        },
      },
      receive: { cam: VideoQuality.HIGH, screen: VideoQuality.HIGH },
    },
    economia: {
      cam: {
        capture: cam(640, 360, 400, 24),
        layers: [cam(320, 180, 120, 15)],
      },
      screen: {
        nitidez: {
          maxBitrate: 900_000,
          fps: 5,
          layers: [new VideoPreset(1280, 720, 300_000, 3, 'high')],
        },
        fluidez: {
          maxBitrate: 1_200_000,
          fps: 15,
          layers: [new VideoPreset(1280, 720, 500_000, 10, 'high')],
        },
      },
      receive: { cam: VideoQuality.LOW, screen: VideoQuality.MEDIUM },
    },
  };
}

/** Um vídeo para mostrar: o painel liga e desliga nos elementos (o servidor sabe o tamanho). */
export interface VideoRef {
  /** Identidade estável (para não religar o mesmo vídeo). */
  id: string;
  stream: MediaStream;
  attach(el: HTMLVideoElement): void;
  detach(el: HTMLVideoElement): void;
}

/** Vídeos de alguém na chamada (você também, como prévia): câmera e tela podem vir juntas. */
export interface CallVideo {
  cam?: VideoRef;
  screen?: VideoRef;
}

/** Qualidade da conexão de cada pessoa (o indicador discreto no quadro). */
export type LinkQuality = 'bom' | 'medio' | 'ruim';

/** Uma linha do painel de detalhes: um vídeo (que eu mando ou que eu recebo). */
export interface VideoStat {
  userId: string;
  kind: 'cam' | 'screen';
  direction: 'envio' | 'recebe';
  /** Camadas (simulcast) que saem, ou a única que chega. */
  layers: { width: number; height: number; fps: number }[];
  kbps: number;
  /** Por que o navegador está segurando a qualidade (banda, processador). */
  limit?: string;
  lossPct?: number;
  /** Ida e volta até o servidor de mídia (ms). */
  rttMs?: number;
  /** Atraso estimado do vídeo: rede (ida e volta) + espera para tocar liso (ms). */
  delayMs?: number;
}

export interface CallEvents {
  /** Chamada atual (ou `null`): para o painel. */
  state(state: CallState | null): void;
  invited(invite: CallInvite): void;
  inviteGone(inviteId: string): void;
  result(result: CallInviteResult): void;
  /** Quem está falando agora (ids das contas; inclui você). */
  speaking(userIds: ReadonlySet<string>): void;
  /** Volume de cada um agora (RMS de 0 a 1), a cada 100 ms: a boca do avatar acompanha. */
  levels(levels: ReadonlyMap<string, number>): void;
  /** Vídeos ativos (câmera e/ou tela) por pessoa; o seu entra como prévia. */
  videos(videos: ReadonlyMap<string, CallVideo>): void;
  /** Qualidade da conexão de cada pessoa (inclui você). */
  links(links: ReadonlyMap<string, LinkQuality>): void;
  /** Erro para mostrar (microfone negado, etc.). */
  error(message: string): void;
}

/** Dispositivos do aparelho e os que estão em uso. */
export interface CallDevices {
  mics: MediaDeviceInfo[];
  cams: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
  mic?: string;
  cam?: string;
  speaker?: string;
  /** O navegador deixa escolher a saída de áudio (no Safari e no Firefox, não). */
  canPickSpeaker: boolean;
}

type SinkAudio = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
const canPickSpeaker = () =>
  typeof (HTMLMediaElement.prototype as SinkAudio).setSinkId === 'function';

function linkOf(q: ConnectionQuality): LinkQuality | null {
  const { ConnectionQuality: Q } = L();
  if (q === Q.Excellent) return 'bom';
  if (q === Q.Good) return 'medio';
  if (q === Q.Poor || q === Q.Lost) return 'ruim';
  return null;
}

/** Vídeo meu (prévia): é só pôr o fluxo no elemento. */
function localRef(id: string, stream: MediaStream): VideoRef {
  return {
    id,
    stream,
    attach: (el) => {
      if (el.srcObject !== stream) el.srcObject = stream;
      void el.play().catch(() => undefined);
    },
    detach: (el) => {
      if (el.srcObject === stream) el.srcObject = null;
    },
  };
}

/** Vídeo de outra pessoa: o LiveKit acompanha o tamanho do elemento e pede a camada certa. */
function remoteRef(track: RemoteTrack): VideoRef {
  const stream = new MediaStream([track.mediaStreamTrack]);
  return {
    id: track.sid ?? track.mediaStreamTrack.id,
    stream,
    attach: (el) => {
      if (!track.attachedElements.includes(el)) track.attach(el);
    },
    detach: (el) => {
      track.detach(el);
    },
  };
}

/**
 * Chamadas: o servidor do escritório cuida de quem está em qual chamada (convites, quem entra
 * e sai, mudo/câmera/tela anunciados); o áudio e o vídeo vão por um servidor de mídia (LiveKit,
 * uma SFU). Cada pessoa manda cada trilha uma vez só, em várias camadas, e o servidor entrega a
 * cada um a que cabe na conexão dele: quem tem rede boa não é puxado para baixo por quem tem
 * rede ruim, e a chamada aguenta muita gente.
 */
export class CallManager {
  private current: CallState | null = null;
  private room: Room | null = null;
  /** Chamada a que a sala de mídia está ligada (ou ligando). */
  private roomCall: string | null = null;
  private connecting: Promise<boolean> | null = null;
  private reconnectTry = 0;
  private reconnectTimer = 0;
  private micTrack: LocalAudioTrack | null = null;
  private micPub: LocalTrackPublication | null = null;
  /** O que sai da câmera (com o desfoque, o vídeo já borrado). */
  private cam: MediaStream | null = null;
  private camPub: LocalTrackPublication | null = null;
  /** Desfoque de fundo rodando sobre a câmera. */
  private blur: BackgroundBlur | null = null;
  /** Ligando a câmera (um pedido por vez). */
  private camBusy: Promise<boolean> | null = null;
  private screen: MediaStream | null = null;
  private screenPub: LocalTrackPublication | null = null;
  private prefs: CallPrefs = loadCallPrefs();
  private muted = false;
  private audioCtx: AudioContext | null = null;
  private localLevel: (() => number) | null = null;
  /** Áudio e medidor de volume de cada pessoa (pela identidade, que é o id da conta). */
  private readonly audios = new Map<
    string,
    { el: HTMLAudioElement; level: (() => number) | null }
  >();
  private speakingTimer = 0;
  private speakingNow = new Set<string>();
  /** Volume suavizado de cada um (para o decaimento). */
  private smooth = new Map<string, number>();
  private links = new Map<string, LinkQuality>();

  constructor(
    private readonly lobby: LobbyConnection,
    private readonly myUserId: string,
    private readonly on: CallEvents,
  ) {
    lobby.onCalls({
      invited: (i) => on.invited(i),
      inviteGone: (id) => on.inviteGone(id),
      result: (r) => on.result(r),
      state: (st) => void this.applyState(st),
    });
  }

  get state(): CallState | null {
    return this.current;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get cameraOn(): boolean {
    return Boolean(this.cam);
  }

  get screenOn(): boolean {
    return Boolean(this.screen);
  }

  /** Efeitos escolhidos (valem para as próximas chamadas). */
  get effects(): { blur: boolean; noise: boolean } {
    return { blur: this.prefs.blur, noise: this.prefs.noise };
  }

  get quality(): CallQuality {
    return this.prefs.quality;
  }

  get screenMode(): ScreenMode {
    return this.prefs.screenMode;
  }

  /** O desfoque está de fato no vídeo agora (o navegador conseguiu rodar o recorte). */
  get blurActive(): boolean {
    return Boolean(this.blur);
  }

  /** O vídeo que sai da minha câmera agora (para a prévia dos dispositivos). */
  get cameraStream(): MediaStream | null {
    return this.cam;
  }

  /** Volume do meu microfone agora (0 a 1), para o medidor dos dispositivos. */
  micLevel(): number {
    return this.muted ? 0 : (this.localLevel?.() ?? 0);
  }

  /** Está numa chamada com essa pessoa? */
  hasMember(userId: string): boolean {
    return Boolean(this.current?.members.some((m) => m.userId === userId));
  }

  invite(toUserId: string, reason: string): void {
    this.lobby.callInvite(toUserId, reason);
  }

  answer(inviteId: string, accept: boolean): void {
    this.lobby.callAnswer(inviteId, accept);
  }

  /**
   * Esta aba saiu do escritório (a conta entrou por outra): solta o microfone e a sala de mídia
   * sem avisar o servidor, porque a chamada continua na aba nova.
   */
  async stop(): Promise<void> {
    this.current = null;
    this.on.state(null);
    await this.teardown();
  }

  leave(): void {
    this.lobby.callLeave();
    void this.applyState(null);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.micTrack) void (muted ? this.micTrack.mute() : this.micTrack.unmute());
    this.sendMedia();
  }

  /** Liga/desliga a câmera. Devolve se ficou ligada. */
  async setCamera(on: boolean): Promise<boolean> {
    if (this.camBusy) await this.camBusy;
    if (!on) {
      await this.stopCamera();
      this.afterVideoChange();
      return false;
    }
    if (this.cam) return true;
    this.camBusy = this.openCamera().finally(() => (this.camBusy = null));
    return this.camBusy;
  }

  private async stopCamera(): Promise<void> {
    const pub = this.camPub;
    this.camPub = null;
    if (pub?.track && this.room) {
      await this.room.localParticipant.unpublishTrack(pub.track, false).catch(() => undefined);
    }
    this.blur?.stop();
    this.blur = null;
    for (const t of this.cam?.getTracks() ?? []) t.stop();
    this.cam = null;
  }

  /**
   * Abre a câmera escolhida e, com o desfoque ligado, só manda o vídeo depois de borrar o fundo
   * (o fundo nunca aparece sem querer). Se o navegador não roda o desfoque, manda sem e avisa.
   */
  private async openCamera(): Promise<boolean> {
    await loadLivekit();
    const { capture } = qualityPlans()[this.prefs.quality].cam;
    let raw: MediaStream;
    try {
      const deviceId = this.prefs.cam;
      raw = await navigator.mediaDevices.getUserMedia({
        video: {
          // Teto também: sem ele, a câmera pode mandar a resolução nativa dela (maior).
          width: { ideal: capture.width, max: capture.width },
          height: { ideal: capture.height, max: capture.height },
          frameRate: { ideal: capture.encoding.maxFramerate, max: 30 },
          ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
        },
      });
    } catch {
      this.on.error('Sem acesso à câmera. Libere a câmera para este site e tente de novo.');
      return false;
    }
    const track = raw.getVideoTracks()[0]!;
    track.contentHint = 'motion';
    if (this.prefs.blur) {
      const blur = await BackgroundBlur.start(track);
      if (blur) {
        this.blur = blur;
        this.cam = new MediaStream([blur.track]);
      } else {
        this.on.error('O desfoque de fundo não funcionou neste navegador. A câmera foi sem ele.');
      }
    }
    this.cam ??= raw;
    // Saiu da chamada enquanto a câmera abria.
    if (!this.current?.here) {
      await this.stopCamera();
      return false;
    }
    await this.publishCamera();
    this.afterVideoChange();
    return true;
  }

  private async publishCamera(): Promise<void> {
    await loadLivekit();
    const track = this.cam?.getVideoTracks()[0];
    if (!track || !this.room || this.camPub) return;
    const plan = qualityPlans()[this.prefs.quality].cam;
    const opts: TrackPublishOptions = {
      source: L().Track.Source.Camera,
      simulcast: true,
      videoEncoding: plan.capture.encoding,
      videoSimulcastLayers: plan.layers,
      // Câmera: cai a resolução e o fps juntos, sem congelar.
      degradationPreference: 'balanced',
    };
    try {
      this.camPub = await this.room.localParticipant.publishTrack(track, opts);
    } catch (err) {
      console.warn('[chamada] não consegui mandar a câmera', err);
    }
  }

  /** Desfoque de fundo: salva a escolha e, com a câmera ligada, troca o vídeo na hora. */
  async setBlur(on: boolean): Promise<void> {
    this.prefs = { ...this.prefs, blur: on };
    saveCallPrefs(this.prefs);
    if (this.camBusy) await this.camBusy;
    if (!this.cam || Boolean(this.blur) === on) return;
    await this.stopCamera();
    await this.setCamera(true);
  }

  /** Supressão de ruído: salva a escolha e reabre o microfone com ela (sem cair a chamada). */
  async setNoise(on: boolean): Promise<void> {
    this.prefs = { ...this.prefs, noise: on };
    saveCallPrefs(this.prefs);
    const current = this.micTrack?.mediaStreamTrack;
    if (current) await this.useMic(current.getSettings().deviceId ?? this.prefs.mic ?? '', true);
  }

  /**
   * Qualidade do vídeo: salva e aplica na hora. O que eu mando volta a sair na qualidade nova
   * (câmera e tela republicadas); o que eu recebo passa a pedir a camada certa.
   */
  async setQuality(quality: CallQuality): Promise<void> {
    if (quality === this.prefs.quality) return;
    this.prefs = { ...this.prefs, quality };
    saveCallPrefs(this.prefs);
    this.applyReceiveQuality();
    if (this.camBusy) await this.camBusy;
    if (this.cam) {
      await this.stopCamera();
      await this.setCamera(true);
    }
    if (this.screen) await this.republishScreen();
  }

  /**
   * Compartilha (ou para de compartilhar) a tela. Devolve se ficou compartilhando. A câmera
   * continua ligada: os outros veem a tela em destaque e a câmera em miniatura.
   */
  async setScreen(on: boolean, mode: ScreenMode = this.prefs.screenMode): Promise<boolean> {
    await loadLivekit();
    if (!on) {
      await this.stopScreen();
      this.afterVideoChange();
      return false;
    }
    if (mode !== this.prefs.screenMode) {
      this.prefs = { ...this.prefs, screenMode: mode };
      saveCallPrefs(this.prefs);
    }
    if (this.screen) {
      await this.republishScreen();
      return true;
    }
    const plan = qualityPlans()[this.prefs.quality].screen[mode];
    try {
      this.screen = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: plan.fps, max: plan.fps } },
        audio: false,
      });
    } catch {
      return false; // cancelou a escolha da tela
    }
    // Parou pelo botão do navegador ("Parar de compartilhar").
    this.screen.getVideoTracks()[0]?.addEventListener('ended', () => void this.setScreen(false));
    await this.publishScreen();
    this.afterVideoChange();
    return true;
  }

  private async publishScreen(): Promise<void> {
    await loadLivekit();
    const track = this.screen?.getVideoTracks()[0];
    if (!track || !this.room || this.screenPub) return;
    const mode = this.prefs.screenMode;
    const plan = qualityPlans()[this.prefs.quality].screen[mode];
    // Nitidez: o navegador guarda a resolução (texto legível) e cede fps quando mexe muito.
    // Fluidez: guarda o fps (vídeo, rolagem) e cede resolução.
    track.contentHint = mode === 'nitidez' ? 'text' : 'motion';
    const settings = track.getSettings();
    const width = settings.width ?? 1920;
    const height = settings.height ?? 1080;
    try {
      this.screenPub = await this.room.localParticipant.publishTrack(track, {
        source: L().Track.Source.ScreenShare,
        simulcast: true,
        screenShareEncoding: {
          maxBitrate: plan.maxBitrate,
          maxFramerate: plan.fps,
          priority: 'high',
        },
        // A camada menor só serve se a tela for maior que ela.
        screenShareSimulcastLayers: plan.layers.filter((l) => l.height < height && l.width < width),
        degradationPreference: mode === 'nitidez' ? 'maintain-resolution' : 'maintain-framerate',
      });
    } catch (err) {
      console.warn('[chamada] não consegui mandar a tela', err);
    }
  }

  /** Troca o jeito de mandar a tela (nitidez/fluidez ou qualidade) sem pedir a tela de novo. */
  private async republishScreen(): Promise<void> {
    await loadLivekit();
    const track = this.screen?.getVideoTracks()[0];
    if (!track) return;
    const plan = qualityPlans()[this.prefs.quality].screen[this.prefs.screenMode];
    await track
      .applyConstraints({ frameRate: { ideal: plan.fps, max: plan.fps } })
      .catch(() => undefined);
    const pub = this.screenPub;
    this.screenPub = null;
    if (pub?.track && this.room) {
      await this.room.localParticipant.unpublishTrack(pub.track, false).catch(() => undefined);
    }
    await this.publishScreen();
    this.afterVideoChange();
  }

  private async stopScreen(): Promise<void> {
    const pub = this.screenPub;
    this.screenPub = null;
    if (pub?.track && this.room) {
      await this.room.localParticipant.unpublishTrack(pub.track, false).catch(() => undefined);
    }
    for (const t of this.screen?.getTracks() ?? []) t.stop();
    this.screen = null;
  }

  /** Microfones, câmeras e saídas de áudio (os nomes só aparecem depois da permissão). */
  async devices(): Promise<CallDevices> {
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const camSource = this.blur ? null : this.cam?.getVideoTracks()[0];
    return {
      mics: all.filter((d) => d.kind === 'audioinput'),
      cams: all.filter((d) => d.kind === 'videoinput'),
      speakers: all.filter((d) => d.kind === 'audiooutput'),
      mic: this.micTrack?.mediaStreamTrack.getSettings().deviceId ?? this.prefs.mic,
      cam: camSource?.getSettings().deviceId ?? this.prefs.cam,
      speaker: this.prefs.speaker,
      canPickSpeaker: canPickSpeaker(),
    };
  }

  /**
   * Troca o microfone na hora, sem cair a chamada: abre o novo, troca a trilha que está sendo
   * mandada (sem republicar) e só então fecha o antigo.
   */
  async useMic(deviceId: string, reopen = false): Promise<void> {
    if (!reopen) {
      this.prefs = { ...this.prefs, mic: deviceId || undefined };
      saveCallPrefs(this.prefs);
    }
    if (!this.micTrack) return;
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        audio: this.audioConstraints(deviceId || undefined),
      });
      const track = next.getAudioTracks()[0]!;
      const old = this.micTrack.mediaStreamTrack;
      await this.micTrack.replaceTrack(track, true);
      if (this.muted) await this.micTrack.mute();
      old.stop();
      this.localLevel = this.meter(new MediaStream([track]));
    } catch {
      this.on.error('Não consegui usar esse microfone.');
    }
  }

  /** Troca a câmera (se estiver ligada, na hora, sem cair a chamada). */
  async useCam(deviceId: string): Promise<void> {
    this.prefs = { ...this.prefs, cam: deviceId || undefined };
    saveCallPrefs(this.prefs);
    if (this.camBusy) await this.camBusy;
    if (!this.cam) return;
    await this.stopCamera();
    await this.setCamera(true);
  }

  /** Troca a saída de áudio (alto-falante ou fone) de todo mundo na chamada. */
  async useSpeaker(deviceId: string): Promise<void> {
    this.prefs = { ...this.prefs, speaker: deviceId || undefined };
    saveCallPrefs(this.prefs);
    await Promise.all([...this.audios.values()].map((a) => this.applySpeaker(a.el)));
  }

  private async applySpeaker(audio: SinkAudio): Promise<void> {
    if (!canPickSpeaker()) return;
    try {
      await audio.setSinkId!(this.prefs.speaker ?? '');
    } catch {
      this.on.error('Não consegui usar essa saída de áudio.');
    }
  }

  // ---------- Detalhes da conexão ----------

  /** Resolução, fps, bitrate e atraso de cada vídeo (meus e dos outros), para o painel. */
  async stats(): Promise<VideoStat[]> {
    const room = this.room;
    if (!room) return [];
    const out: VideoStat[] = [];
    for (const pub of room.localParticipant.videoTrackPublications.values()) {
      const track = pub.track;
      if (!(track instanceof L().LocalVideoTrack)) continue;
      const layers = await track.getSenderStats().catch(() => []);
      const limit = layers.map((l) => l.qualityLimitationReason).find((r) => r && r !== 'none');
      out.push({
        userId: this.myUserId,
        kind: pub.source === L().Track.Source.ScreenShare ? 'screen' : 'cam',
        direction: 'envio',
        layers: layers
          .filter((l) => l.frameWidth)
          .map((l) => ({
            width: l.frameWidth ?? 0,
            height: l.frameHeight ?? 0,
            fps: Math.round(l.framesPerSecond ?? 0),
          }))
          .sort((a, b) => b.height - a.height),
        kbps: Math.round(track.currentBitrate / 1000),
        limit,
        rttMs: rttOf(layers[0]?.roundTripTime),
      });
    }
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.videoTrackPublications.values()) {
        const track = pub.videoTrack;
        if (!(track instanceof L().RemoteVideoTrack) || !pub.isSubscribed) continue;
        const s = await track.getReceiverStats().catch(() => undefined);
        const report = await track.getRTCStatsReport().catch(() => undefined);
        let rtt: number | undefined;
        let buffer: number | undefined;
        let fps = 0;
        report?.forEach((r: Record<string, unknown>) => {
          if (r.type === 'candidate-pair' && r.nominated && r.currentRoundTripTime !== undefined) {
            rtt = Number(r.currentRoundTripTime) * 1000;
          }
          if (r.type === 'inbound-rtp' && r.kind === 'video') {
            fps = Number(r.framesPerSecond ?? 0);
            if (Number(r.jitterBufferEmittedCount) > 0) {
              buffer = (Number(r.jitterBufferDelay) / Number(r.jitterBufferEmittedCount)) * 1000;
            }
          }
        });
        const lost = s?.packetsLost ?? 0;
        const got = s?.packetsReceived ?? 0;
        out.push({
          userId: p.identity,
          kind: pub.source === L().Track.Source.ScreenShare ? 'screen' : 'cam',
          direction: 'recebe',
          layers: s?.frameWidth
            ? [
                {
                  width: s.frameWidth,
                  height: s.frameHeight ?? 0,
                  fps: Math.round(fps),
                },
              ]
            : [],
          kbps: Math.round(track.currentBitrate / 1000),
          lossPct: got + lost > 0 ? Math.round((lost / (got + lost)) * 1000) / 10 : 0,
          rttMs: rtt === undefined ? undefined : Math.round(rtt),
          // Ida e volta cobre os dois trechos (quem manda → servidor → eu), mais o tempo de
          // espera para tocar sem engasgar.
          delayMs: rtt === undefined ? undefined : Math.round(rtt + (buffer ?? 0)),
        });
      }
    }
    return out;
  }

  // ---------- Estado ----------

  private async applyState(st: CallState | null): Promise<void> {
    this.current = st;
    this.on.state(st);
    if (!st || !st.here) return this.teardown();
    if (this.roomCall !== st.id) {
      if (this.roomCall) await this.teardown();
      if (!(await this.connect(st.id))) {
        if (this.current?.id === st.id) this.lobby.callLeave();
        return;
      }
    }
    this.startSpeaking();
    this.emitVideos();
  }

  /** Abre o microfone, pega a credencial do servidor de mídia e entra na sala da chamada. */
  private connect(callId: string): Promise<boolean> {
    if (this.connecting && this.roomCall === callId) return this.connecting;
    this.roomCall = callId;
    const attempt = (async () => {
      const [, mic, token] = await Promise.all([
        loadLivekit(),
        this.micTrack ? Promise.resolve(this.micTrack.mediaStreamTrack) : this.openMic(),
        this.lobby.callToken().catch(() => null),
      ]);
      if (this.roomCall !== callId) {
        if (!this.micTrack) mic?.stop();
        return false;
      }
      if (!mic) return false;
      if (!token) {
        mic.stop();
        this.on.error('Não consegui ligar o áudio e o vídeo da chamada. Tente de novo.');
        return false;
      }
      const room = this.createRoom();
      try {
        await room.connect(mediaUrl(token.url), token.token, {
          rtcConfig: token.iceServers.length
            ? { iceServers: token.iceServers as RTCIceServer[] }
            : undefined,
        });
      } catch (err) {
        console.warn('[chamada] não consegui entrar na sala de mídia', err);
        await room.disconnect();
        mic.stop();
        if (this.roomCall === callId)
          this.on.error('Não consegui ligar o áudio e o vídeo da chamada.');
        return false;
      }
      if (this.roomCall !== callId) {
        await room.disconnect();
        mic.stop();
        return false;
      }
      this.room = room;
      this.reconnectTry = 0;
      if (!this.micTrack) {
        this.micTrack = new (L().LocalAudioTrack)(mic, undefined, true);
        this.localLevel = this.meter(new MediaStream([mic]));
      }
      this.micPub = await room.localParticipant
        .publishTrack(this.micTrack, { source: L().Track.Source.Microphone, dtx: true, red: true })
        .catch(() => null);
      if (this.muted) await this.micTrack.mute();
      // Voltando de uma queda: manda de novo o que estava ligado.
      await this.publishCamera();
      await this.publishScreen();
      for (const p of room.remoteParticipants.values()) this.addParticipant(p);
      this.updateLinks();
      return true;
    })();
    this.connecting = attempt.finally(() => {
      if (this.connecting === attempt) this.connecting = null;
    });
    return attempt;
  }

  private createRoom(): Room {
    const room = new (L().Room)({
      // Cada vídeo chega no tamanho do quadro onde aparece (na tela de alta densidade, em
      // dobro); quadro escondido não recebe vídeo.
      adaptiveStream: { pixelDensity: 'screen' },
      // Camada que ninguém está vendo não é codificada (poupa processador e upload).
      dynacast: true,
      publishDefaults: { videoCodec: 'vp8', backupCodec: false },
      disconnectOnPageLeave: true,
    });
    room
      .on(L().RoomEvent.TrackSubscribed, (track, pub, p) => this.onTrack(track, pub, p))
      .on(L().RoomEvent.TrackUnsubscribed, (track, _pub, p) => this.offTrack(track, p))
      .on(L().RoomEvent.TrackMuted, () => this.emitVideos())
      .on(L().RoomEvent.TrackUnmuted, () => this.emitVideos())
      .on(L().RoomEvent.TrackPublished, (pub) => this.applyReceiveQuality(pub))
      // A publicação só sai da lista depois do aviso: redesenha logo em seguida.
      .on(L().RoomEvent.TrackUnpublished, () => setTimeout(() => this.emitVideos(), 0))
      .on(L().RoomEvent.ParticipantConnected, (p) => this.addParticipant(p))
      .on(L().RoomEvent.ParticipantDisconnected, (p) => this.removeAudio(p.identity))
      .on(L().RoomEvent.ConnectionQualityChanged, () => this.updateLinks())
      .on(L().RoomEvent.Disconnected, (reason) => this.onDisconnected(room, reason));
    return room;
  }

  /** Caiu de vez (a própria biblioteca já tentou retomar): entra de novo com credencial nova. */
  private onDisconnected(room: Room, reason?: DisconnectReason): void {
    if (this.room !== room) return;
    this.room = null;
    this.camPub = this.screenPub = this.micPub = null;
    for (const id of [...this.audios.keys()]) this.removeAudio(id);
    this.emitVideos();
    const st = this.current;
    const callId = this.roomCall;
    this.roomCall = null;
    if (!st?.here || st.id !== callId || reason === L().DisconnectReason.CLIENT_INITIATED) return;
    // Entrou a mesma conta por outra aba: esta para de falar sem insistir.
    if (reason === L().DisconnectReason.DUPLICATE_IDENTITY) return;
    const wait = RECONNECT_MS[Math.min(this.reconnectTry++, RECONNECT_MS.length - 1)]!;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => {
      const now = this.current;
      if (now?.here && now.id === callId && !this.room) void this.connect(callId);
    }, wait);
  }

  private addParticipant(p: RemoteParticipant): void {
    for (const pub of p.trackPublications.values()) {
      this.applyReceiveQuality(pub);
      if (pub.track && pub.isSubscribed) this.onTrack(pub.track, pub, p);
    }
  }

  private onTrack(track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant): void {
    if (track.kind === L().Track.Kind.Audio) {
      this.removeAudio(p.identity);
      const el = document.createElement('audio');
      el.autoplay = true;
      el.dataset.callPeer = p.identity;
      el.hidden = true;
      document.body.append(el);
      track.attach(el);
      if (this.prefs.speaker) void this.applySpeaker(el);
      this.audios.set(p.identity, {
        el,
        level: this.meter(new MediaStream([track.mediaStreamTrack])),
      });
      return;
    }
    this.applyReceiveQuality(pub);
    this.emitVideos();
  }

  private offTrack(track: RemoteTrack, p: RemoteParticipant): void {
    if (track.kind === L().Track.Kind.Audio) this.removeAudio(p.identity);
    else setTimeout(() => this.emitVideos(), 0);
  }

  private removeAudio(identity: string): void {
    const a = this.audios.get(identity);
    if (!a) return;
    a.el.srcObject = null;
    a.el.remove();
    this.audios.delete(identity);
  }

  /** Camada máxima que peço ao servidor (na economia, as menores). */
  private applyReceiveQuality(only?: RemoteTrackPublication): void {
    // Sem o servidor de mídia carregado não há sala nem vídeo dos outros.
    if (!lk) return;
    const want = qualityPlans()[this.prefs.quality].receive;
    const pubs = only
      ? [only]
      : [...(this.room?.remoteParticipants.values() ?? [])].flatMap((p) => [
          ...p.videoTrackPublications.values(),
        ]);
    for (const pub of pubs) {
      if (pub.kind !== L().Track.Kind.Video) continue;
      pub.setVideoQuality(pub.source === L().Track.Source.ScreenShare ? want.screen : want.cam);
    }
  }

  private updateLinks(): void {
    const room = this.room;
    const links = new Map<string, LinkQuality>();
    const add = (p: Participant) => {
      const q = linkOf(p.connectionQuality);
      if (q)
        links.set(p.identity === room?.localParticipant.identity ? this.myUserId : p.identity, q);
    };
    if (room) {
      add(room.localParticipant);
      for (const p of room.remoteParticipants.values()) add(p);
    }
    this.links = links;
    this.on.links(links);
  }

  /** Quanto o servidor de mídia diz da conexão de cada um (para o indicador). */
  get linkQualities(): ReadonlyMap<string, LinkQuality> {
    return this.links;
  }

  /** Câmera/tela mudou: avisa os outros (pelo escritório) e redesenha os vídeos. */
  private afterVideoChange(): void {
    this.sendMedia();
    this.emitVideos();
  }

  private sendMedia(): void {
    if (!this.current?.here) return;
    const media: CallMedia = {
      mic: !this.muted,
      cam: Boolean(this.cam),
      screen: Boolean(this.screen),
    };
    this.lobby.callMedia(media);
  }

  private audioConstraints(deviceId?: string): MediaTrackConstraints {
    return {
      echoCancellation: true,
      noiseSuppression: this.prefs.noise,
      autoGainControl: true,
      ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
    };
  }

  private async openMic(): Promise<MediaStreamTrack | null> {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: this.audioConstraints(this.prefs.mic),
      });
      return s.getAudioTracks()[0] ?? null;
    } catch {
      this.on.error('Sem acesso ao microfone. Libere o microfone para este site e tente de novo.');
      return null;
    }
  }

  /** Vídeos para o painel: dos outros (pelo que chega do servidor de mídia) e a sua prévia. */
  private emitVideos(): void {
    const out = new Map<string, CallVideo>();
    const st = this.current;
    if (st?.here) {
      const mine: CallVideo = {};
      if (this.cam) mine.cam = localRef(`eu-cam-${this.cam.id}`, this.cam);
      if (this.screen) mine.screen = localRef(`eu-tela-${this.screen.id}`, this.screen);
      if (mine.cam || mine.screen) out.set(this.myUserId, mine);
      for (const p of this.room?.remoteParticipants.values() ?? []) {
        if (!this.hasMember(p.identity)) continue;
        const v: CallVideo = {};
        for (const pub of p.videoTrackPublications.values()) {
          const track = pub.videoTrack;
          if (!(track instanceof L().RemoteVideoTrack) || !pub.isSubscribed || pub.isMuted)
            continue;
          if (pub.source === L().Track.Source.ScreenShare) v.screen = remoteRef(track);
          else if (pub.source === L().Track.Source.Camera) v.cam = remoteRef(track);
        }
        if (v.cam || v.screen) out.set(p.identity, v);
      }
    }
    this.on.videos(out);
  }

  private async teardown(): Promise<void> {
    clearTimeout(this.reconnectTimer);
    this.roomCall = null;
    this.connecting = null;
    const room = this.room;
    this.room = null;
    await this.stopCamera();
    await this.stopScreen();
    this.micPub = null;
    this.micTrack?.mediaStreamTrack.stop();
    this.micTrack = null;
    await room?.disconnect().catch(() => undefined);
    for (const id of [...this.audios.keys()]) this.removeAudio(id);
    this.localLevel = null;
    this.muted = false;
    clearInterval(this.speakingTimer);
    this.speakingTimer = 0;
    if (this.speakingNow.size) {
      this.speakingNow = new Set();
      this.on.speaking(this.speakingNow);
    }
    this.smooth = new Map();
    this.links = new Map();
    this.on.links(this.links);
    this.on.levels(new Map());
    this.on.videos(new Map());
  }

  // ---------- Quem está falando ----------

  /** Medidor de volume (RMS) de um fluxo de áudio. */
  private meter(stream: MediaStream): (() => number) | null {
    try {
      if (!this.audioCtx) {
        const ctx = new AudioContext();
        this.audioCtx = ctx;
        // Sem um clique antes, o navegador pode deixar o áudio pausado (e o medidor em zero):
        // retoma no primeiro toque ou tecla.
        if (ctx.state !== 'running') {
          const resume = () => void ctx.resume().catch(() => undefined);
          resume();
          document.addEventListener('pointerdown', resume, { once: true });
          document.addEventListener('keydown', resume, { once: true });
        }
      }
      const analyser = this.audioCtx.createAnalyser();
      // ~43 ms de som por medida: pega sílabas (e bipes) curtos entre uma medida e outra.
      analyser.fftSize = 2048;
      this.audioCtx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      return () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        return Math.sqrt(sum / buf.length);
      };
    } catch {
      return null;
    }
  }

  private startSpeaking(): void {
    if (this.speakingTimer) return;
    this.speakingTimer = window.setInterval(() => {
      const raw = new Map<string, number>();
      raw.set(this.myUserId, this.micLevel());
      for (const [id, a] of this.audios) raw.set(id, a.level?.() ?? 0);
      // Quem anunciou mudo não fala (nem mexe a boca), mesmo com ruído chegando.
      for (const m of this.current?.members ?? []) if (!m.mic) raw.set(m.userId, 0);
      const levels = new Map<string, number>();
      for (const [id, level] of raw) {
        const prev = this.smooth.get(id) ?? 0;
        levels.set(id, level === 0 ? 0 : Math.max(level, prev * LEVEL_DECAY));
      }
      this.smooth = levels;
      this.on.levels(levels);
      const now = new Set<string>();
      for (const [id, level] of levels) if (level > SPEAKING_LEVEL) now.add(id);
      const same =
        now.size === this.speakingNow.size && [...now].every((id) => this.speakingNow.has(id));
      if (same) return;
      this.speakingNow = now;
      this.on.speaking(now);
    }, LEVEL_EVERY_MS);
  }
}

const rttOf = (s: number | undefined) => (s === undefined ? undefined : Math.round(s * 1000));

/** Endereço do servidor de mídia: absoluto, ou um caminho neste mesmo site (atrás do Caddy). */
export function mediaUrl(url: string, loc: Pick<Location, 'protocol' | 'host'> = location): string {
  if (/^wss?:\/\//.test(url)) return url;
  if (/^https?:\/\//.test(url)) return url.replace(/^http/, 'ws');
  const ws = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${ws}//${loc.host}${url.startsWith('/') ? url : `/${url}`}`;
}

export type { CallToken, IceServer };
