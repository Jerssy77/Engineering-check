"use client";

import { PlusOutlined } from "@ant-design/icons";
import { ProjectStatus } from "@property-review/shared";
import {
  Button,
  Col,
  Drawer,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useState } from "react";

import { StatusTag } from "../../../components/status-tag";
import { apiRequest } from "../../../lib/api";
import {
  categoryLabels,
  formatCurrency,
  formatDateTime,
  issueSourceOptions,
  labelFromMap,
  priorityOptions,
  projectCategoryOptions
} from "../../../lib/presentation";
import { getSession } from "../../../lib/session";

interface ProjectRow {
  id: string;
  title: string;
  category: string;
  status: ProjectStatus;
  organizationName: string;
  currentVersionNumber: number;
  updatedAt: string;
  budgetAmount: number;
  locationSummary: string;
  duplicateFlag: boolean;
}

interface QuotaInfo {
  used: number;
  remaining: number;
  policy: {
    weeklyQuotaPerCity: number;
    resubmitCooldownDays: number;
  };
}

type CreateProjectForm = {
  projectName: string;
  projectCategory: "mep_upgrade" | "fire_safety" | "energy_retrofit" | "civil_upgrade" | "plumbing_drainage";
  priority: "low" | "medium" | "high";
  budgetAmount: number;
  expectedStartDate: string;
  expectedEndDate: string;
  propertyName: string;
  building: string;
  floor: string;
  area: string;
  room: string;
  equipmentPoint: string;
  issueSourceType:
    | "inspection"
    | "complaint"
    | "work_order"
    | "safety_hazard"
    | "energy_optimization"
    | "repair_renewal"
    | "other";
  issueDescription: string;
};

const initialForm: CreateProjectForm = {
  projectName: "",
  projectCategory: "mep_upgrade",
  priority: "medium",
  budgetAmount: 300000,
  expectedStartDate: "2026-04-10",
  expectedEndDate: "2026-05-20",
  propertyName: "",
  building: "",
  floor: "",
  area: "",
  room: "",
  equipmentPoint: "",
  issueSourceType: "inspection",
  issueDescription: ""
};

