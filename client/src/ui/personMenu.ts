/** Alguém das listas (Pessoas online, Equipe, Mapa). */
export interface MenuPerson {
  userId: string;
  name: string;
  /** Sessão na sala atual (dá para achar o avatar na tela). */
  sessionId?: string;
  /** Sala onde a pessoa está, se estiver online em outra. */
  roomId?: string;
  roomName?: string;
}

/** O que dá para fazer com alguém, igual em todas as listas. */
export interface PersonActions {
  callMode(userId: string): 'call' | 'add' | 'with' | 'none';
  call(userId: string, name: string): void;
  message(userId: string, name: string): void;
  praise(userId: string, name: string): void;
  /** Câmera até o avatar na sala atual. */
  find(sessionId: string): void;
  /** Ir até a sala da pessoa (e andar até ela). */
  goTo(userId: string, roomId: string): void;
}

interface Item {
  label: string;
  run: () => void;
}

/** Ações para a pessoa, na ordem do menu. */
export function personMenuItems(p: MenuPerson, a: PersonActions): Item[] {
  const items: Item[] = [];
  const online = Boolean(p.sessionId || p.roomId);
  const mode = online ? a.callMode(p.userId) : 'none';
  if (mode === 'call')
    items.push({ label: '📞 Chamar para conversa', run: () => a.call(p.userId, p.name) });
  if (mode === 'add') {
    items.push({ label: '📞 Adicionar à chamada', run: () => a.call(p.userId, p.name) });
  }
  items.push({ label: '✉️ Mensagem', run: () => a.message(p.userId, p.name) });
  if (p.sessionId) {
    const id = p.sessionId;
    items.push({ label: '📍 Achar na sala', run: () => a.find(id) });
  } else if (p.roomId) {
    const roomId = p.roomId;
    const where = p.roomName ? ` (${p.roomName})` : '';
    items.push({ label: `🚶 Ir até lá${where}`, run: () => a.goTo(p.userId, roomId) });
  }
  items.push({ label: '🙌 Elogiar', run: () => a.praise(p.userId, p.name) });
  return items;
}

let current: (() => void) | null = null;

/** Fecha o menu aberto (se houver). */
export function closePersonMenu(): void {
  current?.();
}

/**
 * Menu pequeno ao lado de quem foi clicado: Ligar, Mensagem, Achar/Ir até e Elogiar. Fecha com
 * Esc, clique fora ou ao escolher (`before` roda antes da ação, por exemplo fechar a lista).
 */
export function openPersonMenu(
  anchor: HTMLElement,
  p: MenuPerson,
  a: PersonActions,
  before?: () => void,
): void {
  closePersonMenu();
  const doc = anchor.ownerDocument ?? document;
  const win = doc.defaultView ?? window;
  const menu = Object.assign(document.createElement('div'), { className: 'person-menu' });
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', p.name);
  menu.append(Object.assign(document.createElement('p'), { textContent: p.name }));
  const close = () => {
    if (current !== close) return;
    current = null;
    menu.remove();
    doc.removeEventListener('pointerdown', onOutside, true);
    doc.removeEventListener('keydown', onKey, true);
    anchor.focus({ preventScroll: true });
  };
  for (const item of personMenuItems(p, a)) {
    const b = Object.assign(document.createElement('button'), {
      type: 'button',
      textContent: item.label,
    });
    b.setAttribute('role', 'menuitem');
    b.addEventListener('click', () => {
      close();
      before?.();
      item.run();
    });
    menu.append(b);
  }
  const onOutside = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    const buttons = [...menu.querySelectorAll('button')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      buttons[(at + step + buttons.length) % buttons.length]?.focus();
    }
  };
  doc.body.append(menu);
  // Do lado da pessoa clicada, sem sair da tela.
  const r = anchor.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  const left = Math.min(Math.max(8, r.left), win.innerWidth - m.width - 8);
  const below = r.bottom + 4 + m.height <= win.innerHeight - 8;
  menu.style.left = `${left}px`;
  menu.style.top = `${below ? r.bottom + 4 : Math.max(8, r.top - m.height - 4)}px`;
  current = close;
  doc.addEventListener('pointerdown', onOutside, true);
  doc.addEventListener('keydown', onKey, true);
  menu.querySelector('button')?.focus();
}
