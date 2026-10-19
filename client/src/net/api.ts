import {
  ERROR_MESSAGES,
  type ApiError,
  type AdminOverview,
  type AdminUserUpdate,
  type AuditEntry,
  type ClaimRequest,
  type KickScope,
  type TempPasswordResponse,
  type LoginRequest,
  type PasswordChangeRequest,
  type ProfileUpdate,
  type RegisterRequest,
  type Meeting,
  type MeetingCreate,
  type PetInfo,
  type AchievementsResponse,
  type BackupInfo,
  type BackupList,
  type ActivitySettings,
  type ApiTokenCreated,
  type CodeShare,
  type SpotifyStatus,
  type JiraBoard,
  type EffectId,
  type SavedLook,
  type EffectsResponse,
  type FurniConfigResponse,
  type FurniManifestEntry,
  type TeleportInfo,
  type JiraConnect,
  type JiraShare,
  type JiraStatus,
  type Announcement,
  type Kudos,
  type MapRoom,
  type KudosCreate,
  type Attachment,
  type LinkPreview,
  type SearchHit,
  type AnnouncementCreate,
  type RoomEdit,
  type RoomEditorData,
  type SessionResponse,
  type TeamResponse,
} from '@office/shared';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: Partial<ApiError>,
  ) {
    super(body.message ?? `Erro ${status}`);
  }
}

/** JSON para a API do próprio servidor, com o token quando houver. */
async function request<T>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiRequestError(0, {
      message: 'Não foi possível falar com o servidor. Ele está no ar?',
    });
  }
  const body = (await res.json().catch(() => ({}))) as Partial<ApiError> & T;
  if (!res.ok) {
    const message = body.message ?? (body.error ? ERROR_MESSAGES[body.error] : undefined);
    throw new ApiRequestError(res.status, { ...body, message: message ?? `Erro ${res.status}` });
  }
  return body;
}

export const api = {
  register: (req: RegisterRequest) =>
    request<SessionResponse>('POST', '/api/register', { body: req }),
  login: (req: LoginRequest) => request<SessionResponse>('POST', '/api/login', { body: req }),
  me: (token: string) => request<SessionResponse>('GET', '/api/me', { token }),
  claim: (token: string, req: ClaimRequest) =>
    request<SessionResponse>('POST', '/api/me/claim', { token, body: req }),
  updateProfile: (token: string, req: ProfileUpdate) =>
    request<SessionResponse>('PATCH', '/api/me', { token, body: req }),
  changePassword: (token: string, req: PasswordChangeRequest) =>
    request<{ ok: true }>('POST', '/api/me/password', { token, body: req }),
  logout: (token: string, all = false) =>
    request<{ ok: true }>('POST', '/api/logout', { token, body: { all } }),
  team: (token: string) => request<TeamResponse>('GET', '/api/team', { token }),
  assignCargo: (token: string, userId: string, cargoId: number | null) =>
    request<{ ok: true }>('PUT', `/api/users/${encodeURIComponent(userId)}/cargo`, {
      token,
      body: { cargoId },
    }),
};

type Ok = { ok: true };
const user = (id: string) => `/api/admin/users/${encodeURIComponent(id)}`;

