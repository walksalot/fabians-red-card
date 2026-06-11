import { AuthPageClient } from '@/components/AuthPageClient';
import { Brand } from '@/components/Brand';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = Array.isArray(params.next) ? params.next[0] : params.next;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-5 py-10">
      <header className="space-y-2">
        <Brand />
        <h1 className="text-xl font-bold text-zinc-100">Welcome back</h1>
        <p className="text-sm text-zinc-400">
          Sign in to make your picks before kickoff.
        </p>
      </header>
      <AuthPageClient mode="login" next={next} />
    </main>
  );
}
