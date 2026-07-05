import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { getSessionUser } from '@/lib/session';
import { AuthPageClient } from '@/components/AuthPageClient';
import AuthFooter from '@/components/AuthFooter';
import AuthGlow from '@/components/AuthGlow';
import { Brand } from '@/components/Brand';
import { safePath } from '@/components/client-api';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = Array.isArray(params.next) ? params.next[0] : params.next;

  // Already signed in — the mirror of HomePage's signed-out redirect: a
  // sign-in form for a live session only invites a pointless re-login.
  const user = await getSessionUser(getDb());
  if (user) redirect(safePath(next));

  return (
    <main className="relative isolate mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-10">
      <AuthGlow />
      {/* my-auto centers the form in the space above the pinned footer; the
          slight upward shift gives the logo lockup the splash-screen position
          (eyes land ~1/3 down, not dead center). */}
      <div className="my-auto -translate-y-4 space-y-8 py-6">
        <header className="space-y-3">
          {/* The one screen whose only job is brand — full logo moment. */}
          <Brand size="xl" />
          <div className="space-y-1">
            <h1 className="text-xl font-bold text-zinc-100">Welcome back</h1>
            <p className="text-sm text-zinc-400">
              Sign in to make your picks before kickoff.
            </p>
          </div>
        </header>
        <AuthPageClient mode="login" next={next} />
      </div>
      <AuthFooter />
    </main>
  );
}
