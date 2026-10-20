import { AMBIENT_LABELS } from '@office/shared';
import type { AmbientSound } from './ambient.js';
import { iconHtml } from './icons.js';
import { NOTIFY_LABELS, type SystemNotifier } from './notifications.js';
import {
  FONT_SCALES,
  loadFontScale,
  loadDayLight,
  loadMotion,
  setDayLightPref,
  setFontScale,
  setMotion,
  type MotionPref,
} from './prefs.js';
import type { ChatSound } from './sound.js';
import { loadThemePref, setTheme, type ThemePref } from './theme.js';

export interface SettingsDeps {
  sound: ChatSound;
  /** O som de mensagem foi ligado/desligado aqui (o sino da coluna acompanha). */
  onSoundChange: (on: boolean) => void;
  ambient: AmbientSound;
  notifier: SystemNotifier;
  /** Ligou/desligou a luz do dia e noite: a sala reaplica a cor. */
  onDayLightChange: () => void;
  /** Só admins: de onde vem a arte (diagnóstico); `null` para os outros. */
  assetStatus: () => string | null;
}

const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'dark', label: 'Escuro' },
  { value: 'light', label: 'Claro' },
  { value: 'system', label: 'Do sistema' },
];

const MOTIONS: { value: MotionPref; label: string }[] = [
  { value: 'system', label: 'Do sistema' },
  { value: 'reduce', label: 'Reduzir' },
  { value: 'full', label: 'Normal' },
];

/** Grupo de opções (rádios com cara de botões segmentados). */
function choice<T extends string | number>(
  legend: string,
  name: string,
  options: readonly { value: T; label: string }[],
  current: T,
  onPick: (v: T) => void,
): HTMLFieldSetElement {
  const fs = document.createElement('fieldset');
  fs.className = 'settings-choice';
  fs.append(Object.assign(document.createElement('legend'), { textContent: legend }));
  const row = Object.assign(document.createElement('div'), { className: 'segmented-radios' });
  for (const o of options) {
    const label = document.createElement('label');
    const input = Object.assign(document.createElement('input'), {
      type: 'radio',
      name,
      value: String(o.value),
      checked: o.value === current,
    });
    input.addEventListener('change', () => input.checked && onPick(o.value));
    label.append(input, Object.assign(document.createElement('span'), { textContent: o.label }));
    row.append(label);
  }
  fs.append(row);
  return fs;
}

function toggle(label: string, checked: boolean, onChange: (on: boolean) => void) {
  const wrap = Object.assign(document.createElement('label'), { className: 'settings-toggle' });
  const input = Object.assign(document.createElement('input'), { type: 'checkbox', checked });
  input.setAttribute('role', 'switch');
  input.addEventListener('change', () => onChange(input.checked));
  wrap.append(Object.assign(document.createElement('span'), { textContent: label }), input);
  return { wrap, input };
}

function section(title: string, ...children: Node[]): HTMLElement {
  const s = document.createElement('section');
  s.className = 'settings-section';
  s.setAttribute('aria-label', title);
  s.append(Object.assign(document.createElement('h3'), { textContent: title }), ...children);
  return s;
}

/** Janela "Configurações" (Fase 43): aparência, som e notificações num lugar só. */
export function openSettings(deps: SettingsDeps): () => void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const sheet = document.createElement('section');
  sheet.className = 'sheet settings';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'settings-title');
  sheet.innerHTML = `
    <header class="sheet-head">
      <h2 id="settings-title">Configurações</h2>
      <button type="button" class="sheet-close" aria-label="Fechar">${iconHtml('x')}</button>
    </header>`;
  const body = Object.assign(document.createElement('div'), { className: 'sheet-body' });

  // Aparência
  const appearance = section(
    'Aparência',
    choice('Tema', 'theme', THEMES, loadThemePref(), (v) => setTheme(v)),
    choice('Tamanho do texto', 'font', FONT_SCALES, loadFontScale() as 1 | 1.15 | 1.3, (v) =>
      setFontScale(v),
    ),
    choice('Movimento e animações', 'motion', MOTIONS, loadMotion(), (v) => setMotion(v)),
  );
  const daylight = toggle(
    'Luz do dia e noite na sala (horário de Brasília)',
    loadDayLight(),
    (on) => {
      setDayLightPref(on);
      deps.onDayLightChange();
    },
  );
  appearance.append(daylight.wrap);

  // Som
  const msgSound = toggle('Som de mensagem e menções', deps.sound.enabled, () => {
    deps.onSoundChange(deps.sound.toggle());
  });
  const amb = toggle('Som ambiente da sala', deps.ambient.enabled, (on) => {
    deps.ambient.setEnabled(on);
    volume.disabled = !on;
  });
  const volume = Object.assign(document.createElement('input'), {
    type: 'range',
    min: '0',
    max: '1',
    step: '0.05',
    value: String(deps.ambient.volume),
    disabled: !deps.ambient.enabled,
    className: 'settings-volume',
  });
  volume.setAttribute('aria-label', 'Volume do som ambiente');
  volume.addEventListener('input', () => deps.ambient.setVolume(Number(volume.value)));
  const now = Object.assign(document.createElement('small'), {
    className: 'muted',
    textContent:
      deps.ambient.current === 'none'
        ? 'Esta sala é silenciosa.'
        : `Nesta sala: ${AMBIENT_LABELS[deps.ambient.current]}`,
  });
  const soundSec = section('Som', msgSound.wrap, amb.wrap, volume, now);

  // Notificações do navegador
  const notifyBtn = Object.assign(document.createElement('button'), {
    type: 'button',
    className: 'btn-secondary',
  });
  const notifyHint = Object.assign(document.createElement('small'), { className: 'muted' });
  const renderNotify = () => {
    const st = deps.notifier.state;
    notifyBtn.textContent = st === 'on' ? 'Desativar notificações' : NOTIFY_LABELS[st];
    notifyBtn.disabled = st === 'unsupported' || st === 'blocked';
    notifyHint.textContent =
      st === 'on'
        ? 'Ativadas: mensagens, menções e reuniões avisam com a aba em segundo plano.'
        : st === 'blocked'
          ? 'Libere as notificações deste site nas configurações do navegador.'
          : 'Avisos de mensagens, menções e reuniões quando a aba está em segundo plano.';
  };
  notifyBtn.addEventListener('click', async () => {
    await deps.notifier.toggle();
    renderNotify();
  });
  renderNotify();
  body.append(appearance, soundSec, section('Notificações', notifyBtn, notifyHint));

  const status = deps.assetStatus();
  if (status) {
    body.append(
      section(
        'Diagnóstico (admin)',
        Object.assign(document.createElement('p'), { className: 'muted', textContent: status }),
      ),
    );
  }
  sheet.append(body);
  backdrop.append(sheet);
  document.body.append(backdrop);

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  sheet.querySelector('.sheet-close')!.addEventListener('click', close);
  sheet.querySelector<HTMLInputElement>('input:checked')?.focus();
  return close;
}
