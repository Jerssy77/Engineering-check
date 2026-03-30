import { Injectable } from "@nestjs/common";
import fontkit from "@pdf-lib/fontkit";
import { PDFFont, PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { resolveWorkspacePath } from "./storage-paths";

interface LoadedFont {
  font: PDFFont;
  supportsUnicode: boolean;
}

@Injectable()
export class PdfService {
  async createReportPdf(title: string, lines: string[]): Promise<Buffer> {
    const document = await PDFDocument.create();
    document.registerFontkit(fontkit);

    const { font, supportsUnicode } = await this.loadFont(document);
    const pageSize: [number, number] = [595.28, 841.89];
    let page = document.addPage(pageSize);
    let cursorY = 790;

    const drawLine = (text: string, size = 11): void => {
      const segments = this.wrapText(text, 38);
      for (const segment of segments) {
        if (cursorY < 70) {
          page = document.addPage(pageSize);
          cursorY = 790;
        }
        page.drawText(this.toPdfSafeText(segment, supportsUnicode), {
          x: 48,
          y: cursorY,
          size,
          font,
          color: rgb(0.15, 0.18, 0.23)
        });
        cursorY -= size + 8;
      }
    };

    drawLine(title, 18);
    cursorY -= 6;
    lines.forEach((line) => drawLine(line));

    const bytes = await document.save();
    return Buffer.from(bytes);
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

  private wrapText(text: string, maxChars: number): string[] {
    const output: string[] = [];
    let buffer = "";

    for (const character of text) {
      buffer += character;
      if (buffer.length >= maxChars) {
        output.push(buffer);
        buffer = "";
      }
    }

    if (buffer) {
      output.push(buffer);
    }

    return output.length ? output : [""];
  }

  private toPdfSafeText(text: string, supportsUnicode: boolean): string {
    if (supportsUnicode) {
      return text;
    }

    return text.replace(/[^\x20-\x7E]/g, "?");
  }
}
