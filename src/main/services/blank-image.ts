/**
 * A locked screen, or a selection of an empty flat area, comes back as one flat
 * colour. Such an image carries nothing to translate and must not be sent.
 * (It does NOT catch the no-permission wallpaper image: the Screen Recording
 * gate in capture-gate.ts does.)
 */

/** True when every 4-byte pixel of the bitmap equals the first one (or it is empty). */
export function isUniformBitmap(bitmap: Buffer): boolean {
  if (bitmap.length < 8) return true
  for (let i = 4; i + 3 < bitmap.length; i += 4) {
    if (
      bitmap[i] !== bitmap[0] ||
      bitmap[i + 1] !== bitmap[1] ||
      bitmap[i + 2] !== bitmap[2] ||
      bitmap[i + 3] !== bitmap[3]
    ) {
      return false
    }
  }
  return true
}
