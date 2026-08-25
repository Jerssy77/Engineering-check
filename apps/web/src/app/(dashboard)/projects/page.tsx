"use client";

import { ArrowRightOutlined, PlusOutlined } from "@ant-design/icons";
import { ProjectExperience, ProjectStatus } from "@property-review/shared";
import { Button, Drawer, Form, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { StatusTag } from "../../../components/status-tag";
import { apiRequest } from "../../../lib/api";
import { categoryLabels, formatCurrency, formatDateTime, labelFromMap } from "../../../lib/presentation";
import { getSession } from "../../../lib/session";
import { Input } from "antd";

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

export default function ProjectsPage() {
  const router = useRouter();
  const [messageApi, contextHolder] = message.useMessage();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
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

  const columns: ColumnsType<ProjectRow> = [
    {
      title: "项目",
      dataIndex: "title",
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Link href={record.experience === "guided_interview" ? `/projects/${record.id}/interview` : `/projects/${record.id}`}>
            <Typography.Text strong>{record.title}</Typography.Text>
          </Link>
          <Typography.Text type="secondary">{record.organizationName}</Typography.Text>
        </Space>
      )
    },
    { title: "类别", dataIndex: "category", render: (value) => <Tag>{labelFromMap(categoryLabels, value)}</Tag> },
    { title: "流程", dataIndex: "experience", render: (value) => value === "guided_interview" ? <Tag color="blue">智能访谈</Tag> : <Tag>历史表单</Tag> },
    { title: "状态", dataIndex: "status", render: (value) => <StatusTag status={value} /> },
    { title: "位置", dataIndex: "locationSummary", render: (value) => value || "访谈中确认" },
    { title: "预算", dataIndex: "budgetAmount", render: (value) => value > 0 ? formatCurrency(value) : "待形成" },
    { title: "版本", dataIndex: "currentVersionNumber", render: (value) => `V${value}` },
    { title: "更新时间", dataIndex: "updatedAt", render: formatDateTime },
    {
      title: "",
      render: (_, record) => <Link href={record.experience === "guided_interview" ? `/projects/${record.id}/interview` : `/projects/${record.id}`}><ArrowRightOutlined /></Link>
    }
  ];

  return (
    <div className="section-grid">
      {contextHolder}
      <section className="glass-card brand-frame page-hero">
        <div className="page-hero-grid">
          <Space direction="vertical" size={14}>
            <span className="hero-kicker">工程立项决策</span>
            <Typography.Title className="hero-title">工程立项</Typography.Title>
            {isSubmitter ? <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建立项</Button> : null}
          </Space>
          <div className="metric-grid">
            <div className="metric-card"><span>全部项目</span><strong>{stats.total}</strong></div>
            <div className="metric-card"><span>访谈填写中</span><strong>{stats.interviewing}</strong></div>
            <div className="metric-card"><span>待人工确认</span><strong>{stats.pending}</strong></div>
            <div className="metric-card"><span>{isSubmitter ? "本周送审余额" : "已批准"}</span><strong>{isSubmitter ? `${quota?.remaining ?? 0}/${quota?.policy.weeklyQuotaPerCity ?? 3}` : stats.approved}</strong></div>
          </div>
        </div>
      </section>

      <section className="section-surface document-table">
        <div className="panel-heading">
          <Typography.Title level={4} className="section-title">项目清单</Typography.Title>
          <Button onClick={() => void load()}>刷新</Button>
        </div>
        <Table rowKey="id" loading={loading} columns={columns} dataSource={projects} pagination={{ pageSize: 8 }} scroll={{ x: 1050 }} />
      </section>

      <Drawer title="新建立项" open={open} width={480} onClose={() => setOpen(false)}>
        <Form form={form} layout="vertical" initialValues={{ projectCategory: "civil_upgrade" }} onFinish={create}>
          <Form.Item name="projectName" label="项目名称" rules={[{ required: true, min: 3, message: "请输入至少三个字的项目名称" }]}>
            <Input size="large" placeholder="例如：地下车库伸缩缝渗漏改造" />
          </Form.Item>
          <Form.Item name="projectCategory" label="工程类别" rules={[{ required: true }]}>
            <Select size="large" options={pilotCategoryOptions} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={saving} block size="large">创建并开始访谈</Button>
        </Form>
      </Drawer>
    </div>
  );
}
