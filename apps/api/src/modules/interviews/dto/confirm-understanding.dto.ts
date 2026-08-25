import { IsIn, IsOptional, IsString } from "class-validator";

export class ConfirmUnderstandingDto {
  @IsIn(["confirm", "disagree"])
  action!: "confirm" | "disagree";

  @IsOptional()
  @IsString()
  comment?: string;
}
