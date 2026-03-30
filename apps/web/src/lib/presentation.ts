import {
  COST_ROW_TYPE_LABELS,
  ISSUE_SOURCE_LABELS,
  PRIORITY_LABELS,
  PROJECT_CATEGORY_LABELS,
  TECHNICAL_SCHEME_TEMPLATES,
  URGENCY_LEVEL_LABELS,
  VERDICT_LABELS
} from "@property-review/shared";

export function formatDateTime(value?: string): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
    hour12: false
  }).format(new Date(value));
}

export function formatDate(value?: string): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeZone: "Asia/Shanghai"
  }).format(new Date(value));
}

export function formatCurrency(value?: number): string {
  return `\u00a5 ${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export const categoryLabels: Record<string, string> = PROJECT_CATEGORY_LABELS;
export const priorityLabels: Record<string, string> = PRIORITY_LABELS;
export const issueSourceLabels: Record<string, string> = ISSUE_SOURCE_LABELS;
export const urgencyLabels: Record<string, string> = URGENCY_LEVEL_LABELS;
export const costRowTypeLabels: Record<string, string> = COST_ROW_TYPE_LABELS;
export const verdictLabels: Record<string, string> = VERDICT_LABELS;
export const technicalSchemeTemplates = TECHNICAL_SCHEME_TEMPLATES;

export const roleLabels: Record<string, string> = {
  submitter: "\u7533\u62a5\u4eba",
  reviewer: "\u7ec8\u5ba1\u4eba",
  admin: "\u7ba1\u7406\u5458"
};

export const organizationKindLabels: Record<string, string> = {
  city_company: "\u57ce\u5e02\u516c\u53f8",
  regional_hq: "\u533a\u57df\u5de5\u7a0b\u4e2d\u5fc3",
  group_hq: "\u603b\u90e8"
};

export const auditActionLabels: Record<string, string> = {
  create_project: "\u521b\u5efa\u7acb\u9879\u8349\u7a3f",
  create_version: "\u751f\u6210\u65b0\u7248\u672c",
  update_version: "\u66f4\u65b0\u8349\u7a3f",
  submit_project: "\u63d0\u4ea4 AI \u9884\u5ba1",
  ai_review_complete: "AI \u9884\u5ba1\u5b8c\u6210",
  ai_review_failed: "AI \u8c03\u7528\u5931\u8d25",
  human_decision: "\u4eba\u5de5\u7ec8\u5ba1",
  upload_files: "\u6750\u6599\u7ef4\u62a4",
  grant_override: "\u53d1\u653e\u7279\u6279"
};

export const overrideScopeLabels: Record<string, string> = {
  weekly_quota: "\u8df3\u8fc7\u5468\u989d\u5ea6",
  cooldown: "\u8df3\u8fc7\u51b7\u5374\u671f",
  both: "\u989d\u5ea6+\u51b7\u5374\u671f"
};

export const projectCategoryOptions = Object.entries(categoryLabels).map(([value, label]) => ({ value, label }));
export const priorityOptions = Object.entries(priorityLabels).map(([value, label]) => ({ value, label }));
export const issueSourceOptions = Object.entries(issueSourceLabels).map(([value, label]) => ({ value, label }));
export const urgencyOptions = Object.entries(urgencyLabels).map(([value, label]) => ({ value, label }));
export const costRowTypeOptions = Object.entries(costRowTypeLabels).map(([value, label]) => ({ value, label }));

export function labelFromMap(map: Record<string, string>, value?: string): string {
  if (!value) return "-";
  return map[value] ?? value;
}
