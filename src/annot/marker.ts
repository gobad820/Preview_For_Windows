/** Byte-level detection of this app's annotations. Dependency-free so the pdf.js wrapper can use it. */

const MARKER = new TextEncoder().encode('/PFWAnnot');

/** True when the bytes contain `/PFWAnnot` (stream dictionaries are never compressed). */
export function hasOwnMarker(bytes: Uint8Array): boolean {
  const first = MARKER[0]!;
  for (let i = bytes.indexOf(first); i !== -1; i = bytes.indexOf(first, i + 1)) {
    let k = 1;
    while (k < MARKER.length && bytes[i + k] === MARKER[k]) k++;
    if (k === MARKER.length) return true;
  }
  return false;
}
