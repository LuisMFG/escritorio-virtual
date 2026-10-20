/**
 * Abas acessíveis (Fase 43): `role=tablist/tab/tabpanel`, setas ← → (e Home/End) trocam
 * de aba. Os painéis já existem no HTML; aqui só se liga um a um.
 */
export interface TabSpec {
  id: string;
  label: string;
  panel: HTMLElement;
}

export interface Tabs {
  readonly el: HTMLElement;
  select(id: string, focus?: boolean): void;
  readonly current: string;
}

let seq = 0;

export function createTabs(
  label: string,
  specs: TabSpec[],
  initial = specs[0]!.id,
  onChange?: (id: string) => void,
): Tabs {
  const list = document.createElement('div');
  list.className = 'tabs';
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', label);
  const prefix = `tabs-${++seq}`;
  const buttons = specs.map((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab';
    b.id = `${prefix}-${s.id}`;
    b.textContent = s.label;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', `${prefix}-${s.id}-panel`);
    s.panel.id = `${prefix}-${s.id}-panel`;
    s.panel.setAttribute('role', 'tabpanel');
    s.panel.setAttribute('aria-labelledby', b.id);
    s.panel.tabIndex = 0;
    b.addEventListener('click', () => tabs.select(s.id));
    list.append(b);
    return b;
  });
  list.addEventListener('keydown', (e) => {
    const i = specs.findIndex((s) => s.id === current);
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % specs.length
        : e.key === 'ArrowLeft'
          ? (i - 1 + specs.length) % specs.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? specs.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    tabs.select(specs[next]!.id, true);
  });

  let current = '';
  const tabs: Tabs = {
    el: list,
    get current() {
      return current;
    },
    select(id, focus = false) {
      const index = Math.max(
        0,
        specs.findIndex((s) => s.id === id),
      );
      current = specs[index]!.id;
      specs.forEach((s, i) => {
        const on = i === index;
        buttons[i]!.setAttribute('aria-selected', String(on));
        buttons[i]!.tabIndex = on ? 0 : -1;
        s.panel.hidden = !on;
      });
      if (focus) buttons[index]!.focus();
      onChange?.(current);
    },
  };
  tabs.select(initial);
  return tabs;
}
