import { AuthPageClient } from '@/components/AuthPageClient';
import AuthFooter from '@/components/AuthFooter';
import AuthGlow from '@/components/AuthGlow';
import { Brand } from '@/components/Brand';

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = Array.isArray(params.next) ? params.next[0] : params.next;

  return (
    <main className="relative isolate mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-10">
      <AuthGlow />
      {/* my-auto centers the form in the space above the pinned footer; the
          slight upward shift gives the logo lockup the splash-screen position
          (eyes land ~1/3 down, not dead center). */}
      <div className="my-auto -translate-y-4 space-y-8 py-6">
        <header className="space-y-3">
          {/* Same full-size logo moment as /login — lockstep via size="xl". */}
          <Brand size="xl" />
          <div className="space-y-1">
            <h1 className="text-xl font-bold text-zinc-100">
              Create your account
            </h1>
            <p className="text-sm text-zinc-400">
              One account for the whole tournament — 104 matches of glory.
            </p>
          </div>
        </header>
        <AuthPageClient mode="register" next={next} />
      </div>
      <AuthFooter />
    </main>
  );
}
