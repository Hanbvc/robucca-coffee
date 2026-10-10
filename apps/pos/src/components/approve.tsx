/* Persetujuan manajer (PIN) untuk void, refund, dan diskon di atas batas kasir. Port dari pos/js/components/approve.js. */
import { useState, type ReactNode } from 'react';
import type { Approval } from '../data/backend';
import { APPROVE_PERM, roleName, type ApproveKind } from '../data/master';
import type { MStaff } from '../data/types';
import { Icon } from '../lib/icons';
import { S, can, master } from '../state';
import { Avatar, PinPad, useKeys } from '../ui/common';
import { Modal, openLayer, type Close } from '../ui/overlay';

function ApproveBody({ kind, title, text, close }: { kind: ApproveKind; title: string; text: ReactNode; close: Close<Approval> }) {
  const approvers = master().approvers(kind);
  const [who, setWho] = useState<MStaff | null>(approvers.length === 1 ? approvers[0]! : null);
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (p: string) => {
    if (!who || p.length < 4 || busy) return;
    setBusy(true);
    const ok = await S.be.approve(kind, who.id, p);
    setBusy(false);
    if (ok) {
      close(ok);
      return;
    }
    setPin('');
    const lock = S.be.lockedFor(who.id);
    setMsg(lock ? `Terkunci ${lock} detik` : 'PIN salah');
  };
  const key = (k: string) => {
    if (!who) return;
    if (k === 'ok') return void submit(pin);
    const next = k === 'del' ? pin.slice(0, -1) : pin.length < 6 && /^\d$/.test(k) ? pin + k : pin;
    setPin(next);
    setMsg('');
    if (next.length === 6) void submit(next);
  };
  useKeys(
    (e) => {
      if (!who) return;
      if (/^\d$/.test(e.key)) key(e.key);
      else if (e.key === 'Backspace') key('del');
      else if (e.key === 'Enter') key('ok');
    },
    [who, pin, busy],
  );

  return (
    <Modal title={title} sub={text} size="sm">
      <div id="ap">
        {!who ? (
          approvers.length ? (
            <div className="list">
              {approvers.map((s) => (
                <button
                  key={s.id}
                  className="li"
                  data-s={s.id}
                  onClick={() => {
                    setWho(s);
                    setPin('');
                  }}
                >
                  <Avatar staff={s} size="sm" />
                  <div>
                    <b>{s.name}</b>
                    <small>{roleName(s.role)}</small>
                  </div>
                  <Icon name="chevron-right" size="sm" />
                </button>
              ))}
            </div>
          ) : (
            <div className="note red">
              <Icon name="alert" size="sm" />
              <span>Tidak ada manajer/pemilik untuk cabang ini.</span>
            </div>
          )
        ) : (
          <PinPad
            gap={14}
            pin={pin}
            msg={busy ? 'Memeriksa…' : msg}
            onKey={key}
            who={
              <div className="pin-who">
                <Avatar staff={who} />
                <div>
                  <b>{who.name}</b>
                  <small>{roleName(who.role)}</small>
                </div>
                {approvers.length > 1 && (
                  <button className="btn ghost xs" style={{ marginLeft: 8 }} onClick={() => setWho(null)}>
                    Ganti
                  </button>
                )}
              </div>
            }
          />
        )}
      </div>
    </Modal>
  );
}

/**
 * Staf penyetuju (dengan token server bila online), atau null bila dibatalkan.
 * Staf yang login dan berhak menyetujui tidak perlu memasukkan PIN lagi.
 */
export function requireApproval(kind: ApproveKind, { title = 'Persetujuan manajer', text = '' }: { title?: string; text?: ReactNode } = {}): Promise<Approval | null> {
  if (S.user && can(APPROVE_PERM[kind])) return Promise.resolve({ staff: S.user, at: Date.now() });
  return openLayer<Approval>((close) => <ApproveBody kind={kind} title={title} text={text} close={close} />).then((v) => v ?? null);
}
