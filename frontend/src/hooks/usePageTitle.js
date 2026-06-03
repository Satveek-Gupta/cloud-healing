'use client';
import { useEffect } from 'react';

/**
 * usePageTitle(pageName)
 * Sets document.title to "PageName | SelfHeal" on mount.
 * Works in any "use client" component — no server component needed.
 */
export function usePageTitle(pageName) {
  useEffect(() => {
    document.title = `${pageName} | SelfHeal`;
  }, [pageName]);
}
