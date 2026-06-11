import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { assertRateLimit, clearRateLimit, clientIp } from '@/lib/rate-limit';
import { withFakeNow } from '../helpers/db';

const WINDOW_MS = 15 * 60_000;

function expect429(fn: () => unknown) {
  try {
    fn();
    expect.unreachable('expected a 429 AppError');
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(429);
  }
}

describe('assertRateLimit', () => {
  it('allows up to the limit within a window, then throws 429', async () => {
    await withFakeNow('2026-06-10T12:00:00Z', () => {
      for (let i = 0; i < 5; i++) {
        assertRateLimit('test:within-limit', 5, WINDOW_MS); // no throw
      }
      expect429(() => assertRateLimit('test:within-limit', 5, WINDOW_MS));
    });
  });

  it('resets after the window expires', async () => {
    await withFakeNow('2026-06-10T12:00:00Z', () => {
      for (let i = 0; i < 3; i++) assertRateLimit('test:window-reset', 3, WINDOW_MS);
      expect429(() => assertRateLimit('test:window-reset', 3, WINDOW_MS));
    });
    // 16 minutes later the window has rolled over — attempts are fresh.
    await withFakeNow('2026-06-10T12:16:00Z', () => {
      assertRateLimit('test:window-reset', 3, WINDOW_MS); // no throw
    });
  });

  it('keys are independent (one username/ip cannot lock out another)', async () => {
    await withFakeNow('2026-06-10T12:00:00Z', () => {
      for (let i = 0; i < 3; i++) assertRateLimit('test:keys:a', 3, WINDOW_MS);
      expect429(() => assertRateLimit('test:keys:a', 3, WINDOW_MS));
      assertRateLimit('test:keys:b', 3, WINDOW_MS); // unaffected
    });
  });

  it('clearRateLimit (successful login) resets the counter', async () => {
    await withFakeNow('2026-06-10T12:00:00Z', () => {
      for (let i = 0; i < 3; i++) assertRateLimit('test:clear', 3, WINDOW_MS);
      clearRateLimit('test:clear');
      assertRateLimit('test:clear', 3, WINDOW_MS); // no throw — counter gone
    });
  });
});

describe('clientIp', () => {
  it('takes the first hop of x-forwarded-for, else a fixed local label', () => {
    expect(clientIp({ headers: new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }) })).toBe(
      '1.2.3.4',
    );
    expect(clientIp({ headers: new Headers() })).toBe('local');
  });
});
