import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  AttachmentKind,
  AttachmentSlotKey,
  FAULT_REGISTRY_TEMPLATE_HEADERS,
  SessionUser,
  buildVersionAttachmentSlots
} from "@property-review/shared";

import { DemoDataService } from "../shared/demo-data.service";
import {
  ensureDirectory,
  normalizeLatin1Utf8Text,
  resolveUploadDirPath,
  sanitizeFileName
} from "../shared/storage-paths";

const DEFAULT_ATTACHMENT_MAX_SIZE_BYTES = 512 * 1024;
const DEFAULT_NON_PHOTO_ATTACHMENTS_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
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

  getFaultRegistryTemplate(): Buffer {
    const rows = [
      FAULT_REGISTRY_TEMPLATE_HEADERS.join("\t"),
      ["xxx项目", "xxx楼栋", "xxx楼层", "xxx区域/房间", "xxx设备/点位", "xxx故障现象", "xxx影响范围", "2026-03-27", "待整改", "xxx临时措施", "照片1"].join("\t")
    ];

    return Buffer.from(`\uFEFF${rows.join("\r\n")}`, "utf8");
  }

  uploadFiles(params: {
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

    const slot = buildVersionAttachmentSlots({
      category: version.snapshot.projectCategory,
      sourceType: version.snapshot.issueSourceType,
      attachments: this.data.listAttachments(params.projectId, params.versionId)
    }).find((item) => item.key === params.slotKey);
    if (!slot) {
      throw new BadRequestException("\u4e0d\u5b58\u5728\u7684\u6750\u6599\u69fd\u4f4d");
    }
    if (slot.attachments.length + params.files.length > slot.maxFiles) {
      throw new BadRequestException(`${slot.label} \u6700\u591a\u4e0a\u4f20 ${slot.maxFiles} \u4e2a\u6587\u4ef6`);
    }

    const versionAttachments = this.data.listAttachments(params.projectId, params.versionId);
    if (params.slotKey !== "issue_photos") {
      const existingNonPhotoTotal = versionAttachments
        .filter((item) => item.slotKey !== "issue_photos")
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
      const kind = resolveAttachmentKind(file.mimetype);
      if (file.size > ATTACHMENT_MAX_SIZE_BYTES) {
        throw new BadRequestException(
          `${normalizedFileName} \u8d85\u8fc7\u5355\u4e2a\u6587\u4ef6\u5927\u5c0f\u9650\u5236 ${formatAttachmentSizeLimit(ATTACHMENT_MAX_SIZE_BYTES)}`
        );
      }
      if (!slot.acceptedKinds.includes(kind)) {
        throw new BadRequestException(`${slot.label} \u4e0d\u63a5\u53d7 ${kind} \u7c7b\u578b\u6587\u4ef6`);
      }

      return { file, kind, normalizedFileName };
    });

    const createdAttachments = preparedFiles.map(({ file, kind, normalizedFileName }, index) => {
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

      const canParse = ["pdf", "word", "image", "spreadsheet"].includes(kind);
      this.data.createParseResult({
        attachmentId: attachment.id,
        status: canParse ? "completed" : "failed",
        extractedText: canParse ? `\u5df2\u4ece ${normalizedFileName} \u63d0\u53d6\u9644\u4ef6\u6458\u8981` : undefined,
        summary: canParse ? `${slot.label}\uff1a${normalizedFileName} \u5df2\u7eb3\u5165 AI \u5ba1\u6838\u3002` : undefined,
        failureReason: canParse ? undefined : `\u6682\u4e0d\u652f\u6301\u89e3\u6790 ${file.mimetype}`
      });

      return attachment;
    });

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
