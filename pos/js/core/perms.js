/* =========================================================
   Peran & hak akses.
   owner   : pemilik / kantor pusat — semua cabang, semua pengaturan
   manager : kepala cabang — kantor untuk cabangnya, menyetujui void/diskon
   cashier : kasir — penjualan, shift, tandai menu habis
   kitchen : dapur/bar — layar pesanan dapur
   ========================================================= */

export const ROLES = {
  owner: { name: 'Pemilik', short: 'Owner' },
  manager: { name: 'Manajer', short: 'Manajer' },
  cashier: { name: 'Kasir', short: 'Kasir' },
  kitchen: { name: 'Dapur / Bar', short: 'Dapur' },
};

const P = {
  owner: ['sell', 'kds', 'office', 'office.all', 'approve', 'soldout', 'report', 'menu.edit', 'menu.branch', 'price.branch', 'stock', 'promo', 'branch', 'staff', 'staff.owner', 'device', 'settings', 'audit'],
  manager: ['sell', 'kds', 'office', 'approve', 'soldout', 'report', 'menu.branch', 'stock', 'staff', 'device', 'audit'],
  cashier: ['sell', 'kds', 'soldout'],
  kitchen: ['kds', 'soldout'],
};

export const can = (staff, perm) => !!staff && staff.active !== false && (P[staff.role] || []).includes(perm);

/** Cabang yang boleh diakses staf; ['*'] = semua cabang */
export const staffBranches = (staff) => (staff && staff.role === 'owner' ? ['*'] : (staff && staff.branchIds) || []);
export const canBranch = (staff, branchId) => { const b = staffBranches(staff); return b.includes('*') || b.includes(branchId); };

/** Staf yang boleh login di perangkat cabang ini (perangkat kantor pusat: hanya owner & manager) */
export const staffForBranch = (staff, branchId) => staff.filter((s) => s.active !== false && (branchId ? canBranch(s, branchId) : ['owner', 'manager'].includes(s.role)));

/** Peran yang boleh dibuat oleh `actor` */
export const assignableRoles = (actor) => (can(actor, 'staff.owner') ? Object.keys(ROLES) : ['cashier', 'kitchen']);
