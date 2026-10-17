const params = new URLSearchParams(location.search);

/** Força a arte provisória gerada por código (sem chamar a HabboAssets). Use `?offline=1`. */
export const OFFLINE_ASSETS = params.has('offline') || import.meta.env.VITE_OFFLINE_ASSETS === '1';

/** Desenha footprints e caixas de profundidade por cima da cena. Use `?debug=1`. */
export const DEBUG = params.has('debug');

/** Ponto dos pés do avatar no render 64×110 do imager (medido no pixel opaco mais baixo). */
export const IMAGER_AVATAR_FEET = { x: 32, y: 104 } as const;

/** Força a hora do dia/noite (ex.: `?hora=21` ou `?hora=18.5`), para testar a iluminação. */
export const HOUR_OVERRIDE = (() => {
  const v = params.get('hora');
  const n = v === null ? NaN : Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
})();
