/* Persetujuan manajer (PIN) untuk void, refund, dan diskon di atas batas kasir. */
import { S, branch, master, can } from '../state.js';
import { $, esc, icon, avatar, modal } from '../lib/ui.js';
import { ROLES } from '../core/perms.js';
import { canBranch } from '../core/perms.js';

/** Kembalikan staf penyetuju, atau null bila dibatalkan */
export function requireApproval({ title = 'Persetujuan manajer', text = '', branchId } = {}) {
  if (can('approve')) return Promise.resolve(S.user);
  const bid = branchId || (branch() && branch().id);
  const approvers = master().staff.filter((s) => s.active !== false && ['owner', 'manager'].includes(s.role) && (!bid || canBranch(s, bid)));
  let who = approvers.length === 1 ? approvers[0] : null; let pin = ''; let msg = '';
  const m = modal({ title, sub: text, size: 'sm', body: '<div id="ap"></div>' });
  const box = $('#ap', m.el);
  const paint = () => {
    if (!who) {
      box.innerHTML = approvers.length
        ? `<div class="list">${approvers.map((s) => `<button class="li" data-s="${s.id}">${avatar(s, 'sm')}<div><b>${esc(s.name)}</b><small>${ROLES[s.role].name}</small></div>${icon('chevron-right', 'sm')}</button>`).join('')}</div>`
        : `<div class="note red">${icon('alert', 'sm')}<span>Tidak ada manajer/pemilik untuk cabang ini.</span></div>`;
      return;
    }
    box.innerHTML = `<div class="pin-box" style="gap:14px">
      <div class="pin-who">${avatar(who)}<div><b>${esc(who.name)}</b><small>${ROLES[who.role].name}</small></div>${approvers.length > 1 ? `<button class="btn ghost xs" data-chg style="margin-left:8px">Ganti</button>` : ''}</div>
      <div class="pin-dots">${Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join('')}</div>
      <div class="pin-msg">${esc(msg)}</div>
      <div class="keypad">${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => `<button data-k="${d}">${d}</button>`).join('')}<button class="fn" data-k="del" aria-label="Hapus">${icon('chevron-left')}</button><button data-k="0">0</button><button class="fn" data-k="ok" aria-label="Setujui">${icon('check')}</button></div>
    </div>`;
  };
  const submit = async () => {
    if (pin.length < 4) return;
    const ok = await S.be.approve(who.id, pin);
    if (ok) { m.close(ok); return; }
    pin = ''; msg = S.be.lockedFor(who.id) ? `Terkunci ${S.be.lockedFor(who.id)} detik` : 'PIN salah'; paint();
  };
  const key = (k) => {
    if (k === 'del') pin = pin.slice(0, -1);
    else if (k === 'ok') { submit(); return; }
    else if (pin.length < 6) pin += k;
    msg = ''; paint();
    if (pin.length === 6) submit();
  };
  m.el.addEventListener('click', (e) => {
    const s = e.target.closest('[data-s]'); if (s) { who = master().person[s.dataset.s]; pin = ''; paint(); return; }
    if (e.target.closest('[data-chg]')) { who = null; paint(); return; }
    const k = e.target.closest('[data-k]'); if (k) key(k.dataset.k);
  });
  const onKey = (e) => { if (!who) return; if (/^\d$/.test(e.key)) key(e.key); else if (e.key === 'Backspace') key('del'); else if (e.key === 'Enter') key('ok'); };
  document.addEventListener('keydown', onKey);
  m.result.then(() => document.removeEventListener('keydown', onKey));
  paint();
  return m.result.then((v) => v || null);
}
