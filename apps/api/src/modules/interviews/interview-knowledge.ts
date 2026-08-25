import {
  KnowledgeRelease,
  ProjectCategory,
  QuestionDefinition
} from "@property-review/shared";

const PILOT_CATEGORIES: ProjectCategory[] = ["civil_upgrade", "mep_upgrade"];

const questions: QuestionDefinition[] = [
  {
    id: "necessity.problem_evidence_type",
    stage: "necessity",
    title: "目前已有哪类证明材料？",
    responseType: "multi_choice",
    options: [
      { value: "photo", label: "现场照片" },
      { value: "work_order", label: "工单或报修记录" },
      { value: "inspection", label: "巡检记录" },
      { value: "test", label: "检测或运行数据" },
      { value: "complaint", label: "投诉记录" },
      { value: "equipment_record", label: "设备报警或维保记录" },
      { value: "unknown", label: "目前没有可用材料" }
    ],
    categories: PILOT_CATEGORIES,
    required: true,
    critical: true,
    factKey: "problem_evidence_type"
  },
  {
    id: "necessity.problem_summary",
    stage: "necessity",
    title: "现场最主要的问题是什么？",
    helpText: "一句话说明现象即可，不需要撰写完整报告。",
    responseType: "short_text",
    categories: PILOT_CATEGORIES,
    required: true,
    critical: true,
    factKey: "problem_summary"
  },
  {
    id: "necessity.project_location",
    stage: "necessity",
    title: "项目在哪里，影响多大范围？",
    responseType: "location_form",
    categories: PILOT_CATEGORIES,
    required: true,
    critical: true,
    factKey: "project_location"
  },
  {
    id: "necessity.consequence",
    stage: "necessity",
    title: "如果暂不改造，最主要的后果是什么？",
    responseType: "single_choice",
    options: [
      { value: "safety", label: "安全或合规风险" },
      { value: "function", label: "功能失效或运行中断" },
      { value: "customer", label: "持续影响客户使用" },
      { value: "cost", label: "维修和运营成本持续增加" },
      { value: "energy", label: "能耗浪费" },
      { value: "appearance", label: "主要是形象或观感改善" },
      { value: "unknown", label: "暂时无法判断" }
    ],
    categories: PILOT_CATEGORIES,
    required: true,
    critical: true,
    factKey: "consequence"
  },
  {
    id: "necessity.repair_alternative",
    stage: "necessity",
    title: "通过常规维修能否解决问题？",
    responseType: "single_choice",
    options: [
      { value: "no", label: "不能，需要系统性改造" },
      { value: "temporary", label: "只能短期缓解" },
      { value: "yes", label: "可以通过常规维修解决" },
      { value: "unknown", label: "尚未判断" }
    ],
    categories: PILOT_CATEGORIES,
    required: true,
    critical: false,
    factKey: "repair_alternative"
  },
  {
    id: "necessity.problem_history",
    stage: "necessity",
    title: "补充问题发生与既往处理情况",
    helpText: "填写已知信息即可，不确定的项目可以暂时留空。",
    responseType: "fact_form",
    formFields: [
      { id: "period", label: "统计时间范围", inputType: "text", placeholder: "如：近6个月" },
      { id: "occurrence_count", label: "发生或报修次数", inputType: "number", unit: "次" },
      { id: "previous_action", label: "做过哪些处理", inputType: "text", placeholder: "如：局部修补、临时封堵、设备检修" },
      { id: "result", label: "处理后的效果", inputType: "select", options: [{ value: "resolved", label: "已解决" }, { value: "temporary", label: "短期缓解后复发" }, { value: "ineffective", label: "效果不明显" }, { value: "unknown", label: "不清楚" }] },
      { id: "service_impact", label: "对运行或使用的影响", inputType: "text", placeholder: "如：停机、封闭区域、客户投诉、能耗增加" },
      { id: "cost", label: "已发生费用（如已知）", inputType: "number", unit: "元" }
    ],
    categories: ["mep_upgrade", "plumbing_drainage"],
    required: false,
    critical: false,
    factKey: "problem_history"
  },
  {
    id: "necessity.condition_history",
    stage: "necessity",
    title: "补充病害发生与变化情况",
    helpText: "用于判断是局部维修还是需要系统治理。",
    responseType: "fact_form",
    formFields: [
      { id: "period", label: "首次发现或统计时间", inputType: "text", placeholder: "如：2025年雨季首次发现" },
      { id: "trigger", label: "通常在什么条件下发生", inputType: "text", placeholder: "如：连续降雨、满负荷运行、温差变化" },
      { id: "range_change", label: "范围是否扩大", inputType: "select", options: [{ value: "expanded", label: "持续扩大" }, { value: "stable", label: "范围基本稳定" }, { value: "intermittent", label: "间歇反复" }, { value: "unknown", label: "不清楚" }] },
      { id: "previous_action", label: "既往做过哪些处理", inputType: "text", placeholder: "如：注浆、补缝、面层修复" },
      { id: "result", label: "既往处理效果", inputType: "select", options: [{ value: "resolved", label: "已解决" }, { value: "temporary", label: "短期缓解后复发" }, { value: "ineffective", label: "效果不明显" }, { value: "unknown", label: "不清楚" }] },
      { id: "service_impact", label: "对使用、安全或环境的影响", inputType: "text" }
    ],
    categories: ["civil_upgrade"],
    required: false,
    critical: false,
    factKey: "condition_history"
  },
  {
    id: "necessity.compliance_history",
    stage: "necessity",
    title: "补充风险发现与临时控制情况",
    responseType: "fact_form",
    formFields: [
      { id: "source", label: "风险由何种检查发现", inputType: "text", placeholder: "如：消防检查、专项检测、巡检" },
      { id: "finding_date", label: "发现时间", inputType: "text" },
      { id: "affected_function", label: "影响的系统能力或区域", inputType: "text" },
      { id: "temporary_control", label: "目前采取的临时保障措施", inputType: "text" },
      { id: "deadline", label: "是否有整改时限", inputType: "text" }
    ],
    categories: ["fire_safety"],
    required: false,
    critical: false,
    factKey: "compliance_history"
  },
  {
    id: "necessity.performance_baseline",
    stage: "necessity",
    title: "补充当前性能与改造基线",
    responseType: "fact_form",
    formFields: [
      { id: "period", label: "统计周期", inputType: "text", placeholder: "如：近12个月" },
      { id: "current_metric", label: "当前能耗或性能指标", inputType: "text" },
      { id: "comparison", label: "可比较的基准", inputType: "text", placeholder: "如：去年同期、同类设备、设计值" },
      { id: "operating_condition", label: "主要运行条件", inputType: "text" },
      { id: "impact", label: "当前问题造成的影响", inputType: "text" }
    ],
    categories: ["energy_retrofit"],
    required: false,
    critical: false,
    factKey: "performance_baseline"
  },
  {
    id: "feasibility.scope_components",
    stage: "feasibility",
    title: "这次准备改哪些部分？",
    responseType: "scope_selector",
    options: [
      { value: "main_object", label: "主要设备或改造对象" },
      { value: "connected_system", label: "配套管线、电缆或连接系统" },
      { value: "base_support", label: "基础、基层或支吊架" },
      { value: "surface_restore", label: "面层、保温或装饰恢复" },
      { value: "protection", label: "围挡与成品保护" },
      { value: "testing", label: "调试、检测与验收" },
      { value: "other", label: "其他" }
    ],
    categories: PILOT_CATEGORIES,
    required: true,
    critical: true,
    factKey: "scope_components"
  },
  {
    id: "feasibility.shutdown",
    stage: "feasibility",
    title: "施工是否需要停水、停电、停机或系统切换？",
    responseType: "single_choice",
    options: [
      { value: "none", label: "不需要" },
      { value: "short", label: "需要短时切换" },
      { value: "long", label: "需要较长时间停运" },
      { value: "unknown", label: "尚未确认" }
    ],
    categories: PILOT_CATEGORIES,
    required: true,
    critical: true,
    factKey: "shutdown"
  },
  {
    id: "feasibility.fire_impact",
    stage: "feasibility",
    title: "施工是否影响消防系统或消防安全能力？",
    responseType: "single_choice",
    options: [
      { value: "yes", label: "是" },
      { value: "no", label: "否" },
      { value: "unknown", label: "尚未确认" }
    ],
    categories: PILOT_CATEGORIES,
    required: true,
    critical: true,
    factKey: "fire_impact"
  },
  {
    id: "feasibility.occupied_impact",
    stage: "feasibility",
    title: "施工是否影响正在使用的区域或客户通行？",
    responseType: "single_choice",
    options: [
      { value: "yes", label: "是" },
      { value: "no", label: "否" },
      { value: "unknown", label: "尚未确认" }
    ],
    categories: PILOT_CATEGORIES,
    required: true,
    critical: false,
    factKey: "occupied_impact"
  },
  {
    id: "feasibility.concealed_work",
    stage: "feasibility",
    title: "是否包含后续会被覆盖的隐蔽工程？",
    responseType: "single_choice",
    options: [
      { value: "yes", label: "是" },
      { value: "no", label: "否" },
      { value: "unknown", label: "尚未确认" }
    ],
    categories: PILOT_CATEGORIES,
    required: true,
    critical: false,
    factKey: "concealed_work"
  },
  {
    id: "feasibility.hot_work",
    stage: "feasibility",
    title: "施工是否包含焊接、切割等动火作业？",
    responseType: "single_choice",
    options: [
      { value: "yes", label: "是" },
      { value: "no", label: "否" },
      { value: "unknown", label: "尚未确认" }
    ],
    categories: PILOT_CATEGORIES,
    required: true,
    critical: false,
    factKey: "hot_work"
  },
  {
    id: "feasibility.working_at_height",
    stage: "feasibility",
    title: "施工是否包含高处作业？",
    responseType: "single_choice",
    options: [
      { value: "yes", label: "是" },
      { value: "no", label: "否" },
      { value: "unknown", label: "尚未确认" }
    ],
    categories: PILOT_CATEGORIES,
    required: true,
    critical: false,
    factKey: "working_at_height"
  },
  {
    id: "feasibility.third_party_testing",
    stage: "feasibility",
    title: "验收是否需要第三方检测或专项检测？",
    responseType: "single_choice",
    options: [
      { value: "yes", label: "需要" },
      { value: "no", label: "不需要" },
      { value: "unknown", label: "由方案进一步判断" }
    ],
    categories: PILOT_CATEGORIES,
    required: true,
    critical: false,
    factKey: "third_party_testing"
  },
  {
    id: "feasibility.execution_window",
    stage: "feasibility",
    title: "预计在什么时间窗口实施？",
    helpText: "例如：9月夜间施工，或冬季停机窗口。",
    responseType: "short_text",
    categories: PILOT_CATEGORIES,
    required: true,
    critical: true,
    factKey: "execution_window"
  },
  {
    id: "feasibility.acceptance_target",
    stage: "feasibility",
    title: "完成后用什么结果判断改造有效？",
    helpText: "例如：连续运行72小时无异常，或闭水试验不再渗漏。",
    responseType: "short_text",
    categories: PILOT_CATEGORIES,
    required: true,
    critical: true,
    factKey: "acceptance_target"
  }
];

