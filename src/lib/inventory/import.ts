export type ImportedRows = { resources: unknown[]; containers: unknown[] };

type ImportResult = { ok: true; rows: ImportedRows } | { ok: false; code: "import-invalid" | "import-too-many-rows" };
const MAX_ROWS = 50_000;

export function parseImportedInventory(json: unknown): ImportResult {
  let rows: ImportedRows;
  if (json !== null && typeof json === "object" && !Array.isArray(json)
    && ("resources" in json || "containers" in json)) {
    if (!("resources" in json) || !("containers" in json)
      || !Array.isArray(json.resources) || !Array.isArray(json.containers)) {
      return { ok: false, code: "import-invalid" };
    }
    rows = { resources: json.resources, containers: json.containers };
  } else {
    const data = Array.isArray(json) ? json
      : json !== null && typeof json === "object" && "data" in json ? json.data : null;
    if (!Array.isArray(data)) {
      return { ok: false, code: "import-invalid" };
    }
    if (data.length > MAX_ROWS) return tooManyRows();
    rows = { resources: [], containers: [] };
    for (const row of data) {
      const type = row !== null && typeof row === "object" && typeof row.type === "string"
        ? row.type.trim().toLowerCase() : null;
      if (type === "microsoft.resources/subscriptions" || type === "microsoft.resources/subscriptions/resourcegroups") {
        rows.containers.push(row);
      } else rows.resources.push(row);
    }
  }

  if (rows.resources.length + rows.containers.length > MAX_ROWS) return tooManyRows();
  return { ok: true, rows };
}

function tooManyRows(): ImportResult {
  return { ok: false, code: "import-too-many-rows" };
}
