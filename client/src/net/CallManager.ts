import {
  CALL_ICE_BATCH_MAX,
  callInitiator,
  type CallInvite,
  type CallInviteResult,
  type CallMedia,
  type CallSignalData,
  type CallState,
  type IceServer,
} from '@office/shared';
import { SPEAKING_LEVEL } from '../ui/callFace.js';
import { BackgroundBlur } from './backgroundBlur.js';
import { loadCallPrefs, saveCallPrefs, type CallPrefs } from './callPrefs.js';
import type { LobbyConnection } from './LobbyConnection.js';

/** Servidores ICE se o servidor não responder (só STUN público). */
const FALLBACK_ICE: IceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478'] }];
/** De quanto em quanto medir o volume (ms): o anel de quem fala e a boca do avatar. */
const LEVEL_EVERY_MS = 100;
/**
 * Quanto do volume da medida anterior sobra na seguinte: um som curto (uma sílaba) segura a
 * boca aberta e o contorno aceso por alguns décimos, em vez de piscar; parando de falar, cai
 * abaixo do limite em meio segundo.
 */
const LEVEL_DECAY = 0.6;
/** Candidatos ICE saem juntos a cada tanto (ms), em vez de um por mensagem. */
const ICE_BATCH_MS = 100;
/** Câmera: qualidade boa sem pesar (cada um manda para até 5 pessoas). */
const CAM_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 360 },
  frameRate: { ideal: 24, max: 30 },
};

/** Vídeo de alguém na chamada (você também, como prévia). */
export interface CallVideo {
  stream: MediaStream;
  kind: 'cam' | 'screen';
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
  /** Vídeos ativos (câmera ou tela) por pessoa; o seu entra como prévia. */
  videos(videos: ReadonlyMap<string, CallVideo>): void;
  /** Erro para mostrar (microfone negado, etc.). */
  error(message: string): void;
}

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  /** Candidatos que chegaram antes da descrição remota. */
  pendingIce: RTCIceCandidateInit[];
  /** Candidatos meus esperando para sair no próximo lote. */
  outIce: RTCIceCandidateInit[];
  iceTimer: number;
  level: (() => number) | null;
  video: MediaStream | null;
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

/**
 * Chamadas (Fases 49–50): uma conexão WebRTC com cada participante (malha), sinalizada pelo
 * canal global. Quem tem o id menor faz a oferta. Cada conexão tem um transceptor de áudio e um
 * de vídeo (os dois enviam e recebem desde o começo): ligar a câmera ou a tela é só trocar a
 * trilha do vídeo (`replaceTrack`), sem renegociar. A tela tem prioridade sobre a câmera.
 */
export class CallManager {
  private current: CallState | null = null;
  private readonly peers = new Map<string, Peer>();
  private mic: MediaStream | null = null;
  /** O que sai da câmera (com o desfoque, o vídeo já borrado). */
  private cam: MediaStream | null = null;
  /** Desfoque de fundo rodando sobre a câmera. */
  private blur: BackgroundBlur | null = null;
  /** Ligando a câmera (um pedido por vez). */
  private camBusy: Promise<boolean> | null = null;
  private screen: MediaStream | null = null;
  private prefs: CallPrefs = loadCallPrefs();
  private ice: IceServer[] | null = null;
  private muted = false;
  private audioCtx: AudioContext | null = null;
  private localLevel: (() => number) | null = null;
  private speakingTimer = 0;
  private speakingNow = new Set<string>();
  /** Volume suavizado de cada um (para o decaimento). */
  private smooth = new Map<string, number>();
  /** Microfone + servidores ICE (uma vez por chamada); a sinalização espera por isso. */
  private ready: Promise<boolean> | null = null;
  /** Sinais em fila: cada um só começa depois do anterior (SDP antes dos candidatos). */
  private signals: Promise<void> = Promise.resolve();

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
      signal: (from, data) => {
        this.signals = this.signals.then(() => this.onSignal(from, data));
      },
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

  leave(): void {
    this.lobby.callLeave();
    void this.applyState(null);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    for (const t of this.mic?.getAudioTracks() ?? []) t.enabled = !muted;
    this.sendMedia();
  }

  /** Liga/desliga a câmera. Devolve se ficou ligada. */
  async setCamera(on: boolean): Promise<boolean> {
    if (this.camBusy) await this.camBusy;
    if (!on) {
      this.stopCamera();
      this.applyVideo();
      return false;
    }
    if (this.cam) return true;
    this.camBusy = this.openCamera().finally(() => (this.camBusy = null));
    return this.camBusy;
  }

