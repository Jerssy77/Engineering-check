type JsonSchema = Record<string, unknown>;

const stringSchema: JsonSchema = { type: "string" };
const numberSchema: JsonSchema = { type: "number" };
const booleanSchema: JsonSchema = { type: "boolean" };

const enumSchema = (...values: string[]): JsonSchema => ({ type: "string", enum: values });
const arraySchema = (items: JsonSchema): JsonSchema => ({ type: "array", items });
const nullableSchema = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: "null" }] });
const objectSchema = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false
});

const strings = arraySchema(stringSchema);
const option = objectSchema({ value: stringSchema, label: stringSchema });
const parameter = objectSchema({
  name: stringSchema,
  recommendedValue: nullableSchema(stringSchema),
  allowedRange: nullableSchema(stringSchema),
  confirmationMethod: stringSchema,
  status: enumSchema("recommended", "range", "field_confirm")
});
const module = objectSchema({
  key: enumSchema("scope", "technical_route", "materials", "process", "risk_controls", "acceptance"),
  content: stringSchema,
  basis: strings,
  parameters: arraySchema(parameter)
});
const quantityItem = objectSchema({
  itemName: stringSchema,
  specification: stringSchema,
  unit: stringSchema,
  measurementBasis: stringSchema,
  sourceModuleKey: enumSchema("scope", "technical_route", "materials", "process", "risk_controls", "acceptance"),
  referenceUnitPriceLow: nullableSchema(numberSchema),
  referenceUnitPriceHigh: nullableSchema(numberSchema),
  referencePriceBasis: nullableSchema(stringSchema)
});
const tradeoffs = objectSchema({
  resolution: stringSchema,
  durability: stringSchema,
  constructionImpact: stringSchema,
  risk: stringSchema,
  costLevel: stringSchema
});
const schemeOption = objectSchema({
  title: stringSchema,
  kind: enumSchema("conditional"),
  summary: stringSchema,
  applicability: strings,
  tradeoffs,
  modules: arraySchema(module),
  quantityItems: arraySchema(quantityItem)
});

export const GUIDED_OUTPUT_SCHEMAS = {
  fingerprint: objectSchema({
    discipline: stringSchema,
    system: stringSchema,
    object: stringSchema,
    problemMode: stringSchema,
    proposedAction: stringSchema,
    impactScope: stringSchema,
    intent: enumSchema("corrective_repair", "lifecycle_renewal", "quality_upgrade", "compliance_rectification", "efficiency_upgrade", "capacity_upgrade"),
    businessObjective: stringSchema,
    scopeStrategy: enumSchema("single_object", "condition_based", "uniform_standard", "phased_program"),
    basis: strings
  }),
  blueprint: objectSchema({
    summary: stringSchema,
    propositions: arraySchema(objectSchema({
      id: stringSchema,
      stage: enumSchema("necessity", "feasibility"),
      gate: enumSchema("principle", "scope_strategy", "implementation_readiness"),
      statement: stringSchema,
      requiredFacts: arraySchema(objectSchema({
        key: stringSchema,
        label: stringSchema,
        maturity: enumSchema("confirmed", "measured", "documented", "estimated", "deferred", "unknown"),
        impacts: arraySchema(enumSchema("necessity", "technical_route", "selection", "safety", "quantity", "acceptance"))
      })),
      passCondition: stringSchema,
      rejectCondition: stringSchema
    })),
    routeFactors: strings,
    candidateRoutes: arraySchema(objectSchema({
      name: stringSchema,
      mechanism: stringSchema,
      applicability: strings,
      exclusions: strings,
      criticalParameters: strings
    })),
    deferredAllowed: strings,
    antiEvasionTerms: strings
  }),
  necessity_understanding: objectSchema({
    summary: stringSchema,
    facts: strings,
    missingFacts: strings,
    evidenceRequest: nullableSchema(objectSchema({
      purpose: stringSchema,
      acceptedTypes: arraySchema(enumSchema("photo", "work_order", "inspection", "test", "complaint", "equipment_record", "other")),
      required: booleanSchema
    }))
  }),
  stage_assessment: objectSchema({
    tendency: enumSchema("leaning_approved", "needs_information", "leaning_not_approved"),
    summary: stringSchema,
    reasons: strings,
    missingFacts: strings,
    implementationConditions: strings,
    followUpQuestionIds: strings,
    supplementFields: arraySchema(objectSchema({
      id: stringSchema,
      label: stringSchema,
      inputType: enumSchema("text", "textarea", "number", "select"),
      placeholder: nullableSchema(stringSchema),
      unit: nullableSchema(stringSchema),
      required: booleanSchema,
      options: arraySchema(option)
    })),
    dataCollectionRecommended: booleanSchema,
    scopeCalibration: nullableSchema(objectSchema({
      required: booleanSchema,
      declaredScope: stringSchema,
      supportedScope: stringSchema,
      unsupportedScope: stringSchema,
      reason: stringSchema,
      basis: strings
    })),
    propositionResults: arraySchema(objectSchema({
      propositionId: stringSchema,
      status: enumSchema("established", "missing", "contradicted"),
      rationale: stringSchema
    }))
  }),
  data_collection: objectSchema({
    title: stringSchema,
    description: stringSchema,
    rowLabel: stringSchema,
    instructions: strings,
    maxRows: { type: "integer" },
    columns: arraySchema(objectSchema({
      id: stringSchema,
      label: stringSchema,
      dataType: enumSchema("text", "number", "date", "select"),
      unit: nullableSchema(stringSchema),
      required: booleanSchema,
      options: strings
    }))
  }),
  scheme: objectSchema({
    modules: arraySchema(module),
    quantityItems: arraySchema(quantityItem),
    alternatives: arraySchema(schemeOption)
  }),
  scheme_review: objectSchema({
    passed: booleanSchema,
    summary: stringSchema,
    defects: arraySchema(objectSchema({
      code: stringSchema,
      message: stringSchema,
      severity: enumSchema("blocking", "warning")
    }))
  }),
  decision: objectSchema({
    outcome: enumSchema("approved", "supplement_required", "not_approved"),
    reasons: strings,
    conditions: strings
  })
} as const;

export type GuidedOutputSchemaName = keyof typeof GUIDED_OUTPUT_SCHEMAS;
export type GuidedStructuredOutputMode = "auto" | "strict" | "json_object";

function isOfficialOpenAIBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === "api.openai.com";
  } catch {
    return false;
  }
}

export function resolveGuidedResponseFormat(
  baseUrl: string,
  schemaName: GuidedOutputSchemaName,
  configuredMode = process.env.AI_STRUCTURED_OUTPUTS_MODE
): { strict: boolean; responseFormat: Record<string, unknown> } {
  const normalized = (configuredMode ?? "auto").trim().toLowerCase();
  const mode: GuidedStructuredOutputMode = normalized === "strict" || normalized === "json_object" ? normalized : "auto";
  const strict = mode === "strict" || (mode === "auto" && isOfficialOpenAIBaseUrl(baseUrl));
  return strict
    ? {
        strict: true,
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: `guided_${schemaName}`,
            strict: true,
            schema: GUIDED_OUTPUT_SCHEMAS[schemaName]
          }
        }
      }
    : { strict: false, responseFormat: { type: "json_object" } };
}
