import { Injectable } from '@nestjs/common';
import { filter, map, merge, type Observable, interval, Subject } from 'rxjs';

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
export class EventsService {
  private readonly bus = new Subject<BranchEvent>();

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
    return merge(events, ping);
  }
}
