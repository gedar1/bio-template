/**
 * Shared TypeScript interfaces for the BioCore Dashboard.
 * Covers all panels: templates, tools, reflex, circuit breaker,
 * mutations, logs, registry, websocket, roles, and navigation.
 */

import type React from "react";

// ─── Cell Types ─────────────────────────────────────────────────────────────

export type CellType =
  | "sensory"
  | "sensory_advanced"
  | "memory"
  | "filesystem"
  | "communication"
  | "versioncontrol"
  | "http"
  | "system"
  | "realtime"
  | "monitor"
  | "orders"
  | "inventory"
  | "delivery"
  | "undifferentiated";

// ─── Role System ────────────────────────────────────────────────────────────

export type UserRole = "super_admin" | "admin" | "operator" | "viewer";

export interface RoleConfig {
  role: UserRole;
  sections: string[];
  actions: string[];
}

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
  category: CellType;
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

// ─── Navigation ─────────────────────────────────────────────────────────────

export type SectionId =
  | "overview"
  | "operations"
  | "system"
  | "settings"
  | "platform";

export interface SectionDefinition {
  id: SectionId;
  label: string;
  icon: (props: { size?: number; className?: string }) => React.ReactNode;
  panels: string[];
}

export type BadgeType = "error" | "warning" | "info";

export interface NotificationBadge {
  sectionId: SectionId;
  count: number;
  type: BadgeType;
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

// ─── Registry Hierarchy (computed) ──────────────────────────────────────────

export interface HierarchyNode {
  type: string;
  description: string;
  tools: string[];
  children: HierarchyNode[];
}

// ─── Tool Schema (for form generation) ──────────────────────────────────────

export type SchemaPropertyType = "string" | "number" | "boolean";

export interface SchemaProperty {
  type: SchemaPropertyType;
  description?: string;
  required?: boolean;
}

export interface ToolInputSchema {
  properties: Record<string, SchemaProperty>;
  required?: string[];
}

export interface FormField {
  key: string;
  type: SchemaPropertyType;
  label: string;
  required: boolean;
  description?: string;
}

// ─── Log Filter Criteria ────────────────────────────────────────────────────

export interface LogFilterCriteria {
  level?: LogLevel;
  component?: string;
}

// ─── Mutation Filter Criteria ───────────────────────────────────────────────

export interface MutationFilterCriteria {
  cellType?: string;
  startTime?: number;
  endTime?: number;
}

// ─── Categorized Group ──────────────────────────────────────────────────────

export interface CategorizedGroup<T> {
  category: string;
  items: T[];
}
