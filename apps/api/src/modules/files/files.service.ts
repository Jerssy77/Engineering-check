import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import ExcelJS from "exceljs";
import {
  Attachment,
  AttachmentKind,
  AttachmentSlotKey,
  FAULT_REGISTRY_TEMPLATE_HEADERS,
  SessionUser,
  buildVersionAttachmentSlots
} from "@property-review/shared";

import { DemoDataService } from "../shared/demo-data.service";
import { parseCostSheet } from "../shared/cost-sheet-parser";
import {
  ensureDirectory,
  normalizeLatin1Utf8Text,
  resolveUploadDirPath,
  sanitizeFileName
} from "../shared/storage-paths";

const DEFAULT_ATTACHMENT_MAX_SIZE_BYTES = 512 * 1024;
const DEFAULT_NON_PHOTO_ATTACHMENTS_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const COST_SHEET_MAX_SIZE_BYTES = 2 * 1024 * 1024;
const parsedAttachmentMaxSize = Number(process.env.ATTACHMENT_MAX_SIZE_BYTES ?? DEFAULT_ATTACHMENT_MAX_SIZE_BYTES);
const parsedNonPhotoAttachmentsMaxTotal = Number(
  process.env.NON_PHOTO_ATTACHMENTS_MAX_TOTAL_BYTES ?? DEFAULT_NON_PHOTO_ATTACHMENTS_MAX_TOTAL_BYTES
);
const ATTACHMENT_MAX_SIZE_BYTES =
  Number.isFinite(parsedAttachmentMaxSize) && parsedAttachmentMaxSize > 0
    ? parsedAttachmentMaxSize
    : DEFAULT_ATTACHMENT_MAX_SIZE_BYTES;
const NON_PHOTO_ATTACHMENTS_MAX_TOTAL_BYTES =
  Number.isFinite(parsedNonPhotoAttachmentsMaxTotal) && parsedNonPhotoAttachmentsMaxTotal > 0
    ? parsedNonPhotoAttachmentsMaxTotal
    : DEFAULT_NON_PHOTO_ATTACHMENTS_MAX_TOTAL_BYTES;

function formatAttachmentSizeLimit(bytes: number): string {
  const sizeInMb = bytes / (1024 * 1024);
  return Number.isInteger(sizeInMb) ? `${sizeInMb} MB` : `${sizeInMb.toFixed(1)} MB`;
}

function resolveAttachmentKind(mimeType: string): AttachmentKind {
  if (mimeType.includes("pdf")) return "pdf";
  if (mimeType.includes("word") || mimeType.includes("officedocument.wordprocessingml")) return "word";
  if (mimeType.includes("image")) return "image";
  if (mimeType.includes("csv")) return "spreadsheet";
  if (mimeType.includes("sheet") || mimeType.includes("excel") || mimeType.includes("spreadsheet")) return "spreadsheet";
  return "other";
}

function readUploadedFile(file: Express.Multer.File): Buffer {
  if (file.buffer?.length) {
    return file.buffer;
  }
  if ("path" in file && typeof file.path === "string" && file.path) {
    return readFileSync(file.path);
  }
  throw new BadRequestException(`无法读取上传文件内容：${file.originalname}`);
}

@Injectable()
export class FilesService {
  constructor(@Inject(DemoDataService) private readonly data: DemoDataService) {}

