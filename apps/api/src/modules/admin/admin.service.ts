import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { ProjectCostBoardRow, SessionUser, findDuplicateProjects, summarizeLocation } from "@property-review/shared";

import { DemoDataService } from "../shared/demo-data.service";

@Injectable()
export class AdminService {
  constructor(@Inject(DemoDataService) private readonly data: DemoDataService) {}

  getDashboard(user: SessionUser) {
    if (user.role === "submitter") {
      throw new ForbiddenException("\u53ea\u6709\u7ec8\u5ba1\u4eba\u548c\u7ba1\u7406\u5458\u53ef\u4ee5\u67e5\u770b\u7ba1\u7406\u770b\u677f");
    }

    return {
      organizations: this.data.getOrganizations(),
      users: this.data.getUsers().map((userItem) => ({
        id: userItem.id,
        username: userItem.username,
        displayName: userItem.displayName,
        role: userItem.role,
        organizationId: userItem.organizationId
      })),
      quotaPolicy: this.data.getQuotaPolicy(),
      projectCostBoard: this.buildProjectCostBoard(),
      auditLogs: this.data
        .listAuditLogs()
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .slice(0, 30)
    };
  }

  private buildProjectCostBoard(): ProjectCostBoardRow[] {
    const organizations = this.data.getOrganizations();
    const allProjects = this.data.listProjects();
    const duplicateRecords = allProjects.flatMap((project) =>
      this.data.listVersions(project.id).map((version) => ({
        projectId: project.id,
        projectTitle: project.title,
        projectCategory: project.category,
        versionId: version.id,
        versionNumber: version.versionNumber,
        status: version.status,
        createdAt: version.createdAt,
        snapshot: version.snapshot
      }))
    );

    return allProjects
      .map((project) => {
        const versions = this.data.listVersions(project.id).sort((left, right) => left.versionNumber - right.versionNumber);
        const currentVersion = versions.find((item) => item.id === project.currentVersionId) ?? versions[versions.length - 1];
        const approvedVersion = [...versions]
          .reverse()
          .find((item) => item.status === "human_approved");
        const initialBudget = versions[0]?.snapshot.budgetAmount ?? 0;
        const currentBudget = currentVersion?.snapshot.budgetAmount ?? initialBudget;
        const finalBudget = approvedVersion?.snapshot.budgetAmount;
        const comparisonTarget = currentVersion?.snapshot;
        const duplicateFlag = comparisonTarget
          ? findDuplicateProjects({
              currentProjectId: project.id,
              snapshot: comparisonTarget,
              records: duplicateRecords
            }).length > 0
          : false;

        return {
          projectId: project.id,
          organizationId: project.organizationId,
          organizationName: organizations.find((item) => item.id === project.organizationId)?.name ?? "-",
          projectName: project.title,
          projectCategory: project.category,
          locationSummary: currentVersion ? summarizeLocation(currentVersion.snapshot.location) : "-",
          status: project.status,
          initialBudget,
          currentBudget,
          finalBudget,
          budgetDelta: (finalBudget ?? currentBudget) - initialBudget,
          submissionCount: this.data.listQuotaLedger().filter((item) => item.projectId === project.id).length,
          updatedAt: project.updatedAt,
          duplicateFlag
        } satisfies ProjectCostBoardRow;
      })
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }
}
