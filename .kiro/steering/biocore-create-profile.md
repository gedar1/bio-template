---
inclusion: manual
---

# Crear un perfil de dominio

Un perfil decide qué células puede ver un tenant y qué agente de dominio carga. No reemplaza al registry ni contiene lógica de negocio.

## Dónde vive un perfil

- `packages/core/src/config/domain-profile.ts`: perfil del template (`DOMAIN_PROFILE_ID = "domain"`, `allowedCells`, `agentFile`, `description`).
- `packages/core/src/config/profileRegistry.ts`: almacén de perfiles. Arranca con el perfil `domain` y valida cada perfil con Zod (`allowedCells` con al menos un tipo, `agentFile` no vacío). `registerDomainProfile()` agrega perfiles adicionales. Hoy ningún código del repositorio lo llama.
- `TenantManager.getTenant()` toma el perfil de su parámetro, luego de `TENANT_PROFILE`, y luego del perfil por defecto del almacén.

No existe `tenant-profiles.json`. Un perfil que aparezca en otra guía con ese archivo está desactualizado.

## Procedimiento

1. Edita `domain-profile.ts` (o registra un perfil nuevo con `registerDomainProfile`). Incluye en `allowedCells` solo los tipos que existen en el registry: los de `domain-registry.json` y las capacidades genéricas que uses, como `memory` o `http`. Un tipo sin registro no se anuncia aunque esté en la lista.
2. Define las células de dominio en `packages/core/src/config/domain-registry.json`. Ver [[biocore-create-cell]].
3. Escribe el prompt del agente en `packages/core/src/config/domain-agent.md` (la ruta por defecto que referencia `agentFile`). Incluye rol, vocabulario, flujos y reglas. No pongas código TypeScript en el prompt.
4. Confirma que `agentFile` coincide exactamente con la ruta relativa que lee `TenantManager.loadAgentFile()`. Si no coincide, el tenant arranca sin el agente y no hay error visible.
5. Pon `TENANT_PROFILE=domain` en `.env`. `.env.example` ya lo trae.

## Qué no hacer

- No crees `packages/domain/` ni otros paquetes. El template concentra el dominio en `packages/core/src`.
- No agregues tipos a `allowedCells` que no tengan registro. Son invisibles para el LLM.

## Verificación

- `npx tsc --noEmit` desde `packages/core`.
- Pruebas desde la raíz: `npx vitest --run --config packages/core/vitest.config.ts`.
- Validador del contrato del template desde la raíz: `npm run validate-template`.
- Comprueba con un perfil permitido y otro no permitido que `stimulate_differentiation` solo lista los tipos del primero.

## Relaciones

- Células de dominio: [[biocore-create-cell]]
- Límites entre core y dominio: [[biocore-boundaries]]
