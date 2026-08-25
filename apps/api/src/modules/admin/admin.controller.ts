import { Body, Controller, Get, Headers, Inject, Patch, Post } from "@nestjs/common";

import { AuthService } from "../auth/auth.service";
import { QuotaService } from "../quota/quota.service";
import { AdminService } from "./admin.service";
import { UpdateAIConfigDto } from "./dto/ai-config.dto";

@Controller("admin")
export class AdminController {
  constructor(
    @Inject(AdminService) private readonly adminService: AdminService,
    @Inject(QuotaService) private readonly quotaService: QuotaService,
    @Inject(AuthService) private readonly authService: AuthService
  ) {}

  @Get("dashboard")
  dashboard(@Headers("x-user-id") userId?: string) {
    return this.adminService.getDashboard(this.authService.requireSession(userId));
  }

  @Get("quota-usage")
  quotaUsage(@Headers("x-user-id") userId?: string) {
    return this.quotaService.getQuotaUsageBoard(this.authService.requireSession(userId));
  }

  @Get("ai-config")
  aiConfig(@Headers("x-user-id") userId?: string) {
    return this.adminService.getAIConfig(this.authService.requireSession(userId));
  }

  @Get("ai-usage")
  aiUsage(@Headers("x-user-id") userId?: string) {
    return this.adminService.getAIUsage(this.authService.requireSession(userId));
  }

  @Patch("ai-config")
  updateAIConfig(@Headers("x-user-id") userId: string | undefined, @Body() body: UpdateAIConfigDto) {
    return this.adminService.updateAIConfig(this.authService.requireSession(userId), body);
  }

  @Post("ai-config/test")
  testAIConfig(@Headers("x-user-id") userId?: string) {
    return this.adminService.testAIConfig(this.authService.requireSession(userId));
  }
}
