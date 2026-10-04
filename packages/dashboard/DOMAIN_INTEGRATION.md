# Integrar DomainSection en el Dashboard

El componente `DomainSection` ya está creado en `src/components/DomainSection/`.
Solo necesitas conectarlo en 3 archivos del dashboard base.

---

## Paso 1 — Añadir "domain" a SectionId

En `src/types/dashboard.ts`, busca:

```typescript
export type SectionId =
  | "overview"
  | "operations"
  | "system"
  | "settings"
  | "platform";
```

Cambia a:

```typescript
export type SectionId =
  | "overview"
  | "operations"
  | "system"
  | "settings"
  | "platform"
  | "domain";    // ← añadir
```

---

## Paso 2 — Añadir la sección al SectionNav

En `src/components/SectionNav/index.tsx`, añade el import del icono y la sección:

```typescript
// Añadir el import del icono (elige el que encaje con tu dominio)
import { BarChart3, Settings, Wrench, SlidersHorizontal, ShieldAlert, Database } from "lucide-react";
//                                                                               ^^^^^^^^ nuevo

// Añadir tooltip
const SECTION_TOOLTIPS: Record<SectionId, string> = {
  // ...existing...
  domain: "Gestión del dominio — registros y operaciones de negocio",  // ← añadir
};

// Añadir la sección al array SECTIONS
const SECTIONS: SectionDefinition[] = [
  // ...existing sections...
  {
    id: "domain",
    label: "Domain",      // ← cambia al nombre de tu caso de uso: "Orders", "Alerts"...
    icon: Database,       // ← elige el icono que corresponda
    panels: ["domain"],
  },
];
```

---

## Paso 3 — Renderizar la sección en DashboardLayout

En `src/components/DashboardLayout/index.tsx`, añade el import y el case:

```typescript
// Añadir import
import { DomainSection } from "../DomainSection";

// En renderSection(), añadir case:
const renderSection = () => {
  switch (activeSection) {
    case "overview":    return <OverviewSection />;
    case "operations":  return <OperationsSection tenantId={tenantId} />;
    case "system":      return <SystemSection tenantId={tenantId} />;
    case "settings":    return <SettingsPanel />;
    case "platform":    return <PlatformSection />;
    case "domain":      return <DomainSection tenantId={tenantId} />;  // ← añadir
    default:            return <OverviewSection />;
  }
};
```

---

## Paso 4 — Crear el endpoint backend

La `DomainSection` llama a `/api/domain/records`. Necesitas crear la ruta en el core.

En `packages/core/src/server/routes/`, crea `DomainRoutes.ts`:

```typescript
import type { HealthServer } from "../HealthServer.js";
import type { TenantManager } from "../TenantManager.js";
import { ExampleMolecule } from "../../molecules/ExampleMolecule.js";

export function setupDomainRoutes(server: HealthServer, tenantManager: TenantManager) {
  // GET /api/domain/records — listar registros
  server.registerData("/api/domain/records", async (req) => {
    const tenantId = new URL(req.url!, "http://x").searchParams.get("tenantId") ?? "default";
    const status = new URL(req.url!, "http://x").searchParams.get("status") ?? undefined;
    const cortex = tenantManager.getCortex(tenantId);
    // TODO: obtener la molécula del organismo activo y listar registros
    return { records: [] };
  });

  // POST /api/domain/records — crear registro
  // DELETE /api/domain/records/:id — eliminar registro
}
```

Y regístrala en `RouteRegistry.ts` siguiendo el patrón comentado ahí.

---

## Resultado final

```
Dashboard
  ├── Overview    → health, métricas
  ├── Operations  → scheduler, templates, chat
  ├── System      → reflex, logs, mutaciones
  ├── Settings    → config del sistema
  └── Domain ★   → TUS entidades de negocio
```

La sección Domain es tuya — tabla, acciones, filtros, todo personalizable.