function buildSchemeTemplates(): KnowledgeRelease["schemeTemplates"] {
  return {
    civil_upgrade: {
      objective: "以消除已确认病害、恢复使用功能并降低重复维修风险为目标",
      scope: "严格按已确认的包含范围和排除范围组织实施，不作无依据扩项",
      process: "遵循先复核、再保护、后修复、最终恢复和验收的施工顺序",
      materials: "材料选型应与基层、使用环境和既有材料相容，并兼顾耐久与可维护性",
      risk_controls: "施工组织须覆盖围挡、成品保护、占用区协调及已触发的专项作业要求",
      acceptance: "验收同时覆盖过程记录、隐蔽节点、完工观感和可验证功能目标"
    },
    mep_upgrade: {
      objective: "以恢复系统稳定运行、降低故障停机和改善后期维护为目标",
      scope: "严格按已确认的设备、系统接口和排除范围组织实施，不作无依据扩项",
      process: "遵循先复核隔离、再安装接入、后单机调试和系统联调的实施顺序",
      materials: "设备材料须与现有容量、接口、控制协议和维护条件兼容",
      risk_controls: "施工组织须覆盖系统隔离、临时保障、切换恢复及已触发的专项作业要求",
      acceptance: "验收同时覆盖到货安装、单机运行、系统联动、试运行和可验证功能目标"
    }
  } satisfies KnowledgeRelease["schemeTemplates"];
}

export function buildInitialKnowledgeRelease(createdBy: string, now: string): Omit<KnowledgeRelease, "id"> {
  return {
    version: 1,
    name: "土建与机电智能访谈首发版",
    status: "published",
    categories: PILOT_CATEGORIES,
    questions,
    schemeTemplates: buildSchemeTemplates(),
    changeNote: "首期影子运行：受控题库、结构化方案和历史成本比较。",
    createdBy,
    createdAt: now,
    publishedAt: now
  };
}

export const INTERVIEW_STAGE_ORDER = ["necessity", "feasibility", "scheme", "cost", "decision"] as const;
