"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FIXED_COLUMNS, ENRICHMENT_COLUMNS } from "@/lib/columns";
import { csvRow } from "@/lib/csv";
import type { Account } from "@/lib/types";
import { renameTable, deleteAccounts } from "@/app/(app)/tables/[id]/actions";

type SortDirection = "asc" | "desc";

interface TableViewProps {
  table: { id: string; name: string };
  initialAccounts: Account[];
  importedCount: number | null;
  duplicateCount: number;
}

function compareValues(a: string | number | null, b: string | number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
}

export default function TableView({
  table,
  initialAccounts,
  importedCount,
  duplicateCount: initialDuplicateCount,
}: TableViewProps) {
  const router = useRouter();

  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [tableName, setTableName] = useState(table.name);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(table.name);

  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const duplicateCount = initialDuplicateCount;

  useEffect(() => {
    if (importedCount !== null) {
      toast.success(`${importedCount} row${importedCount === 1 ? "" : "s"} imported.`);
    }
    if (importedCount !== null || initialDuplicateCount > 0) {
      router.replace(`/tables/${table.id}`, { scroll: false });
    }
    // Only run on initial mount: these props reflect a one-time post-import state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sortedAccounts = (() => {
    if (!sortColumn) return accounts;
    const column = FIXED_COLUMNS.find((c) => c.key === sortColumn);
    if (!column) return accounts;

    return [...accounts].sort((a, b) => {
      const cmp = compareValues(column.getValue(a), column.getValue(b));
      return sortDirection === "asc" ? cmp : -cmp;
    });
  })();

  function handleSort(columnKey: string) {
    if (sortColumn === columnKey) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(columnKey);
      setSortDirection("asc");
    }
  }

  function toggleRow(id: string) {
    setConfirmingDelete(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setConfirmingDelete(false);
    setSelectedIds((prev) =>
      prev.size === accounts.length ? new Set() : new Set(accounts.map((a) => a.id)),
    );
  }

  async function handleDeleteConfirm() {
    const ids = Array.from(selectedIds);
    await deleteAccounts(table.id, ids);
    setAccounts((prev) => prev.filter((a) => !selectedIds.has(a.id)));
    setSelectedIds(new Set());
    setConfirmingDelete(false);
  }

  function startEditingName() {
    setNameInput(tableName);
    setIsEditingName(true);
  }

  async function saveName() {
    const trimmed = nameInput.trim();
    setIsEditingName(false);
    if (!trimmed || trimmed === tableName) {
      setNameInput(tableName);
      return;
    }
    setTableName(trimmed);
    await renameTable(table.id, trimmed);
  }

  function handleExport() {
    const header = [...FIXED_COLUMNS.map((c) => c.label), ...ENRICHMENT_COLUMNS];
    let csv = csvRow(header);

    for (const account of accounts) {
      const fixedValues = FIXED_COLUMNS.map((c) => c.getValue(account));
      const enrichmentValues = ENRICHMENT_COLUMNS.map(() => "");
      csv += csvRow([...fixedValues, ...enrichmentValues]);
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tableName.replace(/\s+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const allSelected = accounts.length > 0 && selectedIds.size === accounts.length;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        {isEditingName ? (
          <input
            autoFocus
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="border-b border-gray-400 bg-transparent text-2xl font-semibold text-gray-900 focus:outline-none"
          />
        ) : (
          <h1
            onClick={startEditingName}
            title="Click to rename"
            className="-mx-1 cursor-text rounded px-1 text-2xl font-semibold text-gray-900 hover:bg-gray-100"
          >
            {tableName}
          </h1>
        )}

        <button
          type="button"
          onClick={handleExport}
          className="shrink-0 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Export CSV
        </button>
      </div>

      {duplicateCount > 0 && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {duplicateCount} duplicate companies detected. Import will proceed — review duplicates
          in the table view.
        </div>
      )}

      <div className="mb-4 flex h-9 items-center gap-3">
        {selectedIds.size > 0 &&
          (confirmingDelete ? (
            <>
              <span className="text-sm text-gray-700">Delete {selectedIds.size} rows?</span>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
            >
              Delete
            </button>
          ))}
      </div>

      <div className="overflow-auto rounded-md border border-gray-200 bg-white">
        <table className="w-full whitespace-nowrap text-sm">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all rows"
                />
              </th>
              {FIXED_COLUMNS.map((column) => (
                <th
                  key={column.key}
                  onClick={() => handleSort(column.key)}
                  className="cursor-pointer select-none px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500 hover:text-gray-700"
                >
                  {column.label}
                  {sortColumn === column.key && (sortDirection === "asc" ? " ▲" : " ▼")}
                </th>
              ))}
              {ENRICHMENT_COLUMNS.map((label) => (
                <th
                  key={label}
                  className="bg-gray-100 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-400"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sortedAccounts.map((account) => (
              <tr
                key={account.id}
                className={selectedIds.has(account.id) ? "bg-gray-50" : undefined}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(account.id)}
                    onChange={() => toggleRow(account.id)}
                    aria-label={`Select ${account.company_name ?? "row"}`}
                  />
                </td>
                {FIXED_COLUMNS.map((column) => (
                  <td key={column.key} className="px-3 py-2 text-gray-700">
                    {column.getValue(account) ?? ""}
                  </td>
                ))}
                {ENRICHMENT_COLUMNS.map((label) => (
                  <td key={label} className="bg-gray-50 px-3 py-2 text-gray-300">
                    —
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {sortedAccounts.length === 0 && (
          <p className="p-6 text-center text-sm text-gray-500">No accounts in this table yet.</p>
        )}
      </div>
    </div>
  );
}
