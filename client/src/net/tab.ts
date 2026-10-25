/**
 * Identidade desta aba: a mesma em todas as salas e reconexões enquanto a página estiver aberta
 * (recarregar gera outra). O servidor usa para manter cada pessoa em uma aba só e para saber,
 * quando a conexão cai no meio de uma chamada, que é a mesma aba que voltou.
 */
export const TAB_ID = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
