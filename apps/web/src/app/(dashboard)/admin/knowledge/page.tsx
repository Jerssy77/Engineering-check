"use client";

import { KnowledgeRelease, QuestionDefinition, SchemeModuleKey } from "@property-review/shared";
import { ArrowLeftOutlined, CopyOutlined, DeleteOutlined, EditOutlined, HistoryOutlined, RollbackOutlined, RocketOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Drawer, Form, Input, List, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { apiRequest } from "../../../../lib/api";
import { categoryLabels, formatDateTime, labelFromMap } from "../../../../lib/presentation";
import { getSession } from "../../../../lib/session";

const stageLabels = { necessity: "必要性", feasibility: "可行性", scheme: "方案", cost: "成本" };
const moduleLabels: Record<SchemeModuleKey, string> = { objective: "目标", scope: "范围", process: "工艺", materials: "材料", risk_controls: "风险措施", acceptance: "验收" };

function normalizeRelease(release: KnowledgeRelease): KnowledgeRelease {
  return { ...release, questions: release.questions ?? [], schemeTemplates: release.schemeTemplates ?? {} };
}

export default function KnowledgeWorkbenchPage() {
  const router = useRouter();
  const [session, setSession] = useState<ReturnType<typeof getSession>>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const [releases, setReleases] = useState<KnowledgeRelease[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [draft, setDraft] = useState<KnowledgeRelease | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<QuestionDefinition | null>(null);
  const [replayResult, setReplayResult] = useState<Record<string, unknown> | null>(null);

  const load = async (preferId?: string) => {
    if (!session) return router.replace("/login");
    if (session.user.role !== "admin") return router.replace("/admin");
    setLoading(true);
    try {
      const data = await apiRequest<KnowledgeRelease[]>("/admin/knowledge/releases", {}, session);
      const normalized = data.map(normalizeRelease);
      setReleases(normalized);
      const selected = normalized.find((item) => item.id === (preferId ?? selectedId)) ?? normalized[0];
      setSelectedId(selected?.id);
      setDraft(selected ? structuredClone(selected) : null);
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "知识版本加载失败"); }
    finally { setLoading(false); }
  };

  useEffect(() => { setSession(getSession()); setSessionReady(true); }, []);
  useEffect(() => { if (sessionReady) void load(); }, [sessionReady]);
  const selected = useMemo(() => releases.find((item) => item.id === selectedId), [releases, selectedId]);
  const selectRelease = (release: KnowledgeRelease) => { setSelectedId(release.id); setDraft(structuredClone(normalizeRelease(release))); };

  const createDraft = async () => {
    setSaving(true);
    try {
      const created = await apiRequest<KnowledgeRelease>("/admin/knowledge/releases", { method: "POST" }, session);
      await load(created.id);
      messageApi.success("已从当前发布版创建新草稿");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "创建草稿失败"); }
    finally { setSaving(false); }
  };

  const save = async (): Promise<boolean> => {
    if (!draft || draft.status !== "draft") return false;
    setSaving(true);
    try {
      const updated = await apiRequest<KnowledgeRelease>(`/admin/knowledge/releases/${draft.id}`, { method: "PATCH", body: JSON.stringify({ name: draft.name, changeNote: draft.changeNote, questions: draft.questions, schemeTemplates: draft.schemeTemplates }) }, session);
      const normalized = normalizeRelease(updated);
      setDraft(normalized);
      setReleases((items) => items.map((item) => item.id === updated.id ? normalized : item));
      messageApi.success("草稿已保存");
      return true;
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "保存失败"); return false; }
    finally { setSaving(false); }
  };

  const publish = async () => {
    if (!draft || !(await save())) return;
    setSaving(true);
    try {
      await apiRequest(`/admin/knowledge/releases/${draft.id}/publish`, { method: "POST" }, session);
      await load(draft.id);
      messageApi.success("知识版本已发布，后续新访谈将使用该版本");
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "发布失败"); }
    finally { setSaving(false); }
  };

  const replay = async () => {
    if (!draft) return;
    try { setReplayResult(await apiRequest<Record<string, unknown>>(`/admin/knowledge/releases/${draft.id}/replay`, { method: "POST" }, session)); }
    catch (error) { messageApi.error(error instanceof Error ? error.message : "历史回放失败"); }
  };

  const rollback = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await apiRequest(`/admin/knowledge/releases/${selected.id}/rollback`, { method: "POST" }, session);
      await load();
      messageApi.success(`已将 V${selected.version} 内容作为新版本重新发布`);
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "回滚失败"); }
    finally { setSaving(false); }
  };

  const saveQuestion = (values: QuestionDefinition & { optionsText?: string; dependsOnQuestionId?: string; dependsOnValuesText?: string }) => {
    if (!draft || !editingQuestion) return;
    const options = editingQuestion.responseType === "single_choice"
      ? String(values.optionsText ?? "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => { const [value, label] = line.split("|"); return { value: value.trim(), label: (label ?? value).trim() }; })
      : undefined;
    const triggerValues = String(values.dependsOnValuesText ?? "").split(/[，,\n]/).map((item) => item.trim()).filter(Boolean);
    setDraft({ ...draft, questions: draft.questions.map((item) => item.id === editingQuestion.id ? {
      ...item,
      stage: values.stage,
      title: values.title,
      helpText: values.helpText,
      categories: values.categories,
      required: values.required,
      critical: values.critical,
      factKey: values.factKey,
      requiredEvidenceSlots: values.requiredEvidenceSlots,
      dependsOn: values.dependsOnQuestionId && triggerValues.length ? { questionId: values.dependsOnQuestionId, values: triggerValues } : undefined,
      options
    } : item) });
    setEditingQuestion(null);
  };

  const duplicateQuestion = (question: QuestionDefinition) => {
    if (!draft) return;
    const copy = { ...structuredClone(question), id: `${question.id}.copy.${Date.now()}`, title: `${question.title}（副本）`, factKey: `${question.factKey}_copy` };
    setDraft({ ...draft, questions: [...draft.questions, copy] });
    setEditingQuestion(copy);
  };

  if (!draft) return <Card loading={loading} />;
  const editable = draft.status === "draft";

  return (
    <div className="section-grid workspace-page knowledge-workspace">
      {contextHolder}
      <Card className="glass-card workspace-intro">
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <Link href="/admin"><Button type="text" icon={<ArrowLeftOutlined />}>返回管理看板</Button></Link>
          <div className="panel-heading"><div><span className="workspace-code">KNOWLEDGE / GOVERNANCE</span><Typography.Title level={2}>访谈知识工作台</Typography.Title><Typography.Paragraph>维护受控题库、方案模块和发布版本。人工改判只形成优化建议，不会自动改变正在使用的审查基线。</Typography.Paragraph></div><Button type="primary" icon={<CopyOutlined />} loading={saving} onClick={() => void createDraft()}>从发布版创建草稿</Button></div>
        </Space>
      </Card>

      <div className="split-layout">
        <Card title="知识版本" loading={loading}>
          <List dataSource={releases} renderItem={(item) => <List.Item onClick={() => selectRelease(item)} style={{ cursor: "pointer", background: item.id === selectedId ? "rgba(28,94,198,.06)" : undefined, paddingInline: 12, borderRadius: 12 }}><List.Item.Meta title={<Space>V{item.version} {item.name}<Tag color={item.status === "published" ? "green" : item.status === "draft" ? "blue" : "default"}>{item.status === "published" ? "已发布" : item.status === "draft" ? "草稿" : "历史"}</Tag></Space>} description={`${item.questions.length} 个问题 · ${formatDateTime(item.publishedAt ?? item.createdAt)}`} /></List.Item>} />
        </Card>

        <Space direction="vertical" size={18} style={{ width: "100%" }}>
          <Card title={`V${draft.version} ${draft.name}`} extra={<Tag>{editable ? "可编辑草稿" : "只读版本"}</Tag>}>
            <Space direction="vertical" size={14} style={{ width: "100%" }}>
              <Input value={draft.name} disabled={!editable} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              <Input.TextArea rows={3} value={draft.changeNote} disabled={!editable} placeholder="本次变更说明" onChange={(event) => setDraft({ ...draft, changeNote: event.target.value })} />
              <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[{ key: "category", label: "适用类别", children: draft.categories.map((item) => labelFromMap(categoryLabels, item)).join("、") }, { key: "created", label: "创建时间", children: formatDateTime(draft.createdAt) }]} />
              <Space wrap>{editable ? <Button onClick={() => void save()} loading={saving}>保存草稿</Button> : null}<Button icon={<HistoryOutlined />} onClick={() => void replay()}>历史回放</Button>{editable ? <Popconfirm title="确认发布该知识版本？" description="现有会话继续锁定原知识版本，新会话使用本版本。" onConfirm={() => void publish()}><Button type="primary" icon={<RocketOutlined />}>发布</Button></Popconfirm> : null}{!editable ? <Popconfirm title="确认回滚？" description="系统会复制该历史内容并作为一个新的知识版本发布。" onConfirm={() => void rollback()}><Button icon={<RollbackOutlined />}>回滚到此版本</Button></Popconfirm> : null}</Space>
            </Space>
          </Card>

          <Card title={`受控题库（${draft.questions.length}）`}>
            <Table rowKey="id" pagination={false} scroll={{ x: 1050 }} dataSource={draft.questions} columns={[
              { title: "阶段", dataIndex: "stage", width: 90, render: (value) => stageLabels[value as keyof typeof stageLabels] },
              { title: "问题", dataIndex: "title" },
              { title: "类型", dataIndex: "responseType", width: 90, render: (value) => value === "single_choice" ? "单选" : value === "number" ? "数字" : "简答" },
              { title: "关键", dataIndex: "critical", width: 70, render: (value) => value ? <Tag color="red">是</Tag> : "否" },
              { title: "适用类别", dataIndex: "categories", width: 150, render: (values: string[]) => values.map((value) => labelFromMap(categoryLabels, value)).join("、") },
              { title: "触发条件", dataIndex: "dependsOn", width: 150, render: (value?: QuestionDefinition["dependsOn"]) => value ? `${value.questionId} = ${value.values.join("/")}` : "始终显示" },
              { title: "操作", width: 150, render: (_, record) => editable ? <Space size={0}><Button type="text" icon={<EditOutlined />} aria-label="编辑题目" onClick={() => setEditingQuestion(record)} /><Button type="text" icon={<CopyOutlined />} aria-label="复制为新题" onClick={() => duplicateQuestion(record)} /><Popconfirm title="从草稿中删除该题？" onConfirm={() => setDraft({ ...draft, questions: draft.questions.filter((item) => item.id !== record.id) })}><Button type="text" danger icon={<DeleteOutlined />} aria-label="删除题目" /></Popconfirm></Space> : null }
            ]} />
          </Card>

          <Card title="方案模块库"><Space direction="vertical" size={18} style={{ width: "100%" }}>{draft.categories.map((category) => <div key={category}><Typography.Title level={5}>{labelFromMap(categoryLabels, category)}</Typography.Title>{(Object.keys(moduleLabels) as SchemeModuleKey[]).map((key) => <Form.Item key={key} label={moduleLabels[key]}><Input.TextArea rows={2} disabled={!editable} value={draft.schemeTemplates[category]?.[key]} onChange={(event) => setDraft({ ...draft, schemeTemplates: { ...draft.schemeTemplates, [category]: { ...draft.schemeTemplates[category], [key]: event.target.value } } })} /></Form.Item>)}</div>)}</Space></Card>
        </Space>
      </div>

      <Drawer title="编辑受控题目" open={Boolean(editingQuestion)} width="min(560px, calc(100vw - 16px))" onClose={() => setEditingQuestion(null)} destroyOnClose>
        {editingQuestion ? <Form layout="vertical" initialValues={{ ...editingQuestion, optionsText: editingQuestion.options?.map((item) => `${item.value}|${item.label}`).join("\n"), dependsOnQuestionId: editingQuestion.dependsOn?.questionId, dependsOnValuesText: editingQuestion.dependsOn?.values.join(",") }} onFinish={saveQuestion}>
          <Form.Item label="题目ID"><Input value={editingQuestion.id} disabled /></Form.Item>
          <Form.Item name="stage" label="判断阶段" rules={[{ required: true }]}><Select options={[{ value: "necessity", label: "必要性" }, { value: "feasibility", label: "可行性" }, { value: "scheme", label: "方案" }, { value: "cost", label: "成本" }]} /></Form.Item>
          <Form.Item name="title" label="问题表达" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="helpText" label="填写提示"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="factKey" label="结构化事实键" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="categories" label="适用工程类别" rules={[{ required: true }]}><Select mode="multiple" options={draft.categories.map((value) => ({ value, label: labelFromMap(categoryLabels, value) }))} /></Form.Item>
          {editingQuestion.responseType === "single_choice" ? <Form.Item name="optionsText" label="选项（每行：值|显示文字）" rules={[{ required: true }]}><Input.TextArea rows={8} /></Form.Item> : null}
          <Form.Item name="dependsOnQuestionId" label="触发题（可选）"><Select allowClear showSearch options={draft.questions.filter((item) => item.id !== editingQuestion.id).map((item) => ({ value: item.id, label: `${item.id} · ${item.title}` }))} /></Form.Item>
          <Form.Item name="dependsOnValuesText" label="触发值（逗号分隔）"><Input placeholder="例如：yes,partial" /></Form.Item>
          <Form.Item name="requiredEvidenceSlots" label="触发的材料槽位"><Select mode="multiple" allowClear options={[{ value: "issue_photos", label: "问题照片" }, { value: "fault_registry", label: "巡检/点位台账" }, { value: "drawings", label: "图纸" }, { value: "supplementary", label: "补充材料" }]} /></Form.Item>
          <Form.Item name="required" label="必答" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="critical" label="关键事实（选择不清楚时阻断）" valuePropName="checked"><Switch /></Form.Item>
          <Button type="primary" htmlType="submit">保存到草稿</Button>
        </Form> : null}
      </Drawer>

      <Modal width={900} title="历史回放结果" open={Boolean(replayResult)} onCancel={() => setReplayResult(null)} footer={<Button onClick={() => setReplayResult(null)}>关闭</Button>}>
        {replayResult ? <Space direction="vertical" size={16} style={{ width: "100%" }}><Descriptions column={{ xs: 1, sm: 2 }} items={Object.entries(replayResult).filter(([key]) => !["warnings", "caseResults"].includes(key)).map(([key, value]) => ({ key, label: key, children: String(value) }))} />{Array.isArray(replayResult.warnings) && replayResult.warnings.length ? <Alert type="warning" message={(replayResult.warnings as string[]).join("；")} /> : <Alert type="success" message="结构校验和分支可达性检查通过" />}<Table size="small" rowKey="projectId" pagination={{ pageSize: 6 }} dataSource={(replayResult.caseResults as Array<Record<string, unknown>>) ?? []} columns={[{ title: "项目", dataIndex: "projectName" }, { title: "类别", dataIndex: "category", render: (value) => labelFromMap(categoryLabels, value) }, { title: "历史批准", dataIndex: "approvedHistoricalCase", render: (value) => value ? <Tag color="green">是</Tag> : <Tag>否</Tag> }, { title: "核心事实缺口", dataIndex: "missingCoreFacts", render: (value: string[]) => value.length ? value.join("、") : <Tag color="green">可回放</Tag> }]} /></Space> : null}
      </Modal>
    </div>
  );
}
