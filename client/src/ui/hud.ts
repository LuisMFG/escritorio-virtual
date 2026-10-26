import type { AssetLoader, AssetStats } from '../assets/AssetLoader.js';
import type { Camera } from '../scene/Camera.js';
import { STATUS_LABELS, STATUSES, type Status } from '@office/shared';
import { icon, setIcon, type IconName } from './icons.js';

export interface Hud {
  setRoomName(name: string): void;
  setDecorating(on: boolean): void;
  /** De onde vem a arte agora (diagnóstico para admins). */
  readonly assetStatus: string;
  /** O som de mensagem mudou em Configurações: o sino acompanha. */
  setSoundOn(on: boolean): void;
  /** Contador de mensagens privadas não lidas no botão. */
  setUnreadDms(n: number): void;
  /** Contador de avisos da diretoria não lidos. */
  setUnreadAnnouncements(n: number): void;
  /** Botão do modo foco (o controle do foco cuida dele). */
  readonly focusButton: HTMLButtonElement;
  /** Mostra o "Editar sala" (admins e quem pode editar salas). */
  setCanEditRooms(on: boolean): void;
  /** Mostra o botão Admin (só para admins). */
  setAdmin(on: boolean): void;
  /** Tem mesa escolhida: mostra o "Minha mesa". */
  setDesk(on: boolean): void;
  /** Sala com decoração travada para você: o botão fica desabilitado. */
  setDecorLocked(locked: boolean): void;
  /** Mostra o seu status no botão (inclusive o ausente automático). */
  setStatus(status: Status): void;
}

