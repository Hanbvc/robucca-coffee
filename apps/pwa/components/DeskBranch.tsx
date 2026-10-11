'use client';
/* Alamat & jam cabang pilihan di panel samping layar lebar. */
import { useBranch } from '@/lib/data';
import { closeOf, dot, openOf } from '@/lib/time';

export function DeskBranch() {
  const { branch } = useBranch();
  if (!branch) return null;
  return (
    <p className="desk-addr">
      Robucca {branch.name}
      {branch.address ? (
        <>
          <br />
          {branch.address}
        </>
      ) : null}
      <br />
      Setiap hari · {dot(openOf(branch))} – {dot(closeOf(branch))}
    </p>
  );
}
