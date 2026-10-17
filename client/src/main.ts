import './style.css';
// Sem isto o Pixi usa `eval` para shaders, e a CSP de produção (sem 'unsafe-eval') o bloqueia.
import 'pixi.js/unsafe-eval';
import { Callbacks } from '@colyseus/sdk';
import {
  parseAvatarManifest,
  parseFurniManifest,
  findRoom,
  RECEPTION,
  type FurniManifestEntry,
  type PresenceResponse,
  type Furni,
  type PlacedFurni,
  type Player,
  ClientMessage,
  type ChatMessage,
  type RoomLayoutMessage,
  type SessionResponse,
  type Status,
  STATUSES,
} from '@office/shared';
import { Application, TextureSource } from 'pixi.js';
import { AssetLoader } from './assets/AssetLoader.js';
import { AvatarTextureCache, ImagerAvatarRenderer } from './assets/AvatarTextureCache.js';
import { PlaceholderFactory } from './assets/PlaceholderFactory.js';
import { DEBUG, OFFLINE_ASSETS } from './config.js';
import type { AvatarSnapshot } from './entities/AvatarView.js';
import { isSessionError, OfficeConnection, type OfficeRoomClient } from './net/OfficeConnection.js';
import { forgetToken, loadSession, saveSession } from './net/storage.js';
import { RoomScene, type SceneDeps } from './scene/RoomScene.js';
import { AvatarCard } from './ui/avatarCard.js';
import { openAvatarEditor } from './ui/avatarEditor.js';
import { ChatPanel } from './ui/chat.js';
import { DecorPanel } from './ui/decorPanel.js';
import { mountHud } from './ui/hud.js';
import { IdleWatcher } from './ui/idle.js';
import { showLogin } from './ui/login.js';
import { ChatSound } from './ui/sound.js';
import { Overlay } from './ui/overlay.js';

