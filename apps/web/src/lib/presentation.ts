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
  return `¥ ${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export const categoryLabels: Record<string, string> = PROJECT_CATEGORY_LABELS;
export const priorityLabels: Record<string, string> = PRIORITY_LABELS;
export const issueSourceLabels: Record<string, string> = ISSUE_SOURCE_LABELS;
export const urgencyLabels: Record<string, string> = URGENCY_LEVEL_LABELS;
export const costRowTypeLabels: Record<string, string> = COST_ROW_TYPE_LABELS;
export const verdictLabels: Record<string, string> = VERDICT_LABELS;
export const technicalSchemeTemplates = TECHNICAL_SCHEME_TEMPLATES;

export const roleLabels: Record<string, string> = {
  submitter: "申报人",
  reviewer: "终审人",
  admin: "管理员"
};

export const organizationKindLabels: Record<string, string> = {
  city_company: "城市公司",
  regional_hq: "区域工程中心",
  group_hq: "总部"
};

export const auditActionLabels: Record<string, string> = {
  create_project: "创建立项草稿",
  create_version: "生成新版本",
  update_version: "更新草稿",
  submit_project: "提交 AI 预审",
  ai_review_complete: "AI 预审完成",
  ai_review_failed: "AI 调用失败",
  human_decision: "人工终审",
  upload_files: "材料维护",
  grant_override: "发放特批"
};

export const overrideScopeLabels: Record<string, string> = {
  weekly_quota: "跳过周额度",
  cooldown: "跳过冷却期",
  both: "额度+冷却期"
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
