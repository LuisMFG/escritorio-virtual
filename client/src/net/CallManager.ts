import {
  callInitiator,
  type CallInvite,
  type CallInviteResult,
  type CallMedia,
  type CallSignalData,
  type CallState,
  type IceServer,
} from '@office/shared';
import type { LobbyConnection } from './LobbyConnection.js';

/** Servidores ICE se o servidor não responder (só STUN público). */
const FALLBACK_ICE: IceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478'] }];
/** Quanto de volume conta como "falando" (RMS de 0 a 1) e de quanto em quanto medir (ms). */
const SPEAKING_LEVEL = 0.035;
const SPEAKING_EVERY_MS = 150;
/** Dispositivos escolhidos (lembrados no navegador). */
const MIC_KEY = 'ev-call-mic';
const CAM_KEY = 'ev-call-cam';
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
  level: (() => number) | null;
  video: MediaStream | null;
}

function readKey(key: string): string | undefined {
  try {
    return localStorage.getItem(key) || undefined;
  } catch {
    return undefined;
  }
}

function writeKey(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // sem armazenamento: vale só para esta visita
  }
}

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
  private cam: MediaStream | null = null;
  private screen: MediaStream | null = null;
  private ice: IceServer[] | null = null;
  private muted = false;
  private audioCtx: AudioContext | null = null;
  private localLevel: (() => number) | null = null;
  private speakingTimer = 0;
  private speakingNow = new Set<string>();

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
      signal: (from, data) => void this.onSignal(from, data),
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
    if (!on) {
      for (const t of this.cam?.getTracks() ?? []) t.stop();
      this.cam = null;
    } else if (!this.cam) {
      try {
        const deviceId = readKey(CAM_KEY);
        this.cam = await navigator.mediaDevices.getUserMedia({
          video: { ...CAM_CONSTRAINTS, ...(deviceId ? { deviceId: { ideal: deviceId } } : {}) },
        });
      } catch {
        this.on.error('Sem acesso à câmera. Libere a câmera para este site e tente de novo.');
        return false;
      }
    }
    this.applyVideo();
    return Boolean(this.cam);
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

  /** Microfones e câmeras do aparelho (os nomes só aparecem depois da permissão). */
  async devices(): Promise<{
    mics: MediaDeviceInfo[];
    cams: MediaDeviceInfo[];
    mic?: string;
    cam?: string;
  }> {
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    return {
      mics: all.filter((d) => d.kind === 'audioinput'),
      cams: all.filter((d) => d.kind === 'videoinput'),
      mic: this.mic?.getAudioTracks()[0]?.getSettings().deviceId ?? readKey(MIC_KEY),
      cam: this.cam?.getVideoTracks()[0]?.getSettings().deviceId ?? readKey(CAM_KEY),
    };
  }

  /** Troca o microfone (na hora, sem cair a chamada). */
  async useMic(deviceId: string): Promise<void> {
    writeKey(MIC_KEY, deviceId);
    if (!this.mic) return;
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        audio: this.audioConstraints(deviceId),
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

  /** Troca a câmera (se estiver ligada, na hora). */
  async useCam(deviceId: string): Promise<void> {
    writeKey(CAM_KEY, deviceId);
    if (!this.cam) return;
    for (const t of this.cam.getTracks()) t.stop();
    this.cam = null;
    await this.setCamera(true);
  }

  // ---------- Estado ----------

  private async applyState(st: CallState | null): Promise<void> {
    this.current = st;
    this.on.state(st);
    if (!st || !st.here) return this.teardown();
    if (!(await this.ensureMic())) {
      this.lobby.callLeave();
      return;
    }
    this.ice ??= await this.lobby.iceServers().then(
      (list) => (Array.isArray(list) && list.length ? list : FALLBACK_ICE),
      () => FALLBACK_ICE,
    );
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

  private audioConstraints(deviceId?: string): MediaTrackConstraints {
    return {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
    };
  }

  private async ensureMic(): Promise<boolean> {
    if (this.mic) return true;
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: this.audioConstraints(readKey(MIC_KEY)),
      });
      for (const t of this.mic.getAudioTracks()) t.enabled = !this.muted;
      this.localLevel = this.meter(this.mic);
      return true;
    } catch {
      this.on.error('Sem acesso ao microfone. Libere o microfone para este site e tente de novo.');
      return false;
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
    const peer: Peer = { pc, audio, pendingIce: [], level: null, video: null };
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      this.lobby.callSignal(userId, {
        kind: 'ice',
        candidate: e.candidate.candidate,
        sdpMid: e.candidate.sdpMid,
        sdpMLineIndex: e.candidate.sdpMLineIndex,
      });
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
  private attachTracks(pc: RTCPeerConnection): void {
    const audioTrack = this.mic?.getAudioTracks()[0] ?? null;
    const audioT = pc.getTransceivers().find((t) => t.receiver.track.kind === 'audio');
    if (audioT) {
      audioT.direction = 'sendrecv';
      void audioT.sender.replaceTrack(audioTrack);
    } else if (audioTrack && this.mic) {
      pc.addTransceiver(audioTrack, { direction: 'sendrecv', streams: [this.mic] });
    }
    const videoT = pc.getTransceivers().find((t) => t.receiver.track.kind === 'video');
    if (videoT) {
      videoT.direction = 'sendrecv';
      void videoT.sender.replaceTrack(this.videoTrack);
    } else {
      pc.addTransceiver(this.videoTrack ?? 'video', { direction: 'sendrecv' });
    }
  }

  private async offer(userId: string, peer: Peer, iceRestart = false): Promise<void> {
    try {
      this.attachTracks(peer.pc);
      const offer = await peer.pc.createOffer({ iceRestart });
      await peer.pc.setLocalDescription(offer);
      this.lobby.callSignal(userId, { kind: 'sdp', type: 'offer', sdp: offer.sdp ?? '' });
    } catch (err) {
      console.warn('[chamada] oferta falhou', err);
    }
  }

  private async onSignal(from: string, data: CallSignalData): Promise<void> {
    if (!this.current?.here || !this.hasMember(from)) return;
    const peer = this.peers.get(from) ?? this.openPeer(from);
    const pc = peer.pc;
    try {
      if (data.kind === 'sdp') {
        await pc.setRemoteDescription({ type: data.type, sdp: data.sdp });
        if (data.type === 'offer') {
          this.attachTracks(pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.lobby.callSignal(from, { kind: 'sdp', type: 'answer', sdp: answer.sdp ?? '' });
        }
        for (const c of peer.pendingIce.splice(0)) await pc.addIceCandidate(c);
      } else {
        const cand: RTCIceCandidateInit = {
          candidate: data.candidate,
          sdpMid: data.sdpMid,
          sdpMLineIndex: data.sdpMLineIndex,
        };
        if (pc.remoteDescription) await pc.addIceCandidate(cand);
        else peer.pendingIce.push(cand);
      }
    } catch (err) {
      console.warn('[chamada] sinalização falhou', err);
    }
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
    peer.pc.close();
    peer.audio.srcObject = null;
    peer.audio.remove();
    this.peers.delete(userId);
  }

  private teardown(): void {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    for (const s of [this.mic, this.cam, this.screen])
      for (const t of s?.getTracks() ?? []) t.stop();
    this.mic = this.cam = this.screen = null;
    this.localLevel = null;
    this.ice = null;
    this.muted = false;
    clearInterval(this.speakingTimer);
    this.speakingTimer = 0;
    if (this.speakingNow.size) {
      this.speakingNow = new Set();
      this.on.speaking(this.speakingNow);
    }
    this.on.videos(new Map());
  }

  // ---------- Quem está falando ----------

  /** Medidor de volume (RMS) de um fluxo de áudio. */
  private meter(stream: MediaStream): (() => number) | null {
    try {
      this.audioCtx ??= new AudioContext();
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 512;
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
      const now = new Set<string>();
      if (!this.muted && (this.localLevel?.() ?? 0) > SPEAKING_LEVEL) now.add(this.myUserId);
      for (const [id, p] of this.peers) if ((p.level?.() ?? 0) > SPEAKING_LEVEL) now.add(id);
      const same =
        now.size === this.speakingNow.size && [...now].every((id) => this.speakingNow.has(id));
      if (same) return;
      this.speakingNow = now;
      this.on.speaking(now);
    }, SPEAKING_EVERY_MS);
  }
}
