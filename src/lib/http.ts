export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** A rejected request. `current` carries the server's copy for 409 conflicts so the client can re-review. */
export type Failure = { status: number; message: string; current?: unknown };

export function error(status: number, message: string, current?: unknown): Response {
  return json(current === undefined ? { error: message } : { error: message, current }, status);
}

export function fail(f: Failure): Response {
  return error(f.status, f.message, f.current);
}

/** Parse a JSON object body; returns null if it is missing or not an object. */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
