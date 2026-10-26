import type { PDFPageProxy, TextContent } from 'pdfjs-dist/types/src/display/api';
import type { PageSize } from '../types';
import type { OutlineNode, PageText } from './document';

/**
 * Read-side view of a document as the viewer, thumbnails, search and outline see it.
 * Implemented by `PdfDocument` (one file) and `EditableDocument` (a composition of files).
 */
export interface PageSource {
  readonly numPages: number;
  /** Unrotated page sizes in PDF points, one per page position. */
  readonly sizes: PageSize[];
  getPage(index: number): Promise<PDFPageProxy>;
  getTextContent(index: number): Promise<TextContent>;
  getPageText(index: number): Promise<PageText>;
  getOutline(): Promise<OutlineNode[]>;
  /** "<src>:<sourcePageIndex>"; positions with equal keys render identically. */
  pageKey(index: number): string;
}
