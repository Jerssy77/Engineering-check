import { IsIn, IsOptional, IsString, MinLength } from "class-validator";

export class ConfirmScopeCalibrationDto {
  @IsIn(["adopt_supported", "keep_declared", "correct_supported"])
  action!: "adopt_supported" | "keep_declared" | "correct_supported";

  @IsOptional()
  @IsString()
  @MinLength(2)
  correctedScope?: string;

  @IsOptional()
  @IsString()
  comment?: string;
}
