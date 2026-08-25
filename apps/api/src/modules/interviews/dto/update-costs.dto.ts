import { IsArray, IsNumber, Min } from "class-validator";
import { CostMatrixRow } from "@property-review/shared";

export class UpdateInterviewCostsDto {
  @IsArray()
  rows!: CostMatrixRow[];

  @IsNumber()
  @Min(0)
  declaredBudget!: number;
}
