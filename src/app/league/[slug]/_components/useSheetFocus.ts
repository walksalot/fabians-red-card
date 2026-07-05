'use client';

import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Completes the dialog contract the bottom sheets half-implement: on open,
 * move focus INTO the sheet (the container carries tabIndex={-1}); while
 * open, cycle Tab between the sheet's first/last focusable controls so
 * keyboard focus can never walk — or activate — the page hidden behind the
 * backdrop. Escape-to-close + focus-return stay with each sheet's own
 * handler.
 */
export function useSheetFocus(
  open: boolean,
  sheetRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusables = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (active === null || !sheet.contains(active)) {
        // Focus escaped (or never entered) — pull it back in.
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || active === sheet)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, sheetRef]);
}

export default useSheetFocus;
