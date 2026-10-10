/* Menu & harga: satu daftar menu pusat untuk semua cabang, dengan ketersediaan & harga khusus per cabang.
   Manajer mengatur ketersediaan di cabangnya; pemilik (menu.manage / price.manage) mengatur menu, harga, grup opsi, & resep. */
import { rp } from '@robucca/core';
import { useMemo, useState } from 'react';
import { Icon } from '../../lib/icons';
import { ss } from '../../lib/store';
import { S, can } from '../../state';
import { FadeImg, MoneyInput } from '../../ui/common';
import { busy, confirmBox, Drawer, Modal, openLayer, promptBox, toast, useLayerClose } from '../../ui/overlay';
import { activeBranches, defaultBranch, errText, oc, oget } from '../lib';
import { Body, PageHead, Switch, useLoad } from '../ui';

type Station = 'BAR' | 'KITCHEN' | 'NONE';
type Group = 'DRINKS' | 'SNACK' | 'FOOD' | 'PASTRY';
interface Cat { id: string; name: string; group: Group; station: Station; quickNotes: string[]; isSignature: boolean; sortOrder: number; isActive: boolean }
interface BranchSetting { branchId: string; priceOverride: number | null; isAvailable: boolean }
interface Link { groupId: string; sortOrder: number; showWhenOptionIds: string[] }
interface Prod {
  id: string; slug: string; categoryId: string; name: string; description: string | null; imageUrl: string | null; basePrice: number; station: Station | null;
  isSignature: boolean; sortOrder: number; isActive: boolean; recipeLines: number; branchSettings: BranchSetting[]; modifierGroups: Link[];
}
interface Opt { id: string; name: string; priceDelta: number; isDefault: boolean; imageUrl: string | null; sortOrder: number; isActive: boolean; recipeLines: number }
interface MGroup { id: string; name: string; selection: 'SINGLE' | 'MULTIPLE'; isRequired: boolean; maxSelect: number | null; sortOrder: number; isActive: boolean; productCount: number; options: Opt[] }
interface MenuData { branches: { id: string; code: string; name: string; isActive: boolean }[]; categories: Cat[]; products: Prod[]; modifierGroups: MGroup[] }
interface InvItem { id: string; sku: string; name: string; unit: 'GRAM' | 'MILLILITER' | 'PIECE'; isActive: boolean }

const GROUPS: [Group, string][] = [['DRINKS', 'Minuman'], ['SNACK', 'Camilan'], ['FOOD', 'Makanan'], ['PASTRY', 'Pastry']];
const STATIONS: [Station | '', string][] = [['', 'Ikuti kategori'], ['BAR', 'Bar'], ['KITCHEN', 'Dapur'], ['NONE', 'Tanpa dapur (langsung saji)']];
const CAT_STATIONS: [Station, string][] = [['BAR', 'Bar'], ['KITCHEN', 'Dapur'], ['NONE', 'Tanpa dapur']];
export const UNIT: Record<InvItem['unit'], string> = { GRAM: 'gram', MILLILITER: 'ml', PIECE: 'pcs' };

