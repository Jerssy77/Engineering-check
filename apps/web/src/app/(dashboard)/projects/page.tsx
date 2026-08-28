"use client";

import { ArrowRightOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { ProjectExperience, ProjectStatus } from "@property-review/shared";
import { Button, Drawer, Form, Input, Select, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { StatusTag } from "../../../components/status-tag";
import { apiRequest } from "../../../lib/api";
import { categoryLabels, formatCurrency, formatDateTime, labelFromMap } from "../../../lib/presentation";
import { getSession } from "../../../lib/session";

interface ProjectRow {
  id: string;
  title: string;
  category: string;
  experience: ProjectExperience;
  status: ProjectStatus;
  organizationName: string;
  currentVersionNumber: number;
  updatedAt: string;
  budgetAmount: number;
  locationSummary: string;
}

interface QuotaInfo {
  used: number;
  remaining: number;
  policy: { weeklyQuotaPerCity: number; resubmitCooldownDays: number };
}

const pilotCategoryOptions = [
  { value: "civil_upgrade", label: "土建改造" },
  { value: "mep_upgrade", label: "机电改造" }
];

type CreateProjectForm = {
  projectName: string;
  projectCategory: "mep_upgrade" | "civil_upgrade";
};

type ProjectFilter = "all" | "drafting" | "reviewing" | "approved";

const projectFilterOptions: Array<{ value: ProjectFilter; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "drafting", label: "填报与访谈" },
  { value: "reviewing", label: "等待确认" },
  { value: "approved", label: "已批准" }
];

export default function ProjectsPage() {
  const router = useRouter();
  const [messageApi, contextHolder] = message.useMessage();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [form] = Form.useForm<CreateProjectForm>();
  const session = getSession();
  const isSubmitter = session?.user.role === "submitter";

  const load = async () => {
    if (!session) return router.replace("/login");
    setLoading(true);
    try {
      const [items, quotaInfo] = await Promise.all([
        apiRequest<ProjectRow[]>("/projects", {}, session),
        isSubmitter ? apiRequest<QuotaInfo>("/quota/me", {}, session) : Promise.resolve(null)
      ]);
      setProjects(items);
      setQuota(quotaInfo);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "项目列表加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const create = async (values: CreateProjectForm) => {
    setSaving(true);
    try {
      const result = await apiRequest<{ project: { id: string; experience?: ProjectExperience } }>("/projects", {
        method: "POST",
        body: JSON.stringify(values)
      }, session);
      messageApi.success("项目已创建，开始智能访谈");
      setOpen(false);
      form.resetFields();
      router.push(result.project.experience === "guided_interview" ? `/projects/${result.project.id}/interview` : `/projects/${result.project.id}`);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "创建失败");
    } finally {
      setSaving(false);
    }
  };

  const stats = useMemo(() => ({
    total: projects.length,
    interviewing: projects.filter((item) => item.experience === "guided_interview" && item.status === "draft").length,
    pending: projects.filter((item) => ["ai_reviewing", "ai_recommended_pass", "ai_conditionally_passed"].includes(item.status)).length,
    approved: projects.filter((item) => item.status === "human_approved").length
  }), [projects]);

  const filteredProjects = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesKeyword = !keyword || [project.title, project.organizationName, project.locationSummary]
        .some((value) => value?.toLowerCase().includes(keyword));
      const matchesFilter = filter === "all"
        || (filter === "drafting" && project.status === "draft")
        || (filter === "reviewing" && ["ai_reviewing", "ai_recommended_pass", "ai_conditionally_passed"].includes(project.status))
        || (filter === "approved" && project.status === "human_approved");
      return matchesKeyword && matchesFilter;
    });
  }, [filter, projects, query]);

  const columns: ColumnsType<ProjectRow> = [
    {
      title: "项目",
      dataIndex: "title",
      width: 300,
      render: (_, record, index) => (
        <div className="project-ledger-title">
          <span className="project-ledger-index">{String(index + 1).padStart(2, "0")}</span>
          <div>
            <div className="project-ledger-meta">
              <span>{labelFromMap(categoryLabels, record.category)}</span>
              <span>{record.organizationName}</span>
            </div>
            <Link href={record.experience === "guided_interview" ? `/projects/${record.id}/interview` : `/projects/${record.id}`}>
              <Typography.Text strong>{record.title}</Typography.Text>
            </Link>
          </div>
        </div>
      )
    },
    { title: "审查方式", dataIndex: "experience", width: 112, render: (value) => value === "guided_interview" ? <Tag className="project-flow-tag is-guided">智能访谈</Tag> : <Tag className="project-flow-tag">历史表单</Tag> },
    { title: "当前状态", dataIndex: "status", width: 120, render: (value) => <StatusTag status={value} /> },
    { title: "工程位置", dataIndex: "locationSummary", width: 250, render: (value) => <span className="project-location">{value || "访谈中确认"}</span> },
    { title: "申报预算", dataIndex: "budgetAmount", width: 124, align: "right", render: (value) => <span className="project-budget">{value > 0 ? formatCurrency(value) : "待形成"}</span> },
    { title: "版本", dataIndex: "currentVersionNumber", width: 68, align: "center", render: (value) => <span className="project-version">V{value}</span> },
    { title: "最后更新", dataIndex: "updatedAt", width: 132, render: (value) => <span className="project-updated">{formatDateTime(value)}</span> },
    {
      title: "",
      width: 120,
      fixed: "right",
      render: (_, record) => (
        <Link className="project-row-action" href={record.experience === "guided_interview" ? `/projects/${record.id}/interview` : `/projects/${record.id}`}>
          {record.experience === "guided_interview" && record.status === "draft" ? "继续访谈" : "查看项目"}<ArrowRightOutlined />
        </Link>
      )
    }
  ];

  const railItems = [
    { label: "在册项目", value: stats.total, note: "本账户可见" },
    { label: "填报访谈", value: stats.interviewing, note: "正在澄清事实" },
    { label: "人工确认", value: stats.pending, note: "等待审查动作" },
    { label: isSubmitter ? "本周可送审" : "已批准", value: isSubmitter ? `${quota?.remaining ?? 0}/${quota?.policy.weeklyQuotaPerCity ?? 3}` : stats.approved, note: isSubmitter ? "剩余额度" : "结论已形成" }
  ];

  return (
    <div className="projects-overview">
      {contextHolder}
      <section className="project-blueprint-hero">
        <div className="project-blueprint-copy">
          <span className="project-blueprint-kicker"><span>PROJECT CONTROL</span> 工程立项审查台</span>
          <Typography.Title className="project-blueprint-title">把一句工程诉求，<br />推进成可执行结论。</Typography.Title>
          <Typography.Paragraph className="project-blueprint-lead">
            在同一条审查路径上确认事实、形成方案、闭合预算，并留下可追溯的审批依据。
          </Typography.Paragraph>
          {isSubmitter ? (
            <Button className="project-create-button" type="primary" size="large" icon={<PlusOutlined />} onClick={() => setOpen(true)}>发起新项目</Button>
          ) : (
            <span className="project-review-note">当前为审查视角 · 优先处理等待确认的项目</span>
          )}
        </div>
        <div className="project-review-rail" aria-label="项目审查路径">
          <div className="project-review-rail-label">审查路径 / REVIEW ROUTE</div>
          <div className="project-review-nodes">
            {railItems.map((item, index) => (
              <div className="project-review-node" key={item.label}>
                <span className="project-review-coordinate">R{index + 1}</span>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
                <small>{item.note}</small>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="project-ledger">
        <div className="project-ledger-heading">
          <div>
            <span className="project-ledger-eyebrow">PROJECT LEDGER · {String(filteredProjects.length).padStart(2, "0")}</span>
            <Typography.Title level={3}>项目审查台账</Typography.Title>
            <Typography.Paragraph>按项目名称、所属组织或工程位置检索，直接进入当前处理环节。</Typography.Paragraph>
          </div>
          <div className="project-ledger-controls">
            <Input allowClear prefix={<SearchOutlined />} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目、组织或位置" aria-label="搜索项目" />
            <Select value={filter} onChange={setFilter} options={projectFilterOptions} aria-label="筛选项目状态" />
            <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新台账</Button>
          </div>
        </div>
        <Table
          className="project-ledger-table"
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={filteredProjects}
          pagination={{ pageSize: 8, hideOnSinglePage: true }}
          scroll={{ x: 1220 }}
          locale={{ emptyText: <div className="project-ledger-empty"><strong>没有匹配的项目</strong><span>调整搜索词或状态筛选后再试。</span></div> }}
        />
      </section>

      <Drawer className="project-create-drawer" title="发起新项目" open={open} width={480} onClose={() => setOpen(false)}>
        <div className="project-create-intro"><span>起点</span><strong>先说清工程事项，后续由访谈逐步补齐。</strong></div>
        <Form form={form} layout="vertical" initialValues={{ projectCategory: "civil_upgrade" }} onFinish={create}>
          <Form.Item name="projectName" label="项目名称" rules={[{ required: true, min: 3, message: "请输入至少三个字的项目名称" }]}>
            <Input size="large" placeholder="例如：地下车库伸缩缝渗漏改造" />
          </Form.Item>
          <Form.Item name="projectCategory" label="工程类别" rules={[{ required: true }]}>
            <Select size="large" options={pilotCategoryOptions} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={saving} block size="large">创建项目并开始访谈</Button>
        </Form>
      </Drawer>
    </div>
  );
}
