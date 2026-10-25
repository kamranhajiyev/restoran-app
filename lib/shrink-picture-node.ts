// The scripts' side of lib/shrink-picture.ts: the same size limit, done with sharp.
import sharp from 'sharp';
import { PICTURE_MAX, shrunkSize } from './shrink-picture';

export type PictureFormat = 'jpeg' | 'png' | 'webp';

const TYPES: Record<PictureFormat, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** The format a stored file must keep, by its name, so its link and type still agree. */
export function formatOf(name: string): PictureFormat | null {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'jpeg';
  if (ext === 'png' || ext === 'webp') return ext;
  return null;
}

/**
 * A smaller copy of a picture, or null when it is small enough already or the
 * copy would not be smaller.
 */
export async function shrinkPictureBuffer(body: Buffer, format: PictureFormat): Promise<{ body: Buffer; type: string } | null> {
  const meta = await sharp(body).metadata();
  // A phone photo stores its turn separately; width and height are before it.
  const turned = (meta.orientation ?? 1) >= 5;
  const w = turned ? meta.height : meta.width;
  const h = turned ? meta.width : meta.height;
  if (!w || !h || !shrunkSize(w, h, body.length)) return null;

  let img = sharp(body).rotate().resize({ width: PICTURE_MAX, height: PICTURE_MAX, fit: 'inside', withoutEnlargement: true });
  img = format === 'jpeg' ? img.jpeg({ quality: 80, mozjpeg: true })
    : format === 'png' ? img.png({ palette: true, quality: 85, compressionLevel: 9 })
    : img.webp({ quality: 80 });
  const out = await img.toBuffer();
  return out.length < body.length ? { body: out, type: TYPES[format] } : null;
}
