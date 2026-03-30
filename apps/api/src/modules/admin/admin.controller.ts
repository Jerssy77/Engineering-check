import { Controller, Get, Headers, Inject } from "@nestjs/common";

import { AuthService } from "../auth/auth.service";
import { QuotaService } from "../quota/quota.service";
import { AdminService } from "./admin.service";

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
}
