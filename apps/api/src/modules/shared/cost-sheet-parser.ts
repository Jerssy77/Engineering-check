import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import {
  CostSheetParsedRow,
  CostSheetRowType,
  CostSheetSection,
  UploadedCostSheetSnapshot,
  roundMoney
} from "@property-review/shared";

interface CostSheetAttachmentMeta {
  attachmentId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

interface ParsedRowDraft extends CostSheetParsedRow {
  rowText: string;
}

interface AmountCandidate {
  value: number;
  address: string;
  column: number;
}

const SECTION_TITLE_PATTERN = /^[一二三四五六七八九十]+[、.．]/;
const SUMMARY_PATTERN = /(合计|总计|小计|汇总|费用合计|含税)/;
const TAX_PATTERN = /(税金|税费|税率|增值税)/;
const NOTE_PATTERN = /^(备注|说明|注[:：]?)/;
const HEADER_PATTERN = /(序号).*(项目|名称|工程量|单位|合价|金额)|((项目|名称).*(工程量|单位).*(合价|金额))/;
const UNIT_PATTERN = /^(项|个|台|套|樘|扇|米|m|㎡|m2|平方米|点|处|组|批|天|工日|次|宗)$/i;

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.result === "string" || typeof record.result === "number") {
      return normalizeText(record.result);
    }
    if (Array.isArray(record.richText)) {
      return record.richText
        .map((item) => (typeof item?.text === "string" ? item.text : ""))
        .join("")
        .trim();
    }
    if (typeof record.text === "string") return record.text.trim();
    if (typeof record.hyperlink === "string" && typeof record.text === "string") return record.text.trim();
  }
  return "";
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (record.result !== undefined) return normalizeNumber(record.result);
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || /%$/.test(trimmed)) return undefined;
  const normalized = trimmed.replace(/[￥¥,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cellRawValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value as unknown;
  if (value && typeof value === "object" && "result" in (value as Record<string, unknown>)) {
    return (value as Record<string, unknown>).result;
  }
  return value;
}

function cellText(cell: ExcelJS.Cell): string {
  if (normalizeText(cellRawValue(cell))) return normalizeText(cellRawValue(cell));
  try {
    return normalizeText(cell.text);
  } catch {
    return "";
  }
}

function cellNumber(cell: ExcelJS.Cell): number | undefined {
  try {
    return normalizeNumber(cellRawValue(cell)) ?? normalizeNumber(cell.text);
  } catch {
    return normalizeNumber(cellRawValue(cell));
  }
}

function parseCsvRows(buffer: Uint8Array): string[][] {
  const content = Buffer.from(buffer).toString("utf8").replace(/^\uFEFF/, "");
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const cells: string[] = [];
      let current = "";
      let quoted = false;
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        const next = line[index + 1];
        if (char === '"' && quoted && next === '"') {
          current += '"';
          index += 1;
          continue;
        }
        if (char === '"') {
          quoted = !quoted;
          continue;
        }
        if (char === "," && !quoted) {
          cells.push(current.trim());
          current = "";
          continue;
        }
        current += char;
      }
      cells.push(current.trim());
      return cells;
    });
}

function addCsvWorksheet(workbook: ExcelJS.Workbook, buffer: Uint8Array): void {
  const worksheet = workbook.addWorksheet("CSV清单");
  parseCsvRows(buffer).forEach((row) => worksheet.addRow(row));
}

function addSheetJsWorksheets(workbook: ExcelJS.Workbook, buffer: Uint8Array): void {
  const parsedWorkbook = XLSX.read(Buffer.from(buffer), { type: "buffer", cellDates: false });
  parsedWorkbook.SheetNames.forEach((sheetName) => {
    const sourceSheet = parsedWorkbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean | Date | null>>(sourceSheet, {
      header: 1,
      defval: "",
      raw: false
    });
    const worksheet = workbook.addWorksheet(sheetName || `工作表${workbook.worksheets.length + 1}`);
    rows.forEach((row) => worksheet.addRow(row));
  });
}

