/**
 * Tiny client-side fetch helpers for the API envelope:
 * success `{ ok: true, data }`, failure `{ ok: false, error }`.
 */

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** POST JSON, unwrap the envelope, throw Error(message) on failure. */
export async function postJson<T = unknown>(
  url: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Always send a JSON body so zod-parsing handlers never see an empty stream.
    body: body === undefined ? '{}' : JSON.stringify(body),
  });
  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new Error('Unexpected server response');
  }
  if (!res.ok || !envelope.ok) {
    throw new Error(envelope.error ?? 'Request failed');
  }
  return envelope.data as T;
}

/** Only allow same-origin path redirects (guards `?next=` against open redirects). */
export function safePath(next: string | null | undefined): string {
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return '/';
}

/** Human message from an unknown thrown value. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}