/** Painel Admin (o servidor recusa com 403 quem não é admin). */
export const adminApi = {
  overview: (token: string) => request<AdminOverview>('GET', '/api/admin', { token }),
  audit: (token: string) => request<AuditEntry[]>('GET', '/api/admin/audit', { token }),
  setInvite: (token: string, inviteCode: string) =>
    request<Ok>('PUT', '/api/admin/invite', { token, body: { inviteCode } }),
  setJiraSite: (token: string, site: string) =>
    request<{ site: string | null }>('PUT', '/api/admin/jira', { token, body: { site } }),
  setRoom: (token: string, roomId: string, decorLocked: boolean) =>
    request<Ok>('PUT', `/api/admin/rooms/${encodeURIComponent(roomId)}`, {
      token,
      body: { decorLocked },
    }),
  updateUser: (token: string, userId: string, changes: AdminUserUpdate) =>
    request<Ok>('PATCH', user(userId), { token, body: changes }),
  resetPassword: (token: string, userId: string) =>
    request<TempPasswordResponse>('POST', `${user(userId)}/password`, { token, body: {} }),
  kick: (token: string, userId: string, scope: KickScope) =>
    request<Ok>('POST', `${user(userId)}/kick`, { token, body: { scope } }),
  createCargo: (token: string, name: string, color: string) =>
    request<Ok>('POST', '/api/admin/cargos', { token, body: { name, color } }),
  updateCargo: (token: string, id: number, changes: { name?: string; color?: string }) =>
    request<Ok>('PATCH', `/api/admin/cargos/${id}`, { token, body: changes }),
  deleteCargo: (token: string, id: number) =>
    request<Ok>('DELETE', `/api/admin/cargos/${id}`, { token }),
  reorderCargos: (token: string, ids: number[]) =>
    request<Ok>('PUT', '/api/admin/cargos/order', { token, body: { ids } }),
  backups: (token: string) => request<BackupList>('GET', '/api/admin/backups', { token }),
  createBackup: (token: string) => request<BackupInfo>('POST', '/api/admin/backups', { token }),
  /** Baixa o arquivo (precisa do token no cabeçalho, então não dá para ser um link comum). */
  downloadBackup: async (token: string, name: string) => {
    const res = await fetch(`/api/admin/backups/${encodeURIComponent(name)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok)
      throw new ApiRequestError(res.status, { message: 'Não foi possível baixar o backup.' });
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};

const room = (id: string) => `/api/rooms/${encodeURIComponent(id)}`;

/** Editor de salas (admins e quem pode editar salas). */
export const roomApi = {
  get: (token: string, id: string) => request<RoomEditorData>('GET', room(id), { token }),
  create: (token: string, name: string) =>
    request<{ id: string }>('POST', '/api/rooms', { token, body: { name } }),
  update: (token: string, id: string, edit: RoomEdit) =>
    request<{ removedFurni: number }>('PUT', room(id), { token, body: edit }),
  remove: (token: string, id: string) => request<Ok>('DELETE', room(id), { token }),
};

/** Agenda de reuniões. */
export const mapApi = {
  get: (token: string) => request<MapRoom[]>('GET', '/api/map', { token }),
};

export const kudosApi = {
  wall: (token: string, para?: string) =>
    request<Kudos[]>('GET', `/api/kudos${para ? `?para=${encodeURIComponent(para)}` : ''}`, {
      token,
    }),
  give: (token: string, k: KudosCreate) => request<Kudos>('POST', '/api/kudos', { token, body: k }),
};

export const uploadApi = {
  /** Envia o arquivo cru (o nome vai no cabeçalho). */
  async upload(token: string, file: File): Promise<Attachment> {
    let res: Response;
    try {
      res = await fetch('/api/uploads', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
        },
        body: file,
      });
    } catch {
      throw new ApiRequestError(0, { message: 'Não foi possível enviar o arquivo.' });
    }
    const body = (await res.json().catch(() => ({}))) as Partial<ApiError> & Attachment;
    if (res.status === 413)
      throw new ApiRequestError(413, { message: 'O arquivo passa de 10 MB.' });
    if (!res.ok)
      throw new ApiRequestError(res.status, { message: body.message ?? `Erro ${res.status}` });
    return body;
  },
  /** O arquivo (com o token: os anexos não ficam abertos na internet). */
  async blob(token: string, id: string): Promise<Blob> {
    const res = await fetch(`/api/uploads/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new ApiRequestError(res.status, { message: 'Arquivo indisponível.' });
    return res.blob();
  },
  preview: (token: string, url: string) =>
    request<LinkPreview | null>('GET', `/api/link-preview?url=${encodeURIComponent(url)}`, {
      token,
    }),
  search: (token: string, q: string) =>
    request<SearchHit[]>('GET', `/api/search?q=${encodeURIComponent(q)}`, { token }),
};

export const announcementApi = {
  list: (token: string) => request<Announcement[]>('GET', '/api/announcements', { token }),
  unread: (token: string) => request<Announcement[]>('GET', '/api/announcements/unread', { token }),
  create: (token: string, a: AnnouncementCreate) =>
    request<Announcement>('POST', '/api/announcements', { token, body: a }),
  read: (token: string, id: number) =>
    request<Ok>('PUT', `/api/announcements/${id}/read`, { token, body: {} }),
  remove: (token: string, id: number) =>
    request<Ok>('DELETE', `/api/announcements/${id}`, { token }),
};

export const looksApi = {
  list: (token: string) => request<SavedLook[]>('GET', '/api/looks', { token }),
  save: (token: string, slot: number, look: { figure: string; gender: 'M' | 'F' }) =>
    request<SavedLook[]>('PUT', `/api/looks/${slot}`, { token, body: look }),
  remove: (token: string, slot: number) =>
    request<SavedLook[]>('DELETE', `/api/looks/${slot}`, { token }),
};

export const furniApi = {
  config: (token: string) => request<FurniConfigResponse>('GET', '/api/furni/config', { token }),
  measured: (token: string) => request<FurniManifestEntry[]>('GET', '/api/furni/defs', { token }),
  def: (token: string, id: string) =>
    request<FurniManifestEntry>('GET', `/api/furni/defs/${encodeURIComponent(id)}`, { token }),
  setHidden: (token: string, hidden: string[]) =>
    request<FurniConfigResponse>('PUT', '/api/admin/furni-categories', {
      token,
      body: { hidden },
    }),
};

export const teleportApi = {
  list: (token: string) => request<TeleportInfo[]>('GET', '/api/teleports', { token }),
  link: (token: string, id: string, targetId: string | null) =>
    request<TeleportInfo[]>('PUT', `/api/teleports/${encodeURIComponent(id)}/link`, {
      token,
      body: { targetId },
    }),
};

export const effectsApi = {
  list: (token: string) => request<EffectsResponse>('GET', '/api/effects', { token }),
  set: (token: string, effect: EffectId | null) =>
    request<EffectsResponse>('PUT', '/api/effects', { token, body: { effect } }),
};

export const jiraApi = {
  status: (token: string) => request<JiraStatus>('GET', '/api/jira/status', { token }),
  connect: (token: string, body: JiraConnect) =>
    request<JiraStatus>('POST', '/api/jira/connect', { token, body }),
  setShare: (token: string, share: JiraShare) =>
    request<JiraStatus>('PUT', '/api/jira/settings', { token, body: { share } }),
  disconnect: (token: string) => request<JiraStatus>('DELETE', '/api/jira', { token }),
  board: (token: string) => request<JiraBoard>('GET', '/api/jira/board', { token }),
};

export const spotifyApi = {
  status: (token: string) => request<SpotifyStatus>('GET', '/api/spotify/status', { token }),
  connect: (token: string) => request<{ url: string }>('POST', '/api/spotify/connect', { token }),
  setHidden: (token: string, hidden: boolean) =>
    request<SpotifyStatus>('PUT', '/api/spotify/settings', { token, body: { hidden } }),
  disconnect: (token: string) => request<SpotifyStatus>('DELETE', '/api/spotify', { token }),
};

export const activityApi = {
  settings: (token: string) =>
    request<ActivitySettings>('GET', '/api/activity/settings', { token }),
  setCodeShare: (token: string, codeShare: CodeShare) =>
    request<{ codeShare: CodeShare }>('PUT', '/api/activity/settings', {
      token,
      body: { codeShare },
    }),
  createToken: (token: string, name: string) =>
    request<ApiTokenCreated>('POST', '/api/activity/tokens', { token, body: { name } }),
  revokeToken: (token: string, id: number) =>
    request<Ok>('DELETE', `/api/activity/tokens/${id}`, { token }),
};

export const achievementApi = {
  me: (token: string) => request<AchievementsResponse>('GET', '/api/achievements/me', { token }),
  setShowcase: (token: string, ids: string[]) =>
    request<{ showcase: string[] }>('PUT', '/api/achievements/showcase', { token, body: { ids } }),
};

export const petApi = {
  get: (token: string) => request<{ pet: PetInfo | null }>('GET', '/api/pets/me', { token }),
  save: (token: string, pet: PetInfo) =>
    request<PetInfo>('PUT', '/api/pets/me', { token, body: pet }),
  release: (token: string) => request<Ok>('DELETE', '/api/pets/me', { token }),
};

export const meetingApi = {
  list: (token: string) => request<Meeting[]>('GET', '/api/meetings', { token }),
  create: (token: string, m: MeetingCreate) =>
    request<Meeting>('POST', '/api/meetings', { token, body: m }),
  respond: (token: string, id: number, response: 'yes' | 'no') =>
    request<Meeting>('PUT', `/api/meetings/${id}/response`, { token, body: { response } }),
  cancel: (token: string, id: number) => request<Ok>('DELETE', `/api/meetings/${id}`, { token }),
};
