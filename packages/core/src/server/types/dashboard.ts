/**
 * Shared backend types for the BioCore Dashboard API.
 * These mirror the frontend types for API contract consistency.
 */

// ─── Role System ────────────────────────────────────────────────────────────

export type UserRole = "super_admin" | "admin" | "operator" | "viewer";

export interface RoleConfig {
  role: UserRole;
  sections: string[];
  actions: string[];
}

/** Role hierarchy: super_admin > admin > operator > viewer */
export const ROLE_HIERARCHY: Record<UserRole, number> = {
  super_admin: 4,
  admin: 3,
  operator: 2,
  viewer: 1,
};

// ─── Task Templates ─────────────────────────────────────────────────────────

export interface TemplateParameter {
  key: string;
  label: string;
  type: "string" | "number" | "url" | "cron";
  required: boolean;
  placeholder?: string;
  validation?: { pattern?: string; min?: number; max?: number };
}

export interface TaskTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  expectedOutcome?: string;
  steps?: string[];
  parameters: TemplateParameter[];
  defaultIntervalMs: number;
  usesLLM: boolean;
  /** Perfil de industria al que pertenece (si no se indica, se muestra para todos) */
  profile?: string;
}

// ─── Circuit Breaker Status ─────────────────────────────────────────────────

export interface CircuitBreakerStatus {
  name: string;
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
  failureCount: number;
  successCount: number;
  lastTransition: number;
  isPrimary: boolean;
}

// ─── Mutation Event ─────────────────────────────────────────────────────────

export interface MutationEvent {
  id: number;
  timestamp: number;
  fromType: string;
  toType: string;
  stimulusSource: string;
  triggerReason: string;
  tenantId: string;
}

// ─── Log Entry ──────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  component: string;
  message: string;
  metadata?: Record<string, unknown>;
}

// ─── Reflex Metrics ─────────────────────────────────────────────────────────

export type ReflexMode = "REFLEX" | "HINT" | "NORMAL";

export interface ReflexMetrics {
  totalReflexes: number;
  hitRate: number;
  missRate: number;
  estimatedTokenSavings: number;
  currentMode: ReflexMode;
}

// ─── WebSocket Server Info ──────────────────────────────────────────────────

export interface WebSocketClientInfo {
  id: string;
  connectedAt: number;
  remoteAddress: string;
}

export interface WebSocketServerInfo {
  port: number;
  status: "running" | "stopped" | "error";
  clientCount: number;
  clients: WebSocketClientInfo[];
}

// ─── Registry ───────────────────────────────────────────────────────────────

export interface RegistryCellType {
  type: string;
  description: string;
  tools: string[];
  parent?: string;
}

export interface RegistryConfig {
  cells: RegistryCellType[];
}
