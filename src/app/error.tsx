'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import Brand from '@/components/Brand';

export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-950 px-4 py-10 text-zinc-100">
      <div className="w-full max-w-sm">
        <Brand size="lg" />
        <section className="card mt-7 p-5">
          <h1 className="font-display text-xl font-bold text-zinc-50">
            That page missed the target
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Your picks are still safe. Try loading the page again, or return to the app.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={unstable_retry}
              className="h-11 rounded-lg bg-emerald-400 px-4 text-sm font-bold text-zinc-950 transition-colors hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              Try again
            </button>
            <Link
              href="/"
              className="flex h-11 items-center justify-center rounded-lg bg-zinc-800 px-4 text-sm font-semibold text-zinc-200 ring-1 ring-inset ring-white/10 transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
            >
              Return to app
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