function getRowCells(row: ExcelJS.Row): Array<{ cell: ExcelJS.Cell; text: string; number?: number; column: number }> {
  const cells: Array<{ cell: ExcelJS.Cell; text: string; number?: number; column: number }> = [];
  row.eachCell({ includeEmpty: false }, (cell, column) => {
    const text = cellText(cell);
    const number = cellNumber(cell);
    if (text || number !== undefined) {
      cells.push({ cell, text, number, column });
    }
  });
  return cells;
}

function getAmountCandidates(
  cells: Array<{ cell: ExcelJS.Cell; text: string; number?: number; column: number }>
): AmountCandidate[] {
  return cells
    .filter((item) => item.number !== undefined && Math.abs(item.number) > 0)
    .map((item) => ({ value: Number(item.number), address: item.cell.address, column: item.column }));
}

function compactRowTexts(cells: Array<{ text: string }>): string[] {
  const texts: string[] = [];
  cells.forEach((item) => {
    const text = item.text.trim();
    if (text && texts[texts.length - 1] !== text && !texts.includes(text)) {
      texts.push(text);
    }
  });
  return texts;
}

function pickLineTotal(candidates: AmountCandidate[]): AmountCandidate | undefined {
  if (!candidates.length) return undefined;
  return [...candidates].sort((left, right) => right.column - left.column)[0];
}

function pickLargestAmount(candidates: AmountCandidate[]): AmountCandidate | undefined {
  if (!candidates.length) return undefined;
  return [...candidates].sort((left, right) => Math.abs(right.value) - Math.abs(left.value))[0];
}

function pickQuantity(candidates: AmountCandidate[], lineTotal?: AmountCandidate): number | undefined {
  const eligible = candidates.filter(
    (item) =>
      item.address !== lineTotal?.address &&
      !(item.column <= 2 && Number.isInteger(item.value) && item.value > 0 && item.value < 1000)
  );
  const smallPositive = eligible.find((item) => item.value > 0 && item.value <= 100000);
  return smallPositive ? roundMoney(smallPositive.value) : undefined;
}

function pickUnitPrice(candidates: AmountCandidate[], quantity?: number, lineTotal?: AmountCandidate): number | undefined {
  if (quantity && lineTotal?.value) return roundMoney(lineTotal.value / quantity);
  const eligible = candidates.filter(
    (item) =>
      item.address !== lineTotal?.address &&
      !(item.column <= 2 && Number.isInteger(item.value) && item.value > 0 && item.value < 1000)
  );
  const last = eligible.sort((left, right) => right.column - left.column)[0];
  return last ? roundMoney(last.value) : undefined;
}

function pickUnit(texts: string[]): string | undefined {
  return texts.find((item) => UNIT_PATTERN.test(item));
}

function pickItemName(texts: string[]): string {
  const withoutSeq = texts.filter((item) => !/^\d+(\.\d+)?$/.test(item) && !UNIT_PATTERN.test(item));
  return withoutSeq[0] ?? "未命名清单项";
}

function pickSpecification(texts: string[], itemName: string, unit?: string): string | undefined {
  return texts.find((item) => item !== itemName && item !== unit && !/^\d+(\.\d+)?$/.test(item));
}

function findSectionTitle(texts: string[], amountCandidates: AmountCandidate[]): string | undefined {
  if (amountCandidates.length > 0) return undefined;
  return texts.find((text) => SECTION_TITLE_PATTERN.test(text));
}

