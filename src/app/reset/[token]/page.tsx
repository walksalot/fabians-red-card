import { getDb } from '@/db';
import { verifyResetToken } from '@/lib/reset';
import { AppError } from '@/lib/errors';
import { RedCardMark } from '@/components/Brand';
import ResetForm from './ResetForm';

export const dynamic = 'force-dynamic';

/** Landing page for an admin-issued one-time password reset link. */
export default async function ResetPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const db = getDb();
  let username: string | null = null;
  let displayName = '';
  try {
    const user = await verifyResetToken(db, token);
    username = user.username;
    displayName = user.displayName;
  } catch (err) {
    const message =
      err instanceof AppError ? err.message : 'This reset link is invalid or has expired';
    return (
      <main className="flex min-h-dvh items-center justify-center bg-zinc-950 px-6 text-zinc-100">
        <div className="w-full max-w-md rounded-2xl bg-zinc-900 p-6 text-center ring-1 ring-zinc-800">
          <RedCardMark className="mx-auto h-8 w-8" />
          <h1 className="mt-3 text-lg font-bold">{message}</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Ask your league admin for a fresh link — they can make one in
            Admin → Members.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-950 px-6 text-zinc-100">
      <div className="w-full max-w-md rounded-2xl bg-zinc-900 p-6 ring-1 ring-zinc-800">
        <RedCardMark className="h-8 w-8" />
        <h1 className="mt-3 text-xl font-bold">Set a new password</h1>
        <p className="mt-1 text-sm text-zinc-400">
          For <span className="font-semibold text-zinc-200">{displayName}</span>{' '}
          (username <span className="font-mono text-zinc-300">{username}</span>)
        </p>
        <ResetForm token={token} />
      </div>
    </main>
  );
}
