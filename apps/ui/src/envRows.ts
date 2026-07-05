import type { KeyValueRow } from "./requestFormData.js";

/** Environment variables ↔ editable rows (the pure logic behind EnvironmentPanel). */

export function variablesToRows(variables: Record<string, string>): KeyValueRow[] {
  return Object.entries(variables).map(([key, value]) => ({ key, value }));
}

/** Blank keys are skipped (half-filled rows aren't errors); duplicate keys: last one wins, like YAML. */
export function rowsToVariables(rows: KeyValueRow[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key) result[key] = row.value;
  }
  return result;
}
