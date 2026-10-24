/**
 * Rosto do avatar na chamada (quem está sem câmera): a boca acompanha o volume do microfone e
 * fecha quando a pessoa para de falar. Funções puras, para o painel e o mini-player.
 */

/** Volume (RMS de 0 a 1) a partir do qual conta como fala; o mesmo do anel verde. */
export const SPEAKING_LEVEL = 0.035;
/** Acima disto (fala alta), a boca abre mais. */
export const LOUD_LEVEL = 0.12;

/** Como a boca fica: fechada, entreaberta ou aberta (quadros de fala 0 e 1 do avatar). */
export type Mouth = 'closed' | 'half' | 'open';

/**
 * Boca para um volume. Falando, alterna entre entreaberta e aberta a cada medida (`tick`) e,
 * com volume alto, fica aberta: o movimento acompanha a voz em vez de piscar sempre igual.
 */
export function mouthFor(level: number, tick: number, muted = false): Mouth {
  if (muted || !(level > SPEAKING_LEVEL)) return 'closed';
  if (level > LOUD_LEVEL) return tick % 3 === 2 ? 'half' : 'open';
  return tick % 2 === 0 ? 'half' : 'open';
}

/** Imagens do rosto: boca fechada e os dois quadros de fala. */
export interface CallFace {
  closed: string;
  half: string;
  open: string;
}

/**
 * Quem aparece no mini-player: quem está falando agora (o primeiro dos outros, se mais de um);
 * senão, quem falou por último; senão, a primeira pessoa além de você. Sozinho, você.
 */
export function spotlightOf(
  members: readonly string[],
  me: string,
  speaking: ReadonlySet<string>,
  lastSpeaker: string | null,
): string | null {
  const others = members.filter((id) => id !== me);
  const talking = others.find((id) => speaking.has(id));
  if (talking) return talking;
  if (speaking.has(me) && !others.length) return me;
  if (lastSpeaker && members.includes(lastSpeaker)) return lastSpeaker;
  return others[0] ?? (members.includes(me) ? me : null);
}