export default function MenuPage() {
  const owner = can('menu.manage');
  const branches = activeBranches();
  const [bid, setBidState] = useState(() => defaultBranch('pos:menu:branch'));
  const setBid = (v: string) => {
    setBidState(v);
    ss.set('pos:menu:branch', v);
  };
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const l = useLoad(() => oget<MenuData>('/office/menu'), []);
  return (
    <>
      <PageHead
        title="Menu & harga"
        sub={owner ? 'Menu berlaku di semua cabang · atur ketersediaan & harga khusus per cabang' : 'Atur ketersediaan menu di cabang Anda'}
        actions={
          <>
            <button className="btn ghost sm" data-a="public" onClick={() => customerMenu(branches.find((b) => b.id === bid)?.code)}>
              <Icon name="eye" size="sm" /> Menu pelanggan
            </button>
            {owner && l.data && (
              <>
                <button className="btn ghost sm" data-a="groups" onClick={() => void groupsDialog(l.data!).then(l.reload)}>
                  <Icon name="list" size="sm" /> Grup opsi
                </button>
                <button className="btn ghost sm" data-a="new-cat" onClick={() => void catDialog(null, l.data!.categories.length).then((ok) => ok && l.reload())}>
                  <Icon name="plus" size="sm" /> Kategori
                </button>
                <button className="btn sm" data-a="new-item" onClick={() => void productDrawer(null, l.data!, cat !== 'all' ? cat : undefined).then((ok) => ok && l.reload())}>
                  <Icon name="plus" size="sm" /> Menu baru
                </button>
              </>
            )}
          </>
        }
      />
      <div className="page">
        <Body l={l}>
          {(m) => {
            let items = m.products;
            if (cat !== 'all') items = items.filter((i) => i.categoryId === cat);
            const s = q.trim().toLowerCase();
            if (s) items = items.filter((i) => i.name.toLowerCase().includes(s));
            const catOf = (id: string) => m.categories.find((c) => c.id === id);
            return (
              <>
                <div className="filters">
                  <select className="select sm" data-branch aria-label="Cabang" value={bid} onChange={(e) => setBid(e.target.value)}>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <span className="sep" />
                  <div className="row wrap" style={{ gap: 6 }}>
                    <button className={`chip sm ${cat === 'all' ? 'on' : ''}`} data-cat="all" onClick={() => setCat('all')}>
                      Semua <span className="n">{m.products.length}</span>
                    </button>
                    {m.categories.map((c) => (
                      <button key={c.id} className={`chip sm ${cat === c.id ? 'on' : ''}`} data-cat={c.id} onClick={() => setCat(c.id)}>
                        {c.name} <span className="n">{m.products.filter((i) => i.categoryId === c.id).length}</span>
                        {c.isActive ? '' : ' · nonaktif'}
                      </button>
                    ))}
                    {owner && cat !== 'all' && (
                      <button className="btn ghost xs" data-a="edit-cat" onClick={() => void catDialog(catOf(cat) ?? null, 0).then((ok) => ok && l.reload())}>
                        <Icon name="edit" size="xs" /> Ubah kategori
                      </button>
                    )}
                  </div>
                  <div className="input-wrap right" style={{ width: 220 }}>
                    <Icon name="search" size="sm" />
                    <input className="input sm" data-q type="search" placeholder="Cari menu" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
                  </div>
                </div>
                <div className="table-card" id="m-table">
                  <div className="table-scroll">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Menu</th>
                          <th>Kategori</th>
                          <th className="r">Harga pusat</th>
                          <th className="r">Harga di cabang</th>
                          <th>Stasiun</th>
                          <th>Resep</th>
                          <th>Tersedia di cabang</th>
                          {owner || can('price.manage') ? <th /> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {items.length ? (
                          items.map((it) => {
                            const ov = it.branchSettings.find((x) => x.branchId === bid);
                            const avail = ov ? ov.isAvailable : true;
                            const st = it.station ?? catOf(it.categoryId)?.station;
                            return (
                              <tr key={it.id} data-row={it.slug}>
                                <td>
                                  <div className="cell-row">
                                    <span className="thumb">{it.imageUrl ? <FadeImg src={it.imageUrl} /> : null}</span>
                                    <div>
                                      <b>{it.name}</b>
                                      {it.isSignature && <span className="tag amber"> Signature</span>}
                                      {!it.isActive && <span className="tag red"> Nonaktif</span>}
                                      <span className="sub">{it.modifierGroups.length ? `${it.modifierGroups.length} grup opsi` : 'tanpa opsi'}</span>
                                    </div>
                                  </div>
                                </td>
                                <td>{catOf(it.categoryId)?.name ?? '-'}</td>
                                <td className="r">{rp(it.basePrice)}</td>
                                <td className="r" data-branch-price>
                                  {ov?.priceOverride != null ? (
                                    <>
                                      <b>{rp(ov.priceOverride)}</b>
                                      <span className="sub">harga khusus</span>
                                    </>
                                  ) : (
                                    <span className="muted">sama</span>
                                  )}
                                </td>
                                <td>{st === 'BAR' ? 'Bar' : st === 'NONE' ? 'Langsung' : 'Dapur'}</td>
                                <td>{it.recipeLines ? <span className="tag blue">{it.recipeLines} bahan</span> : <span className="muted">—</span>}</td>
                                <td>
                                  <Switch
                                    on={avail}
                                    label={`Tersedia di cabang: ${it.name}`}
                                    disabled={!it.isActive || !(can('menu.availability') || owner)}
                                    data-avail={it.id}
                                    onChange={(v) => void setAvail(it, bid, v).then((ok) => ok && l.reload())}
                                  />
                                </td>
                                {owner || can('price.manage') ? (
                                  <td className="r">
                                    <button className="btn ghost xs" data-edit={it.id} onClick={() => void productDrawer(it, m).then((ok) => ok && l.reload())}>
                                      <Icon name="edit" size="xs" /> Ubah
                                    </button>
                                  </td>
                                ) : null}
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 28 }}>
                              Tidak ada menu.
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

async function setAvail(it: Prod, branchId: string, v: boolean): Promise<boolean> {
  try {
    await oc('PUT', `/office/products/${it.id}/branches/${branchId}`, { isAvailable: v });
    toast(`${it.name} ${v ? 'tersedia' : 'tidak tersedia'} di ${activeBranches().find((b) => b.id === branchId)?.name ?? 'cabang'}`);
    return true;
  } catch (e) {
    toast(errText(e), 'err');
    return false;
  }
}

/* ---------- menu pelanggan ---------- */
function customerMenu(code: string | undefined): void {
  if (!code) return;
  const pwa = (import.meta.env.VITE_PWA_URL as string | undefined)?.trim();
  const api = S.be.api?.url ?? '';
  const link = pwa ? `${pwa.replace(/\/+$/, '')}/?cabang=${encodeURIComponent(code)}` : `${api}/branches/${encodeURIComponent(code)}/menu`;
  void openLayer((close) => (
    <Modal
      title={`Menu pelanggan · ${code}`}
      size="sm"
      foot={
        <>
          <button
            className="btn ghost"
            data-copy
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                toast('Tautan disalin');
              } catch {
                toast('Salin manual dari kotak tautan', 'warn');
              }
            }}
          >
            <Icon name="copy" size="sm" /> Salin tautan
          </button>
          <a className="btn" href={link} target="_blank" rel="noopener" onClick={() => close()}>
            <Icon name="link" size="sm" /> Buka
          </a>
        </>
      }
    >
      <div className="col">
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)' }}>
          Menu pelanggan memakai harga & ketersediaan cabang ini dan memberi tanda <b>Habis</b>. Bagikan tautannya atau cetak sebagai QR di meja.
        </p>
        <label className="field">
          <span>Tautan menu</span>
          <input className="input" readOnly value={link} />
        </label>
        {!pwa && <p className="hint">Alamat aplikasi pelanggan belum diatur (VITE_PWA_URL) — tautan di atas menampilkan data menu dari API.</p>}
      </div>
    </Modal>
  ));
}

/* ---------- kategori ---------- */
function catDialog(c: Cat | null, count: number): Promise<boolean> {
  return openLayer<boolean>((close) => <CatBody c={c} count={count} close={close} />).then((v) => !!v);
}
function CatBody({ c, count, close }: { c: Cat | null; count: number; close: (v?: boolean) => void }) {
  const [d, setD] = useState({ name: c?.name ?? '', group: c?.group ?? ('FOOD' as Group), station: c?.station ?? ('KITCHEN' as Station), notes: (c?.quickNotes ?? []).join(', '), sortOrder: c?.sortOrder ?? count + 1, isActive: c?.isActive ?? true });
  const [err, setErr] = useState('');
  const save = async () => {
    if (!d.name.trim()) return setErr('Isi nama kategori.');
    const body = { name: d.name.trim(), group: d.group, station: d.station, quickNotes: d.notes.split(',').map((x) => x.trim()).filter(Boolean), sortOrder: Number(d.sortOrder) || 0, isActive: d.isActive };
    try {
      await oc(c ? 'PATCH' : 'POST', c ? `/office/categories/${c.id}` : '/office/categories', body);
      toast('Kategori disimpan');
      close(true);
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <Modal
      title={c ? `Ubah kategori ${c.name}` : 'Kategori baru'}
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
          <span>Nama kategori</span>
          <input className="input" id="c-name" value={d.name} autoFocus onChange={(e) => setD({ ...d, name: e.target.value })} />
        </label>
        <label className="field">
          <span>Dikirim ke</span>
          <select className="select" value={d.station} onChange={(e) => setD({ ...d, station: e.target.value as Station })}>
            {CAT_STATIONS.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Kelompok</span>
          <select className="select" value={d.group} onChange={(e) => setD({ ...d, group: e.target.value as Group })}>
            {GROUPS.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
          <small>Urutan tampil: {GROUPS.map((g) => g[1]).join(' → ')}</small>
        </label>
        <label className="field">
          <span>
            Catatan cepat <em>(pisahkan dengan koma)</em>
          </span>
          <input className="input" value={d.notes} placeholder="Tidak pedas, Saus dipisah" onChange={(e) => setD({ ...d, notes: e.target.value })} />
        </label>
        <label className="field">
          <span>
            Urutan <em>(di dalam kelompok)</em>
          </span>
          <input className="input" type="number" min={0} value={d.sortOrder} onChange={(e) => setD({ ...d, sortOrder: Number(e.target.value) })} />
        </label>
        <div className="switch-row">
          <div className="grow">
            <b>Aktif</b>
            <small>Kategori nonaktif disembunyikan dari kasir</small>
          </div>
          <Switch on={d.isActive} label="Aktif" onChange={(v) => setD({ ...d, isActive: v })} />
        </div>
        {err ? <p className="err-text">{err}</p> : null}
      </div>
    </Modal>
  );
}

/* ---------- editor menu ---------- */
function productDrawer(p: Prod | null, m: MenuData, catId?: string): Promise<boolean> {
  return openLayer<boolean>(() => <ProductBody p={p} m={m} catId={catId} />).then((v) => !!v);
}

function ProductBody({ p, m, catId }: { p: Prod | null; m: MenuData; catId?: string }) {
  const close = useLayerClose();
  const owner = can('menu.manage');
  const priceOk = can('price.manage');
  const [it, setIt] = useState({
    name: p?.name ?? '', categoryId: p?.categoryId ?? catId ?? m.categories[0]?.id ?? '', basePrice: p?.basePrice ?? 0, station: (p?.station ?? '') as Station | '',
    imageUrl: p?.imageUrl ?? '', description: p?.description ?? '', isSignature: p?.isSignature ?? false, isActive: p?.isActive ?? true,
  });
  const [links, setLinks] = useState<Link[]>(() => [...(p?.modifierGroups ?? [])].sort((a, b) => a.sortOrder - b.sortOrder));
  const [ovs, setOvs] = useState<Record<string, { price: number; avail: boolean }>>(() =>
    Object.fromEntries(m.branches.map((b) => {
      const o = p?.branchSettings.find((x) => x.branchId === b.id);
      return [b.id, { price: o?.priceOverride ?? 0, avail: o ? o.isAvailable : true }];
    })),
  );
  const [err, setErr] = useState('');
  const gallery = useMemo(() => [...new Set(m.products.map((x) => x.imageUrl).filter((x): x is string => !!x))].sort(), [m]);
  const groupName = (id: string) => m.modifierGroups.find((g) => g.id === id)?.name ?? id;

  const save = async () => {
    const name = it.name.trim();
    if (!name || !it.categoryId) return setErr('Lengkapi nama dan kategori.');
    const bz = busy('Menyimpan menu…');
    try {
      let id = p?.id;
      const base = {
        name, categoryId: it.categoryId, station: it.station || null, imageUrl: it.imageUrl.trim() || null, description: it.description.trim() || null,
        isSignature: it.isSignature, isActive: it.isActive,
      };
      const linkBody = links.map((x, i) => ({ groupId: x.groupId, sortOrder: i + 1, showWhenOptionIds: x.showWhenOptionIds }));
      if (!p) {
        const r = await oc<{ id: string }>('POST', '/office/products', { ...base, basePrice: it.basePrice, modifierGroups: linkBody });
        id = r.id;
      } else {
        if (owner) await oc('PATCH', `/office/products/${p.id}`, { ...base, ...(priceOk && it.basePrice !== p.basePrice ? { basePrice: it.basePrice } : {}) });
        else if (priceOk && it.basePrice !== p.basePrice) await oc('PATCH', `/office/products/${p.id}`, { basePrice: it.basePrice });
        const before = JSON.stringify([...p.modifierGroups].sort((a, b) => a.sortOrder - b.sortOrder).map((x) => x.groupId));
        if (owner && before !== JSON.stringify(links.map((x) => x.groupId))) await oc('PUT', `/office/products/${p.id}/modifier-groups`, { groups: linkBody });
      }
      // pengaturan per cabang yang berubah
      for (const b of m.branches) {
        const cur = p?.branchSettings.find((x) => x.branchId === b.id);
        const want = ovs[b.id]!;
        const curPrice = cur?.priceOverride ?? null;
        const wantPrice = want.price ? want.price : null;
        const body: Record<string, unknown> = {};
        if (priceOk && curPrice !== wantPrice) body.priceOverride = wantPrice;
        if ((cur ? cur.isAvailable : true) !== want.avail) body.isAvailable = want.avail;
        if (Object.keys(body).length) await oc('PUT', `/office/products/${id}/branches/${b.id}`, body);
      }
      toast('Menu disimpan');
      close(true);
    } catch (e) {
      setErr(errText(e));
    } finally {
      bz.done();
    }
  };
  const toggleActive = async () => {
    if (!p) return;
    const turnOn = !p.isActive;
    if (!turnOn && !(await confirmBox({ title: `Nonaktifkan ${p.name}?`, text: 'Menu disembunyikan dari kasir di semua cabang. Riwayat penjualan tetap tersimpan.', ok: 'Nonaktifkan', danger: true }))) return;
    try {
      await oc('PATCH', `/office/products/${p.id}`, { isActive: turnOn });
      toast(turnOn ? 'Menu aktif lagi' : 'Menu dinonaktifkan');
      close(true);
    } catch (e) {
      toast(errText(e), 'err');
    }
  };

  return (
    <Drawer
      title={p ? `Ubah ${p.name}` : 'Menu baru'}
      wide
      foot={
        <>
          {p && owner ? (
            <button className="btn danger ghost" data-del onClick={() => void toggleActive()}>
              {p.isActive ? 'Nonaktifkan' : 'Aktifkan lagi'}
            </button>
          ) : null}
          <button className="btn ghost" onClick={() => close(false)}>
            Batal
          </button>
          <button className="btn" data-save onClick={() => void save()}>
            Simpan menu
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field full">
          <span>Nama menu</span>
          <input className="input" data-k="name" value={it.name} disabled={!owner} onChange={(e) => setIt({ ...it, name: e.target.value })} />
        </label>
        <label className="field">
          <span>Kategori</span>
          <select className="select" data-k="categoryId" value={it.categoryId} disabled={!owner} onChange={(e) => setIt({ ...it, categoryId: e.target.value })}>
            {m.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Harga pusat (Rp)</span>
          <MoneyInput className="input money" data-k="basePrice" value={it.basePrice} disabled={!priceOk && !!p} onChange={(v) => setIt({ ...it, basePrice: v })} />
          {!priceOk && <small>Perubahan harga butuh hak harga (pemilik)</small>}
        </label>
        <label className="field">
          <span>Dikirim ke</span>
          <select className="select" value={it.station} disabled={!owner} onChange={(e) => setIt({ ...it, station: e.target.value as Station | '' })}>
            {STATIONS.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Foto</span>
          <select className="select" value={it.imageUrl} disabled={!owner} onChange={(e) => setIt({ ...it, imageUrl: e.target.value })}>
            <option value="">Tanpa foto</option>
            {[...new Set([it.imageUrl, ...gallery].filter(Boolean))].map((g) => (
              <option key={g} value={g}>
                {g.replace(/^assets\/img\//, '')}
              </option>
            ))}
          </select>
          <small>Foto baru: simpan JPG ke assets/img lalu pilih di sini.</small>
        </label>
        <label className="field full">
          <span>
            Deskripsi <em>(opsional, tampil di menu pelanggan)</em>
          </span>
          <input className="input" value={it.description} disabled={!owner} onChange={(e) => setIt({ ...it, description: e.target.value })} />
        </label>
        <div className="full row wrap" style={{ gap: 18 }}>
          <div className="switch-row">
            <Switch on={it.isSignature} label="Signature" disabled={!owner} onChange={(v) => setIt({ ...it, isSignature: v })} />
            <div>
              <b>Signature</b>
              <small>Tanda ★ di kasir</small>
            </div>
          </div>
        </div>
      </div>

      <div className="section-title">
        <h3>Opsi menu</h3>
        <span className="hint">grup opsi bersama (ukuran, level gula, es…) — ubah isinya lewat tombol “Grup opsi”</span>
      </div>
      <div className="col" data-links>
        {links.length ? (
          links.map((x, i) => (
            <div key={x.groupId} className="opt-editor">
              <div className="oe-head">
                <b style={{ flex: 1 }}>{groupName(x.groupId)}</b>
                {x.showWhenOptionIds.length ? <span className="hint">bersyarat</span> : null}
                {owner && (
                  <>
                    <button className="icon-btn sm" aria-label="Naikkan" disabled={!i} onClick={() => setLinks(swap(links, i, i - 1))}>
                      <Icon name="arrow-up" size="sm" />
                    </button>
                    <button className="icon-btn sm" aria-label="Turunkan" disabled={i === links.length - 1} onClick={() => setLinks(swap(links, i, i + 1))}>
                      <Icon name="arrow-down" size="sm" />
                    </button>
                    <button className="icon-btn sm danger" aria-label="Lepas grup" onClick={() => setLinks(links.filter((y) => y.groupId !== x.groupId))}>
                      <Icon name="x" size="sm" />
                    </button>
                  </>
                )}
              </div>
              <p className="hint" style={{ margin: 0 }}>
                {m.modifierGroups.find((g) => g.id === x.groupId)?.options.filter((o) => o.isActive).map((o) => (o.priceDelta ? `${o.name} (+${rp(o.priceDelta)})` : o.name)).join(' · ')}
              </p>
            </div>
          ))
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Tanpa opsi — langsung masuk keranjang saat diketuk.
          </p>
        )}
        {owner && (
          <select
            className="select sm"
            value=""
            aria-label="Tambah grup opsi"
            onChange={(e) => e.target.value && setLinks([...links, { groupId: e.target.value, sortOrder: links.length + 1, showWhenOptionIds: [] }])}
          >
            <option value="">+ Tambah grup opsi…</option>
            {m.modifierGroups.filter((g) => g.isActive && !links.some((x) => x.groupId === g.id)).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.options.length} pilihan)
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="section-title">
        <h3>Per cabang</h3>
        <span className="hint">Kosongkan harga khusus untuk memakai harga pusat</span>
      </div>
      <table className="table ov-table">
        <thead>
          <tr>
            <th>Cabang</th>
            <th>Tersedia</th>
            <th>Harga khusus</th>
          </tr>
        </thead>
        <tbody>
          {m.branches.map((b) => (
            <tr key={b.id}>
              <td>
                {b.name}
                {!b.isActive && <span className="tag"> nonaktif</span>}
              </td>
              <td>
                <Switch on={ovs[b.id]!.avail} label={`Tersedia di ${b.name}`} data-ovav={b.id} onChange={(v) => setOvs({ ...ovs, [b.id]: { ...ovs[b.id]!, avail: v } })} />
              </td>
              <td>
                <MoneyInput
                  className="input sm money"
                  data-ovp={b.code}
                  value={ovs[b.id]!.price}
                  disabled={!priceOk}
                  placeholder={rp(it.basePrice || 0)}
                  onChange={(v) => setOvs({ ...ovs, [b.id]: { ...ovs[b.id]!, price: v } })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {p && (owner || can('stock.manage')) && <RecipeEditor target={`/office/products/${p.id}/recipe`} editable={owner} />}
      {err ? <p className="err-text">{err}</p> : null}
    </Drawer>
  );
}

const swap = <T,>(a: T[], i: number, j: number): T[] => {
  const b = [...a];
  [b[i], b[j]] = [b[j]!, b[i]!];
  return b;
};

/* ---------- resep (BoM): bahan yang terpotong otomatis saat menu terjual ---------- */
interface Recipe { note: string | null; lines: { inventoryItemId: string; quantity: number; item: { name: string; unit: InvItem['unit'] } }[] }
export function RecipeEditor({ target, editable }: { target: string; editable: boolean }) {
  const l = useLoad(() => Promise.all([oget<Recipe>(target), oget<InvItem[]>('/office/inventory-items')]), [target]);
  const [lines, setLines] = useState<{ inventoryItemId: string; quantity: number }[] | null>(null);
  const [err, setErr] = useState('');
  const cur = lines ?? l.data?.[0].lines.map((x) => ({ inventoryItemId: x.inventoryItemId, quantity: x.quantity })) ?? [];
  const items = l.data?.[1] ?? [];
  const save = async () => {
    try {
      const clean = cur.filter((x) => x.inventoryItemId && x.quantity > 0);
      if (clean.length) await oc('PUT', target, { lines: clean });
      else await oc('DELETE', target);
      toast('Resep disimpan');
      setLines(null);
      l.reload();
      setErr('');
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <>
      <div className="section-title">
        <h3>Resep (bahan baku)</h3>
        <span className="hint">Stok bahan di cabang berkurang otomatis setiap menu ini terjual</span>
      </div>
      {!l.data ? (
        <p className="muted">Memuat resep…</p>
      ) : (
        <div className="col" data-recipe>
          {cur.map((x, i) => (
            <div key={i} className="choice-row">
              <select
                className="select sm"
                value={x.inventoryItemId}
                disabled={!editable}
                onChange={(e) => setLines(cur.map((y, j) => (j === i ? { ...y, inventoryItemId: e.target.value } : y)))}
              >
                <option value="">Pilih bahan…</option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name} ({UNIT[it.unit]})
                  </option>
                ))}
              </select>
              <input
                className="input sm"
                type="number"
                min={0}
                step="any"
                value={x.quantity || ''}
                disabled={!editable}
                placeholder="Jumlah"
                onChange={(e) => setLines(cur.map((y, j) => (j === i ? { ...y, quantity: Number(e.target.value) } : y)))}
              />
              {editable && (
                <button className="icon-btn sm danger" aria-label="Hapus bahan" onClick={() => setLines(cur.filter((_, j) => j !== i))}>
                  <Icon name="x" size="sm" />
                </button>
              )}
            </div>
          ))}
          {!cur.length && <p className="muted" style={{ margin: 0 }}>Belum ada resep — stok bahan tidak terpotong.</p>}
          {editable && (
            <div className="row">
              <button className="btn ghost xs" onClick={() => setLines([...cur, { inventoryItemId: '', quantity: 0 }])}>
                <Icon name="plus" size="xs" /> Bahan
              </button>
              {lines && (
                <button className="btn soft xs" data-save-recipe onClick={() => void save()}>
                  <Icon name="check" size="xs" /> Simpan resep
                </button>
              )}
            </div>
          )}
          {err ? <p className="err-text">{err}</p> : null}
        </div>
      )}
    </>
  );
}

/* ---------- grup opsi bersama ---------- */
function groupsDialog(m: MenuData): Promise<unknown> {
  return openLayer(() => <GroupsBody initial={m.modifierGroups} />);
}
function GroupsBody({ initial }: { initial: MGroup[] }) {
  const close = useLayerClose();
  const [groups, setGroups] = useState(initial);
  const [sel, setSel] = useState<string | null>(initial[0]?.id ?? null);
  const g = groups.find((x) => x.id === sel) ?? null;
  const [err, setErr] = useState('');
  const refresh = async (keep?: string) => {
    const d = await oget<MenuData>('/office/menu');
    setGroups(d.modifierGroups);
    if (keep) setSel(keep);
  };
  const patchGroup = async (body: Partial<MGroup>) => {
    if (!g) return;
    try {
      await oc('PATCH', `/office/modifier-groups/${g.id}`, body);
      await refresh(g.id);
      setErr('');
    } catch (e) {
      setErr(errText(e));
    }
  };
  const patchOpt = async (o: Opt, body: Partial<Opt>) => {
    try {
      await oc('PATCH', `/office/modifier-options/${o.id}`, body);
      await refresh(sel ?? undefined);
      setErr('');
    } catch (e) {
      setErr(errText(e));
    }
  };
  const newGroup = async () => {
    const name = await promptBox({ title: 'Grup opsi baru', label: 'Nama grup', placeholder: 'mis. Ukuran', ok: 'Buat' });
    if (!name) return;
    try {
      const r = await oc<{ id: string }>('POST', '/office/modifier-groups', { name, selection: 'SINGLE', options: [{ name: 'Normal', priceDelta: 0, isDefault: true }] });
      await refresh(r.id);
    } catch (e) {
      setErr(errText(e));
    }
  };
  const addOpt = async () => {
    if (!g) return;
    try {
      await oc('POST', `/office/modifier-groups/${g.id}/options`, { name: `Pilihan ${g.options.length + 1}`, priceDelta: 0 });
      await refresh(g.id);
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <Modal
      title="Grup opsi"
      sub="Satu grup bisa dipakai banyak menu. Perubahan berlaku di semua menu yang memakainya."
      size="lg"
      foot={
        <button className="btn" onClick={() => close(true)}>
          Selesai
        </button>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '220px minmax(0,1fr)', gap: 16 }}>
        <div className="list">
          {groups.map((x) => (
            <button key={x.id} className={`li ${x.id === sel ? 'on' : ''}`} onClick={() => setSel(x.id)}>
              <div>
                <b>{x.name}</b>
                <small>
                  {x.options.length} pilihan · {x.productCount} menu{x.isActive ? '' : ' · nonaktif'}
                </small>
              </div>
            </button>
          ))}
          <button className="btn ghost sm" onClick={() => void newGroup()}>
            <Icon name="plus" size="sm" /> Grup baru
          </button>
        </div>
        {g ? (
          <div className="col" key={g.id}>
            <div className="form-grid">
              <label className="field">
                <span>Nama grup</span>
                <input className="input" defaultValue={g.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== g.name && void patchGroup({ name: e.target.value.trim() })} />
              </label>
              <label className="field">
                <span>Pilihan</span>
                <select className="select" value={g.selection} onChange={(e) => void patchGroup({ selection: e.target.value as MGroup['selection'] })}>
                  <option value="SINGLE">Pilih satu</option>
                  <option value="MULTIPLE">Boleh banyak</option>
                </select>
              </label>
            </div>
            <div className="row wrap" style={{ gap: 18 }}>
              <div className="switch-row">
                <Switch on={g.isRequired} label="Wajib" onChange={(v) => void patchGroup({ isRequired: v })} />
                <div>
                  <b>Wajib dipilih</b>
                </div>
              </div>
              <div className="switch-row">
                <Switch on={g.isActive} label="Aktif" onChange={(v) => void patchGroup({ isActive: v })} />
                <div>
                  <b>Aktif</b>
                </div>
              </div>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Pilihan</th>
                  <th className="r">Tambahan harga</th>
                  <th>Bawaan</th>
                  <th>Aktif</th>
                </tr>
              </thead>
              <tbody>
                {g.options.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <input className="input sm" defaultValue={o.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== o.name && void patchOpt(o, { name: e.target.value.trim() })} />
                    </td>
                    <td className="r">
                      <input
                        className="input sm"
                        type="number"
                        step={500}
                        defaultValue={o.priceDelta}
                        style={{ width: 110 }}
                        onBlur={(e) => Number(e.target.value) !== o.priceDelta && void patchOpt(o, { priceDelta: Math.round(Number(e.target.value) || 0) })}
                      />
                    </td>
                    <td>
                      <Switch on={o.isDefault} label="Bawaan" onChange={(v) => void patchOpt(o, { isDefault: v })} />
                    </td>
                    <td>
                      <Switch on={o.isActive} label="Aktif" onChange={(v) => void patchOpt(o, { isActive: v })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn ghost xs" style={{ justifySelf: 'start' }} onClick={() => void addOpt()}>
              <Icon name="plus" size="xs" /> Pilihan
            </button>
            <p className="hint">Tambahan harga dalam Rupiah (0 = tanpa tambahan). Opsi nonaktif tidak muncul di kasir.</p>
          </div>
        ) : (
          <p className="muted">Pilih grup di kiri.</p>
        )}
      </div>
      {err ? <p className="err-text">{err}</p> : null}
    </Modal>
  );
}
