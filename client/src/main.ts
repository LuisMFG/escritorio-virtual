import './style.css';
// Sem isto o Pixi usa `eval` para shaders, e a CSP de produção (sem 'unsafe-eval') o bloqueia.
import 'pixi.js/unsafe-eval';
import { Callbacks } from '@colyseus/sdk';
import {
  parseAvatarManifest,
  parseFurniManifest,
  findRoom,
  findAchievement,
  KUDOS_INFO,
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
  type WbStroke,
  dayLight,
  officeHour,
  STATUSES,
} from '@office/shared';
import { Application, TextureSource } from 'pixi.js';
import { AssetLoader } from './assets/AssetLoader.js';
import { AvatarTextureCache, ImagerAvatarRenderer } from './assets/AvatarTextureCache.js';
import { PlaceholderFactory } from './assets/PlaceholderFactory.js';
import { DEBUG, HOUR_OVERRIDE, OFFLINE_ASSETS } from './config.js';
import type { AvatarSnapshot } from './entities/AvatarView.js';
import { isSessionError, OfficeConnection, type OfficeRoomClient } from './net/OfficeConnection.js';
import { adminApi, announcementApi, api, ApiRequestError } from './net/api.js';
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
import { showAchievementToast } from './ui/badges.js';
import { exposeForTests } from './e2e.js';
import { AnnouncementBanner, openAnnouncements } from './ui/announcements.js';
import { openKudosForm, openKudosWall } from './ui/kudos.js';
import { FocusController } from './ui/focus.js';
import { openMinimap } from './ui/minimap.js';
import { openTeam } from './ui/team.js';
import { openAdmin } from './ui/admin.js';
import { openRoomEditor } from './ui/roomEditor.js';
import { AmbientSound } from './ui/ambient.js';
import { openBoard } from './ui/board.js';
import { openWhiteboard, type WhiteboardHandle } from './ui/whiteboard.js';
import type { PetSnapshot } from './entities/PetView.js';
import { openTicTacToe, type TicTacToeHandle, type TttView } from './ui/ticTacToe.js';
import { renderThumbnail } from './ui/wbDraw.js';
import { openAgenda, type AgendaHandle } from './ui/agenda.js';
import { showReminder } from './ui/reminder.js';
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
  return { id: f.id, defId: f.defId, x: f.x, y: f.y, z: f.z, rot: f.rot, state: f.state };
}

