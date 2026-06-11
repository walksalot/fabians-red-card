'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { key: 'today', label: 'Today' },
  { key: 'table', label: 'Table' },
  { key: 'rules', label: 'Rules' },
  { key: 'history', label: 'History' },
  { key: 'profile', label: 'Profile' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function TabIcon({ tab, active }: { tab: TabKey; active: boolean }) {
  // Active glyphs render heavier (2.5 vs 1.8 stroke) so the selected tab
  // reads at a glance, the way native tab bars switch to filled variants.
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: active ? 2.5 : 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (tab) {
    case 'today': // football
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8.2 15.6 10.8 14.2 15H9.8L8.4 10.8Z" />
        </svg>
      );
    case 'table': // podium bars
      return (
        <svg {...common}>
          <path d="M4 20v-6h4v6" />
          <path d="M10 20V8h4v12" />
          <path d="M16 20v-9h4v9" />
          <path d="M3 20h18" />
        </svg>
      );
    case 'rules': // document
      return (
        <svg {...common}>
          <path d="M7 3h7l4 4v14H7z" />
          <path d="M14 3v4h4" />
          <path d="M10 12h5M10 16h5" />
        </svg>
      );
    case 'history': // clock
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'profile': // person
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 20c1.5-3.5 4.3-5 7.5-5s6 1.5 7.5 5" />
        </svg>
      );
  }
}

/**
 * Fixed bottom navigation for league pages. Pair with `pb-24` on the page content.
 * `slug` is optional — when omitted it is derived from the current
 * `/league/<slug>/...` pathname.
 */
export function TabBar({ slug: slugProp }: { slug?: string } = {}) {
  const pathname = usePathname();
  const slug = slugProp ?? /^\/league\/([^/]+)/.exec(pathname)?.[1];
  if (!slug) return null;
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-white/5 bg-zinc-950/80 backdrop-blur-xl"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex w-full max-w-md">
        {TABS.map((tab) => {
          const href = `/league/${slug}/${tab.key}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={tab.key}
              href={href}
              data-testid={`tab-${tab.key}`}
              aria-current={active ? 'page' : undefined}
              className={`group relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400/60 ${
                active ? 'text-emerald-400' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {/* active indicator: 2px rounded bar along the top edge */}
              <span
                aria-hidden="true"
                className={`absolute inset-x-4 top-0 h-0.5 rounded-full bg-emerald-400 transition-opacity duration-200 ${
                  active ? 'opacity-100' : 'opacity-0'
                }`}
              />
              <span className="transition-transform duration-150 group-active:scale-90">
                <TabIcon tab={tab.key} active={active} />
              </span>
              <span className={active ? 'font-semibold' : ''}>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default TabBar;
