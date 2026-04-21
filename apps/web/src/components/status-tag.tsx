"use client";

import { ProjectStatus } from "@property-review/shared";
import { Tag } from "antd";

const STATUS_MAP: Record<ProjectStatus, { label: string; tone: string }> = {
  draft: { label: "草稿", tone: "neutral" },
  submitted: { label: "已提交", tone: "processing" },
  ai_reviewing: { label: "AI 审核中", tone: "info" },
  ai_returned: { label: "AI 不通过", tone: "warning" },
  ai_recommended_pass: { label: "AI 通过", tone: "success" },
  ai_conditionally_passed: { label: "AI 有条件通过", tone: "processing" },
  human_approved: { label: "人工通过", tone: "success" },
  human_returned: { label: "人工退回", tone: "danger" }
};

export function StatusTag({ status }: { status: ProjectStatus }) {
  const config = STATUS_MAP[status];
  return <Tag className={`status-pill tone-${config.tone}`}>{config.label}</Tag>;
}
