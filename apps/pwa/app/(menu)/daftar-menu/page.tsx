import { Suspense } from 'react';
import { DaftarMenu } from '@/components/DaftarMenu';

export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="wrap">
          <div className="loading">
            <i />
            Memuat menu…
          </div>
        </main>
      }
    >
      <DaftarMenu />
    </Suspense>
  );
}
