/**
 * Validación de SQL y de identificadores para la base del tenant.
 *
 * Funciones puras. Se usan antes de ejecutar SQL que viene del LLM o de un cliente.
 *
 * - `checkReadOnlySql` acepta solo una sentencia SELECT o WITH, sin palabras clave de
 *   escritura, de adjunto de bases ni de PRAGMA. Ignora el contenido de comentarios,
 *   cadenas y nombres entre comillas, para no marcar falsos positivos como
 *   `'DELETE'` dentro de un texto.
 * - `isSqlIdentifier` valida nombres de tabla y columna que se interpolan en el SQL.
 */

/** Palabras que nunca aparecen en una consulta de solo lectura. */
const DENIED_KEYWORDS = new Set([
  "ATTACH",
  "DETACH",
  "PRAGMA",
  "VACUUM",
  "REINDEX",
  "CREATE",
  "DROP",
  "ALTER",
  "INSERT",
  "UPDATE",
  "DELETE",
  "INTO",
  "SAVEPOINT",
  "RELEASE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "TRIGGER",
  "LOAD_EXTENSION",
]);

const ALLOWED_FIRST_KEYWORDS = new Set(["SELECT", "WITH"]);

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export type SqlCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

type Token = { readonly kind: "word" | "semicolon"; readonly value: string };

/**
 * Recorre el SQL y devuelve palabras y puntos y coma. Omite comentarios, cadenas,
 * identificadores entre comillas y corchetes. Devuelve error si algún literal queda abierto.
 */
function tokenize(sql: string): { tokens: Token[]; error?: string } {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      if (end === -1) break;
      i = end + 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) return { tokens, error: "Comentario sin cerrar" };
      i = end + 2;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      const end = findClosingQuote(sql, i, ch);
      if (end === -1) return { tokens, error: "Literal o identificador sin cerrar" };
      i = end + 1;
      continue;
    }

    if (ch === "[") {
      const end = sql.indexOf("]", i + 1);
      if (end === -1) return { tokens, error: "Identificador sin cerrar" };
      i = end + 1;
      continue;
    }

    if (ch === ";") {
      tokens.push({ kind: "semicolon", value: ";" });
      i += 1;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j += 1;
      tokens.push({ kind: "word", value: sql.slice(i, j).toUpperCase() });
      i = j;
      continue;
    }

    i += 1;
  }
  return { tokens };
}

/** Posición del cierre de un literal o identificador. Las comillas dobles se escapan duplicándolas. */
function findClosingQuote(sql: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === quote) {
      if (sql[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i;
    }
    i += 1;
  }
  return -1;
}

/**
 * Acepta solo una consulta de lectura. Rechaza escrituras, ATTACH, PRAGMA,
 * varias sentencias y cualquier SQL que no empiece con SELECT o WITH.
 */
export function checkReadOnlySql(sql: string): SqlCheck {
  const { tokens, error } = tokenize(sql);
  if (error) return { ok: false, reason: error };

  if (tokens.length === 0) {
    return { ok: false, reason: "La consulta está vacía" };
  }

  const first = tokens[0];
  if (first.kind !== "word" || !ALLOWED_FIRST_KEYWORDS.has(first.value)) {
    return { ok: false, reason: "Solo se permiten consultas que empiecen con SELECT o WITH" };
  }

  for (const token of tokens) {
    if (token.kind === "word" && DENIED_KEYWORDS.has(token.value)) {
      return { ok: false, reason: `Palabra no permitida en consultas de solo lectura: ${token.value}` };
    }
  }

  // Un punto y coma solo puede cerrar la sentencia, y no puede haber otra después.
  const semicolons = tokens.filter((t) => t.kind === "semicolon").length;
  if (semicolons > 1) {
    return { ok: false, reason: "Solo se permite una sentencia por consulta" };
  }
  if (semicolons === 1 && tokens[tokens.length - 1].kind !== "semicolon") {
    return { ok: false, reason: "Solo se permite una sentencia por consulta" };
  }

  return { ok: true };
}

/** true si el nombre puede usarse como tabla o columna sin comillas. */
export function isSqlIdentifier(name: string): boolean {
  return IDENTIFIER_PATTERN.test(name);
}
