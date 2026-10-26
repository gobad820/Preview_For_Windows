/**
 * Writes this app's annotations into an output page (pdf-lib): standard annotation
 * dictionaries with appearance streams, the model as JSON under `/PFW`, and `/PFWAnnot true` in
 * each appearance stream's dictionary so files with our annotations are found without parsing.
 */
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  StandardFonts,
  type PDFDocument,
  type PDFFont,
  type PDFObject,
  type PDFPage,
} from '@cantoo/pdf-lib';
import { buildAppearance, hexToRgb, type Appearance, type AppearanceFont } from './appearance';
import { ownModel } from './own';
import type { Annot, TextBoxAnnot } from './types';

/** Supplies the bytes of the font text boxes are set in (Malgun Gothic), or null. */
export type FontLoader = () => Promise<Uint8Array | null>;

const N = {
  Annots: PDFName.of('Annots'),
  AP: PDFName.of('AP'),
  N: PDFName.of('N'),
  PFW: PDFName.of('PFW'),
  PFWAnnot: PDFName.of('PFWAnnot'),
  NM: PDFName.of('NM'),
  Parent: PDFName.of('Parent'),
  IRT: PDFName.of('IRT'),
  Popup: PDFName.of('Popup'),
  StructParent: PDFName.of('StructParent'),
  OC: PDFName.of('OC'),
};

/** Keys another app may have added to one of our annotations that a rewrite keeps. */
const CARRIED = [N.Popup, N.StructParent, N.OC, N.IRT];

interface Embedded {
  font: AppearanceFont;
  ref: PDFRef;
}

/** The fonts text boxes can use in one output document, embedded on first use. */
export class AnnotFonts {
  private custom: Promise<{ pdf: PDFFont; chars: Set<number>; ascent: number; descent: number } | null> | null = null;
  private helvetica: Promise<{ pdf: PDFFont; chars: Set<number> }> | null = null;

  constructor(
    private readonly out: PDFDocument,
    private readonly load?: FontLoader,
  ) {}

  /** A font that can show every character of `text`: the loaded font, else Helvetica, else null. */
  async forText(text: string): Promise<Embedded | null> {
    const shown = Array.from(text.replace(/\s/gu, ''), (c) => c.codePointAt(0)!);
    const custom = await this.customFont();
    if (custom && shown.every((cp) => custom.chars.has(cp))) {
      return { font: adapt(custom.pdf, custom.ascent, custom.descent, () => true), ref: custom.pdf.ref };
    }
    // Helvetica shows WinAnsi only; pdf-lib would silently turn anything else into "?".
    const helv = await (this.helvetica ??= this.out
      .embedFont(StandardFonts.Helvetica)
      .then((pdf) => ({ pdf, chars: new Set(pdf.getCharacterSet()) })));
    const encodable = (t: string) => Array.from(t.replace(/\s/gu, ''), (c) => c.codePointAt(0)!).every((cp) => helv.chars.has(cp));
    if (!encodable(text)) return null;
    return { font: adapt(helv.pdf, 0.718, -0.207, encodable), ref: helv.pdf.ref };
  }

  private customFont() {
    this.custom ??= (async () => {
      const bytes = this.load ? await this.load().catch(() => null) : null;
      if (!bytes) return null;
      try {
        const fontkit = (await import('@cantoo/fontkit')).default;
        this.out.registerFontkit(fontkit);
        const pdf = await this.out.embedFont(bytes, { subset: true });
        const fk = (pdf as unknown as { embedder: { font: { ascent: number; descent: number; unitsPerEm: number } } }).embedder.font;
        return { pdf, chars: new Set(pdf.getCharacterSet()), ascent: fk.ascent / fk.unitsPerEm, descent: fk.descent / fk.unitsPerEm };
      } catch (e) {
        console.warn('annotation font could not be embedded', e);
        return null;
      }
    })();
    return this.custom;
  }
}

