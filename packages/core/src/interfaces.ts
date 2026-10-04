/**
 * Barrel export de todas las interfaces formales de BioCore.
 * Importa desde aquí para acceso centralizado.
 *
 * @example
 * import type { IMolecule, IDatabase, IOrganism, IOrchestrator } from '../interfaces.js';
 */

// ─── Moléculas ────────────────────────────────────────────────
export type { IMolecule } from "./molecules/interfaces/IMolecule.js";
export type { IDatabase } from "./molecules/interfaces/IDatabase.js";
export type { IHttp } from "./molecules/interfaces/IHttp.js";
export type { IFileSystem } from "./molecules/interfaces/IFileSystem.js";
export type {
  IScraper,
  ScraperSchemaValue,
} from "./molecules/interfaces/IScraper.js";
export type {
  IGmail,
  EmailOptions,
  BulkResult,
} from "./molecules/interfaces/IGmail.js";
export type { IGit } from "./molecules/interfaces/IGit.js";
export type {
  ISystem,
  CommandResult,
  SystemInfo,
} from "./molecules/interfaces/ISystem.js";
export type {
  IWhatsApp,
  WhatsAppMessage,
  WhatsAppResult,
} from "./molecules/interfaces/IWhatsApp.js";
export type {
  IWebSocket,
  WsSendResult,
  WsClientInfo,
  WsMessageHandler,
} from "./molecules/interfaces/IWebSocket.js";
export type { MolecularGen } from "./molecules/MolecularGen.js";

// ─── Células ──────────────────────────────────────────────────
export type { ICell, MutationEvent } from "./cells/interfaces/ICell.js";

// ─── Organismos ───────────────────────────────────────────────
export type { IOrganism } from "./organisms/interfaces/IOrganism.js";

// ─── Sistema (Orquestador) ────────────────────────────────────
export type { IOrchestrator } from "./system/interfaces/IOrchestrator.js";
export type {
  IStimulus,
  StimulusSource,
} from "./system/interfaces/IStimulus.js";
