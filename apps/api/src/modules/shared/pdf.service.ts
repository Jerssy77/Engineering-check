import { Injectable } from "@nestjs/common";
import fontkit from "@pdf-lib/fontkit";
import { PDFFont, PDFDocument, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { resolveWorkspacePath } from "./storage-paths";

export interface PdfSummaryItem {
  label: string;
  value: string;
}

export interface PdfTableDefinition {
  headers: string[];
  rows: string[][];
  columnWidths?: number[];
  fontSize?: number;
}

export type PdfSectionBlock =
  | { type: "paragraph"; text: string; size?: number }
  | { type: "bullets"; items: string[] }
  | { type: "key-values"; items: PdfSummaryItem[]; columns?: 1 | 2 }
  | { type: "table"; table: PdfTableDefinition }
  | { type: "spacer"; height?: number };

export interface PdfSectionDefinition {
  title: string;
  subtitle?: string;
  blocks: PdfSectionBlock[];
}

export interface PdfDocumentDefinition {
  title: string;
  subtitle?: string;
  headerRight?: string;
  generatedAt?: string;
  coverSummary?: PdfSummaryItem[];
  sections: PdfSectionDefinition[];
}

interface LoadedFont {
  font: PDFFont;
  supportsUnicode: boolean;
}

interface PdfRenderState {
  document: PDFDocument;
  font: PDFFont;
  supportsUnicode: boolean;
  page: PDFPage;
  pages: PDFPage[];
  cursorY: number;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const PAGE_SIZE: [number, number] = [PAGE_WIDTH, PAGE_HEIGHT];
const MARGIN_X = 40;
const HEADER_TOP = PAGE_HEIGHT - 34;
const CONTENT_TOP = PAGE_HEIGHT - 92;
const CONTENT_BOTTOM = 70;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const FOOTER_Y = 36;

@Injectable()
export class PdfService {
  async createReportPdf(definition: PdfDocumentDefinition): Promise<Buffer> {
    const document = await PDFDocument.create();
    document.registerFontkit(fontkit);

    const { font, supportsUnicode } = await this.loadFont(document);
    const state = this.initState(document, font, supportsUnicode);
    const exportedAt = definition.generatedAt ?? this.formatExportTime();

    this.drawHeader(state.page, definition, state.font, state.supportsUnicode);
    this.drawCover(state, definition);

    definition.sections.forEach((section) => this.drawSection(state, definition, section));
    this.drawFooters(state, exportedAt);

    const bytes = await document.save();
    return Buffer.from(bytes);
  }

  private initState(document: PDFDocument, font: PDFFont, supportsUnicode: boolean): PdfRenderState {
    const firstPage = document.addPage(PAGE_SIZE);
    return {
      document,
      font,
      supportsUnicode,
      page: firstPage,
      pages: [firstPage],
      cursorY: CONTENT_TOP
    };
  }

  private drawCover(state: PdfRenderState, definition: PdfDocumentDefinition): void {
    const subtitle = definition.subtitle?.trim() || "导出汇报材料";
    const coverSummary = definition.coverSummary?.slice(0, 8) ?? [];
    const columns = 2;
    const columnGap = 10;
    const cellWidth = (CONTENT_WIDTH - 36 - columnGap) / columns;
    const summaryRowHeights: number[] = [];

    for (let index = 0; index < coverSummary.length; index += columns) {
      const row = coverSummary.slice(index, index + columns);
      const rowHeight = Math.max(
        ...row.map((item) => {
          const valueLines = this.wrapText(item.value, cellWidth - 16, state.font, 10, state.supportsUnicode);
          return 28 + valueLines.length * 12;
        })
      );
      summaryRowHeights.push(rowHeight);
    }

    const summaryHeight = summaryRowHeights.reduce((sum, item) => sum + item, 0) + Math.max(0, summaryRowHeights.length - 1) * 8;
    const cardHeight = coverSummary.length ? Math.max(170, 92 + summaryHeight) : 124;
    this.ensureSpace(state, cardHeight, definition);

    const cardTop = state.cursorY;
    const cardBottom = cardTop - cardHeight;
    state.page.drawRectangle({
      x: MARGIN_X,
      y: cardBottom,
      width: CONTENT_WIDTH,
      height: cardHeight,
      color: rgb(0.95, 0.97, 1),
      borderColor: rgb(0.82, 0.88, 0.97),
      borderWidth: 1
    });

    this.drawText(state, definition.title, MARGIN_X + 18, cardTop - 34, 21, rgb(0.09, 0.22, 0.47));
    this.drawText(state, subtitle, MARGIN_X + 18, cardTop - 56, 11, rgb(0.27, 0.37, 0.53));

    if (coverSummary.length) {
      const items = coverSummary;
      let currentY = cardTop - 82;

      for (let index = 0; index < items.length; index += columns) {
        const row = items.slice(index, index + columns);
        const rowHeight = summaryRowHeights[index / columns] ?? 40;
        const rowLines = row.map((item) => {
          const valueLines = this.wrapText(item.value, cellWidth - 16, state.font, 10, state.supportsUnicode);
          return valueLines;
        });

        row.forEach((item, rowIndex) => {
          const x = MARGIN_X + 18 + rowIndex * (cellWidth + columnGap);
          const y = currentY - rowHeight;
          state.page.drawRectangle({
            x,
            y,
            width: cellWidth,
            height: rowHeight,
            color: rgb(0.99, 0.995, 1),
            borderColor: rgb(0.84, 0.9, 0.97),
            borderWidth: 1
          });
          this.drawText(state, item.label, x + 8, currentY - 14, 9, rgb(0.42, 0.51, 0.64));
          rowLines[rowIndex].forEach((line, lineIndex) => {
            this.drawText(state, line, x + 8, currentY - 30 - lineIndex * 12, 10, rgb(0.12, 0.19, 0.3));
          });
        });

        currentY -= rowHeight + 8;
      }
    }

    state.cursorY = cardBottom - 20;
  }

  private drawSection(
    state: PdfRenderState,
    definition: PdfDocumentDefinition,
    section: PdfSectionDefinition
  ): void {
    this.ensureSpace(state, 44, definition);
    state.page.drawRectangle({
      x: MARGIN_X,
      y: state.cursorY - 28,
      width: CONTENT_WIDTH,
      height: 28,
      color: rgb(0.93, 0.96, 1),
      borderColor: rgb(0.84, 0.9, 0.97),
      borderWidth: 1
    });
    this.drawText(state, section.title, MARGIN_X + 10, state.cursorY - 18, 12, rgb(0.1, 0.26, 0.58));
    state.cursorY -= 42;

    if (section.subtitle?.trim()) {
      this.drawParagraph(state, definition, section.subtitle, 10, rgb(0.36, 0.46, 0.6));
    }

    section.blocks.forEach((block) => {
      switch (block.type) {
        case "paragraph":
          this.drawParagraph(state, definition, block.text, block.size ?? 11, rgb(0.14, 0.2, 0.3));
          break;
        case "bullets":
          this.drawBullets(state, definition, block.items);
          break;
        case "key-values":
          this.drawKeyValues(state, definition, block.items, block.columns ?? 2);
          break;
        case "table":
          this.drawTable(state, definition, block.table);
          break;
        case "spacer":
          this.ensureSpace(state, block.height ?? 10, definition);
          state.cursorY -= block.height ?? 10;
          break;
        default:
          break;
      }
    });

    state.cursorY -= 12;
  }

  private drawParagraph(
    state: PdfRenderState,
    definition: PdfDocumentDefinition,
    text: string,
    size: number,
    color = rgb(0.14, 0.2, 0.3)
  ): void {
    const lines = this.wrapText(text, CONTENT_WIDTH, state.font, size, state.supportsUnicode);
    const lineHeight = size + 6;
    lines.forEach((line) => {
      this.ensureSpace(state, lineHeight, definition);
      this.drawText(state, line, MARGIN_X, state.cursorY, size, color);
      state.cursorY -= lineHeight;
    });
    state.cursorY -= 7;
  }

  private drawBullets(state: PdfRenderState, definition: PdfDocumentDefinition, items: string[]): void {
    if (!items.length) {
      this.drawParagraph(state, definition, "无。", 11);
      return;
    }

    items.forEach((item) => {
      const bulletWidth = 14;
      const textWidth = CONTENT_WIDTH - bulletWidth;
      const lines = this.wrapText(item, textWidth, state.font, 10, state.supportsUnicode);
      const rowHeight = lines.length * 15 + 4;
      this.ensureSpace(state, rowHeight, definition);
      this.drawText(state, "•", MARGIN_X, state.cursorY, 11, rgb(0.16, 0.31, 0.61));
      lines.forEach((line, index) => {
        this.drawText(state, line, MARGIN_X + bulletWidth, state.cursorY - index * 15, 10, rgb(0.14, 0.2, 0.3));
      });
      state.cursorY -= rowHeight;
    });
    state.cursorY -= 8;
  }

  private drawKeyValues(
    state: PdfRenderState,
    definition: PdfDocumentDefinition,
    items: PdfSummaryItem[],
    columns: 1 | 2
  ): void {
    if (!items.length) {
      return;
    }

    const safeColumns = columns === 1 ? 1 : 2;
    const gap = 10;
    const cellWidth = safeColumns === 1 ? CONTENT_WIDTH : (CONTENT_WIDTH - gap) / 2;

    for (let index = 0; index < items.length; index += safeColumns) {
      const row = items.slice(index, index + safeColumns);
      let rowHeight = 0;
      const wrappedValues = row.map((item) => {
        const lines = this.wrapText(item.value, cellWidth - 16, state.font, 10, state.supportsUnicode);
        rowHeight = Math.max(rowHeight, 34 + lines.length * 13);
        return lines;
      });

      this.ensureSpace(state, rowHeight + 10, definition);
      row.forEach((item, rowIndex) => {
        const x = MARGIN_X + rowIndex * (cellWidth + gap);
        const y = state.cursorY - rowHeight;
        state.page.drawRectangle({
          x,
          y,
          width: cellWidth,
          height: rowHeight,
          color: rgb(0.985, 0.992, 1),
          borderColor: rgb(0.86, 0.91, 0.97),
          borderWidth: 1
        });
        this.drawText(state, item.label, x + 8, state.cursorY - 15, 9, rgb(0.42, 0.51, 0.64));
        wrappedValues[rowIndex].forEach((line, lineIndex) => {
          this.drawText(state, line, x + 8, state.cursorY - 33 - lineIndex * 13, 10, rgb(0.12, 0.19, 0.3));
        });
      });
      state.cursorY -= rowHeight + 10;
    }
    state.cursorY -= 3;
  }

  private drawTable(state: PdfRenderState, definition: PdfDocumentDefinition, table: PdfTableDefinition): void {
    const columnCount = table.headers.length;
    if (!columnCount) {
      return;
    }

    const fontSize = table.fontSize ?? 9;
    const widths = this.resolveTableWidths(table, CONTENT_WIDTH);
    const drawRow = (cells: string[], header: boolean): number => {
      const wrapped = cells.map((cell, index) =>
        this.wrapText(cell, widths[index] - 8, state.font, fontSize, state.supportsUnicode)
      );
      const rowHeight = Math.max(...wrapped.map((item) => item.length * (fontSize + 4))) + 10;
      this.ensureSpace(state, rowHeight, definition);

      let cursorX = MARGIN_X;
      wrapped.forEach((lines, index) => {
        state.page.drawRectangle({
          x: cursorX,
          y: state.cursorY - rowHeight,
          width: widths[index],
          height: rowHeight,
          color: header ? rgb(0.92, 0.96, 1) : rgb(1, 1, 1),
          borderColor: rgb(0.84, 0.9, 0.97),
          borderWidth: 1
        });

        lines.forEach((line, lineIndex) => {
          this.drawText(
            state,
            line,
            cursorX + 4,
            state.cursorY - 14 - lineIndex * (fontSize + 4),
            fontSize,
            header ? rgb(0.12, 0.27, 0.57) : rgb(0.15, 0.2, 0.3)
          );
        });
        cursorX += widths[index];
      });
      state.cursorY -= rowHeight;
      return rowHeight;
    };

    const headerHeight = drawRow(table.headers, true);
    table.rows.forEach((row) => {
      const normalized = row.length === columnCount ? row : [...row, ...Array(columnCount - row.length).fill("")];
      const wrapped = normalized.map((cell, index) =>
        this.wrapText(cell, widths[index] - 8, state.font, fontSize, state.supportsUnicode)
      );
      const rowHeight = Math.max(...wrapped.map((item) => item.length * (fontSize + 4))) + 10;
      const pageBreak = this.ensureSpace(state, rowHeight, definition);
      if (pageBreak) {
        this.ensureSpace(state, headerHeight, definition);
        drawRow(table.headers, true);
      }
      drawRow(normalized, false);
    });

    state.cursorY -= 12;
  }

  private resolveTableWidths(table: PdfTableDefinition, fullWidth: number): number[] {
    const columns = table.headers.length;
    if (!table.columnWidths || table.columnWidths.length !== columns) {
      return Array.from({ length: columns }, () => fullWidth / columns);
    }

    const total = table.columnWidths.reduce((sum, item) => sum + item, 0);
    if (total <= 0) {
      return Array.from({ length: columns }, () => fullWidth / columns);
    }

    return table.columnWidths.map((item) => (item / total) * fullWidth);
  }

  private ensureSpace(
    state: PdfRenderState,
    requiredHeight: number,
    definition: Pick<PdfDocumentDefinition, "title" | "headerRight">
  ): boolean {
    if (state.cursorY - requiredHeight >= CONTENT_BOTTOM) {
      return false;
    }

    const page = state.document.addPage(PAGE_SIZE);
    state.page = page;
    state.pages.push(page);
    state.cursorY = CONTENT_TOP;
    this.drawHeader(page, definition, state.font, state.supportsUnicode);
    return true;
  }

  private drawHeader(
    page: PDFPage,
    definition: Pick<PdfDocumentDefinition, "title" | "headerRight">,
    font: PDFFont,
    supportsUnicode: boolean
  ): void {
    page.drawRectangle({
      x: 0,
      y: PAGE_HEIGHT - 56,
      width: PAGE_WIDTH,
      height: 56,
      color: rgb(0.96, 0.98, 1)
    });
    page.drawLine({
      start: { x: MARGIN_X, y: PAGE_HEIGHT - 56 },
      end: { x: PAGE_WIDTH - MARGIN_X, y: PAGE_HEIGHT - 56 },
      thickness: 1,
      color: rgb(0.84, 0.9, 0.97)
    });

    const leftLabel = this.toPdfSafeText("工程立项审批平台", supportsUnicode);
    page.drawText(leftLabel, {
      x: MARGIN_X,
      y: HEADER_TOP,
      size: 11,
      font,
      color: rgb(0.12, 0.27, 0.57)
    });

    const rightSource = definition.headerRight?.trim() || definition.title;
    const rightLabel = this.fitText(rightSource, 220, font, 9, supportsUnicode);
    const rightWidth = font.widthOfTextAtSize(rightLabel, 9);
    page.drawText(rightLabel, {
      x: PAGE_WIDTH - MARGIN_X - rightWidth,
      y: HEADER_TOP + 1,
      size: 9,
      font,
      color: rgb(0.35, 0.45, 0.6)
    });
  }

  private drawFooters(state: PdfRenderState, exportedAt: string): void {
    state.pages.forEach((page, index) => {
      page.drawLine({
        start: { x: MARGIN_X, y: FOOTER_Y + 14 },
        end: { x: PAGE_WIDTH - MARGIN_X, y: FOOTER_Y + 14 },
        thickness: 1,
        color: rgb(0.87, 0.92, 0.98)
      });
      page.drawText(this.toPdfSafeText(`导出时间：${exportedAt}`, state.supportsUnicode), {
        x: MARGIN_X,
        y: FOOTER_Y,
        size: 8,
        font: state.font,
        color: rgb(0.45, 0.53, 0.65)
      });
      const pageLabel = this.toPdfSafeText(`第 ${index + 1} / ${state.pages.length} 页`, state.supportsUnicode);
      const width = state.font.widthOfTextAtSize(pageLabel, 8);
      page.drawText(pageLabel, {
        x: PAGE_WIDTH - MARGIN_X - width,
        y: FOOTER_Y,
        size: 8,
        font: state.font,
        color: rgb(0.45, 0.53, 0.65)
      });
    });
  }

  private drawText(
    state: PdfRenderState,
    text: string,
    x: number,
    y: number,
    size: number,
    color = rgb(0.14, 0.2, 0.3)
  ): void {
    state.page.drawText(this.toPdfSafeText(text, state.supportsUnicode), {
      x,
      y,
      size,
      font: state.font,
      color
    });
  }

  private fitText(
    text: string,
    maxWidth: number,
    font: PDFFont,
    size: number,
    supportsUnicode: boolean
  ): string {
    const safeText = this.toPdfSafeText(text, supportsUnicode);
    if (font.widthOfTextAtSize(safeText, size) <= maxWidth) {
      return safeText;
    }

    let output = "";
    for (const char of safeText) {
      const candidate = `${output}${char}`;
      if (font.widthOfTextAtSize(`${candidate}…`, size) > maxWidth) {
        return `${output}…`;
      }
      output = candidate;
    }
    return output;
  }

  private wrapText(
    text: string,
    maxWidth: number,
    font: PDFFont,
    size: number,
    supportsUnicode: boolean
  ): string[] {
    const safeText = this.toPdfSafeText(text, supportsUnicode);
    const paragraphs = safeText.split(/\r?\n/);
    const output: string[] = [];

    paragraphs.forEach((paragraph) => {
      const source = paragraph.trimEnd();
      if (!source) {
        output.push("");
        return;
      }

      let current = "";
      for (const char of source) {
        const candidate = `${current}${char}`;
        if (!current || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
          current = candidate;
          continue;
        }
        output.push(current);
        current = char;
      }

      if (current) {
        output.push(current);
      }
    });

    return output.length ? output : [""];
  }

  private formatExportTime(): string {
    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Shanghai",
      hour12: false
    }).format(new Date());
  }

  private async loadFont(document: PDFDocument): Promise<LoadedFont> {
    const configuredPath = process.env.PDF_FONT_PATH?.trim();
    const candidates = [
      configuredPath
        ? (path.isAbsolute(configuredPath) ? configuredPath : resolveWorkspacePath(configuredPath))
        : null,
      resolveWorkspacePath("apps", "api", "assets", "fonts", "NotoSansSC-Regular.otf"),
      "C:\\Windows\\Fonts\\msyh.ttf",
      "C:\\Windows\\Fonts\\simhei.ttf",
      "C:\\Windows\\Fonts\\simsun.ttc",
      "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
      "/usr/share/fonts/opentype/noto/NotoSansSC-Regular.otf",
      "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
      "/System/Library/Fonts/PingFang.ttc"
    ].filter((item): item is string => Boolean(item));

    for (const fontPath of candidates) {
      try {
        const bytes = await readFile(fontPath);
        return {
          font: await document.embedFont(bytes, { subset: true }),
          supportsUnicode: true
        };
      } catch {
        continue;
      }
    }

    return {
      font: await document.embedFont(StandardFonts.Helvetica),
      supportsUnicode: false
    };
  }

  private toPdfSafeText(text: string, supportsUnicode: boolean): string {
    if (supportsUnicode) {
      return text;
    }

    return text.replace(/[^\x20-\x7E]/g, "?");
  }
}
