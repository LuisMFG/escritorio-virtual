import { icon, setIcon, type IconName } from './icons.js';
import type { CallInvite } from '@office/shared';
import { currentTheme, onThemeChange, THEME_BACKGROUND } from './theme.js';
import { attachToasterToPip } from './toasts.js';

/**
 * Interface da API Document Picture-in-Picture nativa dos navegadores Chromium.
 * Permite destacar qualquer HTML/Canvas para uma janela flutuante Always-on-Top no Windows/SO.
 */
export interface DocumentPictureInPicture {
  requestWindow(options?: {
    width?: number;
    height?: number;
    disallowReturnToOpener?: boolean;
  }): Promise<Window>;
  window: Window | null;
  onenter?: (event: Event) => void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

export interface PipCallStatus {
  active: boolean;
  muted: boolean;
  members?: string[];
  toggleMute: () => void;
  leave?: () => void;
}

export interface OpenPipOptions {
  app?: any;
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  chatElement?: HTMLElement;
  getCallElements?: () => { panel?: HTMLElement; mini?: HTMLElement };
  avatarCardElement?: HTMLElement | (() => HTMLElement | undefined);
  deskElement?: HTMLElement | (() => HTMLElement | undefined);
  getRoomName: () => string;
  onCenterSelf?: () => void;
  onFit?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResize?: () => void;
  onClose?: () => void;
  getCallStatus?: () => PipCallStatus;
  onSendMessage?: (text: string) => void;
  onTurn?: (dir: 1 | -1) => void;
}

let activePipWindow: Window | null = null;
let currentRoomTitleEl: HTMLElement | null = null;
let micBtnEl: HTMLButtonElement | null = null;
let leaveBtnEl: HTMLButtonElement | null = null;
let callPillEl: HTMLElement | null = null;
let currentGetCallStatus: (() => PipCallStatus) | null = null;

interface PipIncomingInvite {
  invite: CallInvite;
  onAnswer: (inviteId: string, accept: boolean) => void;
}
const activePipInvites = new Map<string, { el: HTMLElement; timer: number }>();
let pendingPipInvites: PipIncomingInvite[] = [];
let pipIncomingContainer: HTMLElement | null = null;

/** Verifica se o navegador atual suporta Document Picture-in-Picture. */
export function isPipSupported(): boolean {
  return typeof window !== 'undefined' && 'documentPictureInPicture' in window;
}

/** Verifica se a janela flutuante está ativa no momento. */
export function isPipActive(): boolean {
  return Boolean(activePipWindow && !activePipWindow.closed);
}

/** Devolve o Document da janela flutuante se ela estiver aberta, ou null */
export function getPipDocument(): Document | null {
  return activePipWindow && !activePipWindow.closed ? activePipWindow.document : null;
}

/** Devolve a Window da janela flutuante se ela estiver aberta, ou null */
export function getPipWindow(): Window | null {
  return activePipWindow && !activePipWindow.closed ? activePipWindow : null;
}

/** Anexa o cartão de perfil/avatar à janela flutuante se ela estiver ativa */
export function attachAvatarCardToPip(cardElement?: HTMLElement): void {
  if (!activePipWindow || activePipWindow.closed || !cardElement) return;
  const shell = activePipWindow.document.querySelector('.pip-shell');
  if (shell && !shell.contains(cardElement)) shell.append(cardElement);
}

/** Anexa a faixa da mesa (desk-chip) à janela flutuante se ela estiver ativa */
export function attachDeskToPip(deskElement?: HTMLElement): void {
  if (!activePipWindow || activePipWindow.closed || !deskElement) return;
  const shell = activePipWindow.document.querySelector('.pip-shell');
  if (shell && !shell.contains(deskElement)) shell.append(deskElement);
}

/** Anexa os elementos da chamada (painel e mini) à janela flutuante se ela estiver ativa */
export function attachCallElementsToPip(panel?: HTMLElement, mini?: HTMLElement): void {
  if (!activePipWindow || activePipWindow.closed) return;
  const shell = activePipWindow.document.querySelector('.pip-shell');
  if (shell) {
    if (panel && !shell.contains(panel)) shell.append(panel);
    if (mini && !shell.contains(mini)) shell.append(mini);
  }
}

/** Atualiza o nome da sala exibido na janela flutuante. */
export function updatePipRoomName(name: string): void {
  if (currentRoomTitleEl) {
    currentRoomTitleEl.textContent = name;
  }
}

/** Atualiza os controles de chamada (ex.: microfone mudo/aberto) na janela flutuante. */
export function updatePipCallUi(): void {
  if (!micBtnEl || !currentGetCallStatus) return;
  const status = currentGetCallStatus();
  micBtnEl.hidden = !status.active;
  if (leaveBtnEl) leaveBtnEl.hidden = !status.active;
  if (callPillEl) {
    callPillEl.hidden = !status.active;
    if (status.active) {
      const count = status.members?.length ?? 0;
      callPillEl.textContent = count > 1 ? `Em chamada (${count})` : 'Em chamada';
    }
  }
  if (!status.active) return;

  const iconName: IconName = status.muted ? 'mic-off' : 'mic';
  setIcon(micBtnEl, iconName);
  const title = status.muted ? 'Ativar microfone' : 'Desativar microfone';
  micBtnEl.title = title;
  micBtnEl.setAttribute('aria-label', title);
  micBtnEl.classList.toggle('muted', status.muted);
}

/** Exibe a notificação de chamada recebida diretamente na janela flutuante */
export function showPipIncomingCall(
  invite: CallInvite,
  onAnswer: (inviteId: string, accept: boolean) => void,
): void {
  removePipIncomingCall(invite.id);
  if (!activePipWindow || activePipWindow.closed || !pipIncomingContainer) {
    pendingPipInvites.push({ invite, onAnswer });
    return;
  }

  const pipDoc = activePipWindow.document;
  const card = pipDoc.createElement('section');
  card.className = 'pip-incoming-call-card';
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-label', `${invite.fromName} está chamando você`);

  const head = pipDoc.createElement('div');
  head.className = 'pip-call-head';

  const iconWrap = pipDoc.createElement('div');
  iconWrap.className = 'pip-call-icon-wrap';
  iconWrap.append(icon('phone', 18));

  const textWrap = pipDoc.createElement('div');
  textWrap.className = 'pip-call-text-wrap';

  const callerName = pipDoc.createElement('strong');
  callerName.className = 'pip-call-caller';
  callerName.textContent = invite.fromName;

  const callPrompt = pipDoc.createElement('span');
  callPrompt.className = 'pip-call-prompt';
  callPrompt.textContent = ' está chamando você';

  const reason = pipDoc.createElement('p');
  reason.className = 'pip-call-reason';
  reason.textContent = invite.reason ? `“${invite.reason}”` : 'Chamada de áudio';

  textWrap.append(callerName, callPrompt, reason);

  if (invite.members && invite.members.length > 1) {
    const membersEl = pipDoc.createElement('small');
    membersEl.className = 'pip-call-members';
    membersEl.textContent = `Na conversa: ${invite.members.join(', ')}`;
    textWrap.append(membersEl);
  }

  head.append(iconWrap, textWrap);

  const timeBar = pipDoc.createElement('div');
  timeBar.className = 'pip-call-time-bar';
  const fill = pipDoc.createElement('span');
  fill.className = 'pip-call-time-fill';
  timeBar.append(fill);

  const actions = pipDoc.createElement('div');
  actions.className = 'pip-call-actions';

  const declineBtn = pipDoc.createElement('button');
  declineBtn.type = 'button';
  declineBtn.className = 'pip-btn-call-decline';
  declineBtn.textContent = 'Recusar';
  declineBtn.addEventListener('click', () => {
    onAnswer(invite.id, false);
    removePipIncomingCall(invite.id);
  });

  const acceptBtn = pipDoc.createElement('button');
  acceptBtn.type = 'button';
  acceptBtn.className = 'pip-btn-call-accept';
  acceptBtn.append(icon('phone', 16), ' Atender');
  acceptBtn.addEventListener('click', () => {
    onAnswer(invite.id, true);
    removePipIncomingCall(invite.id);
  });

  actions.append(declineBtn, acceptBtn);
  card.append(head, timeBar, actions);

  pipIncomingContainer.append(card);

  const total = Math.max(1, invite.expiresAt - Date.now());
  const tick = () => {
    const left = invite.expiresAt - Date.now();
    fill.style.width = `${Math.max(0, (left / total) * 100)}%`;
    if (left <= 0) removePipIncomingCall(invite.id);
  };
  tick();

  const timer = activePipWindow.setInterval(tick, 250);
  activePipInvites.set(invite.id, { el: card, timer });
}

/** Remove a notificação de chamada da janela flutuante quando aceita, recusada ou expirada */
export function removePipIncomingCall(inviteId: string): void {
  pendingPipInvites = pendingPipInvites.filter((p) => p.invite.id !== inviteId);
  const item = activePipInvites.get(inviteId);
  if (item) {
    if (activePipWindow) {
      activePipWindow.clearInterval(item.timer);
    }
    item.el.remove();
    activePipInvites.delete(inviteId);
  }
}

/**
 * Abre o escritório virtual em uma janela flutuante redimensionável (Always on Top)
 * utilizando a Document Picture-in-Picture API ou fallback para popup.
 */
export async function openPip(options: OpenPipOptions): Promise<Window | null> {
  // Se já estiver aberta, foca nela
  if (isPipActive() && activePipWindow) {
    activePipWindow.focus();
    return activePipWindow;
  }

  currentGetCallStatus = options.getCallStatus ?? null;

  let pipWin: Window | null = null;
  if (isPipSupported()) {
    try {
      pipWin = await window.documentPictureInPicture!.requestWindow({
        width: 480,
        height: 380,
      });
    } catch (err) {
      console.warn('Document Picture-in-Picture falhou, tentando fallback popup:', err);
      pipWin = null;
    }
  }

  // Fallback para janela popup no Windows (ex.: Opera GX sem flag)
  if (!pipWin) {
    const left = Math.max(0, (window.screen?.availWidth ?? 1200) - 500);
    const top = Math.max(0, (window.screen?.availHeight ?? 800) - 420);
    pipWin = window.open(
      '',
      'EscritorioVirtualFlutuante',
      `width=480,height=380,left=${left},top=${top},resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no`,
    );
    if (pipWin?.document) {
      pipWin.document.open();
      pipWin.document.write(
        '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Escritório Virtual</title></head><body></body></html>',
      );
      pipWin.document.close();
    }
  }

  if (!pipWin) {
    return null;
  }

  activePipWindow = pipWin;
  if (options.app) {
    options.app.resizeTo = null;
  }

  const pipDoc = pipWin.document;
  pipDoc.title = `${options.getRoomName()} · Escritório Virtual (Flutuante)`;

  // Copia o tema atual (dark/light) e background
  const theme = currentTheme();
  pipDoc.documentElement.dataset.theme = theme;
  pipDoc.body.style.margin = '0';
  pipDoc.body.style.padding = '0';
  pipDoc.body.style.overflow = 'hidden';
  pipDoc.body.style.background = `#${THEME_BACKGROUND[theme].toString(16).padStart(6, '0')}`;
  pipDoc.body.classList.add('pip-body-window');

  // Ajusta suavização durante downscaling no PiP
  // (Pixi v8 gerencia roundPixels internamente no pipeline de shaders)

  // Copia estilos do documento pai para manter fontes, botões e cores idênticos
  for (const sheet of document.querySelectorAll('link[rel="stylesheet"], style')) {
    pipDoc.head.appendChild(sheet.cloneNode(true));
  }

  // Sincroniza tema caso troque durante o uso do PiP
  const stopTheme = onThemeChange((t) => {
    if (!pipWin.closed) {
      pipDoc.documentElement.dataset.theme = t;
      pipDoc.body.style.background = `#${THEME_BACKGROUND[t].toString(16).padStart(6, '0')}`;
    }
  });

  // Estrutura interna da janela flutuante
  const shell = pipDoc.createElement('div');
  shell.className = 'pip-shell';

  // Barra de ferramentas superior compacta
  const topbar = pipDoc.createElement('header');
  topbar.className = 'pip-topbar';

  const roomInfo = pipDoc.createElement('div');
  roomInfo.className = 'pip-room-info';
  const roomDot = pipDoc.createElement('span');
  roomDot.className = 'pip-status-dot';
  const roomName = pipDoc.createElement('span');
  roomName.className = 'pip-room-name';
  roomName.textContent = options.getRoomName();
  currentRoomTitleEl = roomName;
  roomInfo.append(roomDot, roomName);

  const callPill = pipDoc.createElement('div');
  callPill.className = 'pip-call-pill';
  callPill.hidden = true;
  const callPillDot = pipDoc.createElement('span');
  callPillDot.className = 'pip-call-pill-dot';
  const callPillText = pipDoc.createElement('span');
  callPillText.textContent = 'Em chamada';
  callPill.append(callPillDot, callPillText);
  callPillEl = callPillText;
  roomInfo.append(callPill);

  const actions = pipDoc.createElement('div');
  actions.className = 'pip-topbar-actions';

  // Botão para abrir/fechar a sidebar de chat
  let chatSidebar: HTMLElement | null = null;
  if (options.chatElement) {
    const chatBtn = pipDoc.createElement('button');
    chatBtn.type = 'button';
    chatBtn.className = 'pip-btn pip-btn-chat';
    chatBtn.title = 'Conversa lateral (Chat)';
    chatBtn.setAttribute('aria-label', 'Conversa lateral (Chat)');
    chatBtn.append(icon('message-square', 16));
    chatBtn.addEventListener('click', () => {
      if (chatSidebar) {
        chatSidebar.hidden = !chatSidebar.hidden;
        chatBtn.classList.toggle('on', !chatSidebar.hidden);
        updateCanvasSize();
      }
    });
    actions.append(chatBtn);
  }

  // Botão de microfone rápido (se estiver em chamada)
  const micBtn = pipDoc.createElement('button');
  micBtn.type = 'button';
  micBtn.className = 'pip-btn pip-btn-mic';
  micBtn.append(icon('mic', 16));
  micBtn.hidden = true;
  micBtn.addEventListener('click', () => {
    if (currentGetCallStatus) {
      const s = currentGetCallStatus();
      s.toggleMute();
      updatePipCallUi();
    }
  });
  micBtnEl = micBtn;

  // Botão sair da chamada (se estiver em chamada)
  const leaveBtn = pipDoc.createElement('button');
  leaveBtn.type = 'button';
  leaveBtn.className = 'pip-btn pip-btn-call-leave';
  leaveBtn.title = 'Desconectar da chamada';
  leaveBtn.setAttribute('aria-label', 'Desconectar da chamada');
  leaveBtn.append(icon('phone-off', 16));
  leaveBtn.hidden = true;
  leaveBtn.addEventListener('click', () => {
    if (currentGetCallStatus) {
      const s = currentGetCallStatus();
      s.leave?.();
      updatePipCallUi();
    }
  });
  leaveBtnEl = leaveBtn;
  updatePipCallUi();

  // Botão centralizar em mim (Zoom 1x nítido 1-para-1)
  const centerBtn = pipDoc.createElement('button');
  centerBtn.type = 'button';
  centerBtn.className = 'pip-btn';
  centerBtn.title = 'Centralizar no meu avatar (Zoom 1x nítido)';
  centerBtn.setAttribute('aria-label', 'Centralizar no meu avatar (Zoom 1x nítido)');
  centerBtn.append(icon('locate-fixed', 16));
  centerBtn.addEventListener('click', () => options.onCenterSelf?.());

  // Botão enquadrar sala
  const fitBtn = pipDoc.createElement('button');
  fitBtn.type = 'button';
  fitBtn.className = 'pip-btn';
  fitBtn.title = 'Enquadrar sala';
  fitBtn.setAttribute('aria-label', 'Enquadrar sala');
  fitBtn.append(icon('scan', 16));
  fitBtn.addEventListener('click', () => options.onFit?.());

  // Botão aproximar zoom (Zoom In)
  let zoomInBtn: HTMLButtonElement | null = null;
  if (options.onZoomIn) {
    zoomInBtn = pipDoc.createElement('button');
    zoomInBtn.type = 'button';
    zoomInBtn.className = 'pip-btn pip-btn-zoom';
    zoomInBtn.title = 'Aproximar zoom (+)';
    zoomInBtn.setAttribute('aria-label', 'Aproximar zoom');
    zoomInBtn.append(icon('plus', 16));
    zoomInBtn.addEventListener('click', () => options.onZoomIn?.());
  }

  // Botão afastar zoom (Zoom Out)
  let zoomOutBtn: HTMLButtonElement | null = null;
  if (options.onZoomOut) {
    zoomOutBtn = pipDoc.createElement('button');
    zoomOutBtn.type = 'button';
    zoomOutBtn.className = 'pip-btn pip-btn-zoom';
    zoomOutBtn.title = 'Afastar zoom (-)';
    zoomOutBtn.setAttribute('aria-label', 'Afastar zoom');
    zoomOutBtn.append(icon('minus', 16));
    zoomOutBtn.addEventListener('click', () => options.onZoomOut?.());
  }

  // Botão para restaurar / fechar
  const restoreBtn = pipDoc.createElement('button');
  restoreBtn.type = 'button';
  restoreBtn.className = 'pip-btn pip-btn-restore';
  restoreBtn.title = 'Restaurar para a aba do navegador';
  restoreBtn.setAttribute('aria-label', 'Restaurar para a aba do navegador');
  restoreBtn.append(icon('maximize', 16));
  restoreBtn.addEventListener('click', () => closePip());

  // Botão alternar preenchimento total vs 4:3
  let fillWindow = true;
  const aspectBtn = pipDoc.createElement('button');
  aspectBtn.type = 'button';
  aspectBtn.className = 'pip-btn pip-btn-aspect on';
  aspectBtn.title = 'Preenchimento total (sem faixas pretas nas laterais)';
  aspectBtn.setAttribute('aria-label', 'Alternar proporção da tela');
  aspectBtn.append(icon('expand', 16));
  aspectBtn.addEventListener('click', () => {
    fillWindow = !fillWindow;
    aspectBtn.classList.toggle('on', fillWindow);
    aspectBtn.title = fillWindow
      ? 'Preenchimento total (sem faixas pretas nas laterais)'
      : 'Travar proporção fixa em 4:3';
    updateCanvasSize(true);
  });

  actions.append(micBtn, leaveBtn, centerBtn, fitBtn);
  if (zoomInBtn) actions.append(zoomInBtn);
  if (zoomOutBtn) actions.append(zoomOutBtn);
  actions.append(aspectBtn, restoreBtn);
  topbar.append(roomInfo, actions);

  // Área principal de conteúdo (Canvas central com proporções travadas + Sidebar de Chat)
  const mainView = pipDoc.createElement('div');
  mainView.className = 'pip-main-view';

  const canvasHost = pipDoc.createElement('div');
  canvasHost.className = 'pip-canvas-host';

  const canvasBox = pipDoc.createElement('div');
  canvasBox.className = 'pip-canvas-box';
  canvasBox.append(options.canvas);
  canvasHost.append(canvasBox);
  mainView.append(canvasHost);

  // Encaminha a roda do mouse (zoom) na área externa/bordas do canvasHost para o canvas
  const onHostWheel = (e: WheelEvent) => {
    if (e.target !== options.canvas) {
      options.canvas.dispatchEvent(
        new WheelEvent('wheel', {
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaZ: e.deltaZ,
          deltaMode: e.deltaMode,
          clientX: e.clientX,
          clientY: e.clientY,
          screenX: e.screenX,
          screenY: e.screenY,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  };
  canvasHost.addEventListener('wheel', onHostWheel, { passive: false });

  let lastW = -1;
  let lastH = -1;
  let lastRes = -1;
  let resizeRaf = 0;

  // Trava a proporção em 4:3 ou preenche 100%, adaptando ao espaço livre
  const updateCanvasSize = (force = false) => {
    if (!activePipWindow || activePipWindow.closed) return;
    const hostW = canvasHost.clientWidth;
    const hostH = canvasHost.clientHeight;
    if (!hostW || !hostH) return;

    let boxW = hostW;
    let boxH = hostH;

    if (!fillWindow) {
      const targetRatio = 4 / 3;
      boxW = hostW;
      boxH = Math.round(boxW / targetRatio);

      if (boxH > hostH) {
        boxH = hostH;
        boxW = Math.round(boxH * targetRatio);
      }
    }

    canvasBox.style.width = fillWindow ? '100%' : `${boxW}px`;
    canvasBox.style.height = fillWindow ? '100%' : `${boxH}px`;
    canvasBox.style.borderRadius = fillWindow ? '0' : 'var(--radius-sm)';
    canvasBox.style.boxShadow = fillWindow ? 'none' : '0 4px 16px rgba(0, 0, 0, 0.35)';

    let targetResolution = 1;
    if (options.app?.renderer) {
      const pipDpr = activePipWindow.devicePixelRatio || window.devicePixelRatio || 1;
      // Supersampling Anti-Aliasing (SSAA):
      // Quando a janela flutuante estiver em dimensões reduzidas (ex: 240-450px), renderizamos
      // o WebGL com resolução 2x a 3.5x superior e deixamos o CSS suavizar na saída (downsampling).
      // Isso elimina o efeito serrilhado, restaura a integridade de olhos/bocas/roupas dos avatares
      // e preserva a geometria das paredes/móveis mesmo em miniaturas de 280x210.
      targetResolution = Math.min(3, Math.max(pipDpr, 2));
      if (boxW < 360 || boxH < 280) {
        targetResolution = Math.min(3.5, Math.max(pipDpr * 2, 2.75));
      } else if (boxW < 480 || boxH < 360) {
        targetResolution = Math.min(3, Math.max(pipDpr * 1.5, 2.25));
      }
    }

    if (!force && boxW === lastW && boxH === lastH && targetResolution === lastRes) {
      return;
    }
    lastW = boxW;
    lastH = boxH;
    lastRes = targetResolution;

    if (options.app?.renderer) {
      options.app.renderer.resize(boxW, boxH, targetResolution);
    }
    options.onResize?.();

    // Força o redesenho imediato para eliminar o "piscar" da tela durante o resize.
    // No WebGL/HTML5 Canvas, toda alteração em canvas.width/height limpa imediatamente
    // o buffer para transparente/preto. Executar o render() sincronamente garante
    // que o frame esteja pintado antes de o navegador desenhar na tela.
    try {
      options.app?.render?.();
    } catch {
      // Ignora caso a instância não suporte render síncrono
    }
  };

  const scheduleUpdateCanvasSize = () => {
    const raf =
      activePipWindow?.requestAnimationFrame ||
      (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : null);
    if (!raf) {
      updateCanvasSize();
      return;
    }
    if (resizeRaf) {
      const cancelRaf =
        activePipWindow?.cancelAnimationFrame ||
        (typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame : null);
      cancelRaf?.(resizeRaf);
    }
    resizeRaf = raf(() => {
      resizeRaf = 0;
      updateCanvasSize();
    });
  };

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => scheduleUpdateCanvasSize());
    resizeObserver.observe(canvasHost);
  }

  // Sidebar para histórico de chat caso disponível
  if (options.chatElement) {
    const sidebar = pipDoc.createElement('aside');
    sidebar.className = 'pip-sidebar';
    sidebar.hidden = true; // fechado por padrão para economizar espaço
    sidebar.append(options.chatElement);
    chatSidebar = sidebar;
    mainView.append(sidebar);
  }

  shell.append(topbar, mainView);

  // Barra inferior para chat rápido na sala
  if (options.onSendMessage) {
    const bottombar = pipDoc.createElement('div');
    bottombar.className = 'pip-bottombar';

    const chatInput = pipDoc.createElement('input');
    chatInput.type = 'text';
    chatInput.className = 'pip-chat-input';
    chatInput.placeholder = 'Conversar na sala... (Enter)';
    chatInput.maxLength = 140;

    const sendBtn = pipDoc.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'pip-btn pip-btn-send';
    sendBtn.title = 'Enviar mensagem';
    sendBtn.setAttribute('aria-label', 'Enviar mensagem');
    sendBtn.append(icon('send', 14));

    const doSend = () => {
      const text = chatInput.value.trim();
      if (!text) return;
      options.onSendMessage?.(text);
      chatInput.value = '';
    };

    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSend();
      }
    });

    sendBtn.addEventListener('click', doSend);
    bottombar.append(chatInput, sendBtn);
    shell.append(bottombar);
  }

