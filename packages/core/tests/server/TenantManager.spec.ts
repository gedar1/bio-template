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
