/* Status aplikasi bersama (diisi app.js, dibaca oleh layar-layar). */
import { can as canRole, canBranch } from './core/perms.js';
import { bizDate } from './core/dates.js';

export const S = {
  be: null,      // Backend perangkat
  user: null,    // staf yang sedang login
  shift: null,   // shift kasir yang terbuka di perangkat ini
  route: '',
  query: {},
};

export const master = () => S.be.master;
export const branch = () => S.be.branch;
export const settings = () => S.be.master.settings;
export const can = (perm) => canRole(S.user, perm);
export const canSee = (branchId) => canBranch(S.user, branchId);
export const today = (b = branch()) => bizDate(Date.now(), (b && b.tz) || 'Asia/Jakarta', b && b.dayStart);
export const tzOf = (branchId) => ((branchId && S.be.master.branch[branchId]) || branch() || {}).tz || 'Asia/Jakarta';

export function nav(path) {
  const h = '#/' + String(path).replace(/^#?\/?/, '');
  if (location.hash === h) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = h;
}
