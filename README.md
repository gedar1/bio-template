# bio-template 🧬

Template de arranque para crear un proyecto sobre BioCore. El checkout mínimo concentra el motor y la extensión de dominio en `packages/core`; no presupone `packages/domain` ni un dashboard instalado.

## Estructura

```
bio-template/
├── packages/core/          ← motor sincronizado + extensión de ejemplo
│   └── src/
│       ├── molecules/ExampleMolecule.ts
│       ├── config/
│       │   ├── agents/           ← Agentes de dominio
│       │   ├── templates/        ← Plantillas
│       │   ├── tenants/          ← Perfiles por tenant
│       │   ├── domain-registry.json
│       │   ├── domain-profile.ts
│       │   └── applicationComposition.ts
│       └── application-cell.ts
├── scripts/                ← utilidades sincronizadas desde bio-core
├── .kiro/steering/         ← steering canónico compartido
├── .kiro/hooks/            ← hooks oficiales compartidos
└── docs/START_HERE.md
```

Los archivos cuyo nombre comienza por `template-` son propiedad de este checkout. La sincronización nunca los sobrescribe.

## Inicio rápido

```bash
# 1. Copia este repositorio a tu proyecto
cp -r bio-template/ bio-mi-proyecto/
cd bio-mi-proyecto/

# 2. Configura tus variables locales (no se versionan)
cp .env.example .env

# 3. Instala y verifica
npm install
npm run validate-template
npm run build:ts
```

`hnswlib-node` es una peer dependency opcional. `npm install` no la intenta compilar: si no está presente, `ReflexMolecule` registra el modo `linear` y conserva la búsqueda por similitud, siempre que `better-sqlite3` tenga un binario compatible disponible. En un entorno con toolchain C++ compatible se puede instalar manualmente con `npm install hnswlib-node` para habilitar el índice HNSW y sus consultas O(log n). El rendimiento mejora con muchos reflexes, pero el resultado funcional y la persistencia siguen siendo los mismos.

`better-sqlite3` no es opcional en este cambio: es una dependencia nativa separada y obligatoria para SQLite, con sus propios requisitos de prebuild o compilación.

`mergeRegistry` valida `registry.json` y `domain-registry.json` con Zod y rechaza tipos duplicados o JSON inválido; el core no se reemplaza. `validators.ts`, `CellServer` y `ProductionServer` consumen el registry fusionado, por lo que un tipo de dominio como `example` debe aparecer también en `domain-profile.ts` y tener handlers registrados en `applicationComposition.ts`.

## Registrar una cell de dominio

Una aplicación vertical registra sus capacidades en `packages/core/src/config/applicationComposition.ts`: combina `registry.json` con `domain-registry.json`, crea la molécula en un `factory` y registra sus tools en `registerTools`. `CellServer` recibe esa composición dentro del proceso MCP; no se serializan funciones por transporte.

Para que `BaseOrganisms` lance la composición de la aplicación, usa el entrypoint compilado y define `BIOCORE_CELL_SERVER_PATH` con la ruta absoluta a `packages/core/dist/application-cell.js`. Ese entrypoint importa `createApplicationComposition()` y llama a `runCellServer()`. Así una aplicación vertical añade una cell sin modificar ni editar switches de `@bio/core`.

### Troubleshooting

- **El estímulo de dominio aparece como inválido:** revisa que el tipo esté en `domain-registry.json`, que no duplique un tipo de `registry.json` y que también esté en `allowedCells` del perfil. El merge falla al arrancar en vez de ocultar la entrada.
- **La mutación funciona pero no aparecen las tools del dominio:** configura `BIOCORE_CELL_SERVER_PATH` apuntando al `packages/core/dist/application-cell.js` compilado. El fallback `packages/core/dist/cells/CellServer.js` es el servidor genérico y no registra handlers de `applicationComposition.ts`.
- **No se encuentran datos del tenant:** las moléculas de dominio reciben `DATABASE_DIR/tenants/{tenantId}.db`; `DATABASE_PATH` se reserva para la memoria/reflexes compartida. Comprueba `TENANT_PROFILE`, `BIOCORE_TENANT_ID` y `DATABASE_DIR` sin copiar BDs al repositorio.
- **HNSW o embeddings no cargan:** `hnswlib-node` es opcional y la búsqueda cae a recorrido lineal. Si el binding de Transformers no está disponible, la memoria semántica usa un vector seguro y no guarda nuevos reflexes; SQLite sigue requiriendo `better-sqlite3` compatible.

## Mantener el template actualizado

`bio-core` es la fuente de verdad. El sincronizador usa `BIO_TEMPLATE_PATH` si está definido; si no, busca el checkout hermano `../bio-template`.

```bash
# Desde la raíz de bio-core, con el checkout hermano por defecto
npm run sync-template

# O con cualquier checkout explícito (ruta absoluta o relativa a bio-core)
BIO_TEMPLATE_PATH=C:/ruta/a/bio-template npm run sync-template
```

La sincronización actualiza `packages/core`, `packages/dashboard` cuando existe, configuraciones raíz, `scripts/validate-template-contract.ts`, `.kiro/steering` y `.kiro/hooks`. Copia archivos normales, nunca symlinks, y no elimina steering/hooks del template ni sobrescribe nombres `template-*`. También conserva los archivos de dominio `domain-*` y `ExampleMolecule.ts` del template.

Después de sincronizar, valida ambos checkouts cuando sus dependencias estén instaladas:

```bash
# En bio-core
npm run validate-template

# En bio-template
npm run validate-template
```

El contrato solo revisa estructura, JSON y configuración mínima. No necesita `.env`, bases SQLite, `data/`, `dist/` ni datos reales; el `.gitignore` del template debe protegerlos.
