// ─── Atoms ────────────────────────────────────────────────────
export * from "./atoms/index.js";

// ─── Molecules (genéricas) ────────────────────────────────────
export { DatabaseMolecule } from "./molecules/DatabaseMolecule.js";
export { HTTPMolecule } from "./molecules/HTTPMolecule.js";
export { ScraperMolecule } from "./molecules/ScraperMolecule.js";
export { FileSystemMolecule } from "./molecules/FileSystemMolecule.js";
export { GitMolecule } from "./molecules/GitMolecule.js";
export { GmailMolecule } from "./molecules/GmailMolecule.js";
export { SystemMolecule } from "./molecules/SystemMolecule.js";
export { WebSocketMolecule } from "./molecules/WebSocketMolecule.js";
export { ReflexMolecule } from "./molecules/ReflexMolecule.js";
export { HistoryMolecule } from "./molecules/HistoryMolecule.js";
export { MolecularGen } from "./molecules/MolecularGen.js";
export { WhatsAppMolecule } from "./molecules/WhatsAppMolecule.js";

// ─── Molecule Interfaces ──────────────────────────────────────
export * from "./molecules/interfaces/IMolecule.js";
export * from "./molecules/interfaces/IDatabase.js";
export * from "./molecules/interfaces/IHttp.js";
export * from "./molecules/interfaces/IFileSystem.js";
export * from "./molecules/interfaces/IScraper.js";
export * from "./molecules/interfaces/IGmail.js";
export * from "./molecules/interfaces/IGit.js";
export * from "./molecules/interfaces/ISystem.js";
export * from "./molecules/interfaces/IWhatsApp.js";
export * from "./molecules/interfaces/IWebSocket.js";

// ─── Cells ────────────────────────────────────────────────────
export { CellServer, runCellServer } from "./cells/CellServer.js";
export type {
  CellComposition,
  CellFactory,
  CellRegistration,
  CellResource,
  CellRuntimeContext,
  CellToolRegistrar,
} from "./cells/CellComposition.js";
export type { CellServerOptions } from "./cells/CellServer.js";
export * from "./cells/interfaces/ICell.js";

// ─── Organisms ────────────────────────────────────────────────
export { BaseOrganisms } from "./organisms/BaseOrganisms.js";
export * from "./organisms/interfaces/IOrganism.js";

// ─── System ───────────────────────────────────────────────────
export { BaseOrchestrator } from "./system/BaseOrchestrator.js";
export type { OrchestratorOptions } from "./system/BaseOrchestrator.js";
export { HeadlessOrchestrator } from "./system/NervousSystem.js";
export type {
  HeadlessTask,
  HeadlessStep,
  HeadlessResult,
  HeadlessOrchestratorOptions,
} from "./system/NervousSystem.js";
export * from "./system/interfaces/IOrchestrator.js";
export * from "./system/interfaces/IStimulus.js";
export type { ReflexFlow } from "./system/reflexSeed.js";
export { seedReflexes, FLOWS as CORE_FLOWS } from "./system/reflexSeed.js";

// ─── System Strategy Interfaces ───────────────────────────────
export * from "./system/interfaces/IUsageMetricsSink.js";
export * from "./system/interfaces/ITenantTokenLimitReader.js";
export { UnifiedCortex } from "./system/implementations/UnifiedCortex.js";
export type { UnifiedCortexOptions } from "./system/implementations/UnifiedCortex.js";
export { ClaudeCortex } from "./system/implementations/ClaudeCortex.js";
export { GeminiCortex } from "./system/implementations/GeminiCortex.js";
export { NvidiaCortex } from "./system/implementations/NvidiaCortex.js";
export * from "./system/providers/index.js";

// ─── Infrastructure ───────────────────────────────────────────
export { CircuitBreaker } from "./infrastructure/CircuitBreaker.js";
export { PerfMonitor } from "./infrastructure/PerfMonitor.js";
export { RateLimiter } from "./infrastructure/RateLimiter.js";
export { Scheduler } from "./infrastructure/Scheduler.js";
export { TenantDatabaseManager } from "./infrastructure/TenantDatabaseManager.js";

// ─── Server ───────────────────────────────────────────────────
export { MCPExternalServer } from "./server/MCPExternalServer.js";
export { startMCPHttpServer } from "./server/MCPHttpServer.js";
export { TenantManager } from "./server/TenantManager.js";
export { registerAllRoutes } from "./server/RouteRegistry.js";
export type { RouteDependencies } from "./server/RouteRegistry.js";

// ─── Config utilities ─────────────────────────────────────────
export { createApplicationComposition } from "./config/applicationComposition.js";
export type { ILogger } from "./config/ILogger.js";
export { PinoLoggerAdapter } from "./config/ILogger.js";
export * from "./config/telemetry.js";
export * from "./config/validators.js";

// ─── Errors & Types ──────────────────────────────────────────
export * from "./errors.js";
export * from "./interfaces.js";

// ─── Registry Composition ─────────────────────────────────────
export { mergeRegistry } from "./config/mergeRegistry.js";
export type { Registry, RegistryEntry } from "./config/mergeRegistry.js";
export {
  registerDomainProfile,
  getAvailableProfiles,
} from "./config/profileRegistry.js";
export type { ProfileConfig } from "./config/profileRegistry.js";
