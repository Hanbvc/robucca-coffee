import { type BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import { filter, map, merge, type Observable, interval, ReplaySubject, Subject, takeUntil } from 'rxjs';

export interface BranchEvent {
  /** null = semua cabang (mis. perubahan menu pusat) */
  branchId: string | null;
  type: 'feed' | 'master' | 'order';
  data: Record<string, unknown>;
}

export interface SseMessage {
  type: string;
  data: string;
}

/** Siaran real-time ke perangkat cabang (Server-Sent Events): layar dapur, antrean, kasir lain, status PWA. */
@Injectable()
export class EventsService implements BeforeApplicationShutdown {
  private readonly bus = new Subject<BranchEvent>();
  /** ReplaySubject: stream yang baru dibuka saat server sedang berhenti juga langsung diakhiri. */
  private readonly closing = new ReplaySubject<void>(1);

  /** API dimatikan (SIGTERM): akhiri semua stream SSE. Tanpa ini server menunggu koneksi SSE yang tak pernah selesai
   *  sehingga tidak bisa berhenti; klien (EventSource) tersambung ulang sendiri ke server yang baru. */
  beforeApplicationShutdown(): void {
    this.closing.next();
    this.closing.complete();
  }

  emit(e: BranchEvent): void {
    this.bus.next(e);
  }

  stream(branchId: string | null, extra?: (e: BranchEvent) => boolean): Observable<SseMessage> {
    const events = this.bus.pipe(
      filter((e) => (e.branchId === null || branchId === null || e.branchId === branchId) && (!extra || extra(e))),
      map((e) => ({ type: e.type, data: JSON.stringify(e.data) })),
    );
    // ping agar proxy tidak memutus koneksi diam
    const ping = interval(25_000).pipe(map(() => ({ type: 'ping', data: '{}' })));
    return merge(events, ping).pipe(takeUntil(this.closing));
  }
}
