/* global document, localStorage, matchMedia */
// Tema e tamanho do texto salvos antes de pintar a página (evita piscar).
try {
  const t = localStorage.getItem('ev-theme');
  const light =
    t === 'light' || (t === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
  if (light) document.documentElement.dataset.theme = 'light';
  const f = localStorage.getItem('ev-font-scale');
  if (f) document.documentElement.style.setProperty('--font-scale', f);
} catch {
  // sem armazenamento: o main.ts aplica o padrão
}
