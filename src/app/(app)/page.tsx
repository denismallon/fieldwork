import Link from "next/link";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

interface TableSummary {
  id: string;
  name: string;
  created_at: number;
  account_count: number;
}

export default async function TablesPage() {
  const result = await db.execute(`
    SELECT t.id, t.name, t.created_at, COUNT(a.id) AS account_count
    FROM fieldwork_tables t
    LEFT JOIN accounts a ON a.table_id = t.id
    GROUP BY t.id, t.name, t.created_at
    ORDER BY t.created_at DESC
  `);

  const tables: TableSummary[] = result.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    created_at: Number(row.created_at),
    account_count: Number(row.account_count),
  }));

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Tables</h1>

      {tables.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-sm text-gray-600">No tables yet.</p>
          <Link
            href="/import"
            className="mt-2 inline-block text-sm font-medium text-gray-900 underline"
          >
            Import a CSV to get started
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Accounts</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tables.map((table) => (
                <tr key={table.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/tables/${table.id}`}
                      className="font-medium text-gray-900 hover:underline"
                    >
                      {table.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{table.account_count}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {new Date(table.created_at * 1000).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
