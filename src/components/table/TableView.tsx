"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FIXED_COLUMNS, ENRICHMENT_COLUMNS, type EnrichmentColumnDef } from "@/lib/columns";
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

interface EnrichmentEvent {
  accountId: string;
  field: string;
  value: string | number | null;
}

function compareValues(a: string | number | null, b: string | number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
}

/** Reads an SSE response body, invoking `onEvent` for each `data: {...}` message. */
async function consumeEventStream(response: Response, onEvent: (event: EnrichmentEvent) => void): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as EnrichmentEvent);
      } catch {
        // ignore malformed event
      }
    }
  }
}

function RunIcon({
  onClick,
  disabled,
  loading,
  title,
}: {
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={disabled ? "cursor-not-allowed text-gray-300" : "text-gray-500 hover:text-gray-700"}
    >
      {loading ? (
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-gray-500" />
      ) : (
        "▶"
      )}
    </button>
  );
}

function CellPlaceholder() {
  return <span className="inline-block h-3 w-16 animate-pulse rounded bg-gray-200" />;
}

function AudienceBadge({ audience }: { audience: string | null }) {
  if (!audience) return <span className="text-gray-300">—</span>;

  const styles: Record<string, string> = {
    "non-technical": "bg-green-100 text-green-800",
    technical: "bg-blue-100 text-blue-800",
    unknown: "bg-gray-100 text-gray-600",
  };
  const labels: Record<string, string> = {
    "non-technical": "Non-technical",
    technical: "Technical",
    unknown: "Unknown",
  };

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[audience] ?? styles.unknown}`}>
      {labels[audience] ?? audience}
    </span>
  );
}

function EnrichmentCell({ account, column }: { account: Account; column: EnrichmentColumnDef }) {
  switch (column.key) {
    case "help_centre_url":
      if (!account.help_centre_url) return <span className="text-gray-300">—</span>;
      return (
        <a
          href={account.help_centre_url}
          target="_blank"
          rel="noreferrer"
          title={account.help_centre_url}
          className="block max-w-[220px] truncate text-blue-600 hover:underline"
        >
          {account.help_centre_url}
        </a>
      );
    case "platform":
      return account.platform ? <span>{account.platform}</span> : <span className="text-gray-300">—</span>;
    case "help_audience":
      return <AudienceBadge audience={account.help_audience} />;
    case "agent_vendor": {
      const label = column.getValue(account);
      return label !== null ? <span>{label}</span> : <span className="text-gray-300">—</span>;
    }
    case "multilingual": {
      const label = column.getValue(account);
      return label !== null ? <span>{label}</span> : <span className="text-gray-300">—</span>;
    }
    case "raw_page_count":
    case "primary_page_count": {
      if (account.page_count_status === "not_found") return <span className="text-gray-400">No sitemap</span>;
      const value = column.key === "raw_page_count" ? account.raw_page_count : account.primary_page_count;
      return value === null ? <span className="text-gray-300">—</span> : <span>{value.toLocaleString()}</span>;
    }
    default:
      return <span className="text-gray-300">—</span>;
  }
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

  const [tier1Running, setTier1Running] = useState(false);
  const [tier2Running, setTier2Running] = useState(false);
  const [pendingTier1, setPendingTier1] = useState<Set<string>>(new Set());
  const [pendingTier2, setPendingTier2] = useState<Set<string>>(new Set());

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
    const header = [...FIXED_COLUMNS.map((c) => c.label), ...ENRICHMENT_COLUMNS.map((c) => c.label)];
    let csv = csvRow(header);

    for (const account of accounts) {
      const fixedValues = FIXED_COLUMNS.map((c) => c.getValue(account));
      const enrichmentValues = ENRICHMENT_COLUMNS.map((c) => c.getValue(account));
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

  function applyEnrichmentEvent(
    { accountId, field, value }: EnrichmentEvent,
    setPending: React.Dispatch<React.SetStateAction<Set<string>>>,
  ) {
    setAccounts((prev) => prev.map((a) => (a.id === accountId ? ({ ...a, [field]: value } as Account) : a)));
    setPending((prev) => {
      if (!prev.has(accountId)) return prev;
      const next = new Set(prev);
      next.delete(accountId);
      return next;
    });
  }

  async function runTier1() {
    if (tier1Running || tier2Running) return;
    setTier1Running(true);
    setPendingTier1(new Set(accounts.filter((a) => a.domain).map((a) => a.id)));

    try {
      const res = await fetch("/api/enrich/tier1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: table.id }),
      });
      if (!res.ok || !res.body) throw new Error("Tier 1 enrichment request failed");

      await consumeEventStream(res, (event) => applyEnrichmentEvent(event, setPendingTier1));
    } catch {
      toast.error("Tier 1 enrichment failed.");
    } finally {
      setTier1Running(false);
      setPendingTier1(new Set());
    }
  }

  async function runTier2() {
    if (tier1Running || tier2Running) return;
    setTier2Running(true);
    setPendingTier2(new Set(accounts.filter((a) => a.help_centre_url_status === "found").map((a) => a.id)));

    try {
      const res = await fetch("/api/enrich/tier2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: table.id }),
      });
      if (!res.ok || !res.body) throw new Error("Tier 2 enrichment request failed");

      await consumeEventStream(res, (event) => applyEnrichmentEvent(event, setPendingTier2));
    } catch {
      toast.error("Tier 2 enrichment failed.");
    } finally {
      setTier2Running(false);
      setPendingTier2(new Set());
    }
  }

  const allSelected = accounts.length > 0 && selectedIds.size === accounts.length;
  const hasHelpCentreUrl = accounts.some((a) => a.help_centre_url);

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
              {ENRICHMENT_COLUMNS.map((column) => (
                <th
                  key={column.key}
                  className="bg-gray-100 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-400"
                >
                  <div className="flex items-center gap-1.5">
                    <span>{column.label}</span>
                    {column.tier === 1 && (
                      <RunIcon
                        onClick={runTier1}
                        disabled={tier1Running || tier2Running}
                        loading={tier1Running}
                        title="Run Tier 1 enrichment for all rows"
                      />
                    )}
                    {column.tier === 2 && (
                      <RunIcon
                        onClick={runTier2}
                        disabled={tier1Running || tier2Running || !hasHelpCentreUrl}
                        loading={tier2Running}
                        title={
                          hasHelpCentreUrl
                            ? "Run Tier 2 enrichment for all rows"
                            : "Run Tier 1 first to discover help centres"
                        }
                      />
                    )}
                  </div>
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
                {ENRICHMENT_COLUMNS.map((column) => (
                  <td key={column.key} className="bg-gray-50 px-3 py-2 text-gray-700">
                    {(column.tier === 1 && pendingTier1.has(account.id)) ||
                    (column.tier === 2 && pendingTier2.has(account.id)) ? (
                      <CellPlaceholder />
                    ) : (
                      <EnrichmentCell account={account} column={column} />
                    )}
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
