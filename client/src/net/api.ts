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
