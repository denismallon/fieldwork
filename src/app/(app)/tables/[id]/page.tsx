import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { rowToAccount } from "@/lib/types";
import TableView from "@/components/table/TableView";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ imported?: string; duplicates?: string }>;
}

export default async function TablePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { imported, duplicates } = await searchParams;

  const tableResult = await db.execute({
    sql: "SELECT id, name FROM fieldwork_tables WHERE id = ?",
    args: [id],
  });

  const tableRow = tableResult.rows[0];
  if (!tableRow) notFound();

  const accountsResult = await db.execute({
    sql: "SELECT * FROM accounts WHERE table_id = ? ORDER BY created_at ASC",
    args: [id],
  });

  const accounts = accountsResult.rows.map(rowToAccount);

  return (
    <TableView
      table={{ id: String(tableRow.id), name: String(tableRow.name) }}
      initialAccounts={accounts}
      importedCount={imported !== undefined ? Number(imported) : null}
      duplicateCount={duplicates !== undefined ? Number(duplicates) : 0}
    />
  );
}
