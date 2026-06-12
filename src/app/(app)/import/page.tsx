import { db } from "@/lib/db";
import ImportFlow from "@/components/import/ImportFlow";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const result = await db.execute("SELECT id, name FROM fieldwork_tables ORDER BY name ASC");
  const tables = result.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
  }));

  return <ImportFlow existingTables={tables} />;
}
