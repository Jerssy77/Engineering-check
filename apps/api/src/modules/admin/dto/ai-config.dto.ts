import { IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUrl, MinLength } from "class-validator";
import { AIProviderConfigView } from "@property-review/shared";

export class UpdateAIConfigDto {
  @IsBoolean()
  enabled!: boolean;

  @IsIn(["demo", "openai_compatible"])
  provider!: "demo" | "openai_compatible";

  @IsUrl({ require_tld: false })
  baseUrl!: string;

  @IsString() @MinLength(2) stageModel!: string;
  @IsString() @MinLength(2) schemeModel!: string;
  @IsString() @MinLength(2) decisionModel!: string;
  @IsOptional() @IsString() @MinLength(2) blueprintModel?: string;
  @IsOptional() @IsString() @MinLength(2) routeModel?: string;
  @IsOptional() @IsString() @MinLength(2) reviewModel?: string;
  @IsOptional() @IsObject() reasoning?: AIProviderConfigView["reasoning"];
  @IsString() @MinLength(2) embeddingModel!: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  apiKey?: string;
}
