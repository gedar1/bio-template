/**
 * Barrel export de todos los átomos (funciones puras).
 */
export { cleanSchemaForLLM, deduplicateTools } from "./schema.js";
export {
  formatToolsForAnthropic,
  formatToolsForGemini,
  formatToolsForOpenAI,
} from "./toolFormat.js";
export { chooseModel } from "./modelSelection.js";
export { resolveTools, resolveAllTools } from "./registry.js";
export type { CellTypeDefinition } from "./registry.js";
export type {
  JSONSchemaObject,
  LLMTool,
} from "../system/providers/providerTypes.js";
export {
  computeEmbedding,
  cosineSimilarity,
  normalizeSequence,
  normalizeForEmbedding,
  serializeEmbedding,
  deserializeEmbedding,
  preloadPipeline,
} from "./embeddings.js";
export type { Embedding } from "./embeddings.js";
export {
  extractParamsForReflex,
  extractParamsFromText,
} from "./paramExtractor.js";
export type { ExtractedParams, StepParams } from "./paramExtractor.js";
export {
  deriveTemplate,
  interpolateTemplate,
  serializeArgTemplates,
  deserializeArgTemplates,
} from "./interpolation.js";
export type {
  TemplatePlaceholder,
  ArgTemplate,
  ReflexArgTemplates,
} from "./interpolation.js";
export { summarizeToolResult } from "./toolResultFormatter.js";
export { getModuleDir, getProjectRoot } from "./paths.js";
export { preCellRoute } from "./cellRouter.js";
export type { CellRouteResult, RouterHistoryEntry } from "./cellRouter.js";
export {
  checkExecutionSafety,
  isGuardedTool,
  getToolRiskLevel,
} from "./executionGuardrail.js";
export type { GuardrailResult } from "./executionGuardrail.js";
