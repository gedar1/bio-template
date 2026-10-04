---
inclusion: manual
---

# Crear un tipo de cell

Una cell es el adaptador MCP dinámico que expone solo las herramientas de la capacidad estimulada. No es el lugar para implementar negocio.

## Procedimiento

1. Define el nuevo `type`, descripción y tools en `packages/core/src/config/registry.json`. Usa nombres estables y verifica que no colisionen con otra cell.
2. Si trabajas en `bio-template`, agrega la definición en `packages/core/src/config/domain-registry.json`; no reemplaces el registry genérico del motor. Comprueba que el tipo también aparece en `allowedCells` de `config/domain-profile.ts`.
3. Agrega la molecule como campo privado de `packages/core/src/cells/CellServer.ts` e impórtala desde la ruta correcta. Sigue el lifecycle existente: limpiar la instancia anterior, crearla en `initializeMolecules(type)` y liberar sus recursos en `disposeMolecules()`.
4. Agrega un `case` en `registerToolsForType(type)`. Define cada `inputSchema` con Zod y delega inmediatamente en un método de la molecule. El handler solo valida, invoca y devuelve contenido MCP.
5. Si la cell hereda de otra, declara el `parent` en el registry y confirma que `resolveTools()` resuelve la cadena sin duplicados. Inicializa y registra las capacidades heredadas solo según el comportamiento ya usado por `CellServer`.
6. No agregues consultas SQL, reglas de dominio, llamadas HTTP de negocio ni decisiones de tenant al `CellServer`; esas responsabilidades pertenecen a la molecule o a configuración.
7. Añade una prueba de registro/mutación en `packages/core/tests/cells/` cuando sea viable y pruebas de la molecule por separado.

## Verificación

- Comprueba que el schema de `stimulate_differentiation` expone el tipo solo cuando el perfil lo permite.
- Ejecuta `npm test` y `npm run build:ts`.
- Si es un cambio del template, valida además con `npm --prefix ..\\bio-template run validate-template` cuando ese script exista; no asumas que el template tiene paquetes de dominio o dashboard instalados en todos los checkouts.
