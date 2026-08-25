import { IsDateString, IsIn, IsNumber, IsOptional, IsString, MinLength, Min } from "class-validator";

export class CreateProjectDto {
  @IsString()
  @MinLength(3)
  projectName!: string;

  @IsIn(["mep_upgrade", "civil_upgrade"])
  projectCategory!: "mep_upgrade" | "civil_upgrade";

  @IsIn(["low", "medium", "high"])
  @IsOptional()
  priority?: "low" | "medium" | "high";

  @IsNumber()
  @Min(0)
  @IsOptional()
  budgetAmount?: number;

  @IsDateString()
  @IsOptional()
  expectedStartDate?: string;

  @IsDateString()
  @IsOptional()
  expectedEndDate?: string;

  @IsString()
  @MinLength(2)
  @IsOptional()
  propertyName?: string;

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
  @IsOptional()
  issueSourceType?: "inspection" | "complaint" | "work_order" | "safety_hazard" | "energy_optimization" | "repair_renewal" | "other";

  @IsOptional()
  @IsString()
  issueDescription?: string;
}
