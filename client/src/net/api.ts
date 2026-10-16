import {
  ERROR_MESSAGES,
  type ApiError,
  type SessionRequest,
  type SessionResponse,
} from '@office/shared';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: Partial<ApiError>,
  ) {
    super(body.message ?? `Erro ${status}`);
  }
}

export async function createSession(req: SessionRequest): Promise<SessionResponse> {
  let res: Response;
  try {
    res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch {
    throw new ApiRequestError(0, {
      message: 'Não foi possível falar com o servidor. Ele está no ar?',
    });
  }
  const body = (await res.json().catch(() => ({}))) as Partial<ApiError> & Partial<SessionResponse>;
  if (!res.ok) {
    const message = body.message ?? (body.error ? ERROR_MESSAGES[body.error] : undefined);
    throw new ApiRequestError(res.status, { ...body, message: message ?? `Erro ${res.status}` });
  }
  return body as SessionResponse;
}
