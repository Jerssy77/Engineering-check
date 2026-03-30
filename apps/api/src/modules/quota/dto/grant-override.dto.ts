import { IsIn, IsString, MinLength } from "class-validator";

export class GrantOverrideDto {
  @IsIn(["weekly_quota", "cooldown", "both"])
  scope!: "weekly_quota" | "cooldown" | "both";

  @IsString()
  @MinLength(4)
  reason!: string;
}
