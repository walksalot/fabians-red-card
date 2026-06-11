import { clearSession } from '@/lib/session';
import { handle, jsonOk } from '@/lib/api-helpers';

/**
 * Clears the session cookie. Deliberately does not require a valid session:
 * logging out with an expired/tampered cookie must still clear it.
 */
export const POST = handle(async () => {
  await clearSession();
  return jsonOk(null);
});
