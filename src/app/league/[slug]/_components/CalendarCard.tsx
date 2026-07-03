'use client';

import { useState, useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

/** window.location.origin, hydration-safe: '' on the server, real origin on the client. */
function useOrigin(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => '',
  );
}

/**
 * "Never miss a lock" — surfaces the calendar feed that has existed at
 * /api/calendar since launch but had no link anywhere in the UI. Subscribing
 * once gives every kickoff a phone-native reminder ("lock your pick!") 60
 * minutes out, with zero server-side reminder machinery.
 *
 * `compact` renders the admin flavor: a copyable line for pasting into the
 * group chat instead of the full how-to card.
 */
export default function CalendarCard({ compact = false }: { compact?: boolean }) {
  const origin = useOrigin();
  const url = `${origin}/api/calendar`;
  // webcal:// opens straight into the subscribe flow on iOS/macOS — the
  // https URL stays the copyable fallback for everything else.
  const webcal = origin ? `webcal://${origin.replace(/^https?:\/\//, '')}/api/calendar` : '';
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (compact) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-zinc-400">
          Kickoff reminders — share this too: subscribing adds every match to
          their phone calendar with a &ldquo;lock your pick!&rdquo; alarm an
          hour before kickoff.
        </p>
        <div className="flex items-center gap-2">
          <code
            data-testid="calendar-url"
            className="min-w-0 flex-1 truncate rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-emerald-400 select-all"
          >
            {url}
          </code>
          <button
            type="button"
            data-testid="calendar-copy"
            onClick={copy}
            className="min-h-10 shrink-0 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-zinc-950 active:scale-95"
          >
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card animate-fade-slide-in p-4">
      <div className="flex items-center gap-2">
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 text-emerald-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="4" y="5.5" width="16" height="15" rx="2.5" />
          <path d="M4 10h16M8.5 3.5v3.5M15.5 3.5v3.5" />
        </svg>
        <p className="text-sm font-bold text-zinc-100">Never miss a lock</p>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">
        Subscribe once and every kickoff lands in your phone&apos;s calendar
        with a &ldquo;lock your pick!&rdquo; reminder an hour before. Your
        calendar does the nagging — the app never needs your number or email.
      </p>
      <div className="mt-3 flex items-center gap-2">
        {webcal ? (
          <a
            href={webcal}
            data-testid="calendar-subscribe"
            className="min-h-10 shrink-0 rounded-lg bg-emerald-500 px-3 py-2.5 text-xs font-semibold text-zinc-950 active:scale-95"
          >
            Subscribe
          </a>
        ) : null}
        <button
          type="button"
          data-testid="calendar-copy"
          onClick={copy}
          className="min-h-10 shrink-0 rounded-lg bg-zinc-800 px-3 py-2.5 text-xs font-semibold text-zinc-200 ring-1 ring-inset ring-white/10 active:scale-95"
        >
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
        <p className="min-w-0 flex-1 text-[10px] leading-tight text-zinc-500">
          iPhone: Subscribe just works. Google Calendar: Settings → Add
          calendar → From URL → paste.
        </p>
      </div>
    </div>
  );
}
