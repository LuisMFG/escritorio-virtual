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
  ROOMS,
  type Furni,
  type PlacedFurni,
  type Player,
  ClientMessage,
  type ChatMessage,
  type RoomLayoutMessage,
  type SessionResponse,
  type Status,
  type TeamResponse,
  type RoomSummary,
  STATUSES,
} from '@office/shared';
import { Application, TextureSource } from 'pixi.js';
import { AssetLoader } from './assets/AssetLoader.js';
import { AvatarTextureCache, ImagerAvatarRenderer } from './assets/AvatarTextureCache.js';
import { PlaceholderFactory } from './assets/PlaceholderFactory.js';
import { DEBUG, OFFLINE_ASSETS } from './config.js';
import type { AvatarSnapshot } from './entities/AvatarView.js';
import { isSessionError, OfficeConnection, type OfficeRoomClient } from './net/OfficeConnection.js';
import { adminApi, api, ApiRequestError } from './net/api.js';
import { forgetToken, loadSession, rememberSession, saveSession } from './net/storage.js';
import { RoomScene, type SceneDeps } from './scene/RoomScene.js';
import { AvatarCard } from './ui/avatarCard.js';
import { openAvatarEditor } from './ui/avatarEditor.js';
import { ChatPanel } from './ui/chat.js';
import { DecorPanel } from './ui/decorPanel.js';
import { mountHud } from './ui/hud.js';
import { IdleWatcher } from './ui/idle.js';
import { showClaim, showLogin } from './ui/login.js';
import { openProfile } from './ui/profile.js';
import { openTeam } from './ui/team.js';
import { openAdmin } from './ui/admin.js';
import { openRoomEditor } from './ui/roomEditor.js';
import { MessagesPanel } from './ui/messages.js';
import { SystemNotifier } from './ui/notifications.js';
import { LobbyConnection, type OnlineInfo } from './net/LobbyConnection.js';
import { confirmDialog } from './ui/confirm.js';
import { ChatSound } from './ui/sound.js';
import { Overlay } from './ui/overlay.js';

