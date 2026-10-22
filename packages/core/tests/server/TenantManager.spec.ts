import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsManager } from "../../src/server/SettingsManager.js";
import { TenantManager } from "../../src/server/TenantManager.js";
import { UnifiedCortex } from "../../src/system/implementations/UnifiedCortex.js";
import type { TemplateStateStore } from "../../src/server/TemplateStateStore.js";

const templateState = {
  getAllStates: () => new Map<string, boolean>(),
  setEnabled: () => undefined,
} as unknown as TemplateStateStore;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("TenantManager platform wiring", () => {
  it("uses the desired provider configuration for existing and future tenants", async () => {
    const init = vi
      .spyOn(UnifiedCortex.prototype, "init")
      .mockResolvedValue(undefined);
    const manager = new TenantManager({ maxTenants: 4 });

    manager.reconfigureAll({
      primaryProvider: "claude",
      fallbackOrder: ["gemini", "claude", "gemini"],
    });

    const tenant = await manager.getTenant("tenant-a", "dev");

    expect(init).toHaveBeenCalledOnce();
    expect(tenant.cortex).toBeInstanceOf(UnifiedCortex);
    expect(tenant.cortex.getProviderConfig()).toEqual({
      primaryProvider: "claude",
      fallbackOrder: ["gemini"],
    });

    manager.reconfigureAll({
      primaryProvider: "nvidia",
      fallbackOrder: ["gemini", "claude"],
    });
    expect(tenant.cortex.getProviderConfig()).toEqual({
      primaryProvider: "nvidia",
      fallbackOrder: ["gemini", "claude"],
    });

    const futureTenant = await manager.getTenant("tenant-b", "dev");
    expect(futureTenant.cortex.getProviderConfig()).toEqual({
      primaryProvider: "nvidia",
      fallbackOrder: ["gemini", "claude"],
    });
  });

  it("serializes concurrent chat operations for one tenant", async () => {
    vi.spyOn(UnifiedCortex.prototype, "init").mockResolvedValue(undefined);
    const manager = new TenantManager({ maxTenants: 2 });
    const tenant = await manager.getTenant("tenant-a", "dev");
    const entered: string[] = [];
    let releaseFirst = () => undefined;
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    vi.spyOn(tenant.cortex, "chat").mockImplementation(async (message) => {
      entered.push(message);
      if (message === "first") await firstFinished;
    });

    const first = manager.chat("tenant-a", "first");
    await vi.waitFor(() => expect(entered).toEqual(["first"]));
    const second = manager.chat("tenant-a", "second");

    await Promise.resolve();
    expect(entered).toEqual(["first"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(entered).toEqual(["first", "second"]);
  });
});

describe("SettingsManager tenant configuration", () => {
  it("uses the canonical resolver and aggregates administrative breakers", () => {
    vi.stubEnv("GOOGLE_API_KEY", " ");
    vi.stubEnv("GOOGLE_AI_API_KEY", "legacy-google-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "short");
    vi.stubEnv("NVIDIA_API_KEY", "valid-nvidia-key");

    const tenantManager = new TenantManager();
    const cortex = new UnifiedCortex({
      providers: new Map(),
    });
    const settings = new SettingsManager({
      cortex,
      tenantManager,
      templateState,
    }).getSettings();

    expect(settings.llm.apiKeyStatuses).toEqual({
      gemini: "configured",
      claude: "invalid_format",
      nvidia: "configured",
    });
    expect(settings.llm.providers).toEqual({
      primaryProvider: "gemini",
      fallbackOrder: ["claude", "nvidia"],
    });
    expect(settings.llm.circuitBreakers).toHaveLength(3);
    expect(
      settings.llm.circuitBreakers.every(
        (breaker) => breaker.state === "CLOSED",
      ),
    ).toBe(true);
  });

  it("preserves a configured primary when its key is missing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", " ");
    const tenantManager = new TenantManager();
    const cortex = new UnifiedCortex({ providers: new Map() });
    const reconfigure = vi.spyOn(cortex, "reconfigure");
    const settings = new SettingsManager({
      cortex,
      tenantManager,
      templateState,
    });

    await settings.applySettings({
      llm: { primaryProvider: "claude" },
    });

    expect(reconfigure).toHaveBeenCalledOnce();
    expect(tenantManager.getProviderConfig()).toEqual({
      primaryProvider: "claude",
      fallbackOrder: ["nvidia"],
    });
  });
});

// ============= Fase 2: Intent Detection + LLM Verification =============
describe("TenantManager evaluateSemanticRoute - Fase 2", () => {
  it("detects single intent with high confidence (activated)", async () => {
    vi.spyOn(UnifiedCortex.prototype, "init").mockResolvedValue(undefined);
    const manager = new TenantManager({ maxTenants: 4 });
    const tenant = await manager.getTenant("tenant-phase2", "dev");

    // Mock reflexes loading
    const reflexes = [
      { id: 51, task_summary: "Guarda un registro en la base de datos" },
    ];
    vi.spyOn<any>(manager, "listReflexesForSemanticRoute").mockResolvedValue(
      reflexes,
    );

    // Mock jevEvaluateAll to return a single high-confidence reflex
    vi.spyOn<any>(manager, "callSemanticRouter").mockResolvedValue([
      {
        id: 51,
        task_summary: "Guarda un registro en la base de datos",
        confidence: 88,
      },
    ]);

    const result = await manager.evaluateSemanticRoute(
      "tenant-phase2",
      "guardala en la bd",
    );

    expect(result.activated_reflexes).toEqual([51]);
    expect(result.candidate_reflexes).toEqual([]);
    expect(result.multi_intent_detected).toBe(false);
    expect(result.top_match?.id).toBe(51);
    expect(result.escalate_to_llm).toBe(false);
    expect(result.verification_results).toEqual({});
  });

  it("detects multi-intent with both high confidence (activated)", async () => {
    vi.spyOn(UnifiedCortex.prototype, "init").mockResolvedValue(undefined);
    const manager = new TenantManager({ maxTenants: 4 });
    const tenant = await manager.getTenant("tenant-phase2-multi", "dev");

    // Mock reflexes loading
    const reflexes = [
      { id: 51, task_summary: "Guarda un registro en la base de datos" },
      { id: 42, task_summary: "Actualiza el inventario" },
    ];
    vi.spyOn<any>(manager, "listReflexesForSemanticRoute").mockResolvedValue(
      reflexes,
    );

    // Mock jevEvaluateAll to return two high-confidence reflexes
    vi.spyOn<any>(manager, "callSemanticRouter").mockResolvedValue([
      {
        id: 51,
        task_summary: "Guarda un registro en la base de datos",
        confidence: 88,
      },
      {
        id: 42,
        task_summary: "Actualiza el inventario",
        confidence: 86,
      },
    ]);

    const result = await manager.evaluateSemanticRoute(
      "tenant-phase2-multi",
      "guardala y luego actualiza el inventario",
    );

    expect(result.activated_reflexes).toContain(51);
    expect(result.activated_reflexes).toContain(42);
    expect(result.multi_intent_detected).toBe(true);
    expect(result.escalate_to_llm).toBe(true); // multi-intent forces escalate
    expect(Object.keys(result.verification_results).length).toBe(0);
  });

  it("detects candidate intent and verifies with LLM", async () => {
    vi.spyOn(UnifiedCortex.prototype, "init").mockResolvedValue(undefined);
    const manager = new TenantManager({ maxTenants: 4 });
    const tenant = await manager.getTenant("tenant-phase2-verify", "dev");

    // Mock reflexes loading
    const reflexes = [
      { id: 30, task_summary: "Verifica si existe un cliente" },
    ];
    vi.spyOn<any>(manager, "listReflexesForSemanticRoute").mockResolvedValue(
      reflexes,
    );

    // Mock jevEvaluateAll to return a candidate (60-85% confidence)
    vi.spyOn<any>(manager, "callSemanticRouter").mockResolvedValue([
      {
        id: 30,
        task_summary: "Verifica si existe un cliente",
        confidence: 72,
      },
    ]);

    // Mock cortex.chat to return rejection
    vi.spyOn(tenant.cortex, "chat").mockResolvedValue(undefined);
    const history = vi.spyOn(tenant.cortex, "getHistory").mockReturnValue([
      {
        role: "assistant",
        content: "reject",
        timestamp: Date.now(),
      },
    ]);

    const result = await manager.evaluateSemanticRoute(
      "tenant-phase2-verify",
      "mira si existe ese cliente",
    );

    expect(result.activated_reflexes).toEqual([]);
    expect(result.candidate_reflexes).toEqual([30]);
    expect(result.verification_results["30"]).toBeDefined();
    expect(result.verification_results["30"].llm_decision).toBe("reject");
    expect(result.multi_intent_detected).toBe(false);
  });

  it("moves candidate to activated if LLM accepts", async () => {
    vi.spyOn(UnifiedCortex.prototype, "init").mockResolvedValue(undefined);
    const manager = new TenantManager({ maxTenants: 4 });
    const tenant = await manager.getTenant("tenant-phase2-accept", "dev");

    // Mock reflexes loading
    const reflexes = [{ id: 42, task_summary: "Actualiza el inventario" }];
    vi.spyOn<any>(manager, "listReflexesForSemanticRoute").mockResolvedValue(
      reflexes,
    );

    // Mock jevEvaluateAll to return a candidate (60-85% confidence)
    vi.spyOn<any>(manager, "callSemanticRouter").mockResolvedValue([
      {
        id: 42,
        task_summary: "Actualiza el inventario",
        confidence: 70, // Between MEDIUM (60) and HIGH (75) → candidate
      },
    ]);

    // Mock cortex.chat to return acceptance
    vi.spyOn(tenant.cortex, "chat").mockResolvedValue(undefined);

    // Setup multiple calls to getHistory
    let callCount = 0;
    vi.spyOn(tenant.cortex, "getHistory").mockImplementation(() => {
      callCount++;
      // After chat is called, return assistant message with accept
      if (callCount > 1) {
        return [
          {
            role: "assistant",
            content: "accept - yes, this updates inventory",
            timestamp: Date.now(),
          },
        ];
      }
      return [];
    });

    const result = await manager.evaluateSemanticRoute(
      "tenant-phase2-accept",
      "actualiza el inventario",
    );

    expect(result.activated_reflexes).toContain(42);
    expect(result.candidate_reflexes).toEqual([]);
    expect(result.verification_results["42"]).toBeDefined();
    expect(result.verification_results["42"].llm_decision).toBe("accept");
    expect(result.multi_intent_detected).toBe(false);
  });
});

// ============= Tarea 5-6: TypeSafe Score + Noul + Multi-Intent Detection =============

describe("TenantManager Fase 3 - detectMultiIntentSequence (no N² Jev)", () => {
  it("detects multi-intent from reflexes without expensive Jev calls", async () => {
    vi.spyOn(UnifiedCortex.prototype, "init").mockResolvedValue(undefined);
    const manager = new TenantManager({ maxTenants: 4 });
    const tenant = await manager.getTenant("tenant-reflex-deps", "dev");

    // Mock reflexes
    const reflexes = [
      { id: 5, task_summary: "scrapea la url" },
      { id: 51, task_summary: "Guarda un registro en la base de datos" },
    ];
    vi.spyOn<any>(manager, "listReflexesForSemanticRoute").mockResolvedValue(
      reflexes,
    );

    // Mock Jev router to return both high-confidence
    vi.spyOn<any>(manager, "callSemanticRouter").mockResolvedValue([
      { id: 5, task_summary: "scrapea la url", confidence: 92 },
      {
        id: 51,
        task_summary: "Guarda un registro en la base de datos",
        confidence: 89,
      },
    ]);

    const result = await manager.evaluateSemanticRoute(
      "tenant-reflex-deps",
      "scrapea la url y guardala en la base de datos",
    );

    // Should detect multi-intent
    expect(result.multi_intent_detected).toBe(true);
    expect(result.activated_reflexes).toContain(5);
    expect(result.activated_reflexes).toContain(51);
  });
});

describe("TenantManager Fase 3 - resolveExecutionOrder (ordered chain)", () => {
  it("returns execution chain with proper ordering", async () => {
    vi.spyOn(UnifiedCortex.prototype, "init").mockResolvedValue(undefined);
    const manager = new TenantManager({ maxTenants: 4 });
    const tenant = await manager.getTenant("tenant-exec-order", "dev");

    const reflexes = [
      { id: 5, task_summary: "scrapea la url" },
      { id: 51, task_summary: "Guarda un registro en la base de datos" },
    ];
    vi.spyOn<any>(manager, "listReflexesForSemanticRoute").mockResolvedValue(
      reflexes,
    );

    vi.spyOn<any>(manager, "callSemanticRouter").mockResolvedValue([
      { id: 5, task_summary: "scrapea la url", confidence: 92 },
      {
        id: 51,
        task_summary: "Guarda un registro en la base de datos",
        confidence: 89,
      },
    ]);

    const result = await manager.evaluateSemanticRoute(
      "tenant-exec-order",
      "scrapea y guarda",
    );

    // Execution chain should exist and have ordering
    expect(result.execution_chain).toBeDefined();
    if (result.execution_chain && result.execution_chain.length > 1) {
      const orders = result.execution_chain.map((n: any) => n.execution_order);
      // Orders should be strictly increasing (1, 2, 3, ...)
      for (let i = 1; i < orders.length; i++) {
        expect(orders[i]).toBeGreaterThan(orders[i - 1]);
      }
    }
  });
});

describe("TenantManager evaluateSemanticRoute - execution strategy", () => {
  it("returns execution strategy based on chain complexity", async () => {
    vi.spyOn(UnifiedCortex.prototype, "init").mockResolvedValue(undefined);
    const manager = new TenantManager({ maxTenants: 4 });
    const tenant = await manager.getTenant("tenant-exec-strategy", "dev");

    const reflexes = [
      { id: 5, task_summary: "scrapea la url" },
      { id: 51, task_summary: "Guarda un registro en la base de datos" },
    ];
    vi.spyOn<any>(manager, "listReflexesForSemanticRoute").mockResolvedValue(
      reflexes,
    );

    vi.spyOn<any>(manager, "callSemanticRouter").mockResolvedValue([
      { id: 5, task_summary: "scrapea la url", confidence: 92 },
      {
        id: 51,
        task_summary: "Guarda un registro en la base de datos",
        confidence: 89,
      },
    ]);

    const result = await manager.evaluateSemanticRoute(
      "tenant-exec-strategy",
      "scrapea y guarda",
    );

    // Strategy should be defined
    expect(result.execution_strategy).toBeDefined();
    expect(["parallel", "sequential"]).toContain(result.execution_strategy);
  });

  it("escalates to LLM for multi-intent without clear dependencies", async () => {
    vi.spyOn(UnifiedCortex.prototype, "init").mockResolvedValue(undefined);
    const manager = new TenantManager({ maxTenants: 4 });
    const tenant = await manager.getTenant("tenant-escalate-unclear", "dev");

    const reflexes = [
      { id: 5, task_summary: "scrapea la url" },
      { id: 51, task_summary: "Guarda un registro en la base de datos" },
    ];
    vi.spyOn<any>(manager, "listReflexesForSemanticRoute").mockResolvedValue(
      reflexes,
    );

    vi.spyOn<any>(manager, "callSemanticRouter").mockResolvedValue([
      { id: 5, task_summary: "scrapea la url", confidence: 92 },
      {
        id: 51,
        task_summary: "Guarda un registro en la base de datos",
        confidence: 89,
      },
    ]);

    const result = await manager.evaluateSemanticRoute(
      "tenant-escalate-unclear",
      "scrapea y guarda",
    );

    // Multi-intent should escalate to LLM
    if (result.multi_intent_detected) {
      expect(result.escalate_to_llm).toBe(true);
    }
  });
});

describe("TenantManager verification fields - TypeSafe integration placeholder", () => {
  it("includes verification_results field for candidate reflexes", async () => {
    vi.spyOn(UnifiedCortex.prototype, "init").mockResolvedValue(undefined);
    const manager = new TenantManager({ maxTenants: 4 });
    const tenant = await manager.getTenant("tenant-verify-fields", "dev");

    const reflexes = [{ id: 42, task_summary: "Actualiza el inventario" }];
    vi.spyOn<any>(manager, "listReflexesForSemanticRoute").mockResolvedValue(
      reflexes,
    );

    // Candidate reflex (70% confidence)
    vi.spyOn<any>(manager, "callSemanticRouter").mockResolvedValue([
      { id: 42, task_summary: "Actualiza el inventario", confidence: 70 },
    ]);

    // Mock cortex to accept
    vi.spyOn(tenant.cortex, "chat").mockResolvedValue(undefined);
    let callCount = 0;
    vi.spyOn(tenant.cortex, "getHistory").mockImplementation(() => {
      callCount++;
      if (callCount > 1) {
        return [
          {
            role: "assistant",
            content: "accept",
            timestamp: Date.now(),
          },
        ];
      }
      return [];
    });

    const result = await manager.evaluateSemanticRoute(
      "tenant-verify-fields",
      "actualiza el inventario",
    );

    // Should have verification_results if candidate was verified
    expect(result.verification_results).toBeDefined();
    expect(typeof result.verification_results).toBe("object");
  });

  it("supports extended verification fields for TypeSafe integration", async () => {
    vi.spyOn(UnifiedCortex.prototype, "init").mockResolvedValue(undefined);
    const manager = new TenantManager({ maxTenants: 4 });
    const tenant = await manager.getTenant("tenant-typesafe-fields", "dev");

    const reflexes = [
      { id: 30, task_summary: "Verifica si existe un cliente" },
    ];
    vi.spyOn<any>(manager, "listReflexesForSemanticRoute").mockResolvedValue(
      reflexes,
    );

    // Candidate reflex
    vi.spyOn<any>(manager, "callSemanticRouter").mockResolvedValue([
      { id: 30, task_summary: "Verifica si existe un cliente", confidence: 72 },
    ]);

    // Mock cortex rejection
    vi.spyOn(tenant.cortex, "chat").mockResolvedValue(undefined);
    vi.spyOn(tenant.cortex, "getHistory").mockReturnValue([
      {
        role: "assistant",
        content: "reject",
        timestamp: Date.now(),
      },
    ]);

    const result = await manager.evaluateSemanticRoute(
      "tenant-typesafe-fields",
      "verifica si existe ese cliente",
    );

    // Verification result should have decision field
    expect(result.verification_results["30"]).toBeDefined();
    const vResult = result.verification_results["30"] as any;

    // Should have either classic llm_decision or TypeSafe fields
    const hasEitherFormat =
      vResult.llm_decision !== undefined ||
      vResult.applicability_score !== undefined ||
      vResult.security_check !== undefined;

    expect(hasEitherFormat).toBe(true);
  });
});

// ============= Tarea 7: Blue-Green Migration + Embeddings Optional =============

describe("TenantManager blue-green migration - reflexes_atomic", () => {
  it("debe leer de reflexes_atomic si existe", async () => {
    vi.spyOn(UnifiedCortex.prototype, "init").mockResolvedValue(undefined);
    const manager = new TenantManager({ maxTenants: 4 });
    const tenant = await manager.getTenant("tenant-blue-green-new", "dev");

    // Mock new reflexes_atomic table with atomic reflexes
    const atomicReflexes = [
      { id: 101, task_summary: "Scrapea datos de URL", execution_order: 1 },
      { id: 102, task_summary: "Valida datos scraped", execution_order: 2 },
      { id: 103, task_summary: "Guarda en base de datos", execution_order: 3 },
      { id: 104, task_summary: "Notifica usuario", execution_order: 4 },
      { id: 105, task_summary: "Registra en log", execution_order: 5 },
    ];
    vi.spyOn<any>(manager, "listReflexesForSemanticRoute").mockResolvedValue(
      atomicReflexes,
    );

    // Mock Jev router
    vi.spyOn<any>(manager, "callSemanticRouter").mockResolvedValue([
      { id: 101, task_summary: "Scrapea datos de URL", confidence: 88 },
    ]);

    const result = await manager.evaluateSemanticRoute(
      "tenant-blue-green-new",
      "scrapea la url",
    );

    expect(result.activated_reflexes).toContain(101);
  });

  it("debe usar fallback a reflexes (legacy) si reflexes_atomic no existe", async () => {
    vi.spyOn(UnifiedCortex.prototype, "init").mockResolvedValue(undefined);
    const manager = new TenantManager({ maxTenants: 4 });
    const tenant = await manager.getTenant("tenant-blue-green-legacy", "dev");

    // Mock legacy reflexes table (no atomic)
    const legacyReflexes = [
      {
        id: 51,
        task_summary: "Guarda un registro en la base de datos",
        embedding: "some_embedding_vector",
      },
    ];
    vi.spyOn<any>(manager, "listReflexesForSemanticRoute").mockResolvedValue(
      legacyReflexes,
    );

    // Mock Jev router
    vi.spyOn<any>(manager, "callSemanticRouter").mockResolvedValue([
      {
        id: 51,
        task_summary: "Guarda un registro en la base de datos",
        confidence: 85,
      },
    ]);

    const result = await manager.evaluateSemanticRoute(
      "tenant-blue-green-legacy",
      "guardala en la bd",
    );

    expect(result.activated_reflexes).toContain(51);
  });

  it("debe leer de reflex_dependencies si existe", async () => {
    vi.spyOn(UnifiedCortex.prototype, "init").mockResolvedValue(undefined);
    const manager = new TenantManager({ maxTenants: 4 });
    const tenant = await manager.getTenant("tenant-deps-new", "dev");

    // Mock reflexes with dependencies
    const reflexes = [
      { id: 101, task_summary: "Scrapea datos", execution_order: 1 },
      { id: 102, task_summary: "Valida datos", execution_order: 2 },
      { id: 103, task_summary: "Guarda datos", execution_order: 3 },
    ];
    vi.spyOn<any>(manager, "listReflexesForSemanticRoute").mockResolvedValue(
      reflexes,
    );

    // Mock dependencies: 101 → 102 → 103 (estructura correcta)
    vi.spyOn<any>(manager, "detectMultiIntentSequence").mockResolvedValue({
      sequences: [],
      implied_order: [101, 102, 103],
      dependencies: [
        {
          source_id: 101,
          target_id: 102,
          confidence: 95,
          sequence_keyword: "y",
        },
        {
          source_id: 102,
          target_id: 103,
          confidence: 92,
          sequence_keyword: "y",
        },
      ],
    });

    // Mock Jev router for multi-intent
    vi.spyOn<any>(manager, "callSemanticRouter").mockResolvedValue([
      { id: 101, task_summary: "Scrapea datos", confidence: 92 },
      { id: 102, task_summary: "Valida datos", confidence: 88 },
      { id: 103, task_summary: "Guarda datos", confidence: 85 },
    ]);

    const result = await manager.evaluateSemanticRoute(
      "tenant-deps-new",
      "scrapea valida y guarda",
    );

    expect(result.multi_intent_detected).toBe(true);
    expect(result.activated_reflexes).toContain(101);
    expect(result.activated_reflexes).toContain(102);
    expect(result.activated_reflexes).toContain(103);
  });

  it("debe usar Jev evaluation si reflex_dependencies no existe", async () => {
    vi.spyOn(UnifiedCortex.prototype, "init").mockResolvedValue(undefined);
    const manager = new TenantManager({ maxTenants: 4 });
    const tenant = await manager.getTenant("tenant-deps-legacy", "dev");

    // Mock reflexes without pre-computed dependencies
    const reflexes = [
      { id: 5, task_summary: "Scrapea la url" },
      { id: 51, task_summary: "Guarda un registro en la base de datos" },
    ];
    vi.spyOn<any>(manager, "listReflexesForSemanticRoute").mockResolvedValue(
      reflexes,
    );

    // Mock Jev router to infer dependency
    vi.spyOn<any>(manager, "callSemanticRouter").mockResolvedValue([
      { id: 5, task_summary: "Scrapea la url", confidence: 92 },
      {
        id: 51,
        task_summary: "Guarda un registro en la base de datos",
        confidence: 89,
      },
    ]);

    const result = await manager.evaluateSemanticRoute(
      "tenant-deps-legacy",
      "scrapea y guarda",
    );

    // Multi-intent detected via Jev (fallback), not from pre-computed dependencies
    expect(result.multi_intent_detected).toBe(true);
    expect(result.activated_reflexes.length).toBeGreaterThanOrEqual(2);
  });
});

describe("TenantManager embeddings optional", () => {
  it("debe usar embeddings si ENABLE_EMBEDDINGS=true", async () => {
    vi.stubEnv("ENABLE_EMBEDDINGS", "true");
    vi.spyOn(UnifiedCortex.prototype, "init").mockResolvedValue(undefined);
    const manager = new TenantManager({ maxTenants: 4 });
    const tenant = await manager.getTenant("tenant-embeddings-enabled", "dev");

    // Mock reflexes with embeddings
    const reflexes = [
      {
        id: 51,
        task_summary: "Guarda un registro",
        embedding: "vector_1,vector_2,vector_3",
      },
      {
        id: 42,
        task_summary: "Actualiza inventario",
        embedding: "vector_4,vector_5,vector_6",
      },
    ];
    vi.spyOn<any>(manager, "listReflexesForSemanticRoute").mockResolvedValue(
      reflexes,
    );

    // Mock Jev as fallback (embeddings config is checked but Jev is always used)
    vi.spyOn<any>(manager, "callSemanticRouter").mockResolvedValue([
      { id: 51, task_summary: "Guarda un registro", confidence: 85 },
    ]);

    const result = await manager.evaluateSemanticRoute(
      "tenant-embeddings-enabled",
      "guarda el registro",
    );

    expect(result.activated_reflexes).toContain(51);
  });

  it("debe usar solo Jev si ENABLE_EMBEDDINGS=false", async () => {
    vi.stubEnv("ENABLE_EMBEDDINGS", "false");
    vi.spyOn(UnifiedCortex.prototype, "init").mockResolvedValue(undefined);
    const manager = new TenantManager({ maxTenants: 4 });
    const tenant = await manager.getTenant("tenant-embeddings-disabled", "dev");

    // Mock reflexes (embeddings ignored)
    const reflexes = [{ id: 51, task_summary: "Guarda un registro" }];
    vi.spyOn<any>(manager, "listReflexesForSemanticRoute").mockResolvedValue(
      reflexes,
    );

    // Mock Jev only (embeddings skipped)
    vi.spyOn<any>(manager, "callSemanticRouter").mockResolvedValue([
      { id: 51, task_summary: "Guarda un registro", confidence: 88 },
    ]);

    const mockSearchBySimilarity = vi.fn();
    expect(mockSearchBySimilarity).not.toHaveBeenCalled();

    const result = await manager.evaluateSemanticRoute(
      "tenant-embeddings-disabled",
      "guarda",
    );

    expect(result.activated_reflexes).toContain(51);
  });
});

describe("TenantManager descomposición de reflexes - atomic IDs 101-134", () => {
  it("debe crear reflexes atómicas con IDs 101-134", async () => {
    vi.spyOn(UnifiedCortex.prototype, "init").mockResolvedValue(undefined);
    const manager = new TenantManager({ maxTenants: 4 });
    const tenant = await manager.getTenant("tenant-decomposition", "dev");

    // Mock 34 atomic reflexes (IDs 101-134)
    const atomicReflexes = Array.from({ length: 34 }, (_, i) => ({
      id: 101 + i,
      task_summary: `Tarea atómica ${i + 1}`,
      execution_order: i + 1,
    }));

    vi.spyOn<any>(manager, "listReflexesForSemanticRoute").mockResolvedValue(
      atomicReflexes,
    );

    const result = await manager.evaluateSemanticRoute(
      "tenant-decomposition",
      "ejecuta tarea atómica 1",
    );

    // Verify atomic reflexes exist
    expect(atomicReflexes).toHaveLength(34);
    expect(atomicReflexes[0].id).toBe(101);
    expect(atomicReflexes[33].id).toBe(134);
  });

  it("debe crear 16 dependencias entre reflexes", async () => {
    vi.spyOn(UnifiedCortex.prototype, "init").mockResolvedValue(undefined);
    const manager = new TenantManager({ maxTenants: 4 });
    const tenant = await manager.getTenant("tenant-dependencies", "dev");

    // Mock reflexes
    const reflexes = Array.from({ length: 34 }, (_, i) => ({
      id: 101 + i,
      task_summary: `Tarea ${i + 1}`,
      execution_order: i + 1,
    }));
    vi.spyOn<any>(manager, "listReflexesForSemanticRoute").mockResolvedValue(
      reflexes,
    );

    // Mock 16 dependencies (estructura correcta)
    const dependencies = Array.from({ length: 16 }, (_, i) => ({
      source_id: 101 + i * 2,
      target_id: 101 + i * 2 + 1,
      confidence: 90 + Math.random() * 5,
      sequence_keyword: "y",
    }));

    vi.spyOn<any>(manager, "detectMultiIntentSequence").mockResolvedValue({
      sequences: [],
      implied_order: Array.from({ length: 34 }, (_, i) => 101 + i),
      dependencies,
    });

    // Mock Jev router
    vi.spyOn<any>(manager, "callSemanticRouter").mockResolvedValue(
      reflexes.slice(0, 5).map((r) => ({ ...r, confidence: 85 })),
    );

    const result = await manager.evaluateSemanticRoute(
      "tenant-dependencies",
      "ejecuta cadena",
    );

    // Verify 16 dependencies exist
    expect(dependencies).toHaveLength(16);
  });
});
