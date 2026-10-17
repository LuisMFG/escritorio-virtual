import {
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  POLL_OPTION_MAX,
  POLL_QUESTION_MAX,
  type PollCreate,
  type PollView,
} from '@office/shared';

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
): HTMLElementTagNameMap[K] => Object.assign(document.createElement(tag), props);

export interface PollCardHandlers {
  vote(pollId: number, option: number): void;
  close(pollId: number): void;
  /** Quem está vendo pode encerrar (criou ou é admin). */
  canClose(poll: PollView): boolean;
}

/** Cartão da enquete dentro do chat: opções com barra, voto destacado e "Encerrar". */
export function pollCard(poll: PollView, on: PollCardHandlers): HTMLElement {
  const box = el('div', { className: `poll-card${poll.closed ? ' closed' : ''}` });
  box.dataset.poll = String(poll.id);
  box.append(el('strong', { className: 'poll-question', textContent: `📊 ${poll.question}` }));
  const list = el('div', { className: 'poll-options' });
  for (const [i, opt] of poll.options.entries()) {
    const pct = poll.total ? Math.round((opt.votes / poll.total) * 100) : 0;
    const b = el('button', {
      type: 'button',
      className: `poll-option${poll.myVote === i ? ' mine' : ''}`,
      disabled: poll.closed,
      title: opt.voters.length ? opt.voters.join(', ') : '',
    });
    b.setAttribute('aria-pressed', String(poll.myVote === i));
    b.setAttribute(
      'aria-label',
      `${opt.text}: ${opt.votes} voto(s)${poll.myVote === i ? ', seu voto' : ''}`,
    );
    b.style.setProperty('--pct', `${pct}%`);
    b.append(
      el('span', {
        className: 'poll-option-text',
        textContent: `${poll.myVote === i ? '✓ ' : ''}${opt.text}`,
      }),
      el('span', { className: 'poll-option-count', textContent: `${opt.votes} · ${pct}%` }),
    );
    b.addEventListener('click', () => on.vote(poll.id, i));
    list.append(b);
  }
  const foot = el('div', { className: 'poll-foot muted' });
  // Com nomes: quem votou aparece ao passar o mouse em cada opção.
  const kind = poll.anonymous ? 'anônima' : 'com nomes';
  foot.append(
    el('span', {
      textContent: `${poll.total} voto(s) · ${poll.closed ? 'encerrada' : kind}`,
    }),
  );
  if (!poll.closed && on.canClose(poll)) {
    const close = el('button', { type: 'button', className: 'btn-link', textContent: 'Encerrar' });
    close.addEventListener('click', () => on.close(poll.id));
    foot.append(close);
  }
  box.append(list, foot);
  return box;
}

/** Janela "Nova enquete": pergunta, 2–6 opções e se é anônima. */
export function openPollForm(create: (poll: Required<PollCreate>) => void): void {
  const backdrop = el('div', { className: 'modal-backdrop' });
  backdrop.innerHTML = `
    <form class="sheet poll-form" role="dialog" aria-modal="true" aria-labelledby="poll-form-title" novalidate>
      <header class="sheet-head">
        <h2 id="poll-form-title">📊 Nova enquete</h2>
        <button type="button" class="sheet-close" aria-label="Fechar">✕</button>
      </header>
      <div class="sheet-body">
        <label class="field"><span>Pergunta</span><input name="question" maxlength="${POLL_QUESTION_MAX}" placeholder="Ex.: Onde vamos almoçar?" /></label>
        <div class="field"><span>Opções</span><div class="poll-form-options"></div></div>
        <button type="button" class="btn-link poll-form-add">+ Adicionar opção</button>
        <label class="poll-form-anon"><input type="checkbox" name="anonymous" /> Anônima (sem mostrar quem votou)</label>
        <p class="login-error" role="alert" hidden></p>
        <button type="submit" class="btn-primary">Criar enquete</button>
      </div>
    </form>`;
  document.body.append(backdrop);
  const form = backdrop.querySelector('form')!;
  const optionsBox = form.querySelector<HTMLElement>('.poll-form-options')!;
  const addBtn = form.querySelector<HTMLButtonElement>('.poll-form-add')!;
  const error = form.querySelector<HTMLElement>('.login-error')!;
  const close = () => backdrop.remove();
  form.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
  });
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  form.querySelector('.sheet-close')!.addEventListener('click', close);

  const addOption = () => {
    const n = optionsBox.children.length + 1;
    const input = el('input', {
      name: 'option',
      maxLength: POLL_OPTION_MAX,
      placeholder: `Opção ${n}`,
    });
    input.setAttribute('aria-label', `Opção ${n}`);
    optionsBox.append(input);
    addBtn.hidden = optionsBox.children.length >= POLL_MAX_OPTIONS;
  };
  for (let i = 0; i < POLL_MIN_OPTIONS; i++) addOption();
  addBtn.addEventListener('click', () => {
    addOption();
    (optionsBox.lastElementChild as HTMLInputElement).focus();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const question = form.querySelector<HTMLInputElement>('input[name=question]')!.value.trim();
    const options = [...optionsBox.querySelectorAll('input')]
      .map((i) => i.value.trim())
      .filter(Boolean);
    if (!question) return showError('Escreva a pergunta.');
    if (options.length < POLL_MIN_OPTIONS)
      return showError(`Dê pelo menos ${POLL_MIN_OPTIONS} opções.`);
    create({
      question,
      options,
      anonymous: form.querySelector<HTMLInputElement>('input[name=anonymous]')!.checked,
    });
    close();
  });
  const showError = (m: string) => {
    error.hidden = false;
    error.textContent = m;
  };
  form.querySelector<HTMLInputElement>('input[name=question]')!.focus();
}
