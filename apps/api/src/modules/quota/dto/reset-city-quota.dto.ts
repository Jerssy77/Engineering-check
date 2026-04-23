import { IsOptional, IsString, MaxLength } from "class-validator";

export class ResetCityQuotaDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reason?: string;
}
