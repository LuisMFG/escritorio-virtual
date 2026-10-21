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
  DESK_ROOM_ID,
  type FurniPlaceMessage,
  deskSeatIds,
} from '@office/shared';
import { Application, TextureSource } from 'pixi.js';
import { AssetLoader } from './assets/AssetLoader.js';
import { AvatarTextureCache, ImagerAvatarRenderer } from './assets/AvatarTextureCache.js';
import { FigureAvatarRenderer } from './assets/FigureAvatarRenderer.js';
import { EffectLibrary } from './assets/EffectLibrary.js';
import { PlaceholderFactory } from './assets/PlaceholderFactory.js';
import { DEBUG, FORCE_IMAGER, HOUR_OVERRIDE, OFFLINE_ASSETS } from './config.js';
import type { AvatarSnapshot } from './entities/AvatarView.js';
import { isSessionError, OfficeConnection, type OfficeRoomClient } from './net/OfficeConnection.js';
import {
  adminApi,
  announcementApi,
  api,
  ApiRequestError,
  furniApi,
  teleportApi,
  jiraApi,
  looksApi,
} from './net/api.js';
import { forgetToken, loadSession, rememberSession, saveSession } from './net/storage.js';
import { RoomScene, type SceneDeps } from './scene/RoomScene.js';
import { AvatarCard } from './ui/avatarCard.js';
import { openAvatarEditor } from './ui/avatarEditor.js';
import { ChatPanel } from './ui/chat.js';
import { DecorPanel } from './ui/decorPanel.js';
import { FurniDefStore } from './assets/FurniDefStore.js';
import { FurniVisualLibrary } from './assets/FurniVisualLibrary.js';
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
import { openSearch, setUploadToken } from './ui/attachments.js';
import { openJiraBoard, renderJiraThumb } from './ui/jiraBoard.js';
import { openTeam } from './ui/team.js';
import { openAdmin } from './ui/admin.js';
import { openRoomEditor } from './ui/roomEditor.js';
import { AmbientSound } from './ui/ambient.js';
import { openBoard } from './ui/board.js';
import { openWhiteboard, type WhiteboardHandle } from './ui/whiteboard.js';
import { TvPanel } from './ui/tv.js';
import { drawTvCover } from './tv/cover.js';
import { fakePlayer, youTubePlayer, youTubePlaylist } from './tv/player.js';
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
import {
  applyTheme,
  currentTheme,
  loadTheme,
  onThemeChange,
  THEME_BACKGROUND,
} from './ui/theme.js';
import { DeskChip } from './ui/desk.js';
import { openSettings } from './ui/settings.js';
import { applyPrefs, loadDayLight } from './ui/prefs.js';
import { openHelp, tipOnce } from './ui/help.js';
import { takeTourPending, Tour } from './ui/tour.js';
import { BootScreen } from './ui/boot.js';
import { DecorHistory } from './scene/DecorHistory.js';
import { installModalFocus } from './ui/a11y.js';
import { CallManager } from './net/CallManager.js';
import { CallPanel, IncomingCalls, openCallInvite } from './ui/calls.js';

const E2E_MODE = new URLSearchParams(location.search).has('e2e');
const TOUR_IN_E2E = new URLSearchParams(location.search).has('tour');

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

/**
 * Luz do dia agora, no fuso de quem está olhando (ou na hora forçada por `?hora=`). Desligada
 * em Configurações (o padrão), a sala fica sempre com a cor do dia.
 */
function currentLight() {
  if (HOUR_OVERRIDE === null && !loadDayLight()) return dayLight(12);
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return dayLight(HOUR_OVERRIDE ?? officeHour(new Date(), localZone));
}

/**
 * Faixas da tela cobertas pela interface (Fase 41): conversa aberta à esquerda, barra de baixo,
 * coluna de câmera à direita e o nome da sala em cima. A câmera enquadra a sala no que sobra.
 */