/** Sala pedida na URL (`#/meeting`), para recarregar no mesmo lugar. */
function roomFromHash(): string {
  return findRoom(location.hash.replace(/^#\/?/, ''))?.id ?? RECEPTION.id;
}

/** Intervalo da consulta de quem está nas outras salas. */
const PRESENCE_POLL_MS = 10_000;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Não foi possível carregar ${url} (HTTP ${res.status})`);
  return res.json();
}

function placed(f: Furni): PlacedFurni {
  return { id: f.id, defId: f.defId, x: f.x, y: f.y, z: f.z, rot: f.rot };
}

function snapshot(p: Player): AvatarSnapshot {
  return {
    name: p.name,
    figure: p.figure,
    x: p.x,
    y: p.y,
    nextX: p.nextX,
    nextY: p.nextY,
    dir: p.dir,
    away: p.away,
    status: p.status,
    typing: p.typing,
    action: p.action,
    z: p.z,
  };
}

async function start(): Promise<void> {
  TextureSource.defaultOptions.scaleMode = 'nearest';

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: 0x1b1d24,
    antialias: false,
    roundPixels: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
  document.getElementById('app')!.appendChild(app.canvas);

  const [furniManifest, avatarManifest] = await Promise.all([
    fetchJson('/assets/furni/manifest.json').then(parseFurniManifest),
    fetchJson('/assets/avatar/manifest.json').then(parseAvatarManifest),
  ]);

  const loader = new AssetLoader(OFFLINE_ASSETS);
  const placeholders = new PlaceholderFactory(app.renderer, avatarManifest);
  const deps: SceneDeps = {
    loader,
    placeholders,
    avatars: new AvatarTextureCache(
      new ImagerAvatarRenderer(loader, placeholders, avatarManifest.imager),
    ),
    furniDefs: new Map<string, FurniManifestEntry>(furniManifest.items.map((i) => [i.id, i])),
  };

  /** Prévia do editor quando o imager falha: o avatar provisório em camadas, como imagem. */
  const fallbackPreview = (figure: string, dir: number) =>
    app.renderer.extract.base64(placeholders.avatar(figure, dir).texture);

  let scene: RoomScene | undefined;
  let connection: OfficeConnection | undefined;
  let session: SessionResponse | undefined;
  // Status: o escolhido pela pessoa e o "ausente" automático por inatividade.
  // O escolhido fica salvo no navegador (sobrevive ao recarregar a página).
  let manualStatus: Status = loadStatus();
  let autoAway = false;
  const effectiveStatus = (): Status => (autoAway ? 'away' : manualStatus);
  const applyStatus = () => {
    connection?.setStatus(effectiveStatus());
    overlay.setOwnStatus(effectiveStatus());
  };
  const overlay = new Overlay((status) => {
    manualStatus = status;
    saveStatus(status);
    autoAway = false;
    applyStatus();
  });
  new IdleWatcher(
    () => {
      if (manualStatus === 'away') return;
      autoAway = true;
      applyStatus();
    },
    () => {
      if (!autoAway) return;
      autoAway = false;
      applyStatus();
    },
  );

  const sound = new ChatSound();
  const chat = new ChatPanel({
    send: (text) => connection?.say(text),
    emote: (id) => connection?.emote(id),
    typing: (on) => connection?.typing(on),
  });

  // Menções com a aba escondida: contador no título até voltar.
  let unseenMentions = 0;
  const baseTitle = () => document.title.replace(/^\(@\d+\) /, '');
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && unseenMentions) {
      unseenMentions = 0;
      document.title = baseTitle();
    }
  });
  let decorating = false;
  const setDecorating = (on: boolean) => {
    decorating = on;
    scene?.decor.setActive(on);
    decorPanel.show(on);
    hud.setDecorating(on);
  };
  const decorPanel = new DecorPanel(furniManifest.items, {
    pick: (defId) => scene?.decor.pick(defId),
    rotate: () => scene?.decor.rotate(),
    remove: () => scene?.decor.removeSelected(),
    close: () => setDecorating(false),
  });
  const hud = mountHud({
    getCamera: () => scene?.camera,
    loader,
    onToggleDecor: () => setDecorating(!decorating),
    onToggleSound: () => sound.toggle(),
    soundOn: sound.enabled,
    onEditAvatar: () => void editAvatar(),
  });
  async function editAvatar(): Promise<void> {
    {
      if (!session || !connection) return;
      const choice = await openAvatarEditor({
        manifest: avatarManifest,
        figure: session.figure,
        gender: session.gender,
        fallbackPreview,
      });
      if (!choice) return;
      // O servidor valida e propaga pelo estado; erros chegam como aviso.
      connection.updateAvatar(choice);
      session = { ...session, ...choice };
      saveSession({ ...(loadSession() ?? { name: session.name }), ...choice });
    }
  }
  const avatarCard = new AvatarCard({
    goTo: (sessionId) => {
      const info = scene?.avatarInfo(sessionId);
      // O servidor leva até o tile livre mais perto da pessoa.
      if (info) connection?.move(info.tile);
    },
    mention: (name) => chat.insertMention(name),
    editAvatar: () => void editAvatar(),
  });
  hud.setRoomName(RECEPTION.name);
  app.ticker.add((ticker) => scene?.update(ticker.deltaMS));

  async function mountRoom(
    connection: OfficeConnection,
    room: OfficeRoomClient,
    layout: RoomLayoutMessage,
  ): Promise<void> {
    scene?.destroy();
    const s = new RoomScene(
      app,
      layout,
      deps,
      {
        move: (tile) => connection.move(tile),
        interact: (furniId) => connection.interact(furniId),
        placeFurni: (msg) => connection.placeFurni(msg),
        moveFurni: (msg) => connection.moveFurni(msg),
        removeFurni: (furniId) => connection.removeFurni(furniId),
        avatarClick: (sessionId, at) => {
          const info = s.avatarInfo(sessionId);
          if (info) avatarCard.show({ sessionId, ...info, roomName: layout.name }, at);
        },
      },
      {
        onPickChange: (defId) => decorPanel.setPicked(defId),
        onSelectionChange: (sel) => decorPanel.setSelected(sel),
        onError: (message) => overlay.notify(message),
      },
    );
    scene = s;
    s.decor.setActive(decorating);
    decorPanel.setPicked(null);
    hud.setRoomName(layout.name);
    history.replaceState(null, '', `#/${layout.roomId}`);
    overlay.setPeople([], layout.name);
    await s.load();
    if (scene !== s) return;
    overlay.setFading(false);
    avatarCard.hide();
    void refreshOtherRooms();
    // Cada sala começa como "Disponível": reaplica o status atual.
    if (effectiveStatus() !== 'available') connection.setStatus(effectiveStatus());
    overlay.setOwnStatus(effectiveStatus());

    const refreshPeople = () => {
      const players = [...room.state.players.entries()];
      overlay.setPeople(
        players.map(([id, p]) => ({
          id,
          name: p.name,
          away: p.away,
          isLocal: id === room.sessionId,
          status: p.status,
        })),
      );
      chat.setPeople(
        players.map(([, p]) => p.name),
        room.state.players.get(room.sessionId)?.name ?? session?.name ?? '',
      );
    };
    const cb = Callbacks.get(room);
    cb.onAdd('players', (player, id) => {
      s.addAvatar(id, snapshot(player), id === room.sessionId);
      cb.onChange(player, () => {
        s.updateAvatar(id, snapshot(player));
        refreshPeople();
      });
      refreshPeople();
    });
    cb.onRemove('players', (_player, id) => {
      s.removeAvatar(id);
      refreshPeople();
    });
    cb.onAdd('furni', (f, id) => {
      s.setFurni(id, placed(f));
      cb.onChange(f, () => s.setFurni(id, placed(f)));
    });
    cb.onRemove('furni', (_f, id) => s.removeFurni(id));

    const chatHistory = (await room.request(ClientMessage.GetChatHistory)) as ChatMessage[];
    if (scene === s) chat.setHistory(chatHistory, session?.userId ?? '');
  }

  /** Quem está nas outras salas (a lista da sala atual vem ao vivo do estado). */
  async function refreshOtherRooms(): Promise<void> {
    if (!session || !connection) return;
    try {
      const res = await fetch('/api/presence', {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (!res.ok) return;
      const body = (await res.json()) as PresenceResponse;
      overlay.setOtherRooms(body.rooms, connection.currentRoomId);
    } catch {
      // Sem rede: a lista das outras salas espera a próxima rodada.
    }
  }
  setInterval(() => void refreshOtherRooms(), PRESENCE_POLL_MS);

  async function enter(current: SessionResponse): Promise<void> {
    const conn: OfficeConnection = new OfficeConnection({
      status: (status, detail) => overlay.setStatus(status, detail),
      serverError: (err) => overlay.notify(err.message),
      chat: (msg) => {
        chat.add(msg);
        const fromOther = msg.userId !== session?.userId;
        const mentioned = fromOther && chat.mentionsMe(msg.text);
        if (mentioned) {
          sound.mention();
          overlay.notify(`${msg.name} mencionou você`);
          if (document.visibilityState === 'hidden') {
            unseenMentions++;
            document.title = `(@${unseenMentions}) ${baseTitle()}`;
          }
        } else if (fromOther) {
          sound.play();
        }
        scene?.say(msg.sessionId, msg.name, msg.text, mentioned);
      },
      emote: (msg) => scene?.playEmote(msg.sessionId, msg.emote),
      sessionInvalid: () => {
        forgetToken();
        location.reload();
      },
      transferStart: () => overlay.setFading(true),
      joined: (room, layout) => void mountRoom(conn, room, layout),
    });
    session = current;
    connection = conn;
    await conn.join(roomFromHash(), current.token);
    // Saída "educada" ao fechar/recarregar: o servidor remove o avatar na hora.
    window.addEventListener('pagehide', () => void conn.leave());
    if (import.meta.env.DEV || DEBUG) {
      Object.assign(window, { __office: { app, connection: conn, getScene: () => scene } });
    }
  }

  let notice: string | undefined;
  for (;;) {
    const result = await showLogin({ manifest: avatarManifest, fallbackPreview, notice });
    try {
      await enter(result);
      return;
    } catch (err) {
      overlay.setStatus('offline');
      if (isSessionError(err)) {
        forgetToken();
        notice = 'Sua sessão expirou. Entre novamente com o código de convite.';
      } else {
        notice = `Não foi possível entrar na sala: ${(err as Error).message}`;
      }
    }
  }
}

start().catch((err: unknown) => {
  console.error(err);
  const box = document.createElement('div');
  box.className = 'fatal';
  box.textContent = `Não foi possível iniciar o escritório: ${(err as Error).message}`;
  document.body.append(box);
});

const STATUS_KEY = 'escritorio.status';

function loadStatus(): Status {
  try {
    const saved = localStorage.getItem(STATUS_KEY);
    return STATUSES.find((s) => s === saved) ?? 'available';
  } catch {
    return 'available';
  }
}

function saveStatus(status: Status): void {
  try {
    localStorage.setItem(STATUS_KEY, status);
  } catch {
    // aba anônima ou armazenamento bloqueado: só não lembra
  }
}
