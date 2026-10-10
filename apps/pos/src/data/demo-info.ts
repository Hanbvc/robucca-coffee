/* Info kecil mode demo (tanpa snapshot master, agar data demo dimuat hanya saat dipakai). */
/** PIN staf contoh (sama dengan seed SEED_DEMO=1). */
export const DEMO_PINS = { owner: '1111', manager: '2222', cashier: '3333', kitchen: '4444' } as const;

export const DEMO_BRANCHES = [
  { code: 'IJN', name: 'Ijen Nirwana', sub: 'Cabang utama (data menu asli)' },
  { code: 'CB2', name: 'Cabang 2 (contoh)', sub: 'Cabang contoh' },
  { code: 'CB3', name: 'Cabang 3 (contoh)', sub: 'Cabang contoh' },
] as const;