function uiInsets() {
  const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
  const history = document.querySelector<HTMLDetailsElement>('.chat-history');
  const dock = rect('.hud-actions');
  const tools = rect('.hud-zoom');
  const chatBar = rect('.chat-bar');
  const bottomEdge = Math.min(dock?.top ?? innerHeight, chatBar?.top ?? innerHeight);
  return {
    top: Math.round(rect('.hud-card')?.bottom ?? 0),
    right: tools ? Math.round(innerWidth - tools.left) : 0,
    bottom: Math.round(innerHeight - bottomEdge),
    left: history?.open ? Math.round(history.getBoundingClientRect().right) : 0,
  };
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
    effect: p.effect,
    handItem: p.handItem,
  };
}

async function start(): Promise<void> {
  const boot = new BootScreen();
  installModalFocus();
  TextureSource.defaultOptions.scaleMode = 'nearest';

  applyTheme(loadTheme());
  applyPrefs();
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: THEME_BACKGROUND[currentTheme()],
    antialias: false,
    roundPixels: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
  document.getElementById('app')!.appendChild(app.canvas);
  onThemeChange((t) => (app.renderer.background.color = THEME_BACKGROUND[t]));

  const [furniManifest, avatarManifest] = await Promise.all([
    fetchJson('/assets/furni/manifest.json').then(parseFurniManifest),
    fetchJson('/assets/avatar/manifest.json').then(parseAvatarManifest),
  ]);

  let session: SessionResponse | undefined;
  // Móveis: os curados do manifesto mais os do catálogo completo, buscados quando aparecem.
  const furniStore = new FurniDefStore(
    new Map<string, FurniManifestEntry>(furniManifest.items.map((i) => [i.id, i])),
    () => session?.token,
  );
  const loader = new AssetLoader(OFFLINE_ASSETS);
  const placeholders = new PlaceholderFactory(app.renderer, avatarManifest);
  const deps: SceneDeps = {
    loader,
    placeholders,
    // Avatar montado no navegador (Fase 31); `?imager=1` volta ao imager, para comparar.
    avatars: new AvatarTextureCache(
      OFFLINE_ASSETS || FORCE_IMAGER
        ? new ImagerAvatarRenderer(loader, placeholders, avatarManifest.imager)
        : new FigureAvatarRenderer(
            new ImagerAvatarRenderer(loader, placeholders, avatarManifest.imager),
          ),
    ),
    furniDefs: furniStore.defs,
    requestDef: (id) => furniStore.ensure(id),
    effects: new EffectLibrary(!OFFLINE_ASSETS),
    furniVisuals: new FurniVisualLibrary(!OFFLINE_ASSETS),
  };

  /** Prévia do editor quando o imager falha: o avatar provisório em camadas, como imagem. */
  const fallbackPreview = (figure: string, dir: number) =>
    app.renderer.extract.base64(placeholders.avatar(figure, dir).texture);

  let scene: RoomScene | undefined;
  let connection: OfficeConnection | undefined;
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
    send: (text, replyToId, attachmentId) => {
      connection?.say(text, replyToId, attachmentId);
      tour?.notify('chat');
    },
    notify: (message) => overlay.notify(message),
    search: () =>
      openSearch({
        openRoomHit: (hit) => {
          if (hit.where === connection?.currentRoomId && chat.showMessage(hit.id)) return;
          if (hit.where === connection?.currentRoomId) {
            overlay.notify('Essa mensagem já saiu do histórico recente da sala.');
            return;
          }
          overlay.notify(`Mensagem na sala ${hit.whereName}. Indo para lá…`);
          connection?.goTo(hit.where);
        },
        openDmHit: (hit) => void messages.showMessage(hit.where, hit.whereName, hit.id),
      }),
    react: (id, emoji) => connection?.react(id, emoji),
    emote: (id) => {
      connection?.emote(id);
      tour?.notify('emote');
    },
    posture: (p) => connection?.posture(p),
    dropItem: () => connection?.dropItem(),
    typing: (on) => connection?.typing(on),
    remove: (id) => connection?.deleteChat(id),
    createPoll: (poll) => connection?.createPoll(poll),
    votePoll: (id, option) => connection?.votePoll(id, option),
    closePoll: (id) => connection?.closePoll(id),
  });
  const refit = () => scene?.camera.setInsets(uiInsets());
  chat.onToggle(() => requestAnimationFrame(refit));
  window.addEventListener('resize', () => requestAnimationFrame(refit));

  // Setas ← →: vira o avatar sem sair do lugar (parado ou sentado no chão).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable], [role=dialog]')) return;
    if (document.querySelector('.modal-backdrop, .login-backdrop')) return;
    e.preventDefault();
    connection?.turn(e.key === 'ArrowRight' ? 1 : -1);
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
  /** TV aberta (Fase 51) e o que passa em cada TV da sala (capa na tela do móvel). */
  let tvPanel: TvPanel | null = null;
  const tvScreens = new Map<string, string>();
  const tvCovers = new Map<string, HTMLCanvasElement>();
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
      sent: (k) =>
        overlay.notify(`${KUDOS_INFO[k.type].emoji} Elogio enviado para ${k.toName}!`, {
          kind: 'success',
        }),
    });
  }
  /** Minimapa aberto (atualiza com a presença) e quem estamos indo encontrar. */
  let minimap: ReturnType<typeof openMinimap> | null = null;
  let approach: string | null = null;
  /** Tour guiado (Fase 44): começa sozinho para conta nova; refaz pela ajuda. */
  let tour: Tour | null = null;
  function startTour(): void {
    tour?.stop();
    tour = new Tour(session?.name ?? '');
    tour.start();
  }
  function showHelp(): void {
    openHelp({ restartTour: startTour });
  }
  // "?" abre a ajuda (fora de campos de texto e janelas).
  document.addEventListener('keydown', (e) => {
    if (e.key !== '?' || e.isComposing) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable=true], [role=dialog]')) return;
    if (document.querySelector('.modal-backdrop, .login-backdrop')) return;
    e.preventDefault();
    showHelp();
  });
  // Gaveta (celular): arrastar o cabeçalho para baixo fecha a janela (as janelas fecham com Esc).
  let sheetDrag: { y: number; sheet: HTMLElement } | null = null;
  document.addEventListener('pointerdown', (e) => {
    const head = (e.target as HTMLElement).closest('.modal-backdrop > .sheet > .sheet-head');
    if (!head || e.pointerType !== 'touch' || (e.target as HTMLElement).closest('button')) return;
    sheetDrag = { y: e.clientY, sheet: head.parentElement as HTMLElement };
  });
  document.addEventListener('pointermove', (e) => {
    if (!sheetDrag) return;
    const dy = Math.max(0, e.clientY - sheetDrag.y);
    sheetDrag.sheet.style.transform = `translateY(${dy}px)`;
  });
  document.addEventListener('pointerup', (e) => {
    if (!sheetDrag) return;
    const { sheet, y } = sheetDrag;
    sheetDrag = null;
    sheet.style.transform = '';
    if (e.clientY - y > 90) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  // Teclado do celular (Fase 46): mede quanto ele cobre e sobe o campo do chat (iOS não
  // encolhe a página sozinho); com o teclado aberto a barra de baixo sai da frente.
  const vv = window.visualViewport;
  if (vv) {
    const onViewport = () => {
      const kb = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
      document.documentElement.style.setProperty('--kb', `${kb}px`);
      document.body.classList.toggle('kb-open', kb > 80);
    };
    vv.addEventListener('resize', onViewport);
    vv.addEventListener('scroll', onViewport);
  }
  // Alt segurado: nomes de todos sobre os avatares (afastados para não encavalar).
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt') scene?.setAllNames(true);
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') scene?.setAllNames(false);
  });
  window.addEventListener('blur', () => scene?.setAllNames(false));
  // Clique na lista de pessoas: câmera até a pessoa (ou vai até a sala dela).
  overlay.onPick((t) => {
    if (t.sessionId) {
      scene?.focusAvatar(t.sessionId);
      return;
    }
    if (!t.userId || !t.roomId || !connection) return;
    approach = t.userId;
    connection.goTo(t.roomId);
  });
  /** Minha mesa (Fase 42): ir até ela depois de chegar na Recepção; convite só ao entrar. */
  let pendingDesk = false;
  let deskOffered = false;
  const deskChip = new DeskChip({
    claim: (seat) => connection?.claimDesk(seat),
    release: () => connection?.releaseDesk(),
    goToDesk: () => goToMyDesk(),
  });
  function goToMyDesk(): void {
    if (!connection) return;
    if (connection.currentRoomId === DESK_ROOM_ID) return connection.goToDesk();
    pendingDesk = true;
    connection.goTo(DESK_ROOM_ID);
  }
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
  // Quadros de Demandas da sala: mini-kanban no papel, atualizado a cada minuto.
  const jiraFurni = new Set<string>();
  let jiraCanvas: HTMLCanvasElement | undefined;
  const refreshJiraThumbs = async () => {
    if (!session || jiraFurni.size === 0) return;
    const board = await jiraApi.board(session.token).catch(() => null);
    jiraCanvas = renderJiraThumb(board, jiraCanvas);
    for (const id of jiraFurni) scene?.setWhiteboardThumb(id, jiraCanvas);
  };
  setInterval(() => void refreshJiraThumbs(), 60_000);
  /** Mostra (ou apaga) a capa do vídeo na tela de uma TV da sala. */
  const applyTvScreen = (furniId: string, videoId: string | null) => {
    if (!videoId) {
      tvScreens.delete(furniId);
      scene?.clearSurface(furniId);
      return;
    }
    tvScreens.set(furniId, videoId);
    const canvas = tvCovers.get(furniId) ?? document.createElement('canvas');
    tvCovers.set(furniId, canvas);
    void drawTvCover(canvas, videoId).then(() => {
      if (tvScreens.get(furniId) === videoId) scene?.setWhiteboardThumb(furniId, canvas);
    });
  };
  const closeTv = () => {
    if (!tvPanel) return;
    connection?.tvClose(tvPanel.furniId);
    tvPanel.close();
    tvPanel = null;
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
    notify: (message) => overlay.notify(message),
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
    if (on) {
      tipOnce('decorar', () =>
        overlay.notify(
          'Dica: escolha um móvel no catálogo e clique no piso. Clique num móvel para mover; R gira, Delete tira.',
          9000,
        ),
      );
    }
    scene?.decor.setActive(on);
    decorPanel.show(on);
    hud.setDecorating(on);
  };
  const decorPanel = new DecorPanel(
    furniManifest.items,
    {
      pick: (defId) => scene?.decor.pick(defId),
      rotate: () => scene?.decor.rotate(),
      remove: () => scene?.decor.removeSelected(),
      color: (defId) => {
        // A definição da cor nova precisa existir antes do estado chegar com ela.
        void furniStore.ensure(defId).then((d) => {
          if (d) scene?.decor.setColor(defId);
          else overlay.notify('Não consegui trocar a cor agora. Tente de novo.', { kind: 'error' });
        });
      },
      close: () => setDecorating(false),
      undo: () => void decorHistory.undo(),
      redo: () => void decorHistory.redo(),
      prepare: async (defId) => Boolean(await furniStore.ensure(defId)),
      teleports: () => (session ? teleportApi.list(session.token) : Promise.resolve([])),
      linkTeleport: (id, targetId) =>
        session ? teleportApi.link(session.token, id, targetId) : Promise.resolve([]),
      loadCatalog: async () => {
        const [catalog, config] = await Promise.all([
          furniStore.catalog(),
          session ? furniApi.config(session.token) : Promise.resolve({ hiddenCategories: [] }),
        ]);
        return { catalog, hidden: config.hiddenCategories };
      },
    },
    !OFFLINE_ASSETS,
  ); // Desfazer/refazer do Decorar (Fase 47): espera o móvel colocado aparecer para saber o id.
  const placedWaiters: { msg: FurniPlaceMessage; done: (id: string | null) => void }[] = [];
  const resolvePlaced = (defId: string, x: number, y: number, id: string) => {
    const i = placedWaiters.findIndex(
      (w) => w.msg.defId === defId && w.msg.x === x && w.msg.y === y,
    );
    if (i >= 0) placedWaiters.splice(i, 1)[0]!.done(id);
  };
  const decorHistory = new DecorHistory(
    {
      place: (m) => connection?.placeFurni(m),
      move: (m) => connection?.moveFurni(m),
      remove: (id) => connection?.removeFurni(id),
      color: (m) => connection?.colorFurni(m),
      awaitPlaced: (msg) =>
        new Promise((resolve) => {
          const w = {
            msg,
            done: (id: string | null) => {
              clearTimeout(timer);
              resolve(id);
            },
          };
          const timer = window.setTimeout(() => {
            const k = placedWaiters.indexOf(w);
            if (k >= 0) placedWaiters.splice(k, 1);
            resolve(null);
          }, 4000);
          placedWaiters.push(w);
        }),
    },
    (canUndo, canRedo) => decorPanel.setHistory(canUndo, canRedo),
  );
  document.addEventListener('keydown', (e) => {
    if (!decorating || !(e.ctrlKey || e.metaKey)) return;
    if ((e.target as HTMLElement).closest('input, textarea, [role=dialog]')) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      void decorHistory.undo();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      void decorHistory.redo();
    }
  });

  const hud = mountHud({
    getCamera: () => scene?.camera,
    onCenterSelf: () => scene?.centerOnSelf(),
    onGoToDesk: () => goToMyDesk(),
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
    onOpenHelp: () => showHelp(),
    onOpenSettings: () =>
      openSettings({
        sound,
        onSoundChange: (on) => hud.setSoundOn(on),
        ambient,
        notifier,
        assetStatus: () => (session?.role === 'admin' ? hud.assetStatus : null),
        onDayLightChange: () => scene?.setDayLight(currentLight()),
      }),
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
      onFurniCategories: (hidden) => decorPanel.setHidden(hidden),
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
      tab: focusAchievements ? 'conquistas' : undefined,
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
    calls?.leave();
    closeTv();
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
        thumbnails: !OFFLINE_ASSETS,
        looks: {
          load: () => looksApi.list(session!.token),
          save: (slot, c) => looksApi.save(session!.token, slot, c),
          remove: (slot) => looksApi.remove(session!.token, slot),
        },
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
    callMode: (userId) => {
      if (!calls) return 'none';
      if (calls.hasMember(userId)) return 'with';
      return calls.state ? 'add' : 'call';
    },
    call: (userId, name) => {
      const c = calls;
      if (!c) return;
      openCallInvite({ name }, Boolean(c.state), (reason) => {
        c.invite(userId, reason);
        overlay.notify(`Chamando ${name}…`);
      });
    },
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
        openTv: (furniId) => {
          const f = room.state.furni.get(furniId);
          const def = f && deps.furniDefs.get(f.defId);
          if (!def || !session) return;
          if (tvPanel?.furniId === furniId) return;
          closeTv();
          const id = furniId;
          tvPanel = new TvPanel({
            furniId: id,
            title: def.name,
            myUserId: session.userId,
            isAdmin: session.role === 'admin',
            player: E2E_MODE ? fakePlayer : youTubePlayer,
            on: {
              add: (ids) => connection.tvAdd(id, ids),
              remove: (itemId) => connection.tvRemove(id, itemId),
              control: (action, at) => connection.tvControl(id, action, at),
              skip: () => connection.tvSkip(id),
              duration: (itemId, d) => connection.tvDuration(id, itemId, d),
              ended: (itemId) => connection.tvEnded(id, itemId),
              playlist: (listId, from) =>
                E2E_MODE ? Promise.resolve([]) : youTubePlaylist(listId, from),
              close: closeTv,
            },
          });
          connection.tvOpen(id);
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
        openJira: () => {
          if (!session) return;
          openJiraBoard({
            token: session.token,
            myUserId: session.userId,
            openProfile: () => showProfile(),
          });
        },
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
        placeFurni: (msg) => {
          connection.placeFurni(msg);
          decorPanel.markRecent(msg.defId);
          void decorHistory.recordPlace(msg);
        },
        moveFurni: (msg) => {
          const f = room.state.furni.get(msg.furniId);
          if (f) {
            decorHistory.recordMove(
              msg.furniId,
              {
                x: f.x,
                y: f.y,
                rot: f.rot as FurniPlaceMessage['rot'],
                ...(msg.z !== undefined ? { z: f.z } : {}),
              },
              { x: msg.x, y: msg.y, rot: msg.rot, ...(msg.z !== undefined ? { z: msg.z } : {}) },
            );
          }
          connection.moveFurni(msg);
        },
        removeFurni: (furniId) => {
          // Desfazer (Fase 45): guarda onde estava e põe de volta igual.
          const f = room.state.furni.get(furniId);
          connection.removeFurni(furniId);
          if (!f) return;
          const wall = deps.furniDefs.get(f.defId)?.wall ?? false;
          const back: FurniPlaceMessage = {
            defId: f.defId,
            x: f.x,
            y: f.y,
            rot: f.rot as FurniPlaceMessage['rot'],
            ...(wall ? { z: f.z } : {}),
          };
          decorHistory.recordRemove(furniId, back);
          const name = deps.furniDefs.get(f.defId)?.name ?? 'Móvel';
          overlay.notify(`${name} removido.`, {
            action: { label: 'Desfazer', run: () => void decorHistory.undo() },
          });
        },
        colorFurni: (msg) => {
          const before = room.state.furni.get(msg.furniId)?.defId;
          if (before) decorHistory.recordColor(msg.furniId, before, msg.defId);
          connection.colorFurni(msg);
        },
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
    s.camera.setInsets(uiInsets());
    await s.load();
    if (scene !== s) return;
    boot.step('art');
    s.setDayLight(currentLight());
    s.setBusyRooms(busyRooms());
    ambient.setAmbient(layout.ambient);
    overlay.setFading(false);
    avatarCard.hide();
    refreshOtherRooms();
    updateTitle();
    // Cada sala começa como "Disponível": reaplica o status atual.
    if (effectiveStatus() !== 'available') connection.setStatus(effectiveStatus());
    overlay.setOwnStatus(effectiveStatus());

    let lastPos: { x: number; y: number } | null = null;
    /** Faixa da mesa, botão "Minha mesa" e plaquinhas, a partir do estado da sala. */
    const refreshDesk = () => {
      const me = room.state.players.get(room.sessionId);
      if (!me) return;
      const myDesk = me.desk;
      hud.setDesk(myDesk !== '');
      if (myDesk) tour?.notify('desk');
      if (lastPos && (lastPos.x !== me.x || lastPos.y !== me.y)) tour?.notify('move');
      lastPos = { x: me.x, y: me.y };
      let seat: string | null = null;
      if (layout.roomId === DESK_ROOM_ID && me.action === 'sit') {
        const seats = deskSeatIds(room.state.furni.keys());
        for (const id of seats) {
          const f = room.state.furni.get(id);
          if (f && f.x === me.x && f.y === me.y) seat = id;
        }
      }
      deskChip.update({ seat, owner: seat ? room.state.desks.get(seat) : undefined, myDesk });
      if (!deskOffered) {
        deskOffered = true;
        if (myDesk && seat !== myDesk) deskChip.offerGo();
      }
    };
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
            if (id === room.sessionId) refreshDesk();
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
        if (id === room.sessionId) refreshDesk();
      }),
    );
    keep(
      cb.onRemove('players', (_player, id) => {
        s.removeAvatar(id);
        refreshPeople();
      }),
    );
    // Jukebox ligada na sala (Fase 37): a música toca para quem está com o som ligado.
    const refreshJukebox = () =>
      ambient.setJukebox(
        [...room.state.furni.values()].some(
          (f) => f.state > 0 && deps.furniDefs.get(f.defId)?.interaction === 'jukebox',
        ),
      );
    ambient.setJukebox(false);
    wbStrokes.clear();
    decorHistory.clear();
    jiraFurni.clear();
    whiteboard?.close();
    // TVs: a janela é da sala anterior; as telas desta sala vêm do servidor.
    closeTv();
    tvScreens.clear();
    void connection.tvScreens().then((screens) => {
      if (scene !== s) return;
      for (const [id, v] of Object.entries(screens)) applyTvScreen(id, v);
    });
    keep(
      cb.onAdd('furni', (f, id) => {
        resolvePlaced(f.defId, f.x, f.y, id);
        s.setFurni(id, placed(f));
        refreshJukebox();
        const interaction = deps.furniDefs.get(f.defId)?.interaction;
        if (interaction === 'whiteboard') void loadWhiteboard(id);
        if (interaction === 'tv' && tvScreens.has(id)) applyTvScreen(id, tvScreens.get(id)!);
        if (interaction === 'jira') {
          jiraFurni.add(id);
          if (jiraCanvas) s.setWhiteboardThumb(id, jiraCanvas);
          else void refreshJiraThumbs();
        }
        keep(
          cb.onChange(f, () => {
            s.setFurni(id, placed(f));
            refreshJukebox();
          }),
        );
      }),
    );
    keep(
      cb.onRemove('furni', (_f, id) => {
        s.removeFurni(id);
        if (tvPanel?.furniId === id) closeTv();
        tvScreens.delete(id);
        refreshJukebox();
        jiraFurni.delete(id);
      }),
    );
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
    // Plaquinhas das mesas (só a Recepção tem).
    const syncDesks = () => {
      s.setDeskOwners(new Map(room.state.desks.entries()));
      refreshDesk();
    };
    keep(cb.onAdd('desks', syncDesks));
    keep(cb.onChange('desks', syncDesks));
    keep(cb.onRemove('desks', syncDesks));
    keep(
      cb.listen('decorLocked', (locked) => {
        decorLocked = locked;
        applyDecorLock();
      }),
    );

    // Conta recém-criada: tour guiado na primeira entrada.
    // (Nos testes de ponta a ponta só com `&tour=1`, para não cobrir o que eles clicam.)
    if (!tour && takeTourPending() && (!E2E_MODE || TOUR_IN_E2E)) setTimeout(startTour, 800);
    // Veio pelo "Minha mesa" de outra sala: vai até a mesa e senta.
    if (pendingDesk && layout.roomId === DESK_ROOM_ID) {
      pendingDesk = false;
      setTimeout(() => connection?.goToDesk(), 300);
    }
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
          .map((p) => ({ name: p.name, userId: p.userId, activity: p.activity })),
      })),
      connection.currentRoomId,
    );
  }

  /** Canal global: DMs e presença. Abre depois de entrar na primeira sala. */
  // ---------- Chamadas de áudio por convite (Fase 49) ----------
  let calls: CallManager | null = null;
  const incomingCalls = new IncomingCalls((id, accept) => calls?.answer(id, accept));
  let callPanel: CallPanel | null = null;
  const CALL_RESULTS: Record<string, (name: string) => [string, 'success' | 'info' | 'error']> = {
    accepted: (n) => [`${n} entrou na chamada.`, 'success'],
    declined: (n) => [`${n} recusou a chamada.`, 'info'],
    expired: (n) => [`${n} não respondeu.`, 'info'],
    busy: (n) => [`${n || 'A pessoa'} está em outra chamada.`, 'info'],
    offline: (n) => [`${n || 'A pessoa'} não está no escritório agora.`, 'info'],
    full: () => ['A chamada está cheia (até 6 pessoas).', 'error'],
  };
  function setupCalls(l: LobbyConnection): void {
    if (!session) return;
    const me = session.userId;
    callPanel ??= new CallPanel(me, {
      mute: (m) => calls?.setMuted(m),
      leave: () => calls?.leave(),
      isMuted: () => calls?.isMuted ?? false,
      camera: async (on) => (await calls?.setCamera(on)) ?? false,
      screen: async (on) => (await calls?.setScreen(on)) ?? false,
      cameraOn: () => calls?.cameraOn ?? false,
      screenOn: () => calls?.screenOn ?? false,
      devices: async () => (await calls?.devices()) ?? { mics: [], cams: [] },
      useMic: async (id) => calls?.useMic(id),
      useCam: async (id) => calls?.useCam(id),
    });
    const panel = callPanel;
    calls = new CallManager(l, me, {
      state: (st) => {
        panel.set(st);
        if (!st) scene?.setSpeaking(new Set());
      },
      invited: (invite) => {
        incomingCalls.add(invite);
        if (!invite.quiet) sound.ring();
        notifier.notify(
          `${invite.fromName} está chamando você`,
          invite.reason || 'Chamada de áudio',
          { tag: `chamada-${invite.id}` },
        );
      },
      inviteGone: (id) => incomingCalls.remove(id),
      result: (r) => {
        const make = CALL_RESULTS[r.outcome];
        if (!make) return;
        const [text, kind] = make(r.toName);
        overlay.notify(text, { kind });
      },
      speaking: (ids) => {
        panel.setSpeaking(ids);
        const room = connection?.currentRoom;
        if (!room) return;
        const sessions = new Set<string>();
        for (const [sid, p] of room.state.players.entries())
          if (ids.has(p.userId)) sessions.add(sid);
        scene?.setSpeaking(sessions);
      },
      videos: (v) => panel.setVideos(v),
      error: (message) => overlay.notify(message, { kind: 'error', durationMs: 6000 }),
    });
  }

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
      error: (e) => overlay.notify(e.message, { kind: 'error' }),
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
    setupCalls(l);
    if (E2E_MODE) (window as unknown as { __e2eLobby: LobbyConnection }).__e2eLobby = l;
    try {
      await l.connect();
    } catch (err) {
      console.warn('[lobby] sem canal global por enquanto', err);
    }
  }

  async function enter(current: SessionResponse): Promise<void> {
    boot.step('room');
    const conn: OfficeConnection = new OfficeConnection({
      status: (status, detail) => overlay.setStatus(status, detail),
      serverError: (err) => overlay.notify(err.message, { kind: 'error', durationMs: 5000 }),
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
        scene?.say(
          msg.sessionId,
          msg.name,
          msg.text || (msg.attachment ? `📎 ${msg.attachment.name}` : ''),
          mentioned,
        );
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
      tvState: (st) => {
        if (tvPanel?.furniId === st.furniId) tvPanel.set(st);
      },
      tvScreens: (screens) => {
        for (const [id, v] of Object.entries(screens)) applyTvScreen(id, v);
      },
      tvError: (message) => {
        if (tvPanel) tvPanel.error(message);
        else overlay.notify(message, { kind: 'error' });
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
      effectFlash: (msg) => scene?.flashEffect(msg.sessionId, msg.effect, msg.ms),
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
    setUploadToken(current.token);
    await furniStore.loadMeasured();
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
  boot.step('connect');
  let result = notice ? undefined : await resumeSession((d) => overlay.setStatus('connecting', d));
  let attempts = 0;
  for (;;) {
    if (!result) boot.hide();
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
