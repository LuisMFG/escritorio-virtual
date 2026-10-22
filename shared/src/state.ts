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
    /** Emblemas de conquistas exibidos (ids separados por vírgula, até 3). */
    badges: t.string(),
    /** Atividade fora do escritório ("💻 Codando em TypeScript"); vazio = nada. Uma por linha. */
    activity: t.string(),
    /** Link da música que está tocando (linha 🎵 da atividade), se houver. */
    activityUrl: t.string(),
    /** Modo foco: fim da fase atual (epoch ms; 0 = fora do foco). */
    focusUntil: t.float64(),
    /** 'focus' | 'break' | '' */
    focusKind: t.string(),
    /** Efeito em uso (Fase 34, ids de `EFFECTS`); vazio = nenhum. */
    effect: t.string(),
    /** Item na mão (id do Habbo, ex.: 6 = café); 0 = nada. */
    handItem: t.uint16(),
    /** Minha mesa (Fase 42): id da cadeira da estação escolhida na Recepção; vazio = nenhuma. */
    desk: t.string(),
    /** Dança em andamento (Fase 55, ids de `DANCES`); vazio = não está dançando. */
    dance: t.string(),
    /** Começo do compasso da dança (epoch ms do servidor): todos calculam o mesmo quadro. */
    danceStart: t.float64(),
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

/**
 * Partida numa mesa do Salão de Jogos (Fase 57; chave = id da mesa): vagas, placar e resultado.
 * Todo mundo na sala recebe, então quem não joga assiste ao vivo. As vagas são achatadas como
 * no jogo da velha: sessão, conta, nome e até quando quem saiu pode voltar (`…Away`, epoch ms).
 */
export const ArcadeGame = schema(
  {
    /** 'pingpong' | 'pool' */
    kind: t.string(),
    /** Jogadores por lado: 1 (1×1) ou 2 (2×2). */
    mode: t.uint8(),
    /** 'waiting' | 'playing' | 'ended' */
    status: t.string(),
    a1Session: t.string(),
    a1User: t.string(),
    a1Name: t.string(),
    a1Away: t.float64(),
    a2Session: t.string(),
    a2User: t.string(),
    a2Name: t.string(),
    a2Away: t.float64(),
    b1Session: t.string(),
    b1User: t.string(),
    b1Name: t.string(),
    b1Away: t.float64(),
    b2Session: t.string(),
    b2User: t.string(),
    b2Name: t.string(),
    b2Away: t.float64(),
    scoreA: t.uint16(),
    scoreB: t.uint16(),
    /** Sets (ou partidas) ganhos por lado (Fase 58). */
    setsA: t.uint8(),
    setsB: t.uint8(),
    /** Vaga da vez: quem saca (ping-pong) ou joga (sinuca). */
    turn: t.string(),
    /** Momento do jogo: 'serve' | 'rally' | 'point' (vazio fora da partida). */
    phase: t.string(),
    /** Trecho da bola em jogo (JSON de `PongBall`; vazio = sem bola). Muda só no saque e na rebatida. */
    ball: t.string(),
    /** Raquetes (coordenadas da mesa, em metros), uma por vaga. */
    a1Px: t.float32(),
    a1Py: t.float32(),
    a2Px: t.float32(),
    a2Py: t.float32(),
    b1Px: t.float32(),
    b1Py: t.float32(),
    b2Px: t.float32(),
    b2Py: t.float32(),
    /** Detalhe do jogo (o último ponto, set, grupo de bolas…). */
    detail: t.string(),
    /** '' | 'a' | 'b' */
    winner: t.string(),
    /** '' | 'points' | 'forfeit' | 'wo' */
    end: t.string(),
  },
  'ArcadeGame',
);
export type ArcadeGame = SchemaType<typeof ArcadeGame>;

/** Pet que acompanha alguém na sala (chave = id da conta do dono). */
export const Pet = schema(
  {
    /** Sessão (avatar) que ele segue. */
    ownerSession: t.string(),
    ownerName: t.string(),
    name: t.string(),
    /** 'dog' | 'cat' | 'bunny' | 'chick' ou `hh:{tipo}` (pet do Habbo). */
    species: t.string(),
    color: t.uint8(),
    /** Pets do Habbo: cor que tinge a paleta (hex). */
    tint: t.string(),
    x: t.uint8(),
    y: t.uint8(),
    z: t.float32(),
    nextX: t.uint8(),
    nextY: t.uint8(),
    dir: t.uint8(),
    /** 'idle' | 'walk' | 'sit' | 'lie' */
    action: t.string(),
  },
  'Pet',
);
export type Pet = SchemaType<typeof Pet>;

export const OfficeState = schema(
  {
    roomId: t.string(),
    /** Chave = sessionId do Colyseus. */
    players: t.map(Player),
    /** Chave = id do móvel. */
    furni: t.map(Furni),
    /** Partidas de jogo da velha (chave = id da mesa). */
    games: t.map(TttGame),
    /** Mesas do Salão de Jogos com gente (chave = id da mesa, Fase 57). */
    arcade: t.map(ArcadeGame),
    /** Pets de quem está na sala (chave = id da conta do dono). */
    pets: t.map(Pet),
    /** Só admins decoram esta sala. */
    decorLocked: t.boolean(),
    /** Mesas com dono (Fase 42, só na Recepção): id da cadeira → nome de quem escolheu. */
    desks: t.map('string'),
  },
  'OfficeState',
);
export type OfficeState = SchemaType<typeof OfficeState>;
