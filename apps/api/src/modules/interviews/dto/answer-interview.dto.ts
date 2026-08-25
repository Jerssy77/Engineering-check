import { InterviewAnswerValue } from "@property-review/shared";
import { IsDefined, IsOptional, IsString, MinLength } from "class-validator";

export class AnswerInterviewDto {
  @IsString()
  @MinLength(2)
  questionId!: string;

  @IsDefined()
  value!: InterviewAnswerValue;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
