// Menu pictures are shown as small tiles, so a 1200 px, 500 KB photograph is
// sent to every till for nothing. Supabase counts every byte of it (cached
// egress, 5 GB a month on the free plan). Every upload goes through here first,
// in the admin page and in scripts/, so a picture is stored at most this big.
//
// Logos are left alone: they are printed on receipts and there is one per company.

/** Longest side of a stored menu picture, in pixels. */
export const PICTURE_MAX = 400;

/** Seconds a browser may keep a stored picture: a year, as a stored name always holds the same picture. */
export const PICTURE_CACHE = '31536000';

/** A picture already this small is kept as it is. */
const SMALL_BYTES = 100 * 1024;

/** The size to draw a picture at, or null when it is small enough already. */
export function shrunkSize(width: number, height: number, bytes: number, max = PICTURE_MAX): { width: number; height: number } | null {
  if (!(width > 0) || !(height > 0)) return null;
  const longest = Math.max(width, height);
  if (longest <= max && bytes <= SMALL_BYTES) return null;
  const scale = Math.min(1, max / longest);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Shrink a picture the owner picked before it is uploaded (browser only).
 *
 * Gives back a WebP named like the original. Never stands in the way of an
 * upload: if the browser cannot read or draw the file, the original goes.
 */
export async function shrinkPicture(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = shrunkSize(bitmap.width, bitmap.height, file.size);
    if (!size) { bitmap.close(); return file; }
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close(); return file; }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>(done => canvas.toBlob(done, 'image/webp', 0.8));
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]*$/, '') + '.webp', { type: 'image/webp' });
  } catch {
    return file;
  }
}