export default function ProjectsPage() {
  const router = useRouter();
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<CreateProjectForm>();
  const session = getSession();
  const isSubmitter = session?.user.role === "submitter";

  const load = async (options?: { background?: boolean; suppressErrors?: boolean }) => {
    if (!session) {
      router.replace("/login");
      return;
    }

    if (!options?.background) {
      setLoading(true);
    }
    try {
      const projectData = await apiRequest<ProjectRow[]>("/projects", {}, session);
      const quotaData = isSubmitter ? await apiRequest<QuotaInfo>("/quota/me", {}, session) : null;
      setProjects(projectData);
      setQuota(quotaData);
    } catch (error) {
      if (!options?.suppressErrors) {
        messageApi.error(error instanceof Error ? error.message : "立项列表加载失败");
      }
    } finally {
      if (!options?.background) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!projects.some((item) => item.status === "ai_reviewing")) {
      return;
    }

    const timer = window.setInterval(() => {
      void load({ background: true, suppressErrors: true });
    }, 5000);

    return () => window.clearInterval(timer);
  }, [projects]);

  const createProject = async (values: CreateProjectForm) => {
    if (!isSubmitter) {
      messageApi.error("只有申报人账号可以创建草稿");
      return;
    }

    setSaving(true);
    try {
      const detail = await apiRequest<{ project: { id: string } }>("/projects", {
        method: "POST",
        body: JSON.stringify(values)
      });
      messageApi.success("已创建草稿");
      setDrawerOpen(false);
      form.resetFields();
      startTransition(() => router.push(`/projects/${detail.project.id}`));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "创建草稿失败");
    } finally {
      setSaving(false);
    }
  };

  const stats = useMemo(() => {
    const total = projects.length;
    const reviewing = projects.filter((item) => item.status === "ai_reviewing").length;
    const approved = projects.filter((item) => item.status === "human_approved").length;
    const duplicate = projects.filter((item) => item.duplicateFlag).length;
    return { total, reviewing, approved, duplicate };
  }, [projects]);

  const columns: ColumnsType<ProjectRow> = [
    {
      title: "项目",
      dataIndex: "title",
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Link href={`/projects/${record.id}`}>
            <Typography.Text strong>{record.title}</Typography.Text>
          </Link>
          <Typography.Text type="secondary">{record.organizationName}</Typography.Text>
        </Space>
      )
    },
    {
      title: "分类",
      dataIndex: "category",
      render: (value) => <Tag className="tone-chip">{labelFromMap(categoryLabels, value)}</Tag>
    },
    {
      title: "当前状态",
      dataIndex: "status",
      render: (value) => <StatusTag status={value} />
    },
    {
      title: "位置摘要",
      dataIndex: "locationSummary",
      render: (value) => <Typography.Text type="secondary">{value}</Typography.Text>
    },
    {
      title: "预算",
      dataIndex: "budgetAmount",
      render: (value) => formatCurrency(value)
    },
    {
      title: "版本",
      dataIndex: "currentVersionNumber",
      render: (value) => `V${value}`
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      render: (value) => formatDateTime(value)
    }
  ];

  return (
    <div className="section-grid">
      {contextHolder}

      <section className="glass-card brand-frame page-hero">
        <div className="page-hero-grid">
          <Space direction="vertical" size={14} style={{ maxWidth: 760 }}>
            <span className="hero-kicker">立项与填报</span>
            <Typography.Title className="hero-title">
              城市公司立项工作台
            </Typography.Title>
            <Typography.Paragraph className="document-lead">
              在这里查看项目节奏、创建草稿、进入结构化填报以及跟踪 AI 预审和人工审批结果。
            </Typography.Paragraph>
            <Space wrap>
              {isSubmitter ? (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawerOpen(true)}>
                  新建立项草稿
                </Button>
              ) : null}
              <Button onClick={() => void load()}>刷新列表</Button>
            </Space>
          </Space>

          <div className="metric-grid">
            <div className="metric-card">
              <span>在管项目</span>
              <strong>{stats.total}</strong>
            </div>
            <div className="metric-card">
              <span>AI 审核中</span>
              <strong>{stats.reviewing}</strong>
            </div>
            <div className="metric-card">
              <span>人工已通过</span>
              <strong>{stats.approved}</strong>
            </div>
            <div className="metric-card">
              <span>{isSubmitter ? "本周剩余额度" : "重复风险"}</span>
              <strong>
                {isSubmitter
                  ? `${quota?.remaining ?? 0} / ${quota?.policy.weeklyQuotaPerCity ?? 0}`
                  : `${stats.duplicate} 项`}
              </strong>
            </div>
          </div>
        </div>
      </section>

      <div className="split-layout">
        <section className="section-surface document-table">
          <div className="panel-heading" style={{ marginBottom: 18 }}>
            <div>
              <Typography.Title level={4} className="section-title">
                当前项目列表
              </Typography.Title>
              <p>
                按统一的审批语义查看项目状态、版本、预算和时间节点，点击即可进入详情和填报页面。
              </p>
            </div>
          </div>

          <Table<ProjectRow>
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={projects}
            pagination={{ pageSize: 8 }}
          />
        </section>

        <Space direction="vertical" size={18} className="sticky-stack" style={{ width: "100%" }}>
          <section className="section-surface">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Typography.Title level={4} className="section-title">
                填报提示
              </Typography.Title>
              <div className="soft-link-list">
                <div className="soft-link-item">
                  <strong>先建草稿，再完成页签填报</strong>
                  <span>草稿页会自动保存，可以分次完成问题、技术方案、预算和附件整理。</span>
                </div>
                <div className="soft-link-item">
                  <strong>审批通过后直接输出</strong>
                  <span>人工审批通过的版本可直接打开最终审核报告、可行性报告和工程量清单。</span>
                </div>
              </div>
            </Space>
          </section>

          {isSubmitter ? (
            <section className="section-surface">
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Typography.Title level={4} className="section-title">
                  额度和冷却规则
                </Typography.Title>
                <div className="summary-grid">
                  <div className="summary-item">
                    <Typography.Text className="summary-label">本周 AI 额度</Typography.Text>
                    <strong>{quota ? `${quota.remaining} / ${quota.policy.weeklyQuotaPerCity}` : "--"}</strong>
                  </div>
                  <div className="summary-item">
                    <Typography.Text className="summary-label">已使用</Typography.Text>
                    <strong>{quota?.used ?? 0}</strong>
                    <Typography.Text type="secondary">
                      {`退回后冷却 ${quota?.policy.resubmitCooldownDays ?? 3} 天`}
                    </Typography.Text>
                  </div>
                </div>
              </Space>
            </section>
          ) : (
            <section className="section-surface">
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Typography.Title level={4} className="section-title">
                  审批视角
                </Typography.Title>
                <div className="summary-grid">
                  <div className="summary-item">
                    <Typography.Text className="summary-label">人工已通过</Typography.Text>
                    <strong>{stats.approved}</strong>
                    <Typography.Text type="secondary">
                      可直接打开正式成果页面与导出文件
                    </Typography.Text>
                  </div>
                  <div className="summary-item">
                    <Typography.Text className="summary-label">重复风险项</Typography.Text>
                    <strong>{stats.duplicate}</strong>
                    <Typography.Text type="secondary">
                      进入项目后可直接查看 AI 重复改造识别说明
                    </Typography.Text>
                  </div>
                </div>
              </Space>
            </section>
          )}
        </Space>
      </div>

      <Drawer
        title="创建立项草稿"
        open={drawerOpen}
        width={520}
        forceRender
        onClose={() => {
          setDrawerOpen(false);
          form.resetFields();
        }}
      >
        <Typography.Paragraph className="section-copy">
          先确认项目基线、位置和问题来源，其他细项会在后续分区填报页里自动保存完成。
        </Typography.Paragraph>

        <Form form={form} layout="vertical" initialValues={initialForm} onFinish={createProject}>
          <Form.Item
            name="projectName"
            label="项目名称"
            rules={[{ required: true, message: "请输入项目名称" }]}
          >
            <Input placeholder="例如：地下车库排水沟维修改造" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="projectCategory" label="改造类别" rules={[{ required: true }]}>
                <Select options={projectCategoryOptions} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="priority" label="优先级" rules={[{ required: true }]}>
                <Select options={priorityOptions} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="expectedStartDate" label="计划开工" rules={[{ required: true }]}>
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="expectedEndDate" label="计划完工" rules={[{ required: true }]}>
                <Input type="date" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="budgetAmount" label="申报预算（元）" rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="propertyName" label="楼盘 / 项目" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="building" label="楼栋">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="floor" label="楼层">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="area" label="区域 / 系统">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="room" label="房间 / 点位">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="equipmentPoint" label="设备 / 组件">
            <Input />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="issueSourceType" label="问题来源" rules={[{ required: true }]}>
                <Select options={issueSourceOptions} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="issueDescription"
            label="问题描述"
            rules={[{ required: true, message: "请输入问题描述" }]}
          >
            <Input.TextArea
              rows={4}
              placeholder="简要说明问题现象、影响范围和立项背景"
            />
          </Form.Item>

          <Button type="primary" htmlType="submit" loading={saving} block style={{ height: 46 }}>
            创建草稿并进入填报
          </Button>
        </Form>
      </Drawer>
    </div>
  );
}
