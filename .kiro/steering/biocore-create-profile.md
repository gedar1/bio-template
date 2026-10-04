---
inclusion: manual
---

# Crear un perfil de dominio

Un perfil limita las capacidades visibles para un tenant y selecciona el agente de dominio. No es un sustituto del registry ni una lista de lógica de negocio.

## Procedimiento en BioCore

1. Define el perfil en `packages/core/src/config/tenant-profiles.json` con un id válido, `allowedCells` y `agentFile`. Usa solo tipos presentes en `config/registry.json`.
2. Crea o edita el agente en `packages/core/src/config/agents/<profile>-agent.md`. Incluye rol, vocabulario, flujos y reglas; no pongas implementación TypeScript en el prompt.
3. Si el perfil corresponde a una industria, coloca sus molecules en el paquete de dominio, por ejemplo `packages/restaurant/src/molecules/`, y registra la integración siguiendo la extensión existente.
4. Comprueba el aislamiento: `allowedCells` se pasa al organism/cell y filtra `stimulate_differentiation`; los datos de negocio van a la BD del tenant, mientras que reflexes y métricas usan la infraestructura compartida.

## Procedimiento en bio-template

1. Usa `packages/core/src/config/domain-profile.ts` como perfil editable. Cambia `DOMAIN_PROFILE_ID`, `allowedCells`, `agentFile` y `description`.
2. Define las cells específicas en `packages/core/src/config/domain-registry.json`; el `allowedCells` del perfil debe incluirlas junto con las capacidades genéricas que realmente uses, como `memory` o `http`.
3. Coloca el prompt en la ruta que consume el template (por defecto `packages/core/src/config/domain-agent.md`) y confirma que `agentFile` coincide exactamente.
4. Registra el perfil con las APIs existentes de `profileRegistry.ts` si el arranque del proyecto lo requiere. No inventes `packages/domain/`: este template mínimo concentra el dominio dentro de `packages/core/src`.

## Verificación

- Rechaza tipos que no estén en el registry o que no deban estar disponibles para el tenant.
- Prueba un perfil con una cell permitida y otra no permitida.
- Ejecuta `npm test` y `npm run build:ts`; para el template, ejecuta `npm --prefix ..\\bio-template run validate-template` cuando el script esté disponible.
