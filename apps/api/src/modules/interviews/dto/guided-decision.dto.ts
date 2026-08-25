import { IsIn, IsOptional, IsString, MinLength } from "class-validator";
import { DecisionOutcome } from "@property-review/shared";

export class GuidedDecisionDto {
  @IsIn(["approved", "supplement_required", "not_approved"])
  outcome!: DecisionOutcome;

  @IsString()
  @MinLength(2)
  @IsIn([
    "confirm_ai_conclusion",
    "evidence_sufficient",
    "evidence_insufficient",
    "necessity_insufficient",
    "scheme_risk",
    "budget_over_threshold",
    "compliance_or_safety_risk",
    "material_conflict",
    "other_manual_judgement"
  ])
  reasonCode!: string;

  @IsOptional()
  @IsString()
  comment?: string;
}
