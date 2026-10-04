# bio-template 🧬

Template de arranque para crear un proyecto sobre BioCore. El checkout mínimo concentra el motor y la extensión de dominio en `packages/core`; no presupone `packages/domain` ni un dashboard instalado.

## Estructura

```
bio-template/
├── packages/core/          ← motor sincronizado + extensión de ejemplo
│   └── src/
│       ├── molecules/ExampleMolecule.ts
│       └── config/domain-*.{json,ts,md}
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

Lee **`docs/START_HERE.md`** para adaptar la molécula, el registry, el perfil y el agente de dominio. Los procedimientos detallados por capa están en `.kiro/steering/`; por ejemplo, invoca `biocore-create-molecule.md` para una molécula nueva.

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