  async getFaultRegistryTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "工程立项审批平台";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("故障点位台账", {
      views: [{ state: "frozen", ySplit: 4 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    });
    sheet.properties.defaultRowHeight = 22;
    sheet.columns = [
      { key: "project", width: 18 },
      { key: "building", width: 12 },
      { key: "floor", width: 10 },
      { key: "area", width: 18 },
      { key: "equipment", width: 22 },
      { key: "issue", width: 32 },
      { key: "impact", width: 28 },
      { key: "foundAt", width: 14 },
      { key: "status", width: 12 },
      { key: "temporary", width: 28 },
      { key: "photoNo", width: 16 }
    ];

    sheet.mergeCells("A1:K1");
    sheet.getCell("A1").value = "工程立项故障点位台账";
    sheet.getCell("A1").font = { bold: true, size: 18, color: { argb: "FF0F3A6B" } };
    sheet.getCell("A1").alignment = { vertical: "middle" };
    sheet.getRow(1).height = 34;

    sheet.mergeCells("A2:K2");
    sheet.getCell("A2").value =
      "用于立项阶段说明故障/缺陷点位、影响范围和临时措施。请按一行一个点位填写，现状照片编号需与上传照片文件名或照片序号对应。";
    sheet.getCell("A2").font = { color: { argb: "FF52657A" }, size: 10 };
    sheet.getCell("A2").alignment = { wrapText: true, vertical: "middle" };
    sheet.getRow(2).height = 34;

    sheet.getRow(4).values = FAULT_REGISTRY_TEMPLATE_HEADERS;
    sheet.getRow(4).height = 30;
    sheet.getRow(4).eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF2FF" } };
      cell.font = { bold: true, color: { argb: "FF123B69" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FFBCD2EA" } },
        left: { style: "thin", color: { argb: "FFBCD2EA" } },
        bottom: { style: "thin", color: { argb: "FFBCD2EA" } },
        right: { style: "thin", color: { argb: "FFBCD2EA" } }
      };
    });

    const exampleRows = [
      [
        "示例：世纪城小区",
        "1#楼",
        "B1",
        "生活水泵房",
        "2#生活泵",
        "运行异响，泵体振动明显，夜间噪声投诉增加",
        "影响 1#楼低区生活供水稳定性",
        "2026-04-21",
        "待整改",
        "维保单位每日巡检，必要时切换备用泵",
        "照片1、照片2"
      ],
      [
        "示例：世纪城小区",
        "地下车库",
        "B2",
        "排水沟",
        "集水井 J-03",
        "井盖破损，周边地坪轻微沉降",
        "影响车库通行和排水安全",
        "2026-04-21",
        "处理中",
        "设置围挡和警示牌，雨天加强巡查",
        "照片3"
      ]
    ];

    sheet.addRows(exampleRows);
    for (let rowNumber = 5; rowNumber <= 104; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      if (rowNumber > 6) {
        row.values = new Array(FAULT_REGISTRY_TEMPLATE_HEADERS.length).fill("");
      }
      row.height = 28;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.alignment = { vertical: "middle", wrapText: true };
        cell.border = {
          top: { style: "thin", color: { argb: "FFE3ECF7" } },
          left: { style: "thin", color: { argb: "FFE3ECF7" } },
          bottom: { style: "thin", color: { argb: "FFE3ECF7" } },
          right: { style: "thin", color: { argb: "FFE3ECF7" } }
        };
        if (rowNumber % 2 === 0) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FBFF" } };
        }
      });
    }

    sheet.getColumn("H").numFmt = "yyyy-mm-dd";
    for (let rowNumber = 5; rowNumber <= 104; rowNumber += 1) {
      sheet.getCell(`I${rowNumber}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: ['"待整改,处理中,已完成,观察中,暂缓"'],
        showErrorMessage: true,
        errorTitle: "请选择状态",
        error: "请从下拉列表中选择当前状态。"
      };
      sheet.getCell(`H${rowNumber}`).dataValidation = {
        type: "date",
        operator: "between",
        allowBlank: true,
        formulae: [new Date("2020-01-01"), new Date("2035-12-31")],
        showErrorMessage: true,
        errorTitle: "日期格式不正确",
        error: "请填写有效日期，例如 2026-04-21。"
      };
    }

    sheet.autoFilter = "A4:K104";

    const guide = workbook.addWorksheet("填写说明");
    guide.columns = [
      { key: "item", width: 18 },
      { key: "description", width: 72 },
      { key: "example", width: 32 }
    ];
    guide.getRow(1).values = ["字段", "填写要求", "示例"];
    guide.getRow(1).height = 28;
    guide.getRow(1).eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F3A6B" } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    guide.addRows([
      ["楼盘/项目", "填写项目所在楼盘或管理项目名称，尽量与立项名称保持一致。", "世纪城小区"],
      ["区域/房间", "填写能让审核人定位现场的区域、系统或房间。", "B1 生活水泵房"],
      ["设备/点位", "填写具体设备、构件、井号、门岗、道路段或点位编号。", "2#生活泵"],
      ["故障/缺陷现象", "说明现场看到的问题，不要只写“损坏”。建议包含程度、频率、持续时间。", "运行异响，振动明显"],
      ["影响范围", "说明影响哪些楼栋、客户、设备系统或安全风险。", "影响低区供水稳定"],
      ["当前状态", "从下拉框选择：待整改、处理中、已完成、观察中、暂缓。", "待整改"],
      ["临时措施", "说明已采取的临时保障、围挡、巡查、切换、停用或告知措施。", "切换备用泵并每日巡检"],
      ["对应照片编号", "与上传照片文件名或照片序号对应，便于审核人快速核对。", "照片1、照片2"]
    ]);
    guide.eachRow((row, rowNumber) => {
      row.height = rowNumber === 1 ? 28 : 42;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.alignment = { vertical: "middle", wrapText: true };
        cell.border = {
          top: { style: "thin", color: { argb: "FFE3ECF7" } },
          left: { style: "thin", color: { argb: "FFE3ECF7" } },
          bottom: { style: "thin", color: { argb: "FFE3ECF7" } },
          right: { style: "thin", color: { argb: "FFE3ECF7" } }
        };
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  }

  async uploadFiles(params: {
    user: SessionUser;
    projectId: string;
    versionId: string;
    slotKey: AttachmentSlotKey;
    files: Express.Multer.File[];
  }) {
    const project = this.data.getProject(params.projectId);
    const version = this.data.getVersion(params.versionId);
    if (params.user.role === "submitter" && params.user.organizationId !== project.organizationId) {
      throw new ForbiddenException("\u4f60\u65e0\u6743\u5411\u8be5\u7acb\u9879\u4e0a\u4f20\u9644\u4ef6");
    }
    if (version.status !== "draft") {
      throw new BadRequestException("\u53ea\u6709\u8349\u7a3f\u7248\u672c\u5141\u8bb8\u4e0a\u4f20\u9644\u4ef6");
    }

    const versionAttachments = this.data.listAttachments(params.projectId, params.versionId);
    const isCostSheetUpload = params.slotKey === "cost_sheet";
    const slot = isCostSheetUpload
      ? {
          key: "cost_sheet" as const,
          label: "工程量清单 Excel",
          description: "上传正式工程量清单 Excel，由系统解析总价、分组和明细。",
          required: false,
          maxFiles: 1,
          acceptedKinds: ["spreadsheet" as const],
          status: "optional" as const,
          attachments: versionAttachments.filter((item) => item.slotKey === "cost_sheet")
        }
      : buildVersionAttachmentSlots({
      category: version.snapshot.projectCategory,
      sourceType: version.snapshot.issueSourceType,
      attachments: versionAttachments
    }).find((item) => item.key === params.slotKey);
    if (!slot) {
      throw new BadRequestException("\u4e0d\u5b58\u5728\u7684\u6750\u6599\u69fd\u4f4d");
    }
    if (isCostSheetUpload && params.files.length !== 1) {
      throw new BadRequestException("工程量清单每次只能上传 1 个 Excel 文件");
    }
    if (!isCostSheetUpload && slot.attachments.length + params.files.length > slot.maxFiles) {
      throw new BadRequestException(`${slot.label} \u6700\u591a\u4e0a\u4f20 ${slot.maxFiles} \u4e2a\u6587\u4ef6`);
    }

    if (params.slotKey !== "issue_photos" && !isCostSheetUpload) {
      const existingNonPhotoTotal = versionAttachments
        .filter((item) => item.slotKey !== "issue_photos" && item.slotKey !== "cost_sheet")
        .reduce((sum, item) => sum + item.size, 0);
      const incomingNonPhotoTotal = params.files.reduce((sum, file) => sum + file.size, 0);

      if (existingNonPhotoTotal + incomingNonPhotoTotal > NON_PHOTO_ATTACHMENTS_MAX_TOTAL_BYTES) {
        throw new BadRequestException(
          `\u9664\u95ee\u9898\u7167\u7247\u5916\uff0c\u5176\u4ed6\u9644\u4ef6\u5408\u8ba1\u4e0d\u80fd\u8d85\u8fc7 ${formatAttachmentSizeLimit(NON_PHOTO_ATTACHMENTS_MAX_TOTAL_BYTES)}`
        );
      }
    }

    const now = new Date().toISOString();
    const preparedFiles = params.files.map((file) => {
      const normalizedFileName = normalizeLatin1Utf8Text(file.originalname);
      const kind =
        isCostSheetUpload && /\.(csv|xls|xlsx)$/i.test(normalizedFileName)
          ? "spreadsheet"
          : resolveAttachmentKind(file.mimetype);
      const sizeLimit = isCostSheetUpload ? COST_SHEET_MAX_SIZE_BYTES : ATTACHMENT_MAX_SIZE_BYTES;
      if (file.size > sizeLimit) {
        throw new BadRequestException(
          `${normalizedFileName} \u8d85\u8fc7\u5355\u4e2a\u6587\u4ef6\u5927\u5c0f\u9650\u5236 ${formatAttachmentSizeLimit(sizeLimit)}`
        );
      }
      if (!slot.acceptedKinds.includes(kind)) {
        throw new BadRequestException(`${slot.label} \u4e0d\u63a5\u53d7 ${kind} \u7c7b\u578b\u6587\u4ef6`);
      }

      return { file, kind, normalizedFileName };
    });

    const createdAttachments: Attachment[] = [];
    for (const { file, kind, normalizedFileName } of preparedFiles) {
      const index = createdAttachments.length;
      const storageKey = path.join(
        params.projectId,
        `${Date.now()}-${index}-${sanitizeFileName(normalizedFileName)}`
      );
      const absolutePath = path.join(resolveUploadDirPath(), storageKey);
      ensureDirectory(path.dirname(absolutePath));
      writeFileSync(absolutePath, readUploadedFile(file));

      const attachment = this.data.createAttachment({
        projectId: params.projectId,
        versionId: params.versionId,
        slotKey: params.slotKey,
        fileName: normalizedFileName,
        mimeType: file.mimetype,
        size: file.size,
        storageKey,
        kind,
        uploadedAt: now
      });

      if (isCostSheetUpload) {
        const parsedSheet = await parseCostSheet(readUploadedFile(file), {
          attachmentId: attachment.id,
          fileName: normalizedFileName,
          fileSize: file.size,
          mimeType: file.mimetype
        });

        this.data.createParseResult({
          attachmentId: attachment.id,
          status: parsedSheet.status,
          extractedText: JSON.stringify({
            totalAmount: parsedSheet.totalAmount,
            detailRowCount: parsedSheet.detailRowCount,
            sections: parsedSheet.sections.map((section) => ({
              name: section.name,
              total: section.total,
              subtotal: section.subtotal,
              tax: section.tax
            })),
            warnings: parsedSheet.warnings
          }),
          summary:
            parsedSheet.status === "completed"
              ? `工程量清单已解析：识别总价 ${parsedSheet.totalAmount} 元，明细 ${parsedSheet.detailRowCount} 行。`
              : `工程量清单解析失败：${parsedSheet.warnings.join("；")}`,
          failureReason: parsedSheet.status === "failed" ? parsedSheet.warnings.join("；") : undefined
        });

        for (const existing of slot.attachments) {
          const removed = this.data.deleteAttachment(existing.id);
          const removedPath = path.join(resolveUploadDirPath(), removed.storageKey);
          if (existsSync(removedPath)) unlinkSync(removedPath);
        }

        this.data.updateVersion(params.versionId, (current) => ({
          ...current,
          snapshot: {
            ...current.snapshot,
            costInputMode: "upload",
            uploadedCostSheet: parsedSheet,
            budgetAmount:
              parsedSheet.status === "completed" && typeof parsedSheet.totalAmount === "number"
                ? parsedSheet.totalAmount
                : current.snapshot.budgetAmount
          },
          updatedAt: now
        }));
      } else {
        const canParse = ["pdf", "word", "image", "spreadsheet"].includes(kind);
        this.data.createParseResult({
          attachmentId: attachment.id,
          status: canParse ? "completed" : "failed",
          extractedText: canParse ? `\u5df2\u4ece ${normalizedFileName} \u63d0\u53d6\u9644\u4ef6\u6458\u8981` : undefined,
          summary: canParse ? `${slot.label}\uff1a${normalizedFileName} \u5df2\u7eb3\u5165 AI \u5ba1\u6838\u3002` : undefined,
          failureReason: canParse ? undefined : `\u6682\u4e0d\u652f\u6301\u89e3\u6790 ${file.mimetype}`
        });
      }

      createdAttachments.push(attachment);
    }

    this.data.addAuditLog({
      actorId: params.user.id,
      projectId: params.projectId,
      versionId: params.versionId,
      action: "upload_files",
      detail: `\u5df2\u5411 ${slot.label} \u4e0a\u4f20 ${createdAttachments.length} \u4e2a\u6587\u4ef6\u3002`,
      createdAt: now
    });

    return createdAttachments;
  }

  downloadFile(attachmentId: string, user: SessionUser) {
    const attachment = this.data.getAttachment(attachmentId);
    const project = this.data.getProject(attachment.projectId);
    if (user.role === "submitter" && user.organizationId !== project.organizationId) {
      throw new ForbiddenException("\u4f60\u65e0\u6743\u67e5\u770b\u8be5\u9644\u4ef6");
    }

    const absolutePath = path.join(resolveUploadDirPath(), attachment.storageKey);
    if (!existsSync(absolutePath)) {
      throw new NotFoundException("\u9644\u4ef6\u6587\u4ef6\u4e0d\u5b58\u5728");
    }

    return {
      buffer: readFileSync(absolutePath),
      fileName: attachment.fileName,
      mimeType: attachment.mimeType || "application/octet-stream"
    };
  }

  deleteFile(attachmentId: string, user: SessionUser) {
    const attachment = this.data.getAttachment(attachmentId);
    const project = this.data.getProject(attachment.projectId);
    const version = this.data.getVersion(attachment.versionId);
    if (user.role === "submitter" && user.organizationId !== project.organizationId) {
      throw new ForbiddenException("\u4f60\u65e0\u6743\u5220\u9664\u8be5\u9644\u4ef6");
    }
    if (version.status !== "draft") {
      throw new BadRequestException("\u53ea\u6709\u8349\u7a3f\u7248\u672c\u53ef\u4ee5\u5220\u9664\u9644\u4ef6");
    }

    const removed = this.data.deleteAttachment(attachmentId);
    const absolutePath = path.join(resolveUploadDirPath(), removed.storageKey);
    if (existsSync(absolutePath)) {
      unlinkSync(absolutePath);
    }
    if (removed.slotKey === "cost_sheet") {
      this.data.updateVersion(removed.versionId, (current) => ({
        ...current,
        snapshot: {
          ...current.snapshot,
          uploadedCostSheet:
            current.snapshot.uploadedCostSheet?.attachmentId === removed.id
              ? undefined
              : current.snapshot.uploadedCostSheet
        },
        updatedAt: new Date().toISOString()
      }));
    }
    this.data.addAuditLog({
      actorId: user.id,
      projectId: removed.projectId,
      versionId: removed.versionId,
      action: "upload_files",
      detail: `\u5df2\u5220\u9664\u6750\u6599\uff1a${removed.fileName}`,
      createdAt: new Date().toISOString()
    });
    return removed;
  }
}
