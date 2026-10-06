/* Data master (menu, cabang, staf, dll.) dengan indeks siap pakai untuk tampilan. */
import { defaultSettings } from '../core/seed.js';
import { branchPrice, isAvailable } from '../core/calc.js';

const bySort = (a, b) => (a.sort ?? 999) - (b.sort ?? 999) || String(a.name).localeCompare(String(b.name), 'id');
const map = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));

export class Master {
  constructor(raw) {
    this.raw = raw;
    this.settings = { ...defaultSettings(), ...(raw.settings && raw.settings[0]) };
    this.branches = [...raw.branches].sort((a, b) => String(a.name).localeCompare(String(b.name), 'id'));
    this.branch = map(raw.branches);
    this.categories = [...raw.categories].sort(bySort);
    this.cat = map(raw.categories);
    const catSort = Object.fromEntries(this.categories.map((c, i) => [c.id, i]));
    this.items = [...raw.items].sort((a, b) => (catSort[a.catId] ?? 999) - (catSort[b.catId] ?? 999) || bySort(a, b));
    this.item = map(raw.items);
    this.ov = map(raw.itemBranch || []);
    this.channels = [...raw.channels].sort(bySort);
    this.channel = map(raw.channels);
    this.payMethods = [...raw.payMethods].sort(bySort);
    this.pay = map(raw.payMethods);
    this.discounts = [...raw.discounts].sort((a, b) => String(a.name).localeCompare(String(b.name), 'id'));
    this.discount = map(raw.discounts);
    this.staff = [...raw.staff].sort((a, b) => String(a.name).localeCompare(String(b.name), 'id'));
    this.person = map(raw.staff);
  }
  override(branchId, itemId) { return this.ov[`${branchId}:${itemId}`] || null; }
  price(branchId, item) { return branchPrice(item, this.override(branchId, item.id)); }
  available(branchId, item) { const c = this.cat[item.catId]; return (!c || c.active !== false) && isAvailable(item, this.override(branchId, item.id)); }
  stationOf(item) { return item.station || (this.cat[item.catId] && this.cat[item.catId].station) || 'kitchen'; }
  activeBranches() { return this.branches.filter((b) => b.active !== false); }
  activeChannels() { return this.channels.filter((c) => c.active !== false); }
  activePays() { return this.payMethods.filter((p) => p.active !== false); }
  /** Promo yang berlaku untuk cabang pada tanggal bisnis tertentu */
  discountsFor(branchId, date) {
    return this.discounts.filter((d) => d.active !== false
      && (!d.branchIds || d.branchIds.includes('*') || d.branchIds.includes(branchId))
      && (!d.from || d.from <= date) && (!d.to || d.to >= date));
  }
  names() {
    return {
      branchNames: Object.fromEntries(this.branches.map((b) => [b.id, b.name])),
      payNames: Object.fromEntries(this.payMethods.map((p) => [p.id, p.name]).concat(this.channels.filter((c) => c.type === 'platform').map((c) => [c.id, c.name]))),
      channelNames: Object.fromEntries(this.channels.map((c) => [c.id, c.name])),
      catNames: Object.fromEntries(this.categories.map((c) => [c.id, c.name])),
    };
  }
}
