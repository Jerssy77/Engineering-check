import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { SessionUser, calculateSubmissionEligibility, getWeekWindow } from "@property-review/shared";

import { DemoDataService } from "../shared/demo-data.service";
import { GrantOverrideDto } from "./dto/grant-override.dto";
import { ResetCityQuotaDto } from "./dto/reset-city-quota.dto";

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

  resetCityWeeklyQuota(organizationId: string, user: SessionUser, dto: ResetCityQuotaDto) {
    if (user.role !== "reviewer") {
      throw new ForbiddenException("只有终审人可以重置城市公司额度");
    }

    const organization = this.data.getOrganizations().find((item) => item.id === organizationId);
    if (!organization || organization.kind !== "city_company") {
      throw new ForbiddenException("仅支持重置城市公司额度");
    }

    const { start, end } = getWeekWindow(new Date());
    const removedCount = this.data.removeQuotaUsageByOrganizationAndRange(
      organizationId,
      start.toISOString(),
      end.toISOString()
    );
    const now = new Date().toISOString();
    const reason = dto.reason?.trim() || "终审人手动重置本周额度";
    const organizationProject = this.data.listProjects().find((item) => item.organizationId === organizationId);
    if (organizationProject) {
      this.data.addAuditLog({
        actorId: user.id,
        projectId: organizationProject.id,
        action: "grant_override",
        detail: `已重置 ${organization.name} 本周 AI 额度，移除 ${removedCount} 条台账；原因：${reason}`,
        createdAt: now
      });
    }

    return {
      organizationId,
      organizationName: organization.name,
      weekStart: start.toISOString(),
      weekEnd: end.toISOString(),
      removedCount,
      board: this.getQuotaUsageBoard(user)
    };
  }
}
