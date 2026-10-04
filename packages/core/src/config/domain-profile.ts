/**
 * domain-profile.ts — Perfil de tu caso de uso.
 *
 * Define qué células están activas para este proyecto.
 * El LLM solo ve las células del perfil activo — todo lo demás no existe para él.
 *
 * ─── QUÉ CAMBIAR ────────────────────────────────────────────────────────────
 * 1. DOMAIN_PROFILE_ID → nombre de tu caso de uso (mismo que TENANT_PROFILE en .env)
 * 2. allowedCells      → solo las células que necesitas
 * 3. agentFile         → ruta al system prompt de tu agente
 * 4. description       → descripción legible del perfil
 *
 * ─── GUÍA DE CÉLULAS POR CASO DE USO ─────────────────────────────────────────
 * Restaurante:   ["example", "memory"]
 * SmartAlerts:   ["example", "memory"]           + agregar "http" si haces health checks
 * MotoFleet:     ["example", "memory"]           + agregar "communication" si notificas
 * Con emails:    agrega "communication"           + instalar nodemailer
 * Con scraping:  agrega "sensory"                 + instalar cheerio
 * Con git:       agrega "versioncontrol"          + instalar simple-git
 * Con archivos:  agrega "filesystem"
 * Con CLI:       agrega "system"
 *
 * REGLA: menos células = LLM más enfocado. Solo activa lo que realmente necesitas.
 */

import type { ProfileConfig } from "./profileRegistry.js";

/** Debe coincidir con TENANT_PROFILE en .env */
export const DOMAIN_PROFILE_ID = "domain"; // ← Cambia al nombre de tu caso de uso

export const domainProfile: ProfileConfig = {
  allowedCells: [
    "example",  // ← tu célula de dominio (definida en domain-registry.json)
    "memory",   // ← SQLite genérico para queries ad-hoc (siempre útil)
    // "communication", // descomenta si envías emails o WhatsApp
    // "http",          // descomenta si consumes APIs externas
    // "filesystem",    // descomenta si lees/escribes archivos
    // "versioncontrol",// descomenta si usas git
    // "system",        // descomenta si ejecutas comandos CLI
  ],
  agentFile: "config/domain-agent.md",
  description: "Perfil del dominio — personaliza esta descripción",
};
