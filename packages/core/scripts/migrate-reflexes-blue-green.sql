-- Cleanup: Eliminar tablas obsoletas (PASO 7-9 usa solo "reflexes" para secuencias)
-- Las tablas reflexes_atomic y reflex_dependencies fueron para reflexes atómicos
-- Ahora: tools.json = átomos, biocore.db/reflexes = secuencias

DROP TABLE IF EXISTS reflex_dependencies;
DROP TABLE IF EXISTS reflexes_atomic;

-- Ya no es necesario crear estas tablas
-- La tabla "reflexes" contiene secuencias completas con ReflexStep[]
-- Ejemplo: ["scrape_url", "database_insert"] es UNA secuencia, no dos átomos

-- NOTA: Este script se ejecuta automáticamente al iniciar ReflexMolecule
-- si encuentra tablas obsoletas en la BD existente

