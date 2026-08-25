import { IsArray, IsOptional, IsString } from "class-validator";
import { SchemeModuleKey } from "@property-review/shared";

export interface SchemeModuleEditDto {
  key: SchemeModuleKey;
  content?: string;
  editReason?: string;
}

export class ConfirmSchemeDto {
  @IsArray()
  modules!: SchemeModuleEditDto[];

  @IsOptional()
  @IsString()
  selectedOptionId?: string;

  @IsOptional()
  @IsString()
  selectionReason?: string;

  @IsOptional()
  @IsString()
  confirmationNote?: string;
}
