import {
  ERROR_MESSAGES,
  type ApiError,
  type ClaimRequest,
  type LoginRequest,
  type PasswordChangeRequest,
  type ProfileUpdate,
  type RegisterRequest,
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
