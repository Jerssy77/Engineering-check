import { IsNotEmpty, IsString } from "class-validator";
import { InterviewAnswerValue } from "@property-review/shared";

export class SaveAnswerDraftDto {
  @IsString()
  questionId!: string;

  @IsNotEmpty()
  value!: InterviewAnswerValue;
}