function adapt(pdf: PDFFont, ascent: number, descent: number, canShow: (t: string) => boolean): AppearanceFont {
  return {
    name: 'F1',
    encode: (t) => (canShow(t) ? pdf.encodeText(t).toString() : null),
    widthOf: (t, size) => pdf.widthOfTextAtSize(t, size),
    ascent,
    descent,
  };
}

const text = (s: string) => PDFHexString.fromText(s);

function pdfDate(iso: string): PDFString {
  const d = new Date(iso);
  const t = Number.isNaN(d.getTime()) ? new Date() : d;
  const p = (v: number, w = 2) => String(v).padStart(w, '0');
  return PDFString.of(
    `D:${p(t.getUTCFullYear(), 4)}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}Z`,
  );
}

const SUBTYPE: Record<Annot['kind'], string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'StrikeOut',
  rect: 'Square',
  oval: 'Circle',
  line: 'Line',
  arrow: 'Line',
  ink: 'Ink',
  text: 'FreeText',
  note: 'Text',
};

function appearanceStream(out: PDFDocument, ap: Appearance, font: Embedded | null): PDFRef {
  const ctx = out.context;
  const resources: Record<string, PDFObject> = {};
  if (ap.extGState) {
    const gs: Record<string, PDFObject> = {
      Type: PDFName.of('ExtGState'),
      CA: PDFNumber.of(ap.extGState.opacity),
      ca: PDFNumber.of(ap.extGState.opacity),
    };
    if (ap.extGState.multiply) gs['BM'] = PDFName.of('Multiply');
    resources['ExtGState'] = ctx.obj({ GS0: ctx.obj(gs) });
  }
  if (ap.usesFont && font) resources['Font'] = ctx.obj({ [font.font.name]: font.ref });
  const r = ap.rect;
  const stream = ctx.flateStream(ap.content, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [r.x0, r.y0, r.x1, r.y1],
    Resources: ctx.obj(resources),
    PFWAnnot: true,
  });
  return ctx.register(stream);
}

/** The annotation dictionary for `a` (appearance included when one could be built). */
async function annotDict(out: PDFDocument, page: PDFPage, a: Annot, fonts: AnnotFonts): Promise<PDFDict> {
  const ctx = out.context;
  const font = a.kind === 'text' ? await fonts.forText(a.text) : null;
  const ap = buildAppearance(a, font?.font ?? null);
  const rect = ap.rect;
  const color = (c: string) => hexToRgb(c);
  const d: Record<string, PDFObject> = {
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of(SUBTYPE[a.kind]),
    F: PDFNumber.of(4),
    NM: text(a.id),
    M: pdfDate(a.modified),
    C: ctx.obj(color(a.color)),
    CA: PDFNumber.of(a.opacity),
    P: page.ref,
    PFW: text(JSON.stringify(a)),
  };
  d['Rect'] = ctx.obj([rect.x0, rect.y0, rect.x1, rect.y1]);
  switch (a.kind) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      d['QuadPoints'] = ctx.obj(a.quads.flatMap((q) => [...q]));
      d['Contents'] = text(a.text);
      break;
    case 'rect':
    case 'oval':
      d['BS'] = ctx.obj({ W: a.width, S: 'S' });
      if (a.fill !== null) d['IC'] = ctx.obj(color(a.fill));
      break;
    case 'line':
    case 'arrow':
      d['L'] = ctx.obj([a.from.x, a.from.y, a.to.x, a.to.y]);
      d['BS'] = ctx.obj({ W: a.width, S: 'S' });
      if (a.kind === 'arrow') d['LE'] = ctx.obj(['None', 'OpenArrow']);
      break;
    case 'ink':
      d['InkList'] = ctx.obj(a.paths.map((path) => path.flatMap((p) => [p.x, p.y])));
      d['BS'] = ctx.obj({ W: a.width, S: 'S' });
      break;
    case 'text': {
      const t = a as TextBoxAnnot;
      const [r, g, b] = color(t.color);
      d['Contents'] = text(t.text);
      d['DA'] = PDFString.of(`/Helv ${t.fontSize} Tf ${[r, g, b].map((v) => Math.round(v * 1000) / 1000).join(' ')} rg`);
      d['Q'] = PDFNumber.of(0);
      d['BS'] = ctx.obj({ W: t.border !== null ? t.borderWidth : 0, S: 'S' });
      if (t.fill !== null) d['C'] = ctx.obj(color(t.fill));
      else delete d['C'];
      break;
    }
    case 'note':
      d['Contents'] = text(a.text);
      d['Name'] = PDFName.of('Comment');
      d['Open'] = PDFBool.False;
      break;
  }
  d['AP'] = ctx.obj({ N: appearanceStream(out, ap, font) });
  return ctx.obj(d);
}

