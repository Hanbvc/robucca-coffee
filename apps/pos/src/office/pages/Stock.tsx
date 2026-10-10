/* Stok bahan baku per cabang: terima barang, stok opname, barang rusak, transfer antarcabang, batas menipis.
   Stok berkurang otomatis dari resep (BoM) saat menu terjual; setiap perubahan tercatat sebagai pergerakan stok. */
import { dateTime, num } from '@robucca/core';
import { useState } from 'react';
import { Icon } from '../../lib/icons';
import { ss } from '../../lib/store';
import { can } from '../../state';
import { Modal, openLayer, toast } from '../../ui/overlay';
import { activeBranches, branchName, defaultBranch, errText, ms, oc, oget, qs, tzOf } from '../lib';
import { Body, PageHead, useLoad } from '../ui';
import { UNIT } from './Menu';

type Unit = keyof typeof UNIT;
interface Level { inventoryItemId: string; sku: string; name: string; unit: Unit; isActive: boolean; tracked: boolean; quantity: number; reorderLevel: number | null; status: 'OK' | 'LOW' | 'OUT' | 'UNTRACKED' }
interface Move {
  id: string; branchId: string; inventoryItemId: string; sku: string; name: string; unit: Unit; type: string; quantity: number; note: string | null;
  orderNumber: string | null; createdAt: string; createdBy: { id: string; name: string } | null;
}
interface LowRow { branchId: string; branchName: string; inventoryItemId: string; name: string; unit: Unit; quantity: number; reorderLevel: number | null; status: 'LOW' | 'OUT' }
const TYPES: Record<string, string> = {
  SALE: 'Terjual', SALE_REVERSAL: 'Batal jual', PURCHASE: 'Stok masuk', ADJUSTMENT: 'Opname', WASTE: 'Rusak/buang', TRANSFER_IN: 'Transfer masuk', TRANSFER_OUT: 'Transfer keluar',
};
const qty = (n: number | null | undefined, u: Unit) => `${(n ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 3 })} ${UNIT[u]}`;

