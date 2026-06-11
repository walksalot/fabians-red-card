'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { EntryOption } from './types';

/** Switch between a user's entries (?entry=<id>) on Today / History / Profile. */
export default function EntrySwitcher({
  entries,
  currentId,
}: {
  entries: EntryOption[];
  currentId: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  if (entries.length < 2) return null;

  return (
    <label className="flex items-center gap-2 text-sm text-zinc-400">
      Entry
      <select
        data-testid="entry-switcher"
        value={currentId}
        onChange={(e) => router.push(`${pathname}?entry=${e.target.value}`)}
        className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
      >
        {entries.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
      </select>
    </label>
  );
}
