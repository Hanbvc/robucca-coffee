/* Pindah halaman: lembar yang terbuka ditutup dulu (seperti go()/replace() di prototipe). */
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { closeSheet } from './sheets';

let depth = 0;
/** Dipanggil Shell tiap pindah halaman di dalam aplikasi. */
export const noteNavigation = (): void => {
  depth += 1;
};

export interface Nav {
  go: (path: string) => void;
  replace: (path: string) => void;
  /** Kembali ke halaman sebelumnya di aplikasi, atau ke `fallback` bila dibuka langsung. */
  back: (fallback: string) => void;
}

export function useNav(): Nav {
  const router = useRouter();
  return useMemo<Nav>(
    () => ({
      go: (path) => closeSheet(() => router.push(path)),
      replace: (path) => closeSheet(() => router.replace(path)),
      back: (fallback) => closeSheet(() => (depth > 0 ? router.back() : router.push(fallback))),
    }),
    [router],
  );
}