/** Sala pedida na URL (`#/meeting`), para recarregar no mesmo lugar. */
function roomFromHash(): string {
  const id = location.hash.replace(/^#\/?/, '');
  return /^[a-z0-9-]{1,40}$/.test(id) ? id : RECEPTION.id;
}

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
    cargo: p.cargo,
    cargoColor: p.cargoColor,
    birthday: p.birthday,
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
    send: (text, replyToId) => connection?.say(text, replyToId),
    react: (id, emoji) => connection?.react(id, emoji),
    emote: (id) => connection?.emote(id),
    typing: (on) => connection?.typing(on),
    remove: (id) => connection?.deleteChat(id),
  });

  // Título da aba: "(@2)" para menções vistas com a aba escondida, "(3)" para DMs não lidas.
  let unseenMentions = 0;
  let unreadDms = 0;
  const updateTitle = () => {
    const base = document.title.replace(/^(\(@?\d+\) )+/, '');
    const prefix =
      (unseenMentions ? `(@${unseenMentions}) ` : '') + (unreadDms ? `(${unreadDms}) ` : '');
    document.title = prefix + base;
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && unseenMentions) {
      unseenMentions = 0;
      updateTitle();
    }
    messages.visibilityChanged();
  });

  // Salas: começa com as iniciais e o canal global mantém a lista atualizada.
  let roomList: RoomSummary[] = ROOMS.map((r) => ({ id: r.id, name: r.name }));
  const roomName = (id: string) =>
    roomList.find((r) => r.id === id)?.name ?? findRoom(id)?.name ?? id;

  const notifier = new SystemNotifier();
  let lobby: LobbyConnection | undefined;
  let online: OnlineInfo[] = [];
  const messages = new MessagesPanel({
    get userId() {
      return session?.userId ?? '';
    },
    lobby: () => lobby,
    loadTeam: async () => {
      await loadTeam();
      return team?.members ?? [];
    },
    roomName,
    notifier,
    unreadChanged: (n) => {
      unreadDms = n;
      hud.setUnreadDms(n);
      updateTitle();
    },
  });
  const openDm = (userId: string, name: string) => messages.open({ userId, name });
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
    onOpenProfile: () => showProfile(),
    onOpenTeam: () => showTeam(),
    onOpenAdmin: () => showAdmin(),
    onOpenMessages: () => messages.toggle(),
    onEditRoom: () => {
      if (!session || !connection) return;
      const conn = connection;
      openRoomEditor({
        token: session.token,
        currentRoomId: conn.currentRoomId,
        rooms: () => roomList,
        goTo: (id) => conn.goTo(id),
        notify: (m) => overlay.notify(m),
      });
    },
  });
  function showAdmin(): void {
    if (session?.role !== 'admin') return;
    openAdmin({
      token: session.token,
      userId: session.userId,
      roomName,
    });
  }
  /** Papel mudou (um admin promoveu/rebaixou você): ajusta o que aparece. */
  function applyRole(
    role: SessionResponse['role'],
    canEditRooms = session?.canEditRooms ?? false,
  ): void {
    if (session) session = { ...session, role, canEditRooms };
    hud.setAdmin(role === 'admin');
    hud.setCanEditRooms(role === 'admin' || canEditRooms);
    chat.setAdmin(role === 'admin');
    applyDecorLock();
  }
  /** Assinaturas do estado da sala montada (desfeitas ao remontar a cena). */
  let detachRoom: (() => void)[] = [];
  let decorLocked = false;
  function applyDecorLock(): void {
    const locked = decorLocked && session?.role !== 'admin';
    hud.setDecorLocked(locked);
    if (locked && decorating) setDecorating(false);
  }
  /** Última lista da Equipe (bio e aniversário no cartão do avatar). */
  let team: TeamResponse | undefined;
  const loadTeam = async () => {
    if (!session) return;
    try {
      team = await api.team(session.token);
    } catch {
      // Sem a lista, o cartão mostra só o que vem do estado da sala.
    }
  };
  function showProfile(): void {
    if (!session) return;
    openProfile(session, {
      saved: (updated) => {
        session = updated;
        rememberSession(updated);
      },
      editAvatar: () => void editAvatar(),
      logout: (all) => void logout(all),
    });
  }
  function showTeam(): void {
    if (!session) return;
    openTeam({
      token: session.token,
      userId: session.userId,
      isAdmin: session.role === 'admin',
      roomName,
      loaded: (t) => (team = t),
      message: openDm,
    });
  }
  async function logout(all: boolean): Promise<void> {
    if (session) await api.logout(session.token, all).catch(() => undefined);
    await connection?.leave();
    await lobby?.leave();
    forgetToken();
    location.reload();
  }
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
    openProfile: () => showProfile(),
    message: openDm,
    kick: async (userId, name, scope) => {
      if (!session) return;
      if (scope === 'office') {
        const yes = await confirmDialog(
          `Tirar ${name} do escritório? A pessoa precisará entrar de novo com usuário e senha.`,
          { confirmLabel: 'Tirar', danger: true },
        );
        if (!yes) return;
      }
      try {
        await adminApi.kick(session.token, userId, scope);
        overlay.notify(
          scope === 'room' ? `${name} foi para a Recepção.` : `${name} saiu do escritório.`,
        );
      } catch (err) {
        overlay.notify((err as Error).message);
      }
    },
  });
  /** Avisos de aniversário: uma vez por pessoa por visita. */
  const birthdaysSeen = new Set<string>();
  hud.setRoomName(RECEPTION.name);
  app.ticker.add((ticker) => scene?.update(ticker.deltaMS));

  async function mountRoom(
    connection: OfficeConnection,
    room: OfficeRoomClient,
    layout: RoomLayoutMessage,
  ): Promise<void> {
    for (const off of detachRoom) off();
    detachRoom = [];
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
          const player = room.state.players.get(sessionId);
          if (!info || !player) return;
          const show = () => {
            const member = team?.members.find((m) => m.userId === player.userId);
            avatarCard.show(
              {
                sessionId,
                ...info,
                roomName: layout.name,
                username: member?.username ?? null,
                cargo: player.cargo,
                cargoColor: player.cargoColor,
                bio: member?.bio ?? '',
                birthday: member?.birthday ?? null,
                birthdayToday: player.birthday,
                userId: player.userId,
                viewerIsAdmin: session?.role === 'admin',
                canKickFromRoom: layout.roomId !== RECEPTION.id,
              },
              at,
            );
          };
          show();
          // Bio e aniversário vêm da Equipe: atualiza o cartão quando a lista chegar.
          void loadTeam().then(() => {
            if (avatarCard.isOpenFor(sessionId)) show();
          });
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
    refreshOtherRooms();
    updateTitle();
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
          cargo: p.cargo,
          cargoColor: p.cargoColor,
          birthday: p.birthday,
        })),
      );
      chat.setPeople(
        players.map(([, p]) => p.name),
        room.state.players.get(room.sessionId)?.name ?? session?.name ?? '',
      );
    };
    const cb = Callbacks.get(room);
    const keep = (off: () => void) => detachRoom.push(off);
    keep(
      cb.onAdd('players', (player, id) => {
        s.addAvatar(id, snapshot(player), id === room.sessionId);
        if (player.birthday && !birthdaysSeen.has(player.userId)) {
          birthdaysSeen.add(player.userId);
          overlay.notify(
            id === room.sessionId
              ? 'Feliz aniversário! 🎂'
              : `Hoje é aniversário de ${player.name}! 🎂`,
          );
        }
        keep(
          cb.onChange(player, () => {
            s.updateAvatar(id, snapshot(player));
            const isMe = id === room.sessionId && session;
            if (
              isMe &&
              (player.role !== session!.role || player.canEditRooms !== session!.canEditRooms)
            ) {
              applyRole(player.role === 'admin' ? 'admin' : 'member', player.canEditRooms);
            }
            refreshPeople();
          }),
        );
        refreshPeople();
      }),
    );
    keep(
      cb.onRemove('players', (_player, id) => {
        s.removeAvatar(id);
        refreshPeople();
      }),
    );
    keep(
      cb.onAdd('furni', (f, id) => {
        s.setFurni(id, placed(f));
        keep(cb.onChange(f, () => s.setFurni(id, placed(f))));
      }),
    );
    keep(cb.onRemove('furni', (_f, id) => s.removeFurni(id)));
    keep(
      cb.listen('decorLocked', (locked) => {
        decorLocked = locked;
        applyDecorLock();
      }),
    );

    const chatHistory = (await room.request(ClientMessage.GetChatHistory)) as ChatMessage[];
    if (scene === s) chat.setHistory(chatHistory, session?.userId ?? '');
  }

  /** Quem está nas outras salas, ao vivo pelo canal global (a sala atual vem do estado dela). */
  function refreshOtherRooms(): void {
    if (!connection) return;
    overlay.setOtherRooms(
      roomList.map((r) => ({
        roomId: r.id,
        name: r.name,
        people: online.filter((p) => p.roomId === r.id).map((p) => ({ name: p.name })),
      })),
      connection.currentRoomId,
    );
  }

  /** Canal global: DMs e presença. Abre depois de entrar na primeira sala. */
  async function connectLobby(token: string): Promise<void> {
    const l = new LobbyConnection(token, {
      dm: (m) => {
        messages.receive(m);
        if (m.fromUserId === session?.userId || messages.isReading(m.fromUserId)) return;
        const name = online.find((p) => p.userId === m.fromUserId)?.name ?? 'Alguém';
        sound.mention();
        if (!messages.isOpen) overlay.notify(`Mensagem de ${name}`);
        notifier.notify(`Mensagem de ${name}`, m.text, {
          tag: `dm-${m.fromUserId}`,
          onClick: () => openDm(m.fromUserId, name),
        });
      },
      receipt: (r) => messages.receipt(r),
      reactions: (u) => messages.updateReactions(u.id, u.reactions),
      error: (e) => overlay.notify(e.message),
      people: (list) => {
        online = list;
        messages.setOnline(list);
        refreshOtherRooms();
      },
      rooms: (list) => {
        roomList = list;
        refreshOtherRooms();
      },
      ready: () => void messages.refresh(),
    });
    lobby = l;
    try {
      await l.connect();
    } catch (err) {
      console.warn('[lobby] sem canal global por enquanto', err);
    }
  }

  async function enter(current: SessionResponse): Promise<void> {
    const conn: OfficeConnection = new OfficeConnection({
      status: (status, detail) => overlay.setStatus(status, detail),
      serverError: (err) => overlay.notify(err.message),
      chat: (msg) => {
        chat.add(msg);
        const fromOther = msg.userId !== session?.userId;
        const repliedToMe = fromOther && msg.replyTo?.userId === session?.userId;
        const mentioned = fromOther && (chat.mentionsMe(msg.text) || repliedToMe);
        if (mentioned) {
          const what = repliedToMe ? 'respondeu você' : 'mencionou você';
          sound.mention();
          overlay.notify(`${msg.name} ${what}`);
          notifier.notify(`${msg.name} ${what}`, msg.text, { tag: 'mencao' });
          if (document.visibilityState === 'hidden') {
            unseenMentions++;
            updateTitle();
          }
        } else if (fromOther) {
          sound.play();
        }
        scene?.say(msg.sessionId, msg.name, msg.text, mentioned);
      },
      emote: (msg) => scene?.playEmote(msg.sessionId, msg.emote),
      chatDeleted: (msg) => chat.removeMessage(msg.id),
      chatReactions: (msg) => chat.updateReactions(msg.id, msg.reactions),
      kicked: (msg) => {
        if (msg.scope === 'room') return overlay.notify(msg.message);
        // Do escritório: volta para a entrada com o aviso.
        forgetToken();
        try {
          sessionStorage.setItem(NOTICE_KEY, msg.message);
        } catch {
          // sem armazenamento: só recarrega
        }
        location.reload();
      },
      sessionInvalid: () => {
        forgetToken();
        location.reload();
      },
      transferStart: () => overlay.setFading(true),
      joined: (room, layout) => void mountRoom(conn, room, layout),
      layoutChanged: (room, layout) => void mountRoom(conn, room, layout),
    });
    session = current;
    connection = conn;
    applyRole(current.role, current.canEditRooms);
    await conn.join(roomFromHash(), current.token);
    void connectLobby(current.token);
    // Saída "educada" ao fechar/recarregar: o servidor remove o avatar na hora.
    window.addEventListener('pagehide', () => {
      void conn.leave();
      void lobby?.leave();
    });
    if (import.meta.env.DEV || DEBUG) {
      Object.assign(window, { __office: { app, connection: conn, getScene: () => scene } });
    }
  }

  let notice = takeNotice();
  let result = notice ? undefined : await resumeSession();
  for (;;) {
    result ??= await showLogin({ manifest: avatarManifest, fallbackPreview, notice });
    // Conta antiga (só o token deste navegador): escolhe usuário e senha antes de entrar.
    if (!result.username) result = await showClaim(result);
    try {
      await enter(result);
      return;
    } catch (err) {
      overlay.setStatus('offline');
      result = undefined;
      if (isSessionError(err)) {
        forgetToken();
        notice = 'Sua sessão expirou. Entre novamente.';
      } else {
        notice = `Não foi possível entrar na sala: ${(err as Error).message}`;
      }
    }
  }
}

/** Token salvo de outra visita: entra direto, sem tela de entrada. */
async function resumeSession(): Promise<SessionResponse | undefined> {
  const token = loadSession()?.token;
  if (!token) return undefined;
  try {
    const session = await api.me(token);
    rememberSession(session);
    return session;
  } catch (err) {
    // Só esquece o token se o servidor disse que ele não vale (não por falta de rede).
    if (err instanceof ApiRequestError && err.status === 401) forgetToken();
    return undefined;
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
/** Aviso para a próxima tela de entrada (ex.: "Ana tirou você do escritório."). */
const NOTICE_KEY = 'escritorio.aviso';

function takeNotice(): string | undefined {
  try {
    const notice = sessionStorage.getItem(NOTICE_KEY) ?? undefined;
    sessionStorage.removeItem(NOTICE_KEY);
    return notice;
  } catch {
    return undefined;
  }
}

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