  // Anexa os elementos da chamada (painel e mini) dentro da casca da janela flutuante
  if (options.getCallElements) {
    const { panel, mini } = options.getCallElements();
    if (panel) shell.append(panel);
    if (mini) shell.append(mini);
  }

  const cardEl = typeof options.avatarCardElement === 'function' ? options.avatarCardElement() : options.avatarCardElement;
  if (cardEl) {
    shell.append(cardEl);
  }

  const deskEl = typeof options.deskElement === 'function' ? options.deskElement() : options.deskElement;
  if (deskEl) {
    shell.append(deskEl);
  }

  // Observa document.body para mover automaticamente modais, diálogos e menus interativos para dentro do PiP
  const forwardedNodes = new Set<HTMLElement>();
  const isForwardable = (node: Node): node is HTMLElement => {
    if (!(node instanceof HTMLElement)) return false;
    return (
      node.classList.contains('modal-backdrop') ||
      node.classList.contains('person-menu') ||
      node.classList.contains('tv-panel') ||
      node.classList.contains('ttt-panel') ||
      node.classList.contains('arcade-panel') ||
      node.classList.contains('reaction-picker') ||
      node.classList.contains('desk-chip')
    );
  };

  let forwardObserver: MutationObserver | null = null;
  if (typeof MutationObserver !== 'undefined') {
    forwardObserver = new MutationObserver((mutations) => {
      if (!activePipWindow || activePipWindow.closed) return;
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (isForwardable(node) && !shell.contains(node)) {
            forwardedNodes.add(node);
            shell.append(node);
          }
        }
      }
    });
    forwardObserver.observe(document.body, { childList: true });
  }

  // Move nós que já estiverem abertos no document.body
  for (const node of Array.from(document.body.children || [])) {
    if (isForwardable(node) && !shell.contains(node)) {
      forwardedNodes.add(node);
      shell.append(node);
    }
  }

  const detachToaster = attachToasterToPip(pipDoc);

  // Container de chamadas recebidas flutuante
  const incomingContainer = pipDoc.createElement('div');
  incomingContainer.className = 'pip-incoming-container';
  shell.append(incomingContainer);
  pipIncomingContainer = incomingContainer;

  // Se já havia convites pendentes que chegaram antes de abrir o PiP, renderiza-os
  for (const pending of pendingPipInvites) {
    showPipIncomingCall(pending.invite, pending.onAnswer);
  }

  pipDoc.body.append(shell);

  // Cria um placeholder na aba principal do navegador avisando que está em PiP
  const placeholder = document.createElement('div');
  placeholder.className = 'pip-placeholder';
  const phContent = document.createElement('div');
  phContent.className = 'pip-placeholder-content';

  const phIcon = document.createElement('div');
  phIcon.className = 'pip-placeholder-icon';
  phIcon.append(icon('pip', 32));

  const phTitle = document.createElement('h2');
  phTitle.textContent = 'Janela Flutuante Ativa';

  const phDesc = document.createElement('p');
  phDesc.textContent =
    'O Escritório Virtual está flutuando livremente no seu Windows sobre os outros aplicativos.';

  const phBtn = document.createElement('button');
  phBtn.type = 'button';
  phBtn.className = 'pip-placeholder-btn';
  phBtn.textContent = 'Trazer de volta para esta aba';
  phBtn.addEventListener('click', () => closePip());

  phContent.append(phIcon, phTitle, phDesc, phBtn);
  placeholder.append(phContent);
  options.container.append(placeholder);

  // Conecta diretamente ao EventSystem do Pixi para cliques, caminhada e arraste
  const pixiEvents = (options.app?.renderer as any)?.events;
  const onPipPointerMove = (e: PointerEvent) => {
    pixiEvents?._onPointerMove(e);
  };
  const onPipPointerUp = (e: PointerEvent) => {
    pixiEvents?._onPointerUp(e);
  };

  pipDoc.addEventListener('pointermove', onPipPointerMove, true);
  pipWin.addEventListener('pointerup', onPipPointerUp, true);

  // Encaminha eventos do teclado (setas para virar o avatar, ignorando quando estiver digitando no chat)
  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target?.matches('input, textarea, [contenteditable]')) return;
    if (e.type === 'keydown') {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        options.onTurn?.(-1);
        return;
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        options.onTurn?.(1);
        return;
      }
    }
    document.dispatchEvent(
      new KeyboardEvent(e.type, {
        key: e.key,
        code: e.code,
        keyCode: e.keyCode,
        which: e.which,
        bubbles: true,
        cancelable: true,
      }),
    );
  };
  pipWin.addEventListener('keydown', onKey);
  pipWin.addEventListener('keyup', onKey);

  // Ajusta a câmera ao redimensionar a janela flutuante com coalescência por RAF
  const onResize = () => {
    scheduleUpdateCanvasSize();
  };
  pipWin.addEventListener('resize', onResize);
  updateCanvasSize(true);
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => updateCanvasSize(true));
  }

  // Restauração segura quando a janela flutuante for fechada (pelo usuário ou via closePip)
  const onPageHide = () => {
    stopTheme();
    if (resizeRaf) {
      const cancelRaf =
        pipWin?.cancelAnimationFrame ||
        (typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame : null);
      cancelRaf?.(resizeRaf);
      resizeRaf = 0;
    }
    resizeObserver?.disconnect();
    pipDoc.removeEventListener('pointermove', onPipPointerMove, true);
    pipWin.removeEventListener('pointerup', onPipPointerUp, true);
    canvasHost.removeEventListener('wheel', onHostWheel);
    placeholder.remove();
    if (options.chatElement) {
      document.body.append(options.chatElement);
    }
    if (options.getCallElements) {
      const { panel, mini } = options.getCallElements();
      if (panel) document.body.append(panel);
      if (mini) document.body.append(mini);
    }
    forwardObserver?.disconnect();
    for (const node of forwardedNodes) {
      if (node.isConnected) {
        document.body.append(node);
      }
    }
    forwardedNodes.clear();

    const cardEl = typeof options.avatarCardElement === 'function' ? options.avatarCardElement() : options.avatarCardElement;
    if (cardEl) {
      document.body.append(cardEl);
    }
    if (deskEl) {
      document.body.append(deskEl);
    }
    detachToaster();
    options.container.append(options.canvas);

    for (const [, item] of activePipInvites) {
      if (pipWin) pipWin.clearInterval(item.timer);
    }
    activePipInvites.clear();
    pipIncomingContainer = null;
    leaveBtnEl = null;
    callPillEl = null;

    activePipWindow = null;
    currentRoomTitleEl = null;
    micBtnEl = null;
    currentGetCallStatus = null;

    const origDpr = Math.min(window.devicePixelRatio || 1, 2);
    if (options.app?.renderer) {
      options.app.renderer.resize(window.innerWidth, window.innerHeight, origDpr);
    }

    options.onClose?.();
    options.onResize?.();
  };

  pipWin.addEventListener('pagehide', onPageHide, { once: true });
  pipWin.addEventListener('beforeunload', onPageHide, { once: true });

  return pipWin;
}

/** Fecha a janela flutuante se estiver aberta. */
export function closePip(): void {
  if (activePipWindow && !activePipWindow.closed) {
    activePipWindow.close();
    activePipWindow = null;
  }
}
