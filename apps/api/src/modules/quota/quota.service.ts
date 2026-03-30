import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { SessionUser, calculateSubmissionEligibility, getWeekWindow } from "@property-review/shared";

import { DemoDataService } from "../shared/demo-data.service";
import { GrantOverrideDto } from "./dto/grant-override.dto";

@Injectable()
export class QuotaService {
  constructor(@Inject(DemoDataService) private readonly data: DemoDataService) {}

  getMyQuota(user: SessionUser) {
    const policy = this.data.getQuotaPolicy();
    const now = new Date();
    const { start, end } = getWeekWindow(now);
    const organizationId = user.role === "submitter" ? user.organizationId : undefined;
    const usage = this.data.listQuotaLedger().filter((item) =>
      organizationId ? item.organizationId === organizationId : true
    );
    const currentWeekUsage = usage.filter((item) => {
      const consumedAt = new Date(item.consumedAt);
      return consumedAt >= start && consumedAt <= end;
    });

    return {
      policy,
      weekStart: start.toISOString(),
      weekEnd: end.toISOString(),
      used: currentWeekUsage.length,
      remaining: Math.max(policy.weeklyQuotaPerCity - currentWeekUsage.length, 0),
      entries: currentWeekUsage
        .map((item) => ({
          ...item,
          projectTitle: this.data.getProject(item.projectId).title
        }))
        .sort((left, right) => new Date(right.consumedAt).getTime() - new Date(left.consumedAt).getTime())
    };
  }

  grantOverride(projectId: string, user: SessionUser, dto: GrantOverrideDto) {
    if (user.role === "submitter") {
      throw new ForbiddenException("\u53ea\u6709\u7ec8\u5ba1\u4eba\u6216\u7ba1\u7406\u5458\u53ef\u4ee5\u53d1\u653e\u7279\u6279");
    }

    const project = this.data.getProject(projectId);
    const now = new Date().toISOString();
    const override = this.data.addOverride({
      projectId,
      grantedBy: user.id,
      scope: dto.scope,
      reason: dto.reason,
      used: false,
      createdAt: now
    });

    this.data.addAuditLog({
      actorId: user.id,
      projectId,
      action: "grant_override",
      detail: `\u5df2\u53d1\u653e ${dto.scope} \u7c7b\u578b\u7279\u6279\uff0c\u539f\u56e0\uff1a${dto.reason}`,
      createdAt: now
    });

    return {
      override,
      eligibility: calculateSubmissionEligibility({
        policy: this.data.getQuotaPolicy(),
        ledger: this.data.listQuotaLedger(),
        overrides: this.data.listOverrides(projectId),
        versions: this.data.listVersions(projectId),
        organizationId: project.organizationId,
        currentStatus: project.status
      })
    };
  }

  getQuotaUsageBoard(user: SessionUser) {
    if (user.role === "submitter") {
      throw new ForbiddenException("\u53ea\u6709\u7ec8\u5ba1\u4eba\u6216\u7ba1\u7406\u5458\u53ef\u4ee5\u67e5\u770b\u989d\u5ea6\u4f7f\u7528\u60c5\u51b5");
    }

    return {
      organizations: this.data
        .getOrganizations()
        .filter((item) => item.kind === "city_company")
        .map((organization) => {
          const quota = this.data.listQuotaLedger().filter((item) => item.organizationId === organization.id);
          const eligibility = calculateSubmissionEligibility({
            policy: this.data.getQuotaPolicy(),
            ledger: this.data.listQuotaLedger(),
            overrides: [],
            versions: [],
            organizationId: organization.id,
            currentStatus: "draft"
          });
          const { start, end } = getWeekWindow(new Date());
          return {
            organizationId: organization.id,
            organizationName: organization.name,
            usedThisWeek: quota.filter((item) => {
              const consumedAt = new Date(item.consumedAt);
              return consumedAt >= start && consumedAt <= end;
            }).length,
            remainingThisWeek: eligibility.remainingWeeklyQuota
          };
        }),
      overrides: this.data
        .listOverrides()
        .map((item) => ({
          ...item,
          projectTitle: this.data.getProject(item.projectId).title
        }))
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    };
  }
}
