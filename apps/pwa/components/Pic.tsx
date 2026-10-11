'use client';
/* Foto dengan placeholder & efek muncul halus (kelas .im/.loaded/img.ok dari CSS prototipe). Tanpa foto: nama menu di kotak. */
import { useCallback, useState, type CSSProperties } from 'react';
import { asset } from '@/lib/env';

export function Pic({
  src,
  name = '',
  cls = '',
  big = false,
  style,
  imgStyle,
  eager = false,
}: {
  src: string | null | undefined;
  name?: string;
  cls?: string;
  big?: boolean;
  style?: CSSProperties;
  imgStyle?: CSSProperties;
  eager?: boolean;
}) {
  const url = src ? asset(src) : '';
  const [ok, setOk] = useState<string | null>(null);
  const [bad, setBad] = useState<string | null>(null);
  // Gambar yang sudah termuat sebelum React aktif (cache) tidak memicu onLoad.
  const ref = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && img.complete && img.naturalWidth) setOk(url);
    },
    [url],
  );
  if (!url) {
    return (
      <div className={`im loaded ${cls}`} style={style}>
        <div className={`ph ${big ? 'big' : ''}`}>
          <span>{name}</span>
        </div>
      </div>
    );
  }
  if (bad === url) return <div className={`im loaded ${cls}`} style={style} />;
  const loaded = ok === url;
  return (
    <div className={`im ${loaded ? 'loaded' : ''} ${cls}`} style={style}>
      <img
        ref={ref}
        src={url}
        alt=""
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        className={loaded ? 'ok' : undefined}
        style={imgStyle}
        onLoad={() => setOk(url)}
        onError={() => setBad(url)}
      />
    </div>
  );
}
