import { IsNotEmpty, IsObject } from "class-validator";

export class SaveStageSupplementDto {
  @IsObject()
  @IsNotEmpty()
  values!: Record<string, string | number>;
}
