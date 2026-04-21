import { IsArray, IsIn, IsOptional, IsString, MinLength } from "class-validator";

export class HumanDecisionDto {
  @IsIn(["approved", "returned"])
  decision!: "approved" | "returned";

  @IsString()
  @MinLength(4)
  comment!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedWritebackIds?: string[];
}
