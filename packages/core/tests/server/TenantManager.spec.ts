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
