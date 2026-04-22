import {
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min
} from "class-validator";

export class UpdateVersionDto {
  @IsOptional()
  @IsString()
  projectName?: string;

  @IsOptional()
  @IsIn(["mep_upgrade", "fire_safety", "energy_retrofit", "civil_upgrade", "plumbing_drainage"])
  projectCategory?: "mep_upgrade" | "fire_safety" | "energy_retrofit" | "civil_upgrade" | "plumbing_drainage";

  @IsOptional()
  @IsIn(["low", "medium", "high"])
  priority?: "low" | "medium" | "high";

  @IsOptional()
  @IsNumber()
  @Min(0)
  budgetAmount?: number;

  @IsOptional()
  @IsDateString()
  expectedStartDate?: string;

  @IsOptional()
  @IsDateString()
  expectedEndDate?: string;

  @IsOptional()
  @IsObject()
  location?: Record<string, string>;

  @IsOptional()
  @IsIn(["inspection", "complaint", "work_order", "safety_hazard", "energy_optimization", "repair_renewal", "other"])
  issueSourceType?: "inspection" | "complaint" | "work_order" | "safety_hazard" | "energy_optimization" | "repair_renewal" | "other";

  @IsOptional()
  @IsString()
  issueSourceDescription?: string;

  @IsOptional()
  @IsString()
  issueDescription?: string;

  @IsOptional()
  @IsString()
  currentCondition?: string;

  @IsOptional()
  @IsString()
  temporaryMeasures?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  complaintCount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  workOrderCount?: number;

  @IsOptional()
  @IsIn(["low", "medium", "high", "critical"])
  urgencyLevel?: "low" | "medium" | "high" | "critical";

  @IsOptional()
  @IsString()
  objective?: string;

  @IsOptional()
  @IsString()
  implementationScope?: string;

  @IsOptional()
  @IsString()
  feasibilitySummary?: string;

  @IsOptional()
  @IsString()
  keyProcess?: string;

  @IsOptional()
  @IsString()
  materialSelection?: string;

  @IsOptional()
  @IsString()
  maintenancePlan?: string;

  @IsOptional()
  @IsString()
  acceptancePlan?: string;

  @IsOptional()
  @IsString()
  hiddenWorksRequirement?: string;

  @IsOptional()
  @IsString()
  sampleFirstRequirement?: string;

  @IsOptional()
  @IsString()
  detailDrawingRequirement?: string;

  @IsOptional()
  @IsString()
  thirdPartyTestingRequirement?: string;

  @IsOptional()
  @IsString()
  preliminaryPlan?: string;

  @IsOptional()
  @IsString()
  initialBudgetExplanation?: string;

  @IsOptional()
  @IsString()
  expectedBenefits?: string;

  @IsOptional()
  @IsString()
  supplementaryNotes?: string;

  @IsOptional()
  @IsArray()
  costMatrixRows?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsIn(["online", "upload"])
  costInputMode?: "online" | "upload";

  @IsOptional()
  @IsObject()
  riskFlags?: Record<string, boolean>;

  @IsOptional()
  @IsObject()
  categorySpecificFields?: Record<string, Record<string, string | number | boolean>>;
}