function classifyRow(rowText: string, cells: Array<{ text: string; number?: number }>, amountCandidates: AmountCandidate[]): CostSheetRowType | undefined {
  if (!rowText) return undefined;
  if (NOTE_PATTERN.test(rowText)) return "note";
  if (HEADER_PATTERN.test(rowText)) return undefined;
  const firstText = cells.find((item) => item.text)?.text ?? "";
  if (/^\d+(\.\d+)?$/.test(firstText) && amountCandidates.length > 0) return "detail";
  if (SUMMARY_PATTERN.test(rowText)) return "summary";
  if (TAX_PATTERN.test(rowText)) return "tax";
  if (amountCandidates.length >= 2 && cells.some((item) => item.text && !/^\d+(\.\d+)?$/.test(item.text))) {
    return "detail";
  }
  return undefined;
}

function buildSourceCells(cells: Array<{ cell: ExcelJS.Cell; text: string }>): Record<string, string> {
  return Object.fromEntries(cells.map((item) => [item.cell.address, item.text]).filter(([, text]) => text));
}

function finalizeSections(sections: CostSheetSection[], lastRow: number): CostSheetSection[] {
  return sections.map((section) => ({
    ...section,
    endRow: section.endRow ?? lastRow,
    subtotal: section.subtotal === undefined ? undefined : roundMoney(section.subtotal),
    tax: section.tax === undefined ? undefined : roundMoney(section.tax),
    total: section.total === undefined ? undefined : roundMoney(section.total)
  }));
}

