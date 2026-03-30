import { Injectable } from "@nestjs/common";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";

@Injectable()
export class PdfService {
  async createReportPdf(title: string, lines: string[]): Promise<Buffer> {
    const document = await PDFDocument.create();
    document.registerFontkit(fontkit);

    const font = await this.loadFont(document);
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
        page.drawText(segment, {
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

  private async loadFont(document: PDFDocument) {
    const candidates = [
      "C:\\Windows\\Fonts\\msyh.ttf",
      "C:\\Windows\\Fonts\\simhei.ttf",
      "C:\\Windows\\Fonts\\simsun.ttc"
    ];

    for (const fontPath of candidates) {
      try {
        const bytes = await readFile(fontPath);
        return document.embedFont(bytes, { subset: true });
      } catch {
        continue;
      }
    }

    return document.embedFont(StandardFonts.Helvetica);
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
}
