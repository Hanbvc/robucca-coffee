'use client';
/* Bayar online tanpa payment gateway: QRIS statis cabang (diunggah di dasbor kantor) atau minta QRIS lewat WhatsApp.
   Pesanan tetap "menunggu pembayaran" sampai kasir mengonfirmasi di POS — tidak ada tombol "Saya sudah bayar".
   Pengganti openPayment() prototipe (QR simulasi + tandai lunas sendiri). */
import { rp } from '@robucca/core';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { api, errText } from '@/lib/api';
import { orderKey, tokenFor, useBranches, useOrder } from '@/lib/data';
import { asset } from '@/lib/env';
import { waLink, waNumber } from '@/lib/platform';
import { mutate } from '@/lib/remote';
import { closeSheet, openSheet } from '@/lib/sheets';
import { toast } from '@/lib/ui';

const DONE_TOAST: Record<string, [string, string]> = {
  paid: ['Pembayaran diterima kasir', 'check'],
  cashier: ['Silakan bayar di kasir', 'banknote'],
  void: ['Pesanan dibatalkan', 'info'],
};

function PaySheet({ id }: { id: string }) {
  const { data: o, reload } = useOrder(id);
  const { data: branches } = useBranches();
  const [busy, setBusy] = useState(false);
  const closed = useRef(false);
  const state = o?.payment.state;

  // Kasir mengonfirmasi, pelanggan pindah bayar di kasir, atau pesanan dibatalkan: lembar ditutup sekali.
  useEffect(() => {
    if (!state || state === 'pending' || closed.current) return;
    closed.current = true;
    const [msg, ic] = DONE_TOAST[state] ?? ['Status pembayaran berubah', 'info'];
    closeSheet(() => toast(msg, ic));
  }, [state]);

  if (!o) {
    return (
      <div className="sheet-body">
        <div className="sheet-head" style={{ textAlign: 'center' }}>
          <h2>Selesaikan pembayaran</h2>
          <p>Memuat pesanan…</p>
        </div>
      </div>
    );
  }

  const b = branches?.find((x) => x.code === o.branch.code) ?? null;
  const wa = waNumber(b);
  const name = o.payment.name;
  const isQris = o.payment.code === 'qris';
  const img = b?.qrisImageUrl ? asset(b.qrisImageUrl) : '';
  const msg = img
    ? `Halo Robucca ${o.branch.name}, saya sudah bayar pesanan *${o.number}* sebesar ${rp(o.total)} lewat ${name}. Bukti pembayaran saya lampirkan.`
    : `Halo Robucca ${o.branch.name}, saya mau bayar pesanan *${o.number}* sebesar ${rp(o.total)} lewat ${name}. Mohon kirim QRIS-nya, terima kasih.`;

  const toCashier = async (): Promise<void> => {
    setBusy(true);
    try {
      mutate(orderKey(o.id), await api.payAtCashier(o.id, tokenFor('orders', o.id)));
    } catch (e) {
      toast(errText(e), 'info');
      void reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="sheet-body">
        <div className="sheet-head" style={{ textAlign: 'center' }}>
          <h2>Selesaikan pembayaran</h2>
          <p>
            {img
              ? `Scan QRIS Robucca ${o.branch.name} lewat ${isQris ? 'e-wallet atau m-banking apa pun' : `aplikasi ${name}`}.`
              : `Minta QRIS Robucca ${o.branch.name} lewat WhatsApp${o.type === 'DELIVERY' ? '' : ', atau bayar di kasir saat mengambil'}.`}
          </p>
        </div>
        <div className="sheet-pad" style={{ textAlign: 'center' }}>
          {img && (
            <>
              <img className="qris-img" src={img} alt={`QRIS Robucca ${o.branch.name}`} />
              <a className="text-btn" style={{ display: 'inline-block', marginTop: 8, fontSize: 12.5 }} href={img} download target="_blank" rel="noopener">
                Simpan gambar QRIS
              </a>
            </>
          )}
          <div className="pay-amt">
            <small className="faint">Total pembayaran · {o.number}</small>
            <b>{rp(o.total)}</b>
          </div>
          {img ? (
            <ol className="steps-ol" style={{ textAlign: 'left' }}>
              <li>Buka aplikasi {isQris ? 'e-wallet / m-banking' : name} lalu pilih Scan / Bayar.</li>
              <li>Scan QRIS di atas (atau simpan gambarnya lalu upload dari galeri).</li>
              <li>Isi nominal {rp(o.total)} persis, lalu konfirmasi.</li>
              <li>Kirim bukti bayar lewat WhatsApp atau tunjukkan ke kasir.</li>
            </ol>
          ) : (
            <div className="note-bar" style={{ margin: '14px 0 0', textAlign: 'left' }}>
              <Icon n="info" cls="sm" />
              <span>
                {wa
                  ? 'QRIS cabang ini belum dipasang di aplikasi. Kasir akan mengirim QRIS lewat WhatsApp.'
                  : `QRIS cabang ini belum dipasang di aplikasi. Hubungi kasir Robucca ${o.branch.name} untuk membayar.`}
              </span>
            </div>
          )}
          <div className="pay-wait" role="status">
            <span className="spinner" />
            Menunggu konfirmasi kasir · status diperbarui otomatis
          </div>
        </div>
      </div>
      <div className="sheet-foot" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        {wa && (
          <a className="btn block" href={waLink(wa, msg)} target="_blank" rel="noopener">
            <Icon n="chat" cls="sm" /> {img ? 'Kirim bukti via WhatsApp' : 'Minta QRIS via WhatsApp'}
          </a>
        )}
        {o.type !== 'DELIVERY' && (
          <button className="btn block soft" style={{ height: 44 }} disabled={busy} onClick={() => void toCashier()}>
            Bayar di kasir saja
          </button>
        )}
      </div>
    </>
  );
}

export function openPay(id: string): void {
  openSheet(<PaySheet id={id} />);
}