/** Nome da sala, barra de baixo em grupos e a coluna de câmera e som (agem sobre a cena atual). */
export function mountHud(opts: {
  getCamera: () => Camera | undefined;
  loader: AssetLoader;
  onOpenProfile: () => void;
  /** Escolheu um status no botão de status. */
  onStatusChange: (status: Status) => void;
  onOpenTeam: () => void;
  onOpenAdmin: () => void;
  onOpenMessages: () => void;
  onOpenAgenda: () => void;
  onOpenAnnouncements: () => void;
  onOpenMap: () => void;
  onEditRoom: () => void;
  /** Câmera no próprio avatar. */
  onCenterSelf: () => void;
  /** Vai até a própria mesa e senta. */
  onGoToDesk: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  onToggleDecor: () => void;
  /** Liga/desliga o som de mensagem; devolve o novo estado. */
  onToggleSound: () => boolean;
  soundOn: boolean;
}): Hud {
  // Fase 41: só o nome da sala no canto (as dicas vão para a ajuda).
  const card = document.createElement('header');
  card.className = 'hud-card';
  const title = document.createElement('h1');
  card.append(title);

  // Origem da arte: só para admins, em Configurações → Diagnóstico.
  let assetStatus = '';
  opts.loader.onChange((stats) => (assetStatus = statusText(stats)));

  // Coluna da direita compacta: configurações e som em cima, câmera embaixo.
  const zoom = document.createElement('div');
  zoom.className = 'hud-zoom';
  zoom.setAttribute('role', 'toolbar');
  zoom.setAttribute('aria-label', 'Câmera e som');
  const sep = Object.assign(document.createElement('span'), { className: 'hud-sep' });
  sep.setAttribute('aria-hidden', 'true');
  zoom.append(
    sep,
    button('plus', 'Aproximar', () => opts.getCamera()?.zoomIn()),
    button('minus', 'Afastar', () => opts.getCamera()?.zoomOut()),
    button('scan', 'Enquadrar a sala', () => opts.getCamera()?.fit()),
    button('locate-fixed', 'Centralizar em mim', opts.onCenterSelf),
  );
  const soundBtn = button('bell', '', () => renderSound(opts.onToggleSound()));
  const renderSound = (on: boolean) => {
    setIcon(soundBtn, on ? 'bell' : 'bell-off');
    const label = on
      ? 'Som de mensagem ligado (clique para desligar)'
      : 'Som de mensagem desligado (clique para ligar)';
    soundBtn.title = label;
    soundBtn.setAttribute('aria-label', label);
    soundBtn.setAttribute('aria-pressed', String(on));
  };
  renderSound(opts.soundOn);
  zoom.prepend(soundBtn);

  // Configurações (Fase 43): tema, texto, movimento, som ambiente e notificações.
  const settingsBtn = button('settings', 'Configurações', opts.onOpenSettings);
  settingsBtn.classList.add('hud-settings');
  zoom.prepend(settingsBtn);

  const profileBtn = actionButton('hud-avatar', 'user', 'Perfil', opts.onOpenProfile);
  // Status (disponível, ocupado, ausente): na barra, à vista e com um clique.
  const statusBtn = document.createElement('button');
  statusBtn.type = 'button';
  statusBtn.className = 'hud-action hud-mystatus';
  statusBtn.setAttribute('aria-haspopup', 'menu');
  const statusDot = Object.assign(document.createElement('span'), { className: 'status-dot' });
  const statusLbl = Object.assign(document.createElement('span'), { className: 'lbl' });
  statusBtn.append(statusDot, statusLbl);
  const statusMenu = document.createElement('div');
  statusMenu.className = 'status-menu';
  statusMenu.setAttribute('role', 'menu');
  statusMenu.setAttribute('aria-label', 'Seu status');
  statusMenu.hidden = true;
  for (const st of STATUSES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitemradio');
    b.dataset.status = st;
    b.append(
      Object.assign(document.createElement('span'), { className: 'status-dot' }),
      STATUS_LABELS[st],
    );
    b.addEventListener('click', () => {
      closeStatus();
      opts.onStatusChange(st);
    });
    statusMenu.append(b);
  }
  const closeStatus = () => {
    statusMenu.hidden = true;
    statusBtn.setAttribute('aria-expanded', 'false');
  };
  /** Abre a escolha de status acima do botão (no celular, acima do "Mais"). */
  const openStatus = (anchor: HTMLElement) => {
    statusMenu.hidden = false;
    statusBtn.setAttribute('aria-expanded', 'true');
    const r = anchor.getBoundingClientRect();
    const m = statusMenu.getBoundingClientRect();
    statusMenu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - m.width - 8))}px`;
    statusMenu.style.top = `${Math.max(8, r.top - m.height - 6)}px`;
    statusMenu.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  };
  statusBtn.addEventListener('click', () =>
    statusMenu.hidden ? openStatus(statusBtn) : closeStatus(),
  );
  statusMenu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeStatus();
      statusBtn.focus();
    }
  });
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    if (!statusMenu.hidden && !statusMenu.contains(t) && !statusBtn.contains(t)) closeStatus();
  });
  const teamBtn = actionButton('hud-team', 'users', 'Equipe', opts.onOpenTeam);
  const agendaBtn = actionButton('hud-agenda', 'calendar', 'Agenda', opts.onOpenAgenda);
  const decorBtn = actionButton('hud-decor', 'armchair', 'Decorar', opts.onToggleDecor);
  decorBtn.setAttribute('aria-pressed', 'false');
  const dmBtn = actionButton('hud-dm', 'mail', 'Mensagens', opts.onOpenMessages);
  const dmBadge = document.createElement('span');
  dmBadge.className = 'dm-badge';
  dmBadge.hidden = true;
  dmBtn.append(dmBadge);
  const focusBtn = actionButton('hud-focus', 'timer', 'Foco', () => undefined);
  const deskBtn = actionButton('hud-desk', 'monitor', 'Minha mesa', opts.onGoToDesk);
  deskBtn.hidden = true;
  const mapBtn = actionButton('hud-map', 'map', 'Mapa', opts.onOpenMap);
  const annBtn = actionButton('hud-ann', 'megaphone', 'Avisos', opts.onOpenAnnouncements);
  const annBadge = document.createElement('span');
  annBadge.className = 'dm-badge';
  annBadge.hidden = true;
  annBtn.append(annBadge);
  // "Mais": ajuda para todos; editar sala e admin para quem pode.
  const moreBtn = actionButton('hud-more-btn', 'ellipsis', 'Mais', () => {
    moreMenu.hidden = !moreMenu.hidden;
    moreBtn.setAttribute('aria-expanded', String(!moreMenu.hidden));
  });
  moreBtn.setAttribute('aria-haspopup', 'menu');
  moreBtn.setAttribute('aria-expanded', 'false');
  const moreMenu = document.createElement('div');
  moreMenu.className = 'hud-more-menu';
  moreMenu.setAttribute('role', 'menu');
  moreMenu.hidden = true;
  const menuItem = (name: IconName, label: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.append(icon(name), label);
    b.addEventListener('click', () => {
      moreMenu.hidden = true;
      moreBtn.setAttribute('aria-expanded', 'false');
      onClick();
    });
    return b;
  };
  const editRoomBtn = menuItem('pencil', 'Editar sala', opts.onEditRoom);
  editRoomBtn.classList.add('hud-edit-room');
  editRoomBtn.hidden = true;
  const adminBtn = menuItem('shield', 'Admin', opts.onOpenAdmin);
  adminBtn.classList.add('hud-admin');
  adminBtn.hidden = true;
  const helpBtn = menuItem('help', 'Ajuda (?)', opts.onOpenHelp);
  helpBtn.classList.add('hud-help');
  // No celular (Fase 46) a barra mostra só 5 botões: os outros entram aqui (CSS mostra/esconde).
  const mobileItem = (name: IconName, label: string, target: HTMLButtonElement) => {
    const b = menuItem(name, label, () => target.click());
    b.classList.add('mobile-only');
    return b;
  };
  const statusItem = menuItem('user', 'Status', () => openStatus(moreBtn));
  statusItem.classList.add('mobile-only');
  const deskItem = mobileItem('monitor', 'Minha mesa', deskBtn);
  deskItem.hidden = true;
  const annItem = mobileItem('megaphone', 'Avisos', annBtn);
  const agendaItem = mobileItem('calendar', 'Agenda', agendaBtn);
  const decorItem = mobileItem('armchair', 'Decorar', decorBtn);
  moreMenu.append(
    statusItem,
    deskItem,
    annItem,
    agendaItem,
    decorItem,
    helpBtn,
    editRoomBtn,
    adminBtn,
  );
  const moreWrap = Object.assign(document.createElement('div'), { className: 'hud-more' });
  moreWrap.append(moreBtn, moreMenu);
  const renderMore = () => undefined;
  renderMore();
  document.addEventListener('pointerdown', (e) => {
    if (!moreMenu.hidden && !moreWrap.contains(e.target as Node)) {
      moreMenu.hidden = true;
      moreBtn.setAttribute('aria-expanded', 'false');
    }
  });

  // Barra de baixo em grupos: Eu · Pessoas · Conversas · Escritório · Mais.
  const group = (label: string, ...buttons: HTMLElement[]) => {
    const g = Object.assign(document.createElement('div'), { className: 'hud-group' });
    g.setAttribute('role', 'group');
    g.setAttribute('aria-label', label);
    g.append(...buttons);
    return g;
  };
  const actions = document.createElement('nav');
  actions.className = 'hud-actions';
  actions.setAttribute('aria-label', 'Menu do escritório');
  actions.append(
    group('Eu', profileBtn, statusBtn, deskBtn, focusBtn),
    group('Pessoas', teamBtn, mapBtn),
    group('Conversas', dmBtn, annBtn),
    group('Escritório', agendaBtn, decorBtn),
    moreWrap,
  );
  document.body.append(card, zoom, actions, statusMenu);
  return {
    focusButton: focusBtn,
    setUnreadDms(n) {
      dmBadge.hidden = n === 0;
      dmBadge.textContent = n > 99 ? '99+' : String(n);
      dmBtn.setAttribute('aria-label', n ? `Mensagens (${n} não lidas)` : 'Mensagens');
    },
    setUnreadAnnouncements(n) {
      moreBtn.classList.toggle('has-unread', n > 0);
      annItem.lastChild!.textContent = n ? `Avisos (${n > 99 ? '99+' : n})` : 'Avisos';
      annBadge.hidden = n === 0;
      annBadge.textContent = n > 99 ? '99+' : String(n);
      annBtn.setAttribute('aria-label', n ? `Avisos (${n} não lidos)` : 'Avisos');
    },
    setCanEditRooms(on) {
      editRoomBtn.hidden = !on;
      renderMore();
    },
    setDesk(on) {
      deskBtn.hidden = !on;
      deskItem.hidden = !on;
    },
    setAdmin(on) {
      adminBtn.hidden = !on;
      renderMore();
    },
    setStatus(status) {
      statusBtn.dataset.status = status;
      statusLbl.textContent = STATUS_LABELS[status];
      statusBtn.title = `Seu status: ${STATUS_LABELS[status]}`;
      statusBtn.setAttribute('aria-label', `Seu status: ${STATUS_LABELS[status]}`);
      statusItem.lastChild!.textContent = `Status: ${STATUS_LABELS[status]}`;
      for (const b of statusMenu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')) {
        b.setAttribute('aria-checked', String(b.dataset.status === status));
      }
    },
    setDecorLocked(locked) {
      decorBtn.disabled = locked;
      decorItem.disabled = locked;
      decorBtn.title = locked ? 'Um admin travou a decoração desta sala.' : '';
    },
    setDecorating(on) {
      setLabel(decorBtn, on ? 'Concluir decoração' : 'Decorar');
      decorItem.lastChild!.textContent = on ? 'Concluir decoração' : 'Decorar';
      setIcon(decorBtn.querySelector('.ico')!, on ? 'check' : 'armchair');
      decorBtn.setAttribute('aria-pressed', String(on));
    },
    get assetStatus() {
      return assetStatus;
    },
    setSoundOn(on) {
      renderSound(on);
    },
    setRoomName(name) {
      title.textContent = name;
      document.title = `${name} · Escritório Virtual`;
    },
  };
}

function statusText(stats: AssetStats): string {
  if (stats.offline) return 'Arte provisória (modo offline).';
  if (stats.failed > 0) {
    return `HabboAssets indisponível em ${stats.failed} item(ns): usando arte provisória.`;
  }
  return 'Arte: HabboAssets (Habbo BR), tudo carregado.';
}

function button(name: IconName, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.append(icon(name, 20));
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', onClick);
  return b;
}

/** Botão do canto: ícone + texto (em telas pequenas só o ícone aparece). */
function actionButton(
  className: string,
  iconName: IconName,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `${className} btn-secondary hud-action`;
  b.append(
    Object.assign(document.createElement('span'), { className: 'ico' }),
    Object.assign(document.createElement('span'), { className: 'lbl', textContent: label }),
  );
  b.querySelector('.ico')!.append(icon(iconName));
  b.querySelector('.ico')!.setAttribute('aria-hidden', 'true');
  b.title = label;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

function setLabel(b: HTMLButtonElement, label: string): void {
  b.querySelector('.lbl')!.textContent = label;
  b.title = label;
  b.setAttribute('aria-label', label);
}
