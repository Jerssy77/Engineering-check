import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Res,
  UploadedFiles,
  UseInterceptors
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { IsIn, IsString } from "class-validator";
import { Response } from "express";

import { AuthService } from "../auth/auth.service";
import { FilesService } from "./files.service";

class UploadFilesBodyDto {
  @IsString()
  projectId!: string;

  @IsString()
  versionId!: string;

  @IsIn([
    "issue_photos",
    "fault_registry",
    "drawings",
    "supplementary"
  ])
  slotKey!:
    | "issue_photos"
    | "fault_registry"
    | "drawings"
    | "supplementary";
}

@Controller("files")
export class FilesController {
  constructor(
    @Inject(FilesService) private readonly filesService: FilesService,
    @Inject(AuthService) private readonly authService: AuthService
  ) {}

  @Get("templates/fault-registry.xlsx")
  async downloadFaultRegistryTemplate(@Res() response: Response) {
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="fault-registry-template.xlsx"'
    );
    response.send(await this.filesService.getFaultRegistryTemplate());
  }

  @Post("upload")
  @UseInterceptors(FilesInterceptor("files", 6))
  upload(
    @Headers("x-user-id") userId: string | undefined,
    @Body() body: UploadFilesBodyDto,
    @UploadedFiles() files: Express.Multer.File[]
  ) {
    return this.filesService.uploadFiles({
      user: this.authService.requireSession(userId),
      projectId: body.projectId,
      versionId: body.versionId,
      slotKey: body.slotKey,
      files
    });
  }

  @Get(":attachmentId/download")
  download(
    @Headers("x-user-id") userId: string | undefined,
    @Param("attachmentId") attachmentId: string,
    @Res() response: Response
  ) {
    const file = this.filesService.downloadFile(
      attachmentId,
      this.authService.requireSession(userId)
    );

    response.setHeader("Content-Type", file.mimeType);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`
    );
    response.send(file.buffer);
  }

  @Delete(":attachmentId")
  remove(@Headers("x-user-id") userId: string | undefined, @Param("attachmentId") attachmentId: string) {
    return this.filesService.deleteFile(attachmentId, this.authService.requireSession(userId));
  }
}
