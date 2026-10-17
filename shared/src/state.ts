import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * Estado sincronizado em tempo real (Colyseus). O servidor é a autoridade; o cliente
 * só lê. Fica em `shared` para o cliente decodificar com tipos.
 *
 * Movimento: `x,y` é o tile onde o avatar está; `nextX,nextY` é o tile para onde ele
 * está andando (igual a `x,y` quando parado). Cada passo leva `STEP_MS` e o cliente
 * interpola entre os dois.
 */
export const Player = schema(
  {
    userId: t.string(),
    name: t.string(),
    figure: t.string(),
    x: t.uint8(),
    y: t.uint8(),
    z: t.float32(),
    nextX: t.uint8(),
    nextY: t.uint8(),
    dir: t.uint8(),
    /** 'idle' | 'walk' | 'sit' */
    action: t.string(),
    /** Desconectado e aguardando reconexão. */
    away: t.boolean(),
    /** 'available' | 'busy' | 'away' (escolhido pela pessoa ou ausente automático). */
    status: t.string(),
    /** Está digitando no chat. */
    typing: t.boolean(),
    /** Cargo (nome e cor da etiqueta); vazio = sem cargo. */
    cargo: t.string(),
    cargoColor: t.string(),
    /** 'admin' | 'member' */
    role: t.string(),
    /** Faz aniversário hoje (fuso do escritório). */
    birthday: t.boolean(),
    /** Pode criar e editar salas. */
    canEditRooms: t.boolean(),
  },
  'Player',
);
export type Player = SchemaType<typeof Player>;

/** Móvel posicionado (persistido em `room_furni`). */
export const Furni = schema(
  {
    id: t.string(),
    defId: t.string(),
    x: t.uint8(),
    y: t.uint8(),
    z: t.float32(),
    rot: t.uint8(),
    /** Estado (luz acesa, TV ligada…). */
    state: t.uint8(),
  },
  'Furni',
);
export type Furni = SchemaType<typeof Furni>;

/**
 * Partida de jogo da velha numa mesa de jogos (chave = id do móvel). Todo mundo na sala
 * recebe o estado, então quem não joga assiste ao vivo.
 */
export const TttGame = schema(
  {
    /** Jogadores: sessão (avatar), conta e nome; vazio = lugar livre. */
    xSession: t.string(),
    xUser: t.string(),
    xName: t.string(),
    oSession: t.string(),
    oUser: t.string(),
    oName: t.string(),
    /** 9 casas: `.`, `X` ou `O`. */
    board: t.string(),
    /** 'X' | 'O': de quem é a vez. */
    turn: t.string(),
    /** Quem começou esta partida (alterna na revanche). */
    starter: t.string(),
    /** 'waiting' (falta jogador) | 'playing' | 'ended' */
    status: t.string(),
    /** 'X' | 'O' | 'draw' quando termina; 'X' ou 'O' também quando alguém sai no meio. */
    winner: t.string(),
    /** Casas da linha vencedora, ex. `0,4,8`. */
    line: t.string(),
  },
  'TttGame',
);
export type TttGame = SchemaType<typeof TttGame>;

export const OfficeState = schema(
  {
    roomId: t.string(),
    /** Chave = sessionId do Colyseus. */
    players: t.map(Player),
    /** Chave = id do móvel. */
    furni: t.map(Furni),
    /** Partidas de jogo da velha (chave = id da mesa). */
    games: t.map(TttGame),
    /** Só admins decoram esta sala. */
    decorLocked: t.boolean(),
  },
  'OfficeState',
);
export type OfficeState = SchemaType<typeof OfficeState>;
