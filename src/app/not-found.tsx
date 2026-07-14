import Link from 'next/link';
import Brand from '@/components/Brand';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-950 px-4 py-10 text-zinc-100">
      <div className="w-full max-w-sm">
        <Brand size="lg" />
        <section className="card mt-7 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-brand-bright">
            404 · Offside
          </p>
          <h1 className="mt-2 font-display text-xl font-bold text-zinc-50">
            This page isn&apos;t on the pitch
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            The link may be old, or the page may have moved.
          </p>
          <Link
            href="/"
            className="mt-5 flex h-11 w-full items-center justify-center rounded-lg bg-emerald-400 px-4 text-sm font-bold text-zinc-950 transition-colors hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            Return to app
          </Link>
        </section>
      </div>
    </main>
  );
}