export async function parseCostSheet(
  buffer: Uint8Array,
  meta: CostSheetAttachmentMeta
): Promise<UploadedCostSheetSnapshot> {
  const warnings: string[] = [];
  const workbook = new ExcelJS.Workbook();
  const extension = meta.fileName.toLowerCase().split(".").pop() ?? "";

  try {
    if (extension === "csv") {
      addCsvWorksheet(workbook, buffer);
    } else if (extension === "xls") {
      addSheetJsWorksheets(workbook, buffer);
    } else if (extension === "xlsx") {
      await workbook.xlsx.load(Buffer.from(buffer) as any);
    } else {
      warnings.push("仅支持 .xlsx、.xls、.csv 格式的工程量清单。");
    }
  } catch (error) {
    warnings.push(`Excel 解析失败：${error instanceof Error ? error.message : "未知错误"}`);
  }

  const rows: ParsedRowDraft[] = [];
  const notes: string[] = [];
  const sections: CostSheetSection[] = [];
  const totalCandidates: Array<{
    amount: number;
    label: string;
    cell: string;
    sheetName: string;
    rowNumber: number;
    score: number;
  }> = [];

  for (const worksheet of workbook.worksheets) {
    let currentSection: CostSheetSection | undefined;
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells = getRowCells(row);
      const compactTexts = compactRowTexts(cells);
      const rowText = compactTexts.join(" ");
      const amountCandidates = getAmountCandidates(cells);

      cells.forEach(({ cell }) => {
        const value = cell.value as Record<string, unknown> | null;
        if (value && typeof value === "object" && "formula" in value && !("result" in value)) {
          warnings.push(`${worksheet.name}!${cell.address} 公式缺少缓存结果，未参与总价识别。`);
        }
      });

      const sectionTitle = findSectionTitle(compactTexts, amountCandidates);
      if (sectionTitle) {
        if (currentSection?.name === sectionTitle) return;
        if (currentSection) currentSection.endRow = rowNumber - 1;
        currentSection = {
          id: `${worksheet.id}-${rowNumber}`,
          sheetName: worksheet.name,
          name: sectionTitle,
          startRow: rowNumber
        };
        sections.push(currentSection);
        return;
      }

      const rowType = classifyRow(rowText, cells, amountCandidates);
      if (!rowType) return;

      const lineTotal = rowType === "summary" || rowType === "tax" ? pickLargestAmount(amountCandidates) : pickLineTotal(amountCandidates);
      const texts = compactTexts;
      const unit = pickUnit(texts);
      const itemName = rowType === "detail" ? pickItemName(texts) : rowText;
      const quantity = rowType === "detail" ? pickQuantity(amountCandidates, lineTotal) : undefined;
      const unitPrice = rowType === "detail" ? pickUnitPrice(amountCandidates, quantity, lineTotal) : undefined;
      const specification = rowType === "detail" ? pickSpecification(texts, itemName, unit) : undefined;

      if (rowType === "note") {
        notes.push(rowText);
      }

      if (currentSection && lineTotal?.value !== undefined) {
        if (rowType === "tax") currentSection.tax = lineTotal.value;
        const shouldSetSubtotal =
          rowType === "summary" && !/(含税|增值税|税率)/.test(rowText) && currentSection.subtotal === undefined;
        if (shouldSetSubtotal) {
          currentSection.subtotal = lineTotal.value;
        }
        if (
          rowType === "summary" &&
          !shouldSetSubtotal &&
          currentSection.total === undefined &&
          (/(含税|增值税|税率)/.test(rowText) || currentSection.subtotal !== undefined)
        ) {
          currentSection.total = lineTotal.value;
        }
        if (rowType === "detail") currentSection.endRow = rowNumber;
      }

      if (rowType === "summary" && lineTotal) {
        const labelScore = /总计|含税合计|合计/.test(rowText) ? 1000 : 0;
        totalCandidates.push({
          amount: lineTotal.value,
          label: rowText,
          cell: lineTotal.address,
          sheetName: worksheet.name,
          rowNumber,
          score: labelScore + rowNumber
        });
      }

      rows.push({
        id: `${worksheet.id}-${rowNumber}`,
        sheetName: worksheet.name,
        rowNumber,
        sectionName: currentSection?.name,
        rowType,
        itemName,
        specification,
        unit,
        quantity,
        unitPrice,
        lineTotal: lineTotal ? roundMoney(lineTotal.value) : undefined,
        remark: rowType === "detail" ? texts.slice(3).join("；") || undefined : undefined,
        sourceCells: buildSourceCells(cells),
        rowText
      });
    });

    if (currentSection) currentSection.endRow = worksheet.rowCount;
  }

  const bestTotal = totalCandidates.sort((left, right) => right.score - left.score)[0];
  const finalTotal = bestTotal ? roundMoney(bestTotal.amount) : undefined;
  const preTaxCandidate = rows
    .filter((item) => item.rowType === "summary" && /(不含税|税前)/.test(item.rowText) && item.lineTotal)
    .sort((left, right) => right.rowNumber - left.rowNumber)[0];
  const taxCandidate = rows
    .filter((item) => item.rowType === "tax" && item.lineTotal)
    .sort((left, right) => right.rowNumber - left.rowNumber)[0];

  if (!finalTotal) warnings.push("未识别到最终合计金额，上传模式下暂不能提交 AI 预审。");
  if (!rows.some((item) => item.rowType === "detail")) warnings.push("未识别到有效明细行，请检查清单表头和内容。");

  return {
    attachmentId: meta.attachmentId,
    fileName: meta.fileName,
    fileSize: meta.fileSize,
    mimeType: meta.mimeType,
    parsedAt: new Date().toISOString(),
    status: finalTotal ? "completed" : "failed",
    workbookSheetCount: workbook.worksheets.length,
    parsedSheetNames: workbook.worksheets.map((item) => item.name),
    totalAmount: finalTotal,
    totalLabel: bestTotal?.label,
    totalCell: bestTotal?.cell,
    totalSheetName: bestTotal?.sheetName,
    preTaxSubtotal: preTaxCandidate?.lineTotal,
    taxAndFeeTotal: taxCandidate?.lineTotal,
    detailRowCount: rows.filter((item) => item.rowType === "detail").length,
    sections: finalizeSections(sections, Math.max(...rows.map((item) => item.rowNumber), 0)),
    rows: rows.map(({ rowText: _rowText, ...item }) => item),
    notes,
    warnings: [...new Set(warnings)].slice(0, 50)
  };
}
