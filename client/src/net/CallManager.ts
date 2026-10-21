import {
  callInitiator,
  type CallInvite,
  type CallInviteResult,
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

export interface CallEvents {
  /** Chamada atual (ou `null`): para o painel. */
  state(state: CallState | null): void;
  invited(invite: CallInvite): void;
  inviteGone(inviteId: string): void;
  result(result: CallInviteResult): void;
  /** Quem está falando agora (ids das contas; inclui você). */
  speaking(userIds: ReadonlySet<string>): void;
  /** Erro para mostrar (microfone negado, etc.). */
  error(message: string): void;
}

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  /** Candidatos que chegaram antes da descrição remota. */
  pendingIce: RTCIceCandidateInit[];
  level: (() => number) | null;
}

/**
 * Chamadas de áudio (Fase 49): uma conexão WebRTC com cada participante (malha), sinalizada
 * pelo canal global. Quem tem o id menor faz a oferta. Cada conexão já reserva um transceptor
 * de vídeo (só recebe por enquanto): na Fase 50 câmera e tela entram com `replaceTrack`.
 */
export class CallManager {
  private current: CallState | null = null;
  private readonly peers = new Map<string, Peer>();
  private mic: MediaStream | null = null;
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
    this.lobby.callMedia({ mic: !muted, cam: false, screen: false });
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
  }

  private async ensureMic(): Promise<boolean> {
    if (this.mic) return true;
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      for (const t of this.mic.getAudioTracks()) t.enabled = !this.muted;
      this.localLevel = this.meter(this.mic);
      return true;
    } catch {
      this.on.error('Sem acesso ao microfone. Libere o microfone para este site e tente de novo.');
      return false;
    }
  }

  private openPeer(userId: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.ice ?? FALLBACK_ICE });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.dataset.callPeer = userId;
    audio.hidden = true;
    document.body.append(audio);
    const peer: Peer = { pc, audio, pendingIce: [], level: null };
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
      if (e.track.kind !== 'audio') return; // vídeo: Fase 50
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

  /** Transceptores: áudio (envia e recebe) e vídeo (reservado para a Fase 50, só recebe). */
  private attachTracks(pc: RTCPeerConnection): void {
    const track = this.mic?.getAudioTracks()[0];
    const audioT = pc.getTransceivers().find((t) => t.receiver.track.kind === 'audio');
    if (audioT) {
      audioT.direction = 'sendrecv';
      if (track) void audioT.sender.replaceTrack(track);
    } else if (track && this.mic) {
      pc.addTransceiver(track, { direction: 'sendrecv', streams: [this.mic] });
    }
    if (!pc.getTransceivers().some((t) => t.receiver.track.kind === 'video')) {
      pc.addTransceiver('video', { direction: 'recvonly' });
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
    for (const t of this.mic?.getTracks() ?? []) t.stop();
    this.mic = null;
    this.localLevel = null;
    this.ice = null;
    this.muted = false;
    clearInterval(this.speakingTimer);
    this.speakingTimer = 0;
    if (this.speakingNow.size) {
      this.speakingNow = new Set();
      this.on.speaking(this.speakingNow);
    }
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