export default function StockPage() {
  const branches = activeBranches();
  const [bid, setBidState] = useState(() => defaultBranch('pos:stock:branch'));
  const setBid = (v: string) => {
    setBidState(v);
    ss.set('pos:stock:branch', v);
  };
  const [show, setShow] = useState<'all' | 'low'>('all');
  const l = useLoad(
    () =>
      Promise.all([
        oget<{ rows: Level[]; low: number }>(`/office/stock${qs({ branchId: bid })}`),
        oget<{ rows: Move[] }>(`/office/stock/movements${qs({ branchId: bid, limit: 150 })}`),
        branches.length > 1 ? oget<LowRow[]>('/office/stock/low') : Promise.resolve([] as LowRow[]),
      ]),
    [bid],
  );
  const manage = can('stock.manage');
  return (
    <>
      <PageHead
        title="Stok"
        sub="Bahan baku per cabang · berkurang otomatis dari resep saat menu terjual"
        actions={
          can('inventory.manage') ? (
            <button className="btn sm" data-a="new-item" onClick={() => void itemDialog().then((ok) => ok && l.reload())}>
              <Icon name="plus" size="sm" /> Bahan baru
            </button>
          ) : undefined
        }
      />
      <div className="page">
        <div className="filters">
          <select className="select sm" data-branch aria-label="Cabang" value={bid} onChange={(e) => setBid(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <span className="sep" />
          <button className={`chip sm ${show === 'all' ? 'on' : ''}`} onClick={() => setShow('all')}>
            Semua bahan
          </button>
          <button className={`chip sm ${show === 'low' ? 'on' : ''}`} data-low onClick={() => setShow('low')}>
            Menipis / habis
          </button>
          <span className="hint">Resep tiap menu diatur di Kantor › Menu & harga.</span>
        </div>
        <Body l={l}>
          {([lv, mv, low]) => {
            const rows = show === 'low' ? lv.rows.filter((r) => r.status === 'LOW' || r.status === 'OUT') : lv.rows;
            const lowHere = lv.rows.filter((r) => r.status === 'LOW' || r.status === 'OUT');
            const other = low.filter((r) => r.branchId !== bid);
            return (
              <>
                <div className="kpis">
                  <div className="kpi">
                    <div className="k-label">Bahan dicatat</div>
                    <div className="k-value">{lv.rows.filter((r) => r.tracked).length}</div>
                    <div className="k-sub">dari {lv.rows.length} bahan aktif</div>
                  </div>
                  <div className="kpi">
                    <div className="k-label">Stok menipis / habis</div>
                    <div className={`k-value ${lowHere.length ? 'neg' : ''}`}>{lowHere.length}</div>
                    <div className="k-sub">
                      {lowHere.slice(0, 3).map((i) => i.name).join(', ')}
                      {lowHere.length > 3 ? '…' : ''}
                    </div>
                  </div>
                  {branches.length > 1 && (
                    <div className="kpi">
                      <div className="k-label">Menipis di cabang lain</div>
                      <div className={`k-value ${other.length ? 'neg' : ''}`}>{other.length}</div>
                      <div className="k-sub">
                        {[...new Set(other.map((r) => r.branchName))].slice(0, 3).join(', ')}
                      </div>
                    </div>
                  )}
                </div>
                <div className="table-card" id="st-table">
                  <div className="table-scroll">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Bahan</th>
                          <th className="r">Stok</th>
                          <th className="r">Batas menipis</th>
                          <th>Status</th>
                          {manage ? <th className="r">Aksi</th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.length ? (
                          rows.map((r) => (
                            <tr key={r.inventoryItemId} data-item={r.sku}>
                              <td>
                                <b>{r.name}</b>
                                <span className="sub">{r.sku}</span>
                              </td>
                              <td className="r" data-qty>
                                <b>{qty(r.quantity, r.unit)}</b>
                              </td>
                              <td className="r">
                                {manage ? (
                                  <button className="btn ghost xs" data-reorder onClick={() => void reorder(bid, r).then((ok) => ok && l.reload())}>
                                    {r.reorderLevel != null ? qty(r.reorderLevel, r.unit) : 'Atur'}
                                  </button>
                                ) : r.reorderLevel != null ? (
                                  qty(r.reorderLevel, r.unit)
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td>
                                {r.status === 'OUT' ? (
                                  <span className="tag red">Habis</span>
                                ) : r.status === 'LOW' ? (
                                  <span className="tag amber">Menipis</span>
                                ) : r.status === 'UNTRACKED' ? (
                                  <span className="tag">Belum dicatat</span>
                                ) : (
                                  <span className="tag green">Aman</span>
                                )}
                              </td>
                              {manage ? (
                                <td className="r nowrap">
                                  <button className="btn soft xs" data-op="in" onClick={() => void op('in', bid, r).then((ok) => ok && l.reload())}>
                                    <Icon name="plus" size="xs" /> Masuk
                                  </button>{' '}
                                  <button className="btn ghost xs" data-op="opname" onClick={() => void op('opname', bid, r).then((ok) => ok && l.reload())}>
                                    Opname
                                  </button>{' '}
                                  <button className="btn ghost xs" data-op="waste" onClick={() => void op('waste', bid, r).then((ok) => ok && l.reload())}>
                                    Rusak
                                  </button>
                                  {branches.length > 1 && (
                                    <>
                                      {' '}
                                      <button className="btn ghost xs" data-op="transfer" aria-label="Transfer" onClick={() => void op('transfer', bid, r).then((ok) => ok && l.reload())}>
                                        <Icon name="swap" size="xs" />
                                      </button>
                                    </>
                                  )}
                                </td>
                              ) : null}
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 28 }}>
                              {show === 'low' ? 'Tidak ada bahan yang menipis.' : 'Belum ada bahan baku.'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                {other.length ? (
                  <>
                    <div className="section-title">
                      <h3>Menipis di cabang lain</h3>
                    </div>
                    <div className="table-card">
                      <div className="table-scroll">
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Cabang</th>
                              <th>Bahan</th>
                              <th className="r">Stok</th>
                              <th className="r">Batas</th>
                            </tr>
                          </thead>
                          <tbody>
                            {other.map((r) => (
                              <tr key={`${r.branchId}:${r.inventoryItemId}`}>
                                <td>{r.branchName}</td>
                                <td>{r.name}</td>
                                <td className="r neg">{qty(r.quantity, r.unit)}</td>
                                <td className="r">{r.reorderLevel != null ? qty(r.reorderLevel, r.unit) : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                ) : null}
                <div className="section-title">
                  <h3>Riwayat pergerakan stok</h3>
                  <span className="hint">150 terakhir</span>
                </div>
                <div className="table-card" id="st-moves">
                  <div className="table-scroll">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Waktu</th>
                          <th>Bahan</th>
                          <th>Jenis</th>
                          <th className="r">Jumlah</th>
                          <th>Keterangan</th>
                          <th>Oleh</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mv.rows.length ? (
                          mv.rows.map((m) => (
                            <tr key={m.id}>
                              <td className="n">{dateTime(ms(m.createdAt), tzOf(m.branchId))}</td>
                              <td>{m.name}</td>
                              <td>{TYPES[m.type] ?? m.type}</td>
                              <td className={`r ${m.quantity < 0 ? 'neg' : 'pos'}`}>
                                {m.quantity > 0 ? '+' : ''}
                                {qty(m.quantity, m.unit)}
                              </td>
                              <td>{m.note ?? m.orderNumber ?? ''}</td>
                              <td>{m.createdBy?.name ?? (m.orderNumber ? 'Kasir' : '')}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                              Belum ada pergerakan.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            );
          }}
        </Body>
      </div>
    </>
  );
}

type Op = 'in' | 'opname' | 'waste' | 'transfer';
const TITLES: Record<Op, string> = { in: 'Stok masuk', opname: 'Stok opname', waste: 'Barang rusak / dibuang', transfer: 'Transfer ke cabang lain' };

function op(type: Op, bid: string, r: Level): Promise<boolean> {
  return openLayer<boolean>((close) => <OpBody type={type} bid={bid} r={r} close={close} />).then((v) => !!v);
}
function OpBody({ type, bid, r, close }: { type: Op; bid: string; r: Level; close: (v?: boolean) => void }) {
  const others = activeBranches().filter((b) => b.id !== bid);
  const [q, setQ] = useState(type === 'opname' ? String(r.quantity) : '');
  const [to, setTo] = useState(others[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const save = async () => {
    const v = Number(q.replace(',', '.'));
    if (!(Number.isFinite(v) && (type === 'opname' ? v >= 0 : v > 0))) return setErr('Jumlah tidak valid.');
    try {
      const n = note.trim() || undefined;
      if (type === 'in' || type === 'waste') await oc('POST', '/office/stock/in', { branchId: bid, type: type === 'in' ? 'PURCHASE' : 'WASTE', lines: [{ inventoryItemId: r.inventoryItemId, quantity: v }], note: n });
      if (type === 'opname') {
        if (v === r.quantity && r.tracked) return close(false);
        await oc('POST', '/office/stock/opname', { branchId: bid, lines: [{ inventoryItemId: r.inventoryItemId, counted: v }], note: n });
      }
      if (type === 'transfer') await oc('POST', '/office/stock/transfer', { fromBranchId: bid, toBranchId: to, lines: [{ inventoryItemId: r.inventoryItemId, quantity: v }], note: n });
      toast('Stok diperbarui');
      close(true);
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <Modal
      title={`${TITLES[type]} · ${r.name}`}
      sub={`${branchName(bid)} · stok sekarang ${qty(r.quantity, r.unit)}`}
      size="sm"
      foot={
        <>
          <button className="btn ghost" onClick={() => close(false)}>
            Batal
          </button>
          <button className="btn" data-ok onClick={() => void save()}>
            Simpan
          </button>
        </>
      }
    >
      <div className="col">
        <label className="field">
          <span>
            {type === 'opname' ? 'Jumlah hasil hitung fisik' : 'Jumlah'} ({UNIT[r.unit]})
          </span>
          <input className="input" id="op-q" type="number" min={0} step="any" inputMode="decimal" value={q} autoFocus onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
        </label>
        {type === 'transfer' && (
          <label className="field">
            <span>Ke cabang</span>
            <select className="select" id="op-to" value={to} onChange={(e) => setTo(e.target.value)}>
              {others.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>
            Keterangan <em>(opsional)</em>
          </span>
          <input className="input" id="op-n" value={note} placeholder={type === 'in' ? 'mis. kiriman dapur pusat' : type === 'waste' ? 'mis. kedaluwarsa' : ''} onChange={(e) => setNote(e.target.value)} />
        </label>
        {err ? <p className="err-text">{err}</p> : null}
      </div>
    </Modal>
  );
}

async function reorder(bid: string, r: Level): Promise<boolean> {
  const v = await openLayer<string>((close) => <ReorderBody r={r} close={close} />);
  if (v === undefined) return false;
  try {
    await oc('PUT', `/office/stock/${bid}/${r.inventoryItemId}/reorder-level`, { reorderLevel: v === '' ? null : Number(v) });
    toast('Batas menipis disimpan');
    return true;
  } catch (e) {
    toast(errText(e), 'err');
    return false;
  }
}
function ReorderBody({ r, close }: { r: Level; close: (v?: string) => void }) {
  const [v, setV] = useState(r.reorderLevel != null ? String(r.reorderLevel) : '');
  return (
    <Modal
      title={`Batas menipis · ${r.name}`}
      size="sm"
      foot={
        <>
          <button className="btn ghost" onClick={() => close()}>
            Batal
          </button>
          <button className="btn" data-ok onClick={() => close(v.trim())}>
            Simpan
          </button>
        </>
      }
    >
      <label className="field">
        <span>Tandai menipis bila stok ≤ ({UNIT[r.unit]}) — kosongkan untuk tanpa batas</span>
        <input className="input" type="number" min={0} step="any" value={v} autoFocus onChange={(e) => setV(e.target.value)} />
      </label>
    </Modal>
  );
}

function itemDialog(): Promise<boolean> {
  return openLayer<boolean>((close) => <ItemBody close={close} />).then((v) => !!v);
}
function ItemBody({ close }: { close: (v?: boolean) => void }) {
  const [d, setD] = useState({ sku: '', name: '', unit: 'GRAM' as Unit });
  const [err, setErr] = useState('');
  const save = async () => {
    if (!d.name.trim() || !d.sku.trim()) return setErr('Isi SKU dan nama bahan.');
    try {
      await oc('POST', '/office/inventory-items', { sku: d.sku.trim().toUpperCase(), name: d.name.trim(), unit: d.unit });
      toast('Bahan ditambahkan');
      close(true);
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <Modal
      title="Bahan baku baru"
      size="sm"
      foot={
        <>
          <button className="btn ghost" onClick={() => close(false)}>
            Batal
          </button>
          <button className="btn" data-ok onClick={() => void save()}>
            Simpan
          </button>
        </>
      }
    >
      <div className="col">
        <label className="field">
          <span>Nama bahan</span>
          <input className="input" value={d.name} autoFocus placeholder="mis. Susu UHT" onChange={(e) => setD({ ...d, name: e.target.value })} />
        </label>
        <label className="field">
          <span>SKU</span>
          <input className="input" value={d.sku} placeholder="SUSU-UHT" style={{ textTransform: 'uppercase' }} onChange={(e) => setD({ ...d, sku: e.target.value })} />
        </label>
        <label className="field">
          <span>Satuan</span>
          <select className="select" value={d.unit} onChange={(e) => setD({ ...d, unit: e.target.value as Unit })}>
            <option value="GRAM">Gram</option>
            <option value="MILLILITER">Mililiter</option>
            <option value="PIECE">Buah / pcs</option>
          </select>
        </label>
        {err ? <p className="err-text">{err}</p> : null}
      </div>
    </Modal>
  );
}
