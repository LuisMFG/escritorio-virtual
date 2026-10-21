import { EMOTE_IDS, EMOTES } from '@office/shared';
import { iconHtml } from './icons.js';
import { createTabs } from './tabs.js';

export interface HelpDeps {
  /** Recomeça o tour guiado. */
  restartTour: () => void;
}

type Row = [string, string];

const CHAT_COMMANDS: Row[] = [
  ['@nome', 'Menciona alguém da sala (a pessoa recebe aviso e som).'],
  ['/sentar · /deitar · /levantar', 'Senta ou deita no chão, e levanta.'],
  ['/largar', 'Solta o café ou a bebida da mão.'],
  ['/dado · /moeda', 'Sorteio feito pelo servidor; todos veem o mesmo resultado.'],
  ['/enquete Pergunta? | a | b', 'Cria uma enquete no chat (até 6 opções).'],
  ['/senta · /deita · /vem', 'Comandos para o seu pet.'],
];

const SHORTCUTS: Row[] = [
  ['Enter', 'Começa a escrever no chat (de qualquer lugar).'],
  ['?', 'Abre esta ajuda.'],
  ['Alt (segurado)', 'Mostra o nome de todo mundo na sala.'],
  ['Esc', 'Fecha janelas e cancela o que estiver fazendo.'],
  ['← →', 'Vira o avatar sem sair do lugar.'],
  ['Roda do mouse · pinça', 'Aproxima e afasta a câmera; arraste para mover.'],
  ['R · Delete', 'No Decorar: gira e remove o móvel escolhido.'],
];

const BUTTONS: Row[] = [
  ['Perfil', 'Nome, bio, pet, conquistas, efeitos, integrações e conta.'],
  ['Minha mesa', 'Leva até a sua estação e senta (aparece depois de escolher uma).'],
  ['Foco', 'Pomodoro: os outros veem que você está focado e os avisos esperam.'],
  ['Equipe', 'Todo mundo por cargo, quem está online e onde.'],
  ['Mapa', 'As salas, quem está em cada uma e as reuniões em andamento.'],
  ['Mensagens', 'Conversas privadas com qualquer pessoa, mesmo offline.'],
  ['Avisos', 'Comunicados da diretoria.'],
  ['Agenda', 'Marcar reuniões, responder convites e lembretes.'],
  ['Decorar', 'Colocar, mover, girar e tirar móveis da sala.'],
  ['Engrenagem', 'Configurações: tema, texto, movimento, som e notificações.'],
];

function table(caption: string, rows: Row[]): HTMLElement {
  const dl = document.createElement('dl');
  dl.className = 'help-list';
  dl.setAttribute('aria-label', caption);
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    for (const part of k.split(' · ')) {
      if (dt.childNodes.length) dt.append(' ');
      dt.append(Object.assign(document.createElement('kbd'), { textContent: part }));
    }
    dl.append(dt, Object.assign(document.createElement('dd'), { textContent: v }));
  }
  return dl;
}

let openClose: (() => void) | null = null;

/** Central de ajuda (Fase 44, tecla `?`): comandos, atalhos, botões e o tour de novo. */
export function openHelp(deps: HelpDeps): void {
  if (openClose) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const sheet = document.createElement('section');
  sheet.className = 'sheet help';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'help-title');
  sheet.innerHTML = `
    <header class="sheet-head">
      <h2 id="help-title">Ajuda</h2>
      <button type="button" class="sheet-close" aria-label="Fechar">${iconHtml('x')}</button>
    </header>`;
  const body = Object.assign(document.createElement('div'), { className: 'sheet-body' });

  const emotes = Object.assign(document.createElement('p'), { className: 'muted help-emotes' });
  const cmd = (id: (typeof EMOTE_IDS)[number]) =>
    'needsTarget' in EMOTES[id] ? `/${EMOTES[id].command} nome` : `/${EMOTES[id].command}`;
  emotes.textContent = `Emotes: ${EMOTE_IDS.map(cmd).join(' · ')} (ou o botão de carinha ao lado do chat). Toca aqui também pelo cartão da pessoa.`;
  const panel = (...nodes: Node[]) => {
    const p = document.createElement('div');
    p.className = 'help-panel';
    p.append(...nodes);
    return p;
  };
  const commands = panel(table('Comandos do chat', CHAT_COMMANDS), emotes);
  const shortcuts = panel(table('Atalhos', SHORTCUTS));
  const buttons = panel(table('Botões', BUTTONS));
  const tabs = createTabs('Seções da ajuda', [
    { id: 'comandos', label: 'Comandos', panel: commands },
    { id: 'atalhos', label: 'Atalhos', panel: shortcuts },
    { id: 'botoes', label: 'Botões', panel: buttons },
  ]);
  const tourBtn = Object.assign(document.createElement('button'), {
    type: 'button',
    className: 'btn-secondary help-tour',
    textContent: 'Refazer o tour guiado',
  });
  body.append(tabs.el, commands, shortcuts, buttons, tourBtn);
  sheet.append(body);
  backdrop.append(sheet);
  document.body.append(backdrop);

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    openClose = null;
  };
  openClose = close;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  sheet.querySelector('.sheet-close')!.addEventListener('click', close);
  tourBtn.addEventListener('click', () => {
    close();
    deps.restartTour();
  });
  sheet.querySelector<HTMLButtonElement>('[role=tab][aria-selected=true]')?.focus();
}

// ---------- Dicas no momento certo ----------

const TIPS_KEY = 'ev-dicas-vistas';

/** Mostra a dica `id` só na primeira vez (por navegador). Devolve se mostrou. */
export function tipOnce(id: string, show: () => void): boolean {
  let seen: string[];
  try {
    seen = JSON.parse(localStorage.getItem(TIPS_KEY) ?? '[]') as string[];
  } catch {
    seen = [];
  }
  if (seen.includes(id)) return false;
  try {
    localStorage.setItem(TIPS_KEY, JSON.stringify([...seen, id]));
  } catch {
    // sem armazenamento: a dica pode voltar na próxima visita
  }
  show();
  return true;
}
