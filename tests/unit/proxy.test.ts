import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

const ORIGIN = 'http://localhost:3000';

function request(path: string, opts: { signedIn?: boolean } = {}) {
  return new NextRequest(`${ORIGIN}${path}`, {
    headers: opts.signedIn ? { cookie: 'wc_session=token' } : {},
  });
}

describe('league proxy (signed-out login redirect)', () => {
  it('keeps a calendar deep link day through the login round trip', () => {
    const res = proxy(request('/league/fabians-red-card/today?day=2026-06-28'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      `${ORIGIN}/login?next=${encodeURIComponent('/league/fabians-red-card/today?day=2026-06-28')}`,
    );
  });

  it('drops malformed or non-today day params (old redirect shape)', () => {
    for (const path of [
      '/league/l/today?day=garbage',
      '/league/l/today?day=2026-6-28',
      '/league/l/today',
      '/league/l/table?day=2026-06-28',
      '/league/l/history',
    ]) {
      const res = proxy(request(path));
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe(
        `${ORIGIN}/login?next=${encodeURIComponent('/league/l/today')}`,
      );
    }
  });

  it('passes signed-in requests through untouched', () => {
    const res = proxy(
      request('/league/l/today?day=2026-06-28', { signedIn: true }),
    );
    expect(res.headers.get('location')).toBeNull();
  });

  it('ignores the bare /league path', () => {
    expect(proxy(request('/league')).headers.get('location')).toBeNull();
  });
});
