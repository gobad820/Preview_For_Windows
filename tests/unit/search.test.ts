import { describe, expect, it } from 'vitest';
import {
  buildPageIndex,
  findMatches,
  matchToItemSpans,
  type Match,
  type PageTextIndex,
} from '../../src/search/search';

describe('buildPageIndex', () => {
  it('joins item strings and records each item offset', () => {
    const index = buildPageIndex(3, [{ str: 'Hello ' }, { str: 'world' }]);
    expect(index).toEqual<PageTextIndex>({ pageIndex: 3, text: 'Hello world', itemStarts: [0, 6] });
  });

  it('appends a newline after items flagged hasEOL', () => {
    const index = buildPageIndex(0, [{ str: 'Hello', hasEOL: true }, { str: 'world', hasEOL: true }, { str: '!' }]);
    expect(index.text).toBe('Hello\nworld\n!');
    expect(index.itemStarts).toEqual([0, 6, 12]);
  });

  it('handles an empty item list', () => {
    expect(buildPageIndex(1, [])).toEqual<PageTextIndex>({ pageIndex: 1, text: '', itemStarts: [] });
  });
});

describe('findMatches', () => {
  const page = (pageIndex: number, text: string): PageTextIndex => ({ pageIndex, text, itemStarts: [0] });

  it('returns [] for an empty or whitespace-only query', () => {
    const pages = [page(0, 'some text')];
    expect(findMatches('', pages)).toEqual([]);
    expect(findMatches('   \n\t', pages)).toEqual([]);
  });

  it('matches case-insensitively', () => {
    expect(findMatches('HELLO', [page(0, 'say hello')])).toEqual<Match[]>([{ pageIndex: 0, start: 4, end: 9 }]);
  });

  it('lets a whitespace run in the query match a newline in the text', () => {
    expect(findMatches('hello world', [page(0, 'Hello\nworld')])).toEqual<Match[]>([
      { pageIndex: 0, start: 0, end: 11 },
    ]);
  });

  it('lets a whitespace run in the query match a longer whitespace run in the text', () => {
    expect(findMatches('a  b', [page(0, 'x a \n\t b y')])).toEqual<Match[]>([{ pageIndex: 0, start: 2, end: 8 }]);
  });

  it('ignores leading and trailing whitespace in the query', () => {
    expect(findMatches('  hello ', [page(0, 'hello')])).toEqual<Match[]>([{ pageIndex: 0, start: 0, end: 5 }]);
  });

  it('matches Korean text', () => {
    expect(findMatches('문서', [page(0, '한글 문서 보기')])).toEqual<Match[]>([{ pageIndex: 0, start: 3, end: 5 }]);
  });

  it('matches through NFKC normalisation and reports offsets in the original text', () => {
    // 'ﬃ' (U+FB03) is one code unit in the text but expands to three under NFKC.
    const pages = [page(0, 'the oﬃce door')];
    expect(findMatches('office', pages)).toEqual<Match[]>([{ pageIndex: 0, start: 4, end: 8 }]);
    expect(findMatches('door', pages)).toEqual<Match[]>([{ pageIndex: 0, start: 9, end: 13 }]);
  });

  it('matches a precomposed query against decomposed text (and vice versa)', () => {
    // 'e' + U+0301 composes to 'é' under NFKC; offsets stay in the original (6-unit) text.
    expect(findMatches('caf\u00e9', [page(0, 'a cafe\u0301!')])).toEqual<Match[]>([{ pageIndex: 0, start: 2, end: 7 }]);
    expect(findMatches('cafe\u0301', [page(0, 'caf\u00e9')])).toEqual<Match[]>([{ pageIndex: 0, start: 0, end: 4 }]);
  });

  it('matches a fullwidth query against ASCII text', () => {
    expect(findMatches('ＡＢＣ', [page(0, 'xx abc')])).toEqual<Match[]>([{ pageIndex: 0, start: 3, end: 6 }]);
  });

  it('treats regex metacharacters in the query literally', () => {
    expect(findMatches('a.b', [page(0, 'axb a.b')])).toEqual<Match[]>([{ pageIndex: 0, start: 4, end: 7 }]);
  });

  it('returns non-overlapping matches ordered by page then start', () => {
    const pages = [page(2, 'aa aaaa'), page(0, 'xaa')];
    expect(findMatches('aa', pages)).toEqual<Match[]>([
      { pageIndex: 0, start: 1, end: 3 },
      { pageIndex: 2, start: 0, end: 2 },
      { pageIndex: 2, start: 3, end: 5 },
      { pageIndex: 2, start: 5, end: 7 },
    ]);
  });

  it('searches the text produced by buildPageIndex', () => {
    const index = buildPageIndex(0, [{ str: 'Hello', hasEOL: true }, { str: 'World' }]);
    expect(findMatches('hello world', [index])).toEqual<Match[]>([{ pageIndex: 0, start: 0, end: 11 }]);
  });
});

describe('matchToItemSpans', () => {
  it('returns one span with item-relative offsets for a match inside one item', () => {
    const index = buildPageIndex(0, [{ str: 'abc ' }, { str: 'defgh' }]);
    expect(matchToItemSpans(index, { pageIndex: 0, start: 5, end: 7 })).toEqual([{ item: 1, start: 1, end: 3 }]);
  });

  it('splits a match spanning two items into two spans', () => {
    const index = buildPageIndex(0, [{ str: 'Hello ' }, { str: 'world' }]);
    const [m] = findMatches('lo wor', [index]);
    expect(m).toEqual({ pageIndex: 0, start: 3, end: 9 });
    expect(matchToItemSpans(index, m!)).toEqual([
      { item: 0, start: 3, end: 6 },
      { item: 1, start: 0, end: 3 },
    ]);
  });

  it('does not attribute the EOL newline to any item', () => {
    const index = buildPageIndex(0, [{ str: 'Hello', hasEOL: true }, { str: 'world' }]);
    expect(matchToItemSpans(index, { pageIndex: 0, start: 0, end: 11 })).toEqual([
      { item: 0, start: 0, end: 5 },
      { item: 1, start: 0, end: 5 },
    ]);
  });

  it('skips empty items inside the match', () => {
    const index = buildPageIndex(0, [{ str: 'ab' }, { str: '' }, { str: 'cd' }]);
    expect(matchToItemSpans(index, { pageIndex: 0, start: 1, end: 3 })).toEqual([
      { item: 0, start: 1, end: 2 },
      { item: 2, start: 0, end: 1 },
    ]);
  });
});
