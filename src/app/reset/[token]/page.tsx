import Link from 'next/link';
import { getDb } from '@/db';
import { verifyResetToken } from '@/lib/reset';
import { AppError } from '@/lib/errors';
import AuthFooter from '@/components/AuthFooter';
import AuthGlow from '@/components/AuthGlow';
import { Brand, RedCardMark } from '@/components/Brand';
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
    // Same auth chrome as the other auth screens (glow + brand lockup +
    // footer) plus an exit — a dead-end card with no action strands whoever
    // tapped a stale link.
    return (
      <main className="relative isolate mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-10">
        <AuthGlow />
        <div className="my-auto flex flex-col items-center gap-6 py-6 text-center">
          <Brand />
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-zinc-100">{message}</h1>
            <p className="text-sm text-zinc-400">
              Ask your league admin for a fresh link.
            </p>
          </div>
          <Link
            href="/login"
            className="flex h-12 items-center justify-center rounded-xl bg-zinc-900 px-6 font-semibold text-zinc-100 ring-1 ring-zinc-800"
          >
            Back to sign in
          </Link>
        </div>
        <AuthFooter />
      </main>
    );
  }

  // Same auth chrome as the invalid branch above (and /login, /join): glow +
  // brand lockup over the card, footer pinned below.
  return (
    <main className="relative isolate mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-10 text-zinc-100">
      <AuthGlow />
      <div className="my-auto flex flex-col items-center gap-6 py-6">
        <Brand />
        <div className="w-full rounded-2xl bg-zinc-900 p-6 ring-1 ring-zinc-800">
          <RedCardMark className="h-8 w-8" />
          <h1 className="mt-3 text-xl font-bold">Set a new password</h1>
          <p className="mt-1 text-sm text-zinc-400">
            For <span className="font-semibold text-zinc-200">{displayName}</span>{' '}
            (username <span className="font-mono text-zinc-300">{username}</span>)
          </p>
          <ResetForm token={token} />
        </div>
      </div>
      <AuthFooter />
    </main>
  );
}
