"use client";

import { PlusOutlined } from "@ant-design/icons";
import { ProjectStatus } from "@property-review/shared";
import {
  Button,
  Card,
  Col,
  Drawer,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";

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
  issueSourceType: "inspection" | "complaint" | "work_order" | "safety_hazard" | "energy_optimization" | "repair_renewal" | "other";
  issueDescription: string;
};

const TEXT = {
  pageKicker: "\u7acb\u9879\u5de5\u4f5c\u53f0",
  pageTitle: "\u57ce\u5e02\u516c\u53f8\u7acb\u9879\u5217\u8868",
  pageDesc:
    "\u5728\u8fd9\u91cc\u521b\u5efa\u6807\u51c6\u5316\u8349\u7a3f\u3001\u67e5\u770b AI \u9884\u5ba1\u7ed3\u8bba\u3001\u8ddf\u8e2a\u989d\u5ea6\u4e0e\u51b7\u5374\u671f\uff0c\u5e76\u57fa\u4e8e\u65b0\u7248\u672c\u7ee7\u7eed\u9001\u5ba1\u3002",
  createDraft: "\u65b0\u5efa\u8349\u7a3f",
  viewMode: "\u53ea\u8bfb\u6d4f\u89c8",
  draftTitle: "\u521b\u5efa\u6807\u51c6\u5316\u7acb\u9879\u8349\u7a3f",
  draftDesc:
    "\u5148\u786e\u5b9a\u9879\u76ee\u57fa\u7840\u4fe1\u606f\u3001\u4f4d\u7f6e\u548c\u95ee\u9898\u6765\u6e90\uff0c\u8be6\u7ec6\u7684\u6280\u672f\u65b9\u6848\u3001\u6750\u6599\u69fd\u4f4d\u4e0e\u8d39\u7528\u6e05\u5355\u5728\u8be6\u60c5\u9875\u8865\u5168\u3002"
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
        messageApi.error(error instanceof Error ? error.message : "\u7acb\u9879\u5217\u8868\u52a0\u8f7d\u5931\u8d25");
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
      messageApi.error("\u53ea\u6709\u7533\u62a5\u4eba\u8d26\u53f7\u53ef\u4ee5\u521b\u5efa\u8349\u7a3f");
      return;
    }

    setSaving(true);
    try {
      const detail = await apiRequest<{ project: { id: string } }>("/projects", {
        method: "POST",
        body: JSON.stringify(values)
      });
      messageApi.success("\u5df2\u521b\u5efa\u8349\u7a3f");
      setDrawerOpen(false);
      form.resetFields();
      startTransition(() => router.push(`/projects/${detail.project.id}`));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "\u521b\u5efa\u8349\u7a3f\u5931\u8d25");
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnsType<ProjectRow> = [
    {
      title: "\u7acb\u9879",
      dataIndex: "title",
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Link href={`/projects/${record.id}`}>
            <Typography.Text strong>{record.title}</Typography.Text>
          </Link>
          <Typography.Text type="secondary">{record.organizationName}</Typography.Text>
        </Space>
      )
    },
    {
      title: "\u5206\u7c7b",
      dataIndex: "category",
      render: (value) => <Tag>{labelFromMap(categoryLabels, value)}</Tag>
    },
    {
      title: "\u4f4d\u7f6e",
      dataIndex: "locationSummary",
      render: (value) => <Typography.Text type="secondary">{value}</Typography.Text>
    },
    {
      title: "\u72b6\u6001",
      dataIndex: "status",
      render: (value) => <StatusTag status={value} />
    },
    {
      title: "\u7248\u672c",
      dataIndex: "currentVersionNumber",
      render: (value) => `V${value}`
    },
    {
      title: "\u9884\u7b97",
      dataIndex: "budgetAmount",
      render: (value) => formatCurrency(value)
    },
    {
      title: "\u91cd\u590d\u98ce\u9669",
      dataIndex: "duplicateFlag",
      render: (value) => (value ? <Tag color="orange">\u7591\u4f3c\u91cd\u590d</Tag> : <Tag>\u65e0</Tag>)
    },
    {
      title: "\u66f4\u65b0\u65f6\u95f4",
      dataIndex: "updatedAt",
      render: (value) => formatDateTime(value)
    }
  ];

  return (
    <div className="section-grid">
      {contextHolder}
      <section className="glass-card" style={{ padding: 28 }}>
        <Space direction="vertical" size={10}>
          <span className="hero-kicker">{TEXT.pageKicker}</span>
          <Typography.Title level={2} style={{ margin: 0 }}>
            {TEXT.pageTitle}
          </Typography.Title>
          <Typography.Paragraph style={{ maxWidth: 760, color: "#56636a", marginBottom: 0 }}>
            {TEXT.pageDesc}
          </Typography.Paragraph>
        </Space>
      </section>

      <Row gutter={[20, 20]}>
        <Col xs={24} lg={8}>
          <Card className="glass-card" styles={{ body: { padding: 24 } }}>
            {isSubmitter ? (
              <>
                <Typography.Text type="secondary">{"\u672c\u5468 AI \u989d\u5ea6"}</Typography.Text>
                <Typography.Title level={2} style={{ marginTop: 10 }}>
                  {quota ? `${quota.remaining} / ${quota.policy.weeklyQuotaPerCity}` : "--"}
                </Typography.Title>
                <Typography.Paragraph style={{ color: "#56636a" }}>
                  {`\u672c\u5468\u5df2\u4f7f\u7528 ${quota?.used ?? 0} \u6b21\uff0c\u9000\u56de\u540e\u51b7\u5374 ${quota?.policy.resubmitCooldownDays ?? 3} \u5929\u3002`}
                </Typography.Paragraph>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawerOpen(true)}>
                  {TEXT.createDraft}
                </Button>
              </>
            ) : (
              <>
                <Typography.Text type="secondary">{TEXT.viewMode}</Typography.Text>
                <Typography.Title level={2} style={{ marginTop: 10 }}>
                  {"\u5ba1\u6838\u4e0e\u7ba1\u7406\u89c6\u56fe"}
                </Typography.Title>
                <Typography.Paragraph style={{ color: "#56636a" }}>
                  {"\u53ef\u67e5\u770b\u5168\u90e8\u7acb\u9879\uff0c\u8fdb\u5165 AI \u7ed3\u8bba\u9875\u6267\u884c\u7ec8\u5ba1\u6216\u53d1\u653e\u7279\u6279\u3002"}
                </Typography.Paragraph>
              </>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card className="glass-card" styles={{ body: { padding: 24 } }}>
            <Statistic title={"\u5f85\u5904\u7406\u7acb\u9879"} value={projects.filter((item) => item.status !== "human_approved").length} />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card className="glass-card" styles={{ body: { padding: 24 } }}>
            <Statistic title={"\u5df2\u901a\u8fc7\u7acb\u9879"} value={projects.filter((item) => item.status === "human_approved").length} />
          </Card>
        </Col>
      </Row>

      <Card className="glass-card" styles={{ body: { padding: 22 } }}>
        <Table<ProjectRow> rowKey="id" loading={loading} columns={columns} dataSource={projects} pagination={{ pageSize: 6 }} />
      </Card>

      <Drawer title={TEXT.draftTitle} open={drawerOpen} width={760} onClose={() => setDrawerOpen(false)} destroyOnClose>
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          {TEXT.draftDesc}
        </Typography.Paragraph>
        <Form layout="vertical" form={form} initialValues={initialForm} onFinish={createProject}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="projectName" label={"\u9879\u76ee\u540d\u79f0"} rules={[{ required: true, message: "\u8bf7\u8f93\u5165\u9879\u76ee\u540d\u79f0" }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="projectCategory" label={"\u6539\u9020\u7c7b\u522b"} rules={[{ required: true, message: "\u8bf7\u9009\u62e9\u6539\u9020\u7c7b\u522b" }]}>
                <Select options={projectCategoryOptions} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="priority" label={"\u4f18\u5148\u7ea7"} rules={[{ required: true, message: "\u8bf7\u9009\u62e9\u4f18\u5148\u7ea7" }]}>
                <Select options={priorityOptions} />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item name="budgetAmount" label={"\u7533\u62a5\u603b\u9884\u7b97\uff08\u5143\uff09"} rules={[{ required: true, message: "\u8bf7\u8f93\u5165\u9884\u7b97" }]}>
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="expectedStartDate" label={"\u8ba1\u5212\u5f00\u5de5\u65f6\u95f4"} rules={[{ required: true, message: "\u8bf7\u9009\u62e9\u5f00\u5de5\u65f6\u95f4" }]}>
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="expectedEndDate" label={"\u8ba1\u5212\u5b8c\u5de5\u65f6\u95f4"} rules={[{ required: true, message: "\u8bf7\u9009\u62e9\u5b8c\u5de5\u65f6\u95f4" }]}>
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="propertyName" label={"\u697c\u76d8/\u9879\u76ee"} rules={[{ required: true, message: "\u8bf7\u8f93\u5165\u697c\u76d8/\u9879\u76ee" }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="building" label={"\u697c\u680b"}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="floor" label={"\u697c\u5c42"}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="area" label={"\u533a\u57df/\u7cfb\u7edf"}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="room" label={"\u623f\u95f4/\u70b9\u4f4d"}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="equipmentPoint" label={"\u8bbe\u5907/\u7ec4\u4ef6"}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="issueSourceType" label={"\u95ee\u9898\u6765\u6e90"} rules={[{ required: true, message: "\u8bf7\u9009\u62e9\u95ee\u9898\u6765\u6e90" }]}>
                <Select options={issueSourceOptions} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="issueDescription" label={"\u95ee\u9898\u63cf\u8ff0"} rules={[{ required: true, message: "\u8bf7\u7b80\u8981\u8bf4\u660e\u95ee\u9898" }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>{"\u53d6\u6d88"}</Button>
            <Button type="primary" htmlType="submit" loading={saving}>
              {TEXT.createDraft}
            </Button>
          </Space>
        </Form>
      </Drawer>
    </div>
  );
}
