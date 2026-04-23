import { Body, Controller, Get, Headers, Inject, Param, Post } from "@nestjs/common";

import { AuthService } from "../auth/auth.service";
import { GrantOverrideDto } from "./dto/grant-override.dto";
import { ResetCityQuotaDto } from "./dto/reset-city-quota.dto";
import { QuotaService } from "./quota.service";

@Controller()
export class QuotaController {
  constructor(
    @Inject(QuotaService) private readonly quotaService: QuotaService,
    @Inject(AuthService) private readonly authService: AuthService
  ) {}

  @Get("quota/me")
  getMine(@Headers("x-user-id") userId?: string) {
    return this.quotaService.getMyQuota(this.authService.requireSession(userId));
  }

  @Post("projects/:projectId/override-grants")
  grantOverride(
    @Headers("x-user-id") userId: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: GrantOverrideDto
  ) {
    return this.quotaService.grantOverride(projectId, this.authService.requireSession(userId), body);
  }

  @Post("quota/organizations/:organizationId/reset-weekly")
  resetCityWeeklyQuota(
    @Headers("x-user-id") userId: string | undefined,
    @Param("organizationId") organizationId: string,
    @Body() body: ResetCityQuotaDto
  ) {
    return this.quotaService.resetCityWeeklyQuota(
      organizationId,
      this.authService.requireSession(userId),
      body
    );
  }
}
