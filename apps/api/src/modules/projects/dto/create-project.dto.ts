import { IsDateString, IsIn, IsNumber, IsOptional, IsString, MinLength, Min } from "class-validator";

export class CreateProjectDto {
  @IsString()
  @MinLength(3)
  projectName!: string;

  @IsIn(["mep_upgrade", "fire_safety", "energy_retrofit", "civil_upgrade", "plumbing_drainage"])
  projectCategory!: "mep_upgrade" | "fire_safety" | "energy_retrofit" | "civil_upgrade" | "plumbing_drainage";

  @IsIn(["low", "medium", "high"])
  priority!: "low" | "medium" | "high";

  @IsNumber()
  @Min(0)
  budgetAmount!: number;

  @IsDateString()
  expectedStartDate!: string;

  @IsDateString()
  expectedEndDate!: string;

  @IsString()
  @MinLength(2)
  propertyName!: string;

  @IsOptional()
  @IsString()
  building?: string;

  @IsOptional()
  @IsString()
  floor?: string;

  @IsOptional()
  @IsString()
  area?: string;

  @IsOptional()
  @IsString()
  room?: string;

  @IsOptional()
  @IsString()
  equipmentPoint?: string;

  @IsIn(["inspection", "complaint", "work_order", "safety_hazard", "energy_optimization", "repair_renewal", "other"])
  issueSourceType!: "inspection" | "complaint" | "work_order" | "safety_hazard" | "energy_optimization" | "repair_renewal" | "other";

  @IsOptional()
  @IsString()
  issueDescription?: string;
}