/** Luz do dia agora, no fuso de quem está olhando (ou na hora forçada por `?hora=`). */
function currentLight() {
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return dayLight(HOUR_OVERRIDE ?? officeHour(new Date(), localZone));
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
    focusUntil: p.focusUntil,
    focusKind: p.focusKind,
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
  // Voltando da página do Spotify (?spotify=ok|erro|cancelado): avisa e limpa o endereço.
  const spotifyResult = new URLSearchParams(location.search).get('spotify');
  if (spotifyResult) {
    history.replaceState(null, '', location.pathname + location.hash);
    setTimeout(() => {
      overlay.notify(
        spotifyResult === 'ok'
          ? '🎵 Spotify conectado! A música que você ouvir aparece no seu cartão.'
          : spotifyResult === 'cancelado'
            ? 'Conexão com o Spotify cancelada.'
            : 'Não foi possível conectar o Spotify. Tente de novo.',
      );
    }, 1500);
  }
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
    createPoll: (poll) => connection?.createPoll(poll),
    votePoll: (id, option) => connection?.votePoll(id, option),
    closePoll: (id) => connection?.closePoll(id),
  });

  // Título da aba: "(@2)" para menções vistas com a aba escondida, "(3)" para DMs não lidas.
  let unseenMentions = 0;
  let unreadDms = 0;
  /** "🍅 18:32 " na aba enquanto o foco roda. */
  let focusTitle = '';
  const updateTitle = () => {
    const base = document.title.replace(/^((\(@?\d+\)|[🍅☕] \d+:\d\d) )+/u, '');
    const prefix =
      (focusTitle ? `${focusTitle} ` : '') +
      (unseenMentions ? `(@${unseenMentions}) ` : '') +
      (unreadDms ? `(${unreadDms}) ` : '');
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
  const ambient = new AmbientSound();
  /** Mural aberto (para atualizar quando alguém pregar ou tirar recado). */
  let board: ReturnType<typeof openBoard> | null = null;
  // Quadros brancos da sala: traços (para a janela) e miniatura no móvel.
  const wbStrokes = new Map<string, WbStroke[]>();
  const wbThumbs = new Map<string, HTMLCanvasElement>();
  let whiteboard: WhiteboardHandle | null = null;
  /** Jogo da velha aberto (mesa de jogos). */
  let ttt: TicTacToeHandle | null = null;
  let agenda: AgendaHandle | null = null;
  /** Avisos da diretoria: faixa com os não lidos e o painel com o histórico. */
  let annPanel: ReturnType<typeof openAnnouncements> | null = null;
  const annBanner = new AnnouncementBanner(
    () => session?.token ?? '',
    () => showAnnouncements(),
    (n) => hud.setUnreadAnnouncements(n),
  );
  /** Mural de elogios aberto (atualiza quando chega elogio novo). */
  let kudosWall: ReturnType<typeof openKudosWall> | null = null;
  function showKudosWall(): void {
    if (!session) return;
    kudosWall?.close();
    kudosWall = openKudosWall({
      token: session.token,
      myUserId: session.userId,
      loadTeam: async () => {
        await loadTeam();
        return team?.members ?? [];
      },
      praise: (to) => praise(to.userId, to.name),
    });
  }
  function praise(userId: string, name: string): void {
    if (!session) return;
    openKudosForm({
      token: session.token,
      to: { userId, name },
      sent: (k) => overlay.notify(`${KUDOS_INFO[k.type].emoji} Elogio enviado para ${k.toName}!`),
    });
  }
  /** Minimapa aberto (atualiza com a presença) e quem estamos indo encontrar. */
  let minimap: ReturnType<typeof openMinimap> | null = null;
  let approach: string | null = null;
  function showMap(): void {
    if (!session || !connection) return;
    const conn = connection;
    minimap?.close();
    minimap = openMinimap({
      token: session.token,
      myUserId: session.userId,
      currentRoomId: () => conn.currentRoomId,
      people: () => online,
      meetingOf: (id) => roomList.find((r) => r.id === id)?.meeting ?? '',
      goToRoom: (id) => conn.goTo(id),
      goToPerson: (p) => {
        if (p.roomId === conn.currentRoomId) return approachPerson(p.userId);
        approach = p.userId;
        conn.goTo(p.roomId);
      },
    });
  }
  /** Anda até perto de alguém da sala atual (o servidor escolhe o tile livre mais perto). */
  function approachPerson(userId: string): void {
    const room = connection?.currentRoom;
    const target = room && [...room.state.players.values()].find((p) => p.userId === userId);
    if (target) connection?.move({ x: target.x, y: target.y });
  }
  function showAnnouncements(): void {
    if (!session) return;
    annPanel?.close();
    annPanel = openAnnouncements({
      token: session.token,
      isAdmin: session.role === 'admin',
      onRead: (id) => annBanner.markedRead(id),
    });
  }
  const busyRooms = () =>
    new Map(roomList.flatMap((r) => (r.meeting ? [[r.id, r.meeting] as [string, string]] : [])));
  const updateThumb = (furniId: string) => {
    const canvas = renderThumbnail(wbStrokes.get(furniId) ?? [], wbThumbs.get(furniId));
    wbThumbs.set(furniId, canvas);
    scene?.setWhiteboardThumb(furniId, canvas);
  };
  /** Carrega os traços de um quadro da sala (uma vez por montagem). */
  const loadWhiteboard = async (furniId: string) => {
    if (!connection) return;
    wbStrokes.set(furniId, await connection.wbLoad(furniId));
    updateThumb(furniId);
    whiteboard?.redraw();
  };
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
    onOpenAnnouncements: () => showAnnouncements(),
    onOpenMap: () => showMap(),
    onOpenAgenda: () => {
      if (!session || !connection) return;
      const conn = connection;
      agenda?.close();
      agenda = openAgenda({
        token: session.token,
        userId: session.userId,
        isAdmin: session.role === 'admin',
        rooms: () => roomList,
        loadTeam: async () => {
          await loadTeam();
          return team?.members ?? [];
        },
        goTo: (id) => conn.goTo(id),
        currentRoomId: conn.currentRoomId,
      });
    },
    ambient,
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
  // Modo foco (Pomodoro): botão 🍅 do HUD, contagem e avisos segurados.
  const focus = new FocusController(hud.focusButton, {
    start: (minutes, breakMinutes) => connection?.focusStart(minutes, breakMinutes),
    stop: () => connection?.focusStop(),
    notify: (m) => overlay.notify(m),
    systemNotify: (title, body) => notifier.notify(title, body, { tag: 'foco' }),
    sound: () => sound.mention(),
    title: (prefix) => {
      focusTitle = prefix ?? '';
      updateTitle();
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
  function showProfile(focusAchievements = false): void {
    if (!session) return;
    openProfile(session, {
      focusAchievements,
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
      praise: (userId, name) => praise(userId, name),
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
    praise: (userId, name) => praise(userId, name),
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
  // Dia e noite acompanham o relógio (de minuto em minuto).
  setInterval(() => scene?.setDayLight(currentLight()), 60_000);

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
        openWhiteboard: (furniId) => {
          const f = room.state.furni.get(furniId);
          const def = f && deps.furniDefs.get(f.defId);
          if (!def) return;
          whiteboard?.close();
          whiteboard = openWhiteboard({
            furniId,
            title: def.name,
            strokes: () => wbStrokes.get(furniId) ?? [],
            mySessionId: () => connection.sessionId,
            stroke: (stroke, draftId) => connection.wbStroke(furniId, stroke, draftId),
            draft: (d) => connection.wbDraft({ ...d, furniId }),
            undo: () => connection.wbUndo(furniId),
            clear: () => connection.wbClear(furniId),
          });
        },
        openGame: (furniId) => {
          ttt?.close();
          ttt = openTicTacToe({
            furniId,
            mySessionId: () => connection.sessionId,
            join: () => connection.tttJoin(furniId),
            leave: () => connection.tttLeave(furniId),
            move: (cell) => connection.tttMove(furniId, cell),
            rematch: () => connection.tttRematch(furniId),
            loadScores: () => connection.tttScores(furniId),
          });
          ttt.update((room.state.games.get(furniId)?.toJSON() as TttView | undefined) ?? null);
        },
        openKudos: () => showKudosWall(),
        openBoard: (furniId) => {
          const f = room.state.furni.get(furniId);
          const def = f && deps.furniDefs.get(f.defId);
          if (!def || !session) return;
          board?.close();
          board = openBoard({
            furniId,
            title: def.name,
            myUserId: session.userId,
            isAdmin: session.role === 'admin',
            load: () => connection.boardNotes(furniId),
            add: (text, color) => connection.boardAdd(furniId, text, color),
            remove: (noteId) => connection.boardRemove(noteId),
          });
        },
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
                badges: player.badges,
                activity: player.activity,
                activityUrl: player.activityUrl,
                focusUntil: player.focusUntil,
                focusKind: player.focusKind,
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
    exposeForTests(s, room);
    s.decor.setActive(decorating);
    decorPanel.setPicked(null);
    hud.setRoomName(layout.name);
    history.replaceState(null, '', `#/${layout.roomId}`);
    overlay.setPeople([], layout.name);
    await s.load();
    if (scene !== s) return;
    s.setDayLight(currentLight());
    s.setBusyRooms(busyRooms());
    ambient.setAmbient(layout.ambient);
    hud.refreshAmbient();
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
          activity: p.activity,
          focusKind: p.focusUntil > Date.now() ? p.focusKind : '',
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
    wbStrokes.clear();
    whiteboard?.close();
    keep(
      cb.onAdd('furni', (f, id) => {
        s.setFurni(id, placed(f));
        if (deps.furniDefs.get(f.defId)?.interaction === 'whiteboard') void loadWhiteboard(id);
        keep(cb.onChange(f, () => s.setFurni(id, placed(f))));
      }),
    );
    keep(cb.onRemove('furni', (_f, id) => s.removeFurni(id)));
    // Jogo da velha: tabuleiro no tampo da mesa e painel aberto, ao vivo.
    ttt?.close();
    const syncGame = (id: string, g: TttView | null) => {
      s.setGame(id, g && { board: g.board, line: g.line ? g.line.split(',').map(Number) : [] });
      if (ttt?.furniId === id) ttt.update(g);
    };
    keep(
      cb.onAdd('games', (g, id) => {
        syncGame(id, g.toJSON() as TttView);
        keep(cb.onChange(g, () => syncGame(id, g.toJSON() as TttView)));
      }),
    );
    keep(cb.onRemove('games', (_g, id) => syncGame(id, null)));
    // Pets de quem está na sala.
    keep(
      cb.onAdd('pets', (pet, id) => {
        s.setPet(id, pet.toJSON() as PetSnapshot);
        keep(cb.onChange(pet, () => s.setPet(id, pet.toJSON() as PetSnapshot)));
      }),
    );
    keep(cb.onRemove('pets', (_p, id) => s.removePet(id)));
    keep(
      cb.listen('decorLocked', (locked) => {
        decorLocked = locked;
        applyDecorLock();
      }),
    );

    // Veio pelo mapa para encontrar alguém: anda até perto da pessoa.
    if (approach) {
      const who = approach;
      approach = null;
      setTimeout(() => approachPerson(who), 300);
    }
    const chatHistory = (await room.request(ClientMessage.GetChatHistory)) as ChatMessage[];
    if (scene === s) chat.setHistory(chatHistory, session?.userId ?? '');
  }

  /** Quem está nas outras salas, ao vivo pelo canal global (a sala atual vem do estado dela). */
  function refreshOtherRooms(): void {
    if (!connection) return;
    overlay.setOtherRooms(
      roomList.map((r) => ({
        roomId: r.id,
        name: r.meeting ? `${r.name} · 🔴 em reunião` : r.name,
        people: online
          .filter((p) => p.roomId === r.id)
          .map((p) => ({ name: p.name, activity: p.activity })),
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
        // Em foco: sem som nem aviso (entra no resumo do fim).
        if (focus.focusing) return focus.hold('dms');
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
        minimap?.refresh();
        messages.setOnline(list);
        refreshOtherRooms();
      },
      rooms: (list) => {
        roomList = list;
        minimap?.refresh();
        refreshOtherRooms();
        scene?.setBusyRooms(busyRooms());
      },
      meetingsChanged: () => agenda?.refresh(),
      meetingInvite: ({ meeting }) => {
        const when = new Date(meeting.startsAt).toLocaleString('pt-BR', {
          weekday: 'short',
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
        const text = `${meeting.createdByName} convidou você para “${meeting.title}” (${when}).`;
        sound.mention();
        overlay.notify(text);
        notifier.notify('Convite de reunião', text, { tag: `meeting-${meeting.id}` });
      },
      meetingReminder: ({ meeting }) => {
        sound.mention();
        showReminder(meeting, (id) => connection?.goTo(id));
        notifier.notify('Reunião em 5 minutos', `${meeting.title} · ${meeting.roomName}`, {
          tag: `reminder-${meeting.id}`,
        });
      },
      achievement: ({ id }) => {
        const def = findAchievement(id);
        if (!def) return;
        sound.mention();
        // Perfil aberto: a lista de conquistas se atualiza sozinha.
        window.dispatchEvent(new CustomEvent('achievement-unlocked', { detail: id }));
        showAchievementToast(def, () => {
          const open = document.querySelector('.profile-achievements');
          if (open) open.scrollIntoView({ block: 'start' });
          else showProfile(true);
        });
        notifier.notify('Conquista desbloqueada!', `${def.emoji} ${def.name}`, {
          tag: `conquista-${id}`,
        });
      },
      announcement: ({ announcement: a }) => {
        annPanel?.refresh();
        if (a.read) return;
        annBanner.add(a);
        sound.mention();
        if (a.urgent) notifier.notify(`🚨 ${a.title}`, a.body, { tag: `aviso-${a.id}` });
      },
      kudosReceived: ({ kudos: k }) => {
        const info = KUDOS_INFO[k.type];
        if (focus.focusing) return focus.hold('kudos');
        sound.mention();
        overlay.notify(`${info.emoji} ${k.fromName} te elogiou: “${k.message}”`);
        notifier.notify(`${info.emoji} ${k.fromName} te elogiou`, k.message, {
          tag: `kudos-${k.id}`,
        });
      },
      kudosChanged: () => kudosWall?.refresh(),
      announcementRemoved: (id) => {
        annBanner.remove(id);
        annPanel?.refresh();
      },
      ready: () => {
        void messages.refresh();
        // Avisos que a pessoa ainda não leu (inclusive os de antes de ela entrar).
        if (session) {
          void announcementApi
            .unread(session.token)
            .then((list) => annBanner.set(list))
            .catch(() => undefined);
        }
      },
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
        if (mentioned && focus.focusing) {
          focus.hold('mentions');
        } else if (mentioned) {
          const what = repliedToMe ? 'respondeu você' : 'mencionou você';
          sound.mention();
          overlay.notify(`${msg.name} ${what}`);
          notifier.notify(`${msg.name} ${what}`, msg.text, { tag: 'mencao' });
          if (document.visibilityState === 'hidden') {
            unseenMentions++;
            updateTitle();
          }
        } else if (fromOther && !focus.focusing) {
          sound.play();
        }
        scene?.say(msg.sessionId, msg.name, msg.text, mentioned);
      },
      emote: (msg) => scene?.playEmote(msg.sessionId, msg.emote),
      chatDeleted: (msg) => chat.removeMessage(msg.id),
      wbStroke: (msg) => {
        const list = wbStrokes.get(msg.furniId) ?? [];
        if (!list.some((x) => x.id === msg.stroke.id)) list.push(msg.stroke);
        wbStrokes.set(msg.furniId, list);
        updateThumb(msg.furniId);
        if (whiteboard?.furniId === msg.furniId) whiteboard.stroke(msg);
      },
      wbDraft: (msg) => {
        if (whiteboard?.furniId === msg.furniId) whiteboard.draft(msg);
      },
      wbRemoved: (msg) => {
        const gone = new Set(msg.ids);
        wbStrokes.set(
          msg.furniId,
          (wbStrokes.get(msg.furniId) ?? []).filter((x) => !gone.has(x.id)),
        );
        updateThumb(msg.furniId);
        if (whiteboard?.furniId === msg.furniId) whiteboard.redraw();
      },
      wbCleared: (furniId) => {
        wbStrokes.set(furniId, []);
        updateThumb(furniId);
        if (whiteboard?.furniId === furniId) whiteboard.redraw();
      },
      boardChanged: (furniId) => {
        if (board?.furniId === furniId) board.refresh();
      },
      chatReactions: (msg) => chat.updateReactions(msg.id, msg.reactions),
      pollUpdated: ({ poll }) => chat.updatePoll(poll),
      focusPhase: (p) => focus.phase(p),
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
  let result = notice ? undefined : await resumeSession((d) => overlay.setStatus('connecting', d));
  let attempts = 0;
  for (;;) {
    result ??= await showLogin({ manifest: avatarManifest, fallbackPreview, notice });
    // Conta antiga (só o token deste navegador): escolhe usuário e senha antes de entrar.
    if (!result.username) result = await showClaim(result);
    try {
      await enter(result);
      return;
    } catch (err) {
      if (isSessionError(err)) {
        overlay.setStatus('offline');
        forgetToken();
        result = undefined;
        notice = 'Sua sessão expirou. Entre novamente.';
      } else if (attempts < RETRY_DELAYS_MS.length) {
        // Servidor reiniciando (ex.: deploy): tenta de novo sem pedir a senha.
        const delay = RETRY_DELAYS_MS[attempts++]!;
        overlay.setStatus(
          'reconnecting',
          `Servidor indisponível. Tentando de novo em ${delay / 1000}s…`,
        );
        await new Promise((r) => setTimeout(r, delay));
      } else {
        overlay.setStatus('offline');
        result = undefined;
        attempts = 0;
        notice = `Não foi possível entrar na sala: ${(err as Error).message}`;
      }
    }
  }
}

/** Esperas entre tentativas quando o servidor não responde (reinício, deploy). */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

/**
 * Token salvo de outra visita: entra direto, sem tela de entrada. Se o servidor não responder
 * (reiniciando), espera e tenta de novo antes de desistir.
 */
async function resumeSession(
  status: (detail: string) => void,
): Promise<SessionResponse | undefined> {
  const token = loadSession()?.token;
  if (!token) return undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      const session = await api.me(token);
      rememberSession(session);
      return session;
    } catch (err) {
      // Só esquece o token se o servidor disse que ele não vale (não por falta de rede).
      if (err instanceof ApiRequestError && err.status === 401) {
        forgetToken();
        return undefined;
      }
      if (attempt >= RETRY_DELAYS_MS.length) return undefined;
      const delay = RETRY_DELAYS_MS[attempt]!;
      status(`Servidor indisponível. Tentando de novo em ${delay / 1000}s…`);
      await new Promise((r) => setTimeout(r, delay));
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
