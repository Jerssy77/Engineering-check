import { IsArray, IsObject, IsOptional, IsString } from "class-validator";
import { KnowledgeRelease } from "@property-review/shared";

export class UpdateKnowledgeReleaseDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  changeNote?: string;

  @IsOptional()
  @IsArray()
  questions?: KnowledgeRelease["questions"];

  @IsOptional()
  @IsObject()
  schemeTemplates?: KnowledgeRelease["schemeTemplates"];
}
