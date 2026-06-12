/**
 * Build a Today href for `day`, preserving the rest of the current query
 * (e.g. ?entry= for multi-entry users) — mirrors how EntrySwitcher keeps a
 * browsed ?day= across entry switches. The current day gets the canonical
 * param-free URL.
 */
export function buildDayHref(
  slug: string,
  day: string,
  currentDay: string,
  search: URLSearchParams,
): string {
  const sp = new URLSearchParams(search);
  if (day === currentDay) sp.delete('day');
  else sp.set('day', day);
  const qs = sp.toString();
  return `/league/${slug}/today${qs ? `?${qs}` : ''}`;
}
