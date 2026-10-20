import type { AssetLoader, AssetStats } from '../assets/AssetLoader.js';
import { AMBIENT_LABELS } from '@office/shared';
import type { Camera } from '../scene/Camera.js';
import type { AmbientSound } from './ambient.js';
import { icon, setIcon, type IconName } from './icons.js';
import { currentTheme, onThemeChange, setTheme } from './theme.js';

export interface Hud {
  setRoomName(name: string): void;
  setDecorating(on: boolean): void;
  /** O ambiente da sala mudou: atualiza o painel do som ambiente. */
  refreshAmbient(): void;
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
  /** Sala com decoração travada para você: o botão fica desabilitado. */
  setDecorLocked(locked: boolean): void;
}

/** Nome da sala, status dos assets e controles de zoom (que agem sobre a cena atual). */
export function mountHud(opts: {
  getCamera: () => Camera | undefined;
  loader: AssetLoader;
  onOpenProfile: () => void;
  onOpenTeam: () => void;
  onOpenAdmin: () => void;
  onOpenMessages: () => void;
  onOpenAgenda: () => void;
  onOpenAnnouncements: () => void;
  onOpenMap: () => void;
  onEditRoom: () => void;
  ambient: AmbientSound;
  onToggleDecor: () => void;
  /** Liga/desliga o som de mensagem; devolve o novo estado. */
  onToggleSound: () => boolean;
  soundOn: boolean;
}): Hud {
  const card = document.createElement('header');
  card.className = 'hud-card';
  const title = document.createElement('h1');
  const hint = document.createElement('p');
  hint.textContent =
    'Clique no piso para andar · Enter para conversar · arraste para mover a câmera.';
  const editRoomBtn = document.createElement('button');
  editRoomBtn.type = 'button';
  editRoomBtn.className = 'btn-link hud-edit-room';
  editRoomBtn.append(icon('pencil', 14), ' Editar sala');
  editRoomBtn.hidden = true;
  editRoomBtn.addEventListener('click', opts.onEditRoom);
  card.append(title, hint, editRoomBtn);

  const status = document.createElement('div');
  status.className = 'hud-status';
  status.setAttribute('role', 'status');
  opts.loader.onChange((stats) => renderStatus(status, stats));

  const zoom = document.createElement('div');
  zoom.className = 'hud-zoom';
  zoom.append(
    button('plus', 'Aproximar', () => opts.getCamera()?.zoomIn()),
    button('minus', 'Afastar', () => opts.getCamera()?.zoomOut()),
    button('locate', 'Centralizar a sala', () => opts.getCamera()?.center()),
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

  // Tema claro/escuro (provisório aqui; vai para as configurações na Fase 43).
  const themeBtn = button('sun', '', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
  themeBtn.classList.add('hud-theme');
  const renderTheme = () => {
    const dark = currentTheme() === 'dark';
    setIcon(themeBtn, dark ? 'sun' : 'moon');
    const label = dark ? 'Usar tema claro' : 'Usar tema escuro';
    themeBtn.title = label;
    themeBtn.setAttribute('aria-label', label);
  };
  renderTheme();
  onThemeChange(renderTheme);
  zoom.prepend(themeBtn);

  // Som ambiente: botão 🎵 com um painelzinho (ligar e volume).
  const ambientBtn = button('music', 'Som ambiente', () => {
    panel.hidden = !panel.hidden;
    renderAmbient();
  });
  const panel = document.createElement('div');
  panel.className = 'ambient-panel';
  panel.hidden = true;
  const toggleLabel = document.createElement('label');
  const toggle = Object.assign(document.createElement('input'), { type: 'checkbox' });
  toggleLabel.append(toggle, ' Som ambiente');
  const volume = Object.assign(document.createElement('input'), {
    type: 'range',
    min: '0',
    max: '1',
    step: '0.05',
  });
  volume.setAttribute('aria-label', 'Volume do som ambiente');
  const nowPlaying = Object.assign(document.createElement('small'), { className: 'muted' });
  panel.append(toggleLabel, volume, nowPlaying);
  const renderAmbient = () => {
    const a = opts.ambient;
    toggle.checked = a.enabled;
    volume.value = String(a.volume);
    volume.disabled = !a.enabled;
    nowPlaying.textContent =
      a.current === 'none' ? 'Esta sala é silenciosa.' : `Nesta sala: ${AMBIENT_LABELS[a.current]}`;
    ambientBtn.setAttribute('aria-pressed', String(a.enabled));
    ambientBtn.classList.toggle('on', a.enabled);
  };
  toggle.addEventListener('change', () => {
    opts.ambient.setEnabled(toggle.checked);
    renderAmbient();
  });
  volume.addEventListener('input', () => opts.ambient.setVolume(Number(volume.value)));
  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !panel.contains(e.target as Node) && e.target !== ambientBtn) {
      panel.hidden = true;
    }
  });
  zoom.prepend(ambientBtn);

  const profileBtn = actionButton('hud-avatar', 'user', 'Perfil', opts.onOpenProfile);
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
  const mapBtn = actionButton('hud-map', 'map', 'Mapa', opts.onOpenMap);
  const annBtn = actionButton('hud-ann', 'megaphone', 'Avisos', opts.onOpenAnnouncements);
  const annBadge = document.createElement('span');
  annBadge.className = 'dm-badge';
  annBadge.hidden = true;
  annBtn.append(annBadge);
  const adminBtn = actionButton('hud-admin', 'shield', 'Admin', opts.onOpenAdmin);
  adminBtn.hidden = true;

  const actions = document.createElement('div');
  actions.className = 'hud-actions';
  actions.append(
    profileBtn,
    teamBtn,
    dmBtn,
    mapBtn,
    agendaBtn,
    annBtn,
    focusBtn,
    decorBtn,
    adminBtn,
  );
  document.body.append(card, status, zoom, actions, panel);
  return {
    focusButton: focusBtn,
    setUnreadDms(n) {
      dmBadge.hidden = n === 0;
      dmBadge.textContent = n > 99 ? '99+' : String(n);
      dmBtn.setAttribute('aria-label', n ? `Mensagens (${n} não lidas)` : 'Mensagens');
    },
    setUnreadAnnouncements(n) {
      annBadge.hidden = n === 0;
      annBadge.textContent = n > 99 ? '99+' : String(n);
      annBtn.setAttribute('aria-label', n ? `Avisos (${n} não lidos)` : 'Avisos');
    },
    setCanEditRooms(on) {
      editRoomBtn.hidden = !on;
    },
    setAdmin(on) {
      adminBtn.hidden = !on;
    },
    setDecorLocked(locked) {
      decorBtn.disabled = locked;
      decorBtn.title = locked ? 'Um admin travou a decoração desta sala.' : '';
    },
    setDecorating(on) {
      setLabel(decorBtn, on ? 'Concluir decoração' : 'Decorar');
      setIcon(decorBtn.querySelector('.ico')!, on ? 'check' : 'armchair');
      decorBtn.setAttribute('aria-pressed', String(on));
    },
    refreshAmbient() {
      renderAmbient();
    },
    setRoomName(name) {
      title.textContent = name;
      document.title = `${name} · Escritório Virtual`;
    },
  };
}

function renderStatus(el: HTMLElement, stats: AssetStats): void {
  if (stats.offline) {
    el.dataset.state = 'fallback';
    el.textContent = 'Arte provisória (modo offline)';
  } else if (stats.failed > 0) {
    el.dataset.state = 'fallback';
    el.textContent = `HabboAssets indisponível em ${stats.failed} item(ns) — usando arte provisória`;
  } else {
    el.dataset.state = 'ok';
    el.textContent = 'Assets: HabboAssets (Habbo BR)';
  }
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
