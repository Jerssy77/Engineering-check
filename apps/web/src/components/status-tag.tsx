"use client";

import { ProjectStatus } from "@property-review/shared";
import { Tag } from "antd";

const STATUS_MAP: Record<ProjectStatus, { label: string; color: string }> = {
  draft: { label: "\u8349\u7a3f", color: "default" },
  submitted: { label: "\u5df2\u63d0\u4ea4", color: "processing" },
  ai_reviewing: { label: "AI \u5ba1\u6838\u4e2d", color: "blue" },
  ai_returned: { label: "AI \u4e0d\u901a\u8fc7", color: "orange" },
  ai_recommended_pass: { label: "AI \u901a\u8fc7", color: "green" },
  ai_conditionally_passed: { label: "AI \u6709\u6761\u4ef6\u901a\u8fc7", color: "gold" },
  human_approved: { label: "\u4eba\u5de5\u901a\u8fc7", color: "success" },
  human_returned: { label: "\u4eba\u5de5\u9000\u56de", color: "red" }
};

export function StatusTag({ status }: { status: ProjectStatus }) {
  const config = STATUS_MAP[status];
  return <Tag color={config.color}>{config.label}</Tag>;
}
