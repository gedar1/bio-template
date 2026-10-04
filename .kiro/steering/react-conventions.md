---
inclusion: fileMatch
fileMatchPattern: "**/packages/dashboard/src/**"
---

# Convenciones React — Dashboard BioCore

Fuente de verdad: #[[file:docs/ai/specs/REACT.md]]

## Stack del dashboard

- React + TypeScript + Vite
- Recharts para gráficos
- Tailwind CSS para estilos (clases inline)
- Hooks personalizados en `src/hooks/`

## Estructura de componentes

Todos los componentes (nuevos y existentes) DEBEN seguir la estructura de carpetas de REACT.md, pero usando Tailwind en lugar de CSS Modules:

```
dashboard/src/components/
├── ComponentName/
│   ├── index.tsx              ← Componente principal (con clases Tailwind)
│   ├── ComponentName.types.ts ← Tipos/Props del componente
│   └── components/            ← Sub-componentes (si aplica)
│       ├── SubComponent/
│       │   └── index.tsx
│       └── index.ts           ← Barrel file
```

### Diferencia con REACT.md

- REACT.md indica `index.module.css` → en este dashboard usamos **Tailwind inline** (ya está configurado y todos los componentes lo usan)
- El resto de la estructura se mantiene: carpetas, tipos separados, barrel files, `React.FC<Props>`

## Patrones obligatorios

- Usar `React.FC<Props>` para la firma del componente
- Props tipadas en archivo separado `ComponentName.types.ts`
- Estilos con **Tailwind CSS** (clases inline en JSX)
- Custom hooks para lógica de API (`useApi.ts`)
- Estado local con `useState`, efectos con `useEffect`
- Barrel file (`index.ts`) en carpetas de sub-componentes

## Ejemplo de componente

```typescript
// components/ReflexPanel/ReflexPanel.types.ts
export interface ReflexPanelProps {
  tenantId: string;
}

// components/ReflexPanel/index.tsx
import type { ReflexPanelProps } from './ReflexPanel.types';
import { useApi } from '../../hooks/useApi';

export const ReflexPanel: React.FC<ReflexPanelProps> = ({ tenantId }) => {
  const { data, loading, error } = useApi('/api/reflex', 5000);

  if (loading) return <div className="text-gray-400">Cargando...</div>;
  if (error) return <div className="text-red-400">{error}</div>;

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      {/* contenido */}
    </div>
  );
};
```

## Comunicación con backend

```typescript
// hooks/useApi.ts contiene las funciones de fetch
// Endpoints en HealthServer: /api/tools, /api/perf, /api/history, etc.
// SSE para streaming: POST /api/chat/stream/:tenantId
```

## Reglas

- No instalar dependencias nuevas sin justificación
- Mantener componentes pequeños y enfocados (1 panel = 1 componente)
- Manejar estados: loading, error, data
- Los paneles reciben `tenantId` como prop cuando aplica
- Estructura de carpetas para TODOS los componentes
- Tailwind para estilos (no CSS Modules)
- Tipos en archivo separado `ComponentName.types.ts`