/**
 * Makes this app's annotations on `page` exactly `annots`. Ours that stay are rewritten in
 * place (same object, so popups and replies other apps attached keep pointing at them), unless
 * another output page shares the object; ours that are gone are removed together with every
 * annotation whose /Parent or /IRT chain leads to them; new ones are appended. Everything the
 * reader did not hand to the user (foreign, unreadable or changed elsewhere) is left alone.
 * `shared` holds the refs (tags) that other output pages also list.
 */
export async function writePageAnnotations(
  out: PDFDocument,
  page: PDFPage,
  annots: readonly Annot[],
  fonts: AnnotFonts,
  shared: ReadonlySet<string> = new Set(),
): Promise<void> {
  const ctx = out.context;
  const entries = page.node.lookupMaybe(N.Annots, PDFArray)?.asArray() ?? [];
  const dictOf = (e: PDFObject) => (e instanceof PDFRef ? ctx.lookupMaybe(e, PDFDict) : e instanceof PDFDict ? e : undefined);
  const wanted = new Set(annots.map((a) => a.id));
  const ownById = new Map<string, { ref: PDFRef; dict: PDFDict }>();
  const kept = new Set<string>();
  const removed = new Set<string>();
  for (const e of entries) {
    const model = ownModel(e, ctx);
    if (!model || !(e instanceof PDFRef) || kept.has(e.tag)) continue;
    if (wanted.has(model.id) && !ownById.has(model.id) && !shared.has(e.tag)) {
      ownById.set(model.id, { ref: e, dict: ctx.lookup(e, PDFDict) });
      kept.add(e.tag);
    } else {
      removed.add(e.tag);
    }
  }
  // Popups and replies of removed annotations go too, transitively; kept ones never do.
  const linksTo = (dict: PDFDict) =>
    [N.Parent, N.IRT].some((k) => {
      const v = dict.get(k);
      return v instanceof PDFRef && removed.has(v.tag);
    });
  for (let changed = removed.size > 0; changed; ) {
    changed = false;
    for (const e of entries) {
      if (!(e instanceof PDFRef) || removed.has(e.tag) || kept.has(e.tag)) continue;
      const dict = dictOf(e);
      if (dict && linksTo(dict)) {
        removed.add(e.tag);
        changed = true;
      }
    }
  }
  const keep: PDFObject[] = entries.filter((e) => {
    if (e instanceof PDFRef) return !removed.has(e.tag);
    const dict = dictOf(e);
    return !(dict && linksTo(dict));
  });
  for (const a of annots) {
    const dict = await annotDict(out, page, a, fonts);
    const existing = ownById.get(a.id);
    if (existing) {
      for (const k of CARRIED) {
        const v = existing.dict.get(k);
        if (v !== undefined) dict.set(k, v);
      }
      ctx.assign(existing.ref, dict);
      ownById.delete(a.id); // a duplicate id later in the list gets its own object
    } else {
      keep.push(ctx.register(dict));
    }
  }
  if (keep.length > 0) page.node.set(N.Annots, ctx.obj(keep));
  else page.node.delete(N.Annots);
}
