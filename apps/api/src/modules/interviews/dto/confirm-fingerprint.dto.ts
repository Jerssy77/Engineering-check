import { IsArray, IsIn, IsOptional, IsString, MinLength } from "class-validator";

export class ConfirmFingerprintDto {
  @IsString() @MinLength(1) discipline!: string;
  @IsString() @MinLength(1) system!: string;
  @IsString() @MinLength(1) object!: string;
  @IsString() @MinLength(1) problemMode!: string;
  @IsString() @MinLength(1) proposedAction!: string;
  @IsString() @MinLength(1) impactScope!: string;
  @IsIn(["corrective_repair", "lifecycle_renewal", "quality_upgrade", "compliance_rectification", "efficiency_upgrade", "capacity_upgrade"])
  intent!: "corrective_repair" | "lifecycle_renewal" | "quality_upgrade" | "compliance_rectification" | "efficiency_upgrade" | "capacity_upgrade";
  @IsString() @MinLength(1) businessObjective!: string;
  @IsIn(["single_object", "condition_based", "uniform_standard", "phased_program"])
  scopeStrategy!: "single_object" | "condition_based" | "uniform_standard" | "phased_program";
  @IsOptional() @IsArray() basis?: string[];
}
