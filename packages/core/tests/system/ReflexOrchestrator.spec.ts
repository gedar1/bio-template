import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReflexOrchestrator } from "../../src/system/ReflexOrchestrator.js";
import type {
  ExecutionChainNode,
  ExecutionDependency,
} from "../../src/server/types/semantic.js";
import type { TenantDatabaseManager } from "../../src/infrastructure/TenantDatabaseManager.js";
import type { ILogger } from "../../src/config/ILogger.js";

// Mock logger
const createMockLogger = (): ILogger => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(function () {
    return this;
  }),
});

// Mock database manager
const createMockDatabaseManager = (): TenantDatabaseManager =>
  ({
    // Required by interface, will be stubbed as needed
  }) as unknown as TenantDatabaseManager;

describe("ReflexOrchestrator", () => {
  let orchestrator: ReflexOrchestrator;
  let mockLog: ILogger;
  let mockDb: TenantDatabaseManager;

  beforeEach(() => {
    mockLog = createMockLogger();
    mockDb = createMockDatabaseManager();
    orchestrator = new ReflexOrchestrator(mockLog, "tenant-test", mockDb);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // resolveOrder() — Topological sort tests
  // ────────────────────────────────────────────────────────────────────────────

  describe("resolveOrder", () => {
    it("returns same order when no dependencies exist", async () => {
      const chain: ExecutionChainNode[] = [
        {
          id: 1,
          task_summary: "Task 1",
          confidence: 90,
          status: "activated",
          execution_order: 1,
          depends_on: null,
        },
        {
          id: 2,
          task_summary: "Task 2",
          confidence: 85,
          status: "activated",
          execution_order: 2,
          depends_on: null,
        },
      ];

      const deps = new Map<number, number[]>();
      const result = await orchestrator.resolveOrder(chain, deps);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(2);
      expect(result[0].execution_order).toBe(1);
      expect(result[1].execution_order).toBe(2);
    });

    it("orders reflexes respecting linear dependencies (1→2→3)", async () => {
      const chain: ExecutionChainNode[] = [
        {
          id: 1,
          task_summary: "Scrape URL",
          confidence: 92,
          status: "activated",
          execution_order: 1,
          depends_on: null,
        },
        {
          id: 2,
          task_summary: "Parse data",
          confidence: 89,
          status: "activated",
          execution_order: 2,
          depends_on: 1,
        },
        {
          id: 3,
          task_summary: "Save to DB",
          confidence: 87,
          status: "activated",
          execution_order: 3,
          depends_on: 2,
        },
      ];

      // 1 → 2, 2 → 3
      const deps = new Map<number, number[]>([
        [1, [2]],
        [2, [3]],
      ]);

      const result = await orchestrator.resolveOrder(chain, deps);

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(2);
      expect(result[2].id).toBe(3);
    });

    it("detects cycles and returns fallback order", async () => {
      const chain: ExecutionChainNode[] = [
        {
          id: 1,
          task_summary: "Task 1",
          confidence: 90,
          status: "activated",
          execution_order: 1,
          depends_on: 2,
        },
        {
          id: 2,
          task_summary: "Task 2",
          confidence: 85,
          status: "activated",
          execution_order: 2,
          depends_on: 1,
        },
      ];

      // Cyclic: 1 → 2 → 1
      const deps = new Map<number, number[]>([
        [1, [2]],
        [2, [1]],
      ]);

      const result = await orchestrator.resolveOrder(chain, deps);

      // Should return original order due to cycle detection
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(2);
    });

    it("logs warning when cycles are detected", async () => {
      const chain: ExecutionChainNode[] = [
        {
          id: 1,
          task_summary: "Task 1",
          confidence: 90,
          status: "activated",
          execution_order: 1,
          depends_on: 2,
        },
        {
          id: 2,
          task_summary: "Task 2",
          confidence: 85,
          status: "activated",
          execution_order: 2,
          depends_on: 1,
        },
      ];

      const deps = new Map<number, number[]>([
        [1, [2]],
        [2, [1]],
      ]);

      await orchestrator.resolveOrder(chain, deps);

      // Check that warn was called at least once with a cycle-related message
      const warnCalls = (mockLog.warn as any).mock.calls;
      const hasCycleWarning = warnCalls.some((call: any[]) =>
        (call[0] as string).toLowerCase().includes("cycle"),
      );
      expect(hasCycleWarning).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // execute() — Sequential execution with output chaining
  // ────────────────────────────────────────────────────────────────────────────

  describe("execute", () => {
    it("executes simple single-step chain successfully", async () => {
      const chain: ExecutionChainNode[] = [
        {
          id: 1,
          task_summary: "Save to DB",
          confidence: 90,
          status: "activated",
          execution_order: 1,
          depends_on: null,
        },
      ];

      const context = {
        tenantId: "tenant-test",
        userMessage: "save this",
        sessionId: "session-123",
      };

      const result = await orchestrator.execute(chain, context);

      expect(result.status).toBe("success");
      expect(result.outputs.size).toBe(1);
      expect(result.outputs.has(1)).toBe(true);
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it("executes two-step chain and records both outputs", async () => {
      const chain: ExecutionChainNode[] = [
        {
          id: 5,
          task_summary: "Scrape URL",
          confidence: 92,
          status: "activated",
          execution_order: 1,
          depends_on: null,
        },
        {
          id: 51,
          task_summary: "Save to DB",
          confidence: 89,
          status: "activated",
          execution_order: 2,
          depends_on: 5,
        },
      ];

      const context = {
        tenantId: "tenant-test",
        userMessage: "scrape and save",
      };

      const result = await orchestrator.execute(chain, context);

      expect(result.status).toBe("success");
      expect(result.outputs.size).toBe(2);
      expect(result.outputs.has(5)).toBe(true);
      expect(result.outputs.has(51)).toBe(true);
    });

    it("logs step execution start and completion", async () => {
      const chain: ExecutionChainNode[] = [
        {
          id: 1,
          task_summary: "Task 1",
          confidence: 90,
          status: "activated",
          execution_order: 1,
          depends_on: null,
        },
      ];

      const context = {
        tenantId: "tenant-test",
        userMessage: "test",
      };

      await orchestrator.execute(chain, context);

      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringContaining("Execution started"),
        expect.objectContaining({ chainLength: 1 }),
      );
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringContaining("Execution completed successfully"),
        expect.any(Object),
      );
    });

    it("includes sessionId in logs if provided", async () => {
      const chain: ExecutionChainNode[] = [
        {
          id: 1,
          task_summary: "Task 1",
          confidence: 90,
          status: "activated",
          execution_order: 1,
          depends_on: null,
        },
      ];

      const context = {
        tenantId: "tenant-test",
        userMessage: "test",
        sessionId: "sess-456",
      };

      await orchestrator.execute(chain, context);

      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringContaining("Execution started"),
        expect.objectContaining({ sessionId: "sess-456" }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // validate() — Chain validation without cycles
  // ────────────────────────────────────────────────────────────────────────────

  describe("validate", () => {
    it("returns true for empty chain", async () => {
      const result = await orchestrator.validate([]);
      expect(result).toBe(true);
    });

    it("returns true for valid linear chain", async () => {
      const chain: ExecutionChainNode[] = [
        {
          id: 1,
          task_summary: "Task 1",
          confidence: 90,
          status: "activated",
          execution_order: 1,
          depends_on: null,
        },
        {
          id: 2,
          task_summary: "Task 2",
          confidence: 85,
          status: "activated",
          execution_order: 2,
          depends_on: 1,
        },
      ];

      const result = await orchestrator.validate(chain);
      expect(result).toBe(true);
    });

    it("returns false for duplicate node IDs", async () => {
      const chain: ExecutionChainNode[] = [
        {
          id: 1,
          task_summary: "Task 1",
          confidence: 90,
          status: "activated",
          execution_order: 1,
          depends_on: null,
        },
        {
          id: 1, // Duplicate!
          task_summary: "Task 1 again",
          confidence: 85,
          status: "activated",
          execution_order: 2,
          depends_on: null,
        },
      ];

      const result = await orchestrator.validate(chain);
      expect(result).toBe(false);
    });

    it("returns false for depends_on referencing non-existent node", async () => {
      const chain: ExecutionChainNode[] = [
        {
          id: 1,
          task_summary: "Task 1",
          confidence: 90,
          status: "activated",
          execution_order: 1,
          depends_on: 999, // Non-existent node!
        },
      ];

      const result = await orchestrator.validate(chain);
      expect(result).toBe(false);
    });

    it("returns false for cyclic dependencies", async () => {
      const chain: ExecutionChainNode[] = [
        {
          id: 1,
          task_summary: "Task 1",
          confidence: 90,
          status: "activated",
          execution_order: 1,
          depends_on: 2,
        },
        {
          id: 2,
          task_summary: "Task 2",
          confidence: 85,
          status: "activated",
          execution_order: 2,
          depends_on: 1,
        },
      ];

      const result = await orchestrator.validate(chain);
      expect(result).toBe(false);
    });

    it("logs debug message on successful validation", async () => {
      const chain: ExecutionChainNode[] = [
        {
          id: 1,
          task_summary: "Task 1",
          confidence: 90,
          status: "activated",
          execution_order: 1,
          depends_on: null,
        },
      ];

      await orchestrator.validate(chain);

      // Check that debug was called with "Chain validation passed"
      const debugCalls = (mockLog.debug as any).mock.calls;
      const hasValidationPassed = debugCalls.some((call: any[]) =>
        (call[0] as string).toLowerCase().includes("validation passed"),
      );
      expect(hasValidationPassed).toBe(true);
    });

    it("logs warning when duplicate IDs detected", async () => {
      const chain: ExecutionChainNode[] = [
        {
          id: 1,
          task_summary: "Task 1",
          confidence: 90,
          status: "activated",
          execution_order: 1,
          depends_on: null,
        },
        {
          id: 1,
          task_summary: "Task 1 again",
          confidence: 85,
          status: "activated",
          execution_order: 2,
          depends_on: null,
        },
      ];

      await orchestrator.validate(chain);
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining("Duplicate node ID"),
        expect.any(Object),
      );
    });
  });
});
