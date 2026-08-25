import { EvidenceClaim } from "@property-review/shared";
import { IsIn, IsString, MinLength } from "class-validator";

export class LinkEvidenceDto {
  @IsString()
  @MinLength(2)
  attachmentId!: string;

  @IsIn(["photo", "work_order", "inspection", "test", "complaint", "equipment_record", "other"])
  evidenceType!: EvidenceClaim["evidenceType"];
}
