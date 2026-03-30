import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import {
  AttachmentKind,
  AttachmentSlotKey,
  FAULT_REGISTRY_TEMPLATE_HEADERS,
  SessionUser,
  buildVersionAttachmentSlots
} from "@property-review/shared";

import { DemoDataService } from "../shared/demo-data.service";

function resolveAttachmentKind(mimeType: string): AttachmentKind {
  if (mimeType.includes("pdf")) return "pdf";
  if (mimeType.includes("word") || mimeType.includes("officedocument.wordprocessingml")) return "word";
  if (mimeType.includes("image")) return "image";
  if (mimeType.includes("sheet") || mimeType.includes("excel") || mimeType.includes("spreadsheet")) return "spreadsheet";
  return "other";
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

    const now = new Date().toISOString();
    const createdAttachments = params.files.map((file) => {
      const kind = resolveAttachmentKind(file.mimetype);
      if (!slot.acceptedKinds.includes(kind)) {
        throw new BadRequestException(`${slot.label} \u4e0d\u63a5\u53d7 ${kind} \u7c7b\u578b\u6587\u4ef6`);
      }

      const attachment = this.data.createAttachment({
        projectId: params.projectId,
        versionId: params.versionId,
        slotKey: params.slotKey,
        fileName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        storageKey: `demo/${params.projectId}/${Date.now()}-${file.originalname}`,
        kind,
        uploadedAt: now
      });

      const canParse = ["pdf", "word", "image", "spreadsheet"].includes(kind);
      this.data.createParseResult({
        attachmentId: attachment.id,
        status: canParse ? "completed" : "failed",
        extractedText: canParse ? `\u5df2\u4ece ${file.originalname} \u63d0\u53d6\u9644\u4ef6\u6458\u8981` : undefined,
        summary: canParse ? `${slot.label}\uff1a${file.originalname} \u5df2\u7eb3\u5165 AI \u5ba1\u6838\u3002` : undefined,
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