  private stopCamera(): void {
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
    let raw: MediaStream;
    try {
      const deviceId = this.prefs.cam;
      raw = await navigator.mediaDevices.getUserMedia({
        video: { ...CAM_CONSTRAINTS, ...(deviceId ? { deviceId: { ideal: deviceId } } : {}) },
      });
    } catch {
      this.on.error('Sem acesso à câmera. Libere a câmera para este site e tente de novo.');
      return false;
    }
    const track = raw.getVideoTracks()[0]!;
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
      this.stopCamera();
      return false;
    }
    this.applyVideo();
    return true;
  }

  /** Desfoque de fundo: salva a escolha e, com a câmera ligada, troca o vídeo na hora. */
  async setBlur(on: boolean): Promise<void> {
    this.prefs = { ...this.prefs, blur: on };
    saveCallPrefs(this.prefs);
    if (this.camBusy) await this.camBusy;
    if (!this.cam || Boolean(this.blur) === on) return;
    this.stopCamera();
    await this.setCamera(true);
  }

  /** Supressão de ruído: salva a escolha e reabre o microfone com ela (sem cair a chamada). */
  async setNoise(on: boolean): Promise<void> {
    this.prefs = { ...this.prefs, noise: on };
    saveCallPrefs(this.prefs);
    const current = this.mic?.getAudioTracks()[0];
    if (current) await this.useMic(current.getSettings().deviceId ?? this.prefs.mic ?? '', true);
  }

  /** Compartilha (ou para de compartilhar) a tela. Devolve se ficou compartilhando. */
  async setScreen(on: boolean): Promise<boolean> {
    if (!on) {
      for (const t of this.screen?.getTracks() ?? []) t.stop();
      this.screen = null;
    } else if (!this.screen) {
      try {
        this.screen = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 15, max: 30 } },
          audio: false,
        });
        // Parou pelo botão do navegador ("Parar de compartilhar").
        this.screen
          .getVideoTracks()[0]
          ?.addEventListener('ended', () => void this.setScreen(false));
      } catch {
        return false; // cancelou a escolha da tela
      }
    }
    this.applyVideo();
    return Boolean(this.screen);
  }

  /** Microfones, câmeras e saídas de áudio (os nomes só aparecem depois da permissão). */
  async devices(): Promise<CallDevices> {
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const camSource = this.blur ? null : this.cam?.getVideoTracks()[0];
    return {
      mics: all.filter((d) => d.kind === 'audioinput'),
      cams: all.filter((d) => d.kind === 'videoinput'),
      speakers: all.filter((d) => d.kind === 'audiooutput'),
      mic: this.mic?.getAudioTracks()[0]?.getSettings().deviceId ?? this.prefs.mic,
      cam: camSource?.getSettings().deviceId ?? this.prefs.cam,
      speaker: this.prefs.speaker,
      canPickSpeaker: canPickSpeaker(),
    };
  }

  /**
   * Troca o microfone na hora, sem cair a chamada: abre o novo, troca a trilha em todas as
   * conexões (`replaceTrack`, sem renegociar) e só então fecha o antigo.
   */
  async useMic(deviceId: string, reopen = false): Promise<void> {
    if (!reopen) {
      this.prefs = { ...this.prefs, mic: deviceId || undefined };
      saveCallPrefs(this.prefs);
    }
    if (!this.mic) return;
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        audio: this.audioConstraints(deviceId || undefined),
      });
      const track = next.getAudioTracks()[0]!;
      track.enabled = !this.muted;
      for (const p of this.peers.values()) {
        const sender = p.pc
          .getTransceivers()
          .find((t) => t.receiver.track.kind === 'audio')?.sender;
        await sender?.replaceTrack(track);
      }
      for (const t of this.mic.getTracks()) t.stop();
      this.mic = next;
      this.localLevel = this.meter(next);
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
    this.stopCamera();
    await this.setCamera(true);
  }

  /** Troca a saída de áudio (alto-falante ou fone) de todo mundo na chamada. */
  async useSpeaker(deviceId: string): Promise<void> {
    this.prefs = { ...this.prefs, speaker: deviceId || undefined };
    saveCallPrefs(this.prefs);
    await Promise.all([...this.peers.values()].map((p) => this.applySpeaker(p.audio)));
  }

  private async applySpeaker(audio: SinkAudio): Promise<void> {
    if (!canPickSpeaker()) return;
    try {
      await audio.setSinkId!(this.prefs.speaker ?? '');
    } catch {
      this.on.error('Não consegui usar essa saída de áudio.');
    }
  }

  // ---------- Estado ----------

  private async applyState(st: CallState | null): Promise<void> {
    this.current = st;
    this.on.state(st);
    if (!st || !st.here) return this.teardown();
    if (!(await this.prepare())) {
      this.lobby.callLeave();
      return;
    }
    // A chamada pode ter mudado (ou acabado) enquanto o microfone abria.
    if (this.current !== st) return;
    const others = new Set(st.members.map((m) => m.userId).filter((id) => id !== this.myUserId));
    for (const id of [...this.peers.keys()]) if (!others.has(id)) this.closePeer(id);
    for (const id of others) {
      if (this.peers.has(id)) continue;
      const peer = this.openPeer(id);
      if (callInitiator(this.myUserId, id) === this.myUserId) void this.offer(id, peer);
    }
    this.startSpeaking();
    this.emitVideos();
  }

  /**
   * Abre o microfone e busca os servidores ICE uma vez só, mesmo com vários estados chegando
   * juntos. Sem isso, uma oferta que chega enquanto a pessoa ainda libera o microfone era
   * respondida sem áudio (e sem TURN): o outro lado não ouvia nada.
   */
  private prepare(): Promise<boolean> {
    if (this.ready) return this.ready;
    let ready: Promise<boolean> | null = null;
    ready = (async () => {
      const [mic, ice] = await Promise.all([
        this.openMic(),
        this.lobby.iceServers().then(
          (list) => (Array.isArray(list) && list.length ? list : FALLBACK_ICE),
          () => FALLBACK_ICE,
        ),
      ]);
      // Saiu da chamada enquanto o microfone abria: devolve o microfone.
      if (this.ready !== ready) {
        for (const t of mic?.getTracks() ?? []) t.stop();
        return false;
      }
      if (!mic) {
        this.ready = null;
        return false;
      }
      for (const t of mic.getAudioTracks()) t.enabled = !this.muted;
      this.mic = mic;
      this.localLevel = this.meter(mic);
      this.ice = ice;
      return true;
    })();
    this.ready = ready;
    return ready;
  }

  private audioConstraints(deviceId?: string): MediaTrackConstraints {
    return {
      echoCancellation: true,
      noiseSuppression: this.prefs.noise,
      autoGainControl: true,
      ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
    };
  }

  private async openMic(): Promise<MediaStream | null> {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: this.audioConstraints(this.prefs.mic),
      });
    } catch {
      this.on.error('Sem acesso ao microfone. Libere o microfone para este site e tente de novo.');
      return null;
    }
  }

  /** Trilha que vai no vídeo: a tela (se compartilhando) ou a câmera. */
  private get videoTrack(): MediaStreamTrack | null {
    return this.screen?.getVideoTracks()[0] ?? this.cam?.getVideoTracks()[0] ?? null;
  }

  /** Câmera/tela mudou: troca a trilha em todas as conexões e avisa os outros. */
  private applyVideo(): void {
    const track = this.videoTrack;
    for (const p of this.peers.values()) {
      const t = p.pc.getTransceivers().find((x) => x.receiver.track.kind === 'video');
      void t?.sender.replaceTrack(track).catch(() => undefined);
    }
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

  private openPeer(userId: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.ice ?? FALLBACK_ICE });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.dataset.callPeer = userId;
    audio.hidden = true;
    document.body.append(audio);
    if (this.prefs.speaker) void this.applySpeaker(audio);
    const peer: Peer = {
      pc,
      audio,
      pendingIce: [],
      outIce: [],
      iceTimer: 0,
      level: null,
      video: null,
    };
    const flushIce = () => {
      clearTimeout(peer.iceTimer);
      peer.iceTimer = 0;
      if (!peer.outIce.length || pc.signalingState === 'closed') return;
      const candidates = peer.outIce.splice(0).map((c) => ({
        candidate: c.candidate ?? '',
        sdpMid: c.sdpMid ?? null,
        sdpMLineIndex: c.sdpMLineIndex ?? null,
      }));
      this.lobby.callSignal(userId, { kind: 'ice', candidates });
    };
    pc.onicecandidate = (e) => {
      // Fim da coleta: manda o que sobrou.
      if (!e.candidate) return flushIce();
      if (!e.candidate.candidate) return;
      peer.outIce.push(e.candidate.toJSON());
      if (peer.outIce.length >= CALL_ICE_BATCH_MAX) flushIce();
      else peer.iceTimer ||= window.setTimeout(flushIce, ICE_BATCH_MS);
    };
    pc.ontrack = (e) => {
      if (e.track.kind === 'video') {
        peer.video = new MediaStream([e.track]);
        this.emitVideos();
        return;
      }
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      audio.srcObject = stream;
      void audio.play().catch(() => undefined);
      peer.level = this.meter(stream);
    };
    pc.onconnectionstatechange = () => {
      // Caiu de vez: quem oferece tenta de novo (reinício do ICE).
      if (
        pc.connectionState === 'failed' &&
        callInitiator(this.myUserId, userId) === this.myUserId
      ) {
        void this.offer(userId, peer, true);
      }
    };
    this.peers.set(userId, peer);
    return peer;
  }

  /** Transceptores: áudio e vídeo, os dois enviando e recebendo (o vídeo começa sem trilha). */
  private async attachTracks(pc: RTCPeerConnection): Promise<void> {
    const audioTrack = this.mic?.getAudioTracks()[0] ?? null;
    const audioT = pc.getTransceivers().find((t) => t.receiver.track.kind === 'audio');
    if (audioT) {
      audioT.direction = 'sendrecv';
      await audioT.sender.replaceTrack(audioTrack);
    } else if (audioTrack && this.mic) {
      pc.addTransceiver(audioTrack, { direction: 'sendrecv', streams: [this.mic] });
    }
    const videoT = pc.getTransceivers().find((t) => t.receiver.track.kind === 'video');
    if (videoT) {
      videoT.direction = 'sendrecv';
      await videoT.sender.replaceTrack(this.videoTrack);
    } else {
      pc.addTransceiver(this.videoTrack ?? 'video', { direction: 'sendrecv' });
    }
  }

  private async offer(userId: string, peer: Peer, iceRestart = false): Promise<void> {
    try {
      await this.attachTracks(peer.pc);
      const offer = await peer.pc.createOffer({ iceRestart });
      await peer.pc.setLocalDescription(offer);
      this.lobby.callSignal(userId, { kind: 'sdp', type: 'offer', sdp: offer.sdp ?? '' });
    } catch (err) {
      console.warn('[chamada] oferta falhou', err);
    }
  }

  private async onSignal(from: string, data: CallSignalData): Promise<void> {
    if (!this.current?.here || !this.hasMember(from)) return;
    if (!(await this.prepare())) return;
    if (!this.current?.here || !this.hasMember(from)) return;
    const peer = this.peers.get(from) ?? this.openPeer(from);
    const pc = peer.pc;
    try {
      if (data.kind === 'sdp') {
        await pc.setRemoteDescription({ type: data.type, sdp: data.sdp });
        if (data.type === 'offer') {
          await this.attachTracks(pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.lobby.callSignal(from, { kind: 'sdp', type: 'answer', sdp: answer.sdp ?? '' });
        }
        for (const c of peer.pendingIce.splice(0)) await this.addIce(pc, c);
      } else if (pc.remoteDescription) {
        for (const c of data.candidates) await this.addIce(pc, c);
      } else {
        peer.pendingIce.push(...data.candidates);
      }
    } catch (err) {
      console.warn('[chamada] sinalização falhou', err);
    }
  }

  /** Um candidato ruim (rede que sumiu, etc.) não impede os outros. */
  private async addIce(pc: RTCPeerConnection, c: RTCIceCandidateInit): Promise<void> {
    await pc.addIceCandidate(c).catch((err) => console.warn('[chamada] candidato recusado', err));
  }

  /** Vídeos para o painel: dos outros (pelo que eles anunciaram) e a sua prévia. */
  private emitVideos(): void {
    const out = new Map<string, CallVideo>();
    const st = this.current;
    if (st?.here) {
      const local = this.screen ?? this.cam;
      if (local) out.set(this.myUserId, { stream: local, kind: this.screen ? 'screen' : 'cam' });
      for (const m of st.members) {
        const peer = this.peers.get(m.userId);
        if (!peer?.video || !(m.cam || m.screen)) continue;
        out.set(m.userId, { stream: peer.video, kind: m.screen ? 'screen' : 'cam' });
      }
    }
    this.on.videos(out);
  }

  private closePeer(userId: string): void {
    const peer = this.peers.get(userId);
    if (!peer) return;
    clearTimeout(peer.iceTimer);
    peer.pc.close();
    peer.audio.srcObject = null;
    peer.audio.remove();
    this.peers.delete(userId);
  }

  private teardown(): void {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.stopCamera();
    for (const s of [this.mic, this.screen]) for (const t of s?.getTracks() ?? []) t.stop();
    this.mic = this.screen = null;
    this.localLevel = null;
    this.ice = null;
    this.ready = null;
    this.muted = false;
    clearInterval(this.speakingTimer);
    this.speakingTimer = 0;
    if (this.speakingNow.size) {
      this.speakingNow = new Set();
      this.on.speaking(this.speakingNow);
    }
    this.smooth = new Map();
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
      for (const [id, p] of this.peers) raw.set(id, p.level?.() ?? 0);
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
