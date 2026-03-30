import { IsOptional, IsString } from "class-validator";

export class SubmitProjectDto {
  @IsOptional()
  @IsString()
  versionId?: string;
}
