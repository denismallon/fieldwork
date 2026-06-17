"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FIXED_COLUMNS, ENRICHMENT_COLUMNS, TIER_DOWNSTREAM_FIELDS, tierOutputLabels, type EnrichmentColumnDef } from "@/lib/columns";
import { csvRow } from "@/lib/csv";
import type { Account } from "@/lib/types";
import { renameTable, deleteAccounts, wipeDownstreamFields } from "@/app/(app)/tables/[id]/actions";

type SortDirection = "asc" | "desc";

/** Tier 3 columns flaky enough to need an individual run icon (pass1/score are pure derived columns). */
const TIER3_RUN_ICON_KEYS = new Set(["changelog_url", "release_velocity", "freshness_signal", "freshness_confidence"]);

/** Rows a tier can actually be run for, regardless of selection. */
function isEligibleForTier(account: Account, tier: 1 | 2 | 3): boolean {
  if (tier === 2) return account.help_centre_url_status === "found";
  return account.domain !== null;
}

function tierEnrichedAt(account: Account, tier: 1 | 2 | 3): number | null {
  if (tier === 1) return account.tier1_enriched_at;
  if (tier === 2) return account.tier2_enriched_at;
  return account.tier3_enriched_at;
}

interface ConfirmRun {
  tier: 1 | 2 | 3;
  targetIds: string[];
  selectionBased: boolean;
}

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

function Pass1Badge({ pass1 }: { pass1: number | null }) {
  if (pass1 === null) return <span className="text-gray-300">—</span>;
  if (pass1 === 1) {
    return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Pass</span>;
  }
  return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Fail</span>;
}

const SCORE_CONFIDENCE_DOT_COLORS: Record<string, string> = {
  high: "bg-green-500",
  medium: "bg-amber-500",
  low: "bg-red-500",
};

function ScoreCell({ account }: { account: Account }) {
  if (account.score === null) return <span className="text-gray-300">—</span>;

  const isPartial = account.tier3_enriched_at === null;
  const confidence = account.score_confidence;
  const dotColor = (confidence && SCORE_CONFIDENCE_DOT_COLORS[confidence]) || "bg-gray-300";

  let flags: string[] = [];
  if (confidence === "low" && account.score_flags) {
    try {
      const parsed = JSON.parse(account.score_flags);
      if (Array.isArray(parsed)) flags = parsed;
    } catch {
      // ignore malformed JSON
    }
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${isPartial ? "text-gray-400" : "text-gray-700"}`}>
      <span>{account.score}</span>
      <span
        className={`inline-block h-2 w-2 rounded-full ${dotColor}`}
        title={flags.length > 0 ? flags.join("\n") : undefined}
      />
    </span>
  );
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

function ConfidenceBadge({ confidence }: { confidence: string | null }) {
  if (!confidence) return <span className="text-gray-300">—</span>;

  const styles: Record<string, string> = {
    high: "bg-green-100 text-green-800",
    medium: "bg-amber-100 text-amber-800",
    low: "bg-red-100 text-red-800",
  };
  const labels: Record<string, string> = {
    high: "High",
    medium: "Medium",
    low: "Low",
  };

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        styles[confidence] ?? "bg-gray-100 text-gray-600"
      }`}
    >
      {labels[confidence] ?? confidence}
    </span>
  );
}

function RationalePreview({ rationale }: { rationale: string | null }) {
  if (!rationale) return <span className="text-gray-300">—</span>;

  const preview = rationale.length > 60 ? `${rationale.slice(0, 57)}...` : rationale;
  return (
    <span title={rationale} className="block w-[360px] truncate">
      {preview}
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
    case "multilingual":
    case "requires_login": {
      const label = column.getValue(account);
      return label !== null ? <span>{label}</span> : <span className="text-gray-300">—</span>;
    }
    case "raw_page_count":
    case "primary_page_count": {
      if (account.page_count_status === "not_found") return <span className="text-gray-400">No sitemap</span>;
      const value = column.key === "raw_page_count" ? account.raw_page_count : account.primary_page_count;
      return value === null ? <span className="text-gray-300">—</span> : <span>{value.toLocaleString()}</span>;
    }
    case "changelog_url":
      if (!account.changelog_url) return <span className="text-gray-300">—</span>;
      return (
        <a
          href={account.changelog_url}
          target="_blank"
          rel="noreferrer"
          title={account.changelog_url}
          className="block max-w-[220px] truncate text-blue-600 hover:underline"
        >
          {account.changelog_url}
        </a>
      );
    case "release_velocity":
    case "freshness_signal": {
      const label = column.getValue(account);
      return label !== null ? <span>{label}</span> : <span className="text-gray-300">—</span>;
    }
    case "freshness_confidence":
      return <ConfidenceBadge confidence={account.freshness_confidence} />;
    case "tier3_rationale":
      return <RationalePreview rationale={account.tier3_rationale} />;
    case "pass1":
      return <Pass1Badge pass1={account.pass1} />;
    case "score":
      return <ScoreCell account={account} />;
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
  const lastCheckedIndex = useRef<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const duplicateCount = initialDuplicateCount;

  const [tier1Running, setTier1Running] = useState(false);
  const [tier2Running, setTier2Running] = useState(false);
  const [tier3Running, setTier3Running] = useState(false);
  const [pendingTier1, setPendingTier1] = useState<Set<string>>(new Set());
  const [pendingTier2, setPendingTier2] = useState<Set<string>>(new Set());
  const [pendingTier3, setPendingTier3] = useState<Set<string>>(new Set());
  const [confirmRun, setConfirmRun] = useState<ConfirmRun | null>(null);

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

  function toggleRow(id: string, index: number, shiftKey: boolean) {
    setConfirmingDelete(false);
    setConfirmRun(null);

    if (shiftKey && lastCheckedIndex.current !== null) {
      const start = Math.min(lastCheckedIndex.current, index);
      const end = Math.max(lastCheckedIndex.current, index);
      const rangeIds = sortedAccounts.slice(start, end + 1).map((a) => a.id);
      const selecting = !selectedIds.has(id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const rid of rangeIds) selecting ? next.add(rid) : next.delete(rid);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      lastCheckedIndex.current = index;
    }
  }

  function toggleAll() {
    setConfirmingDelete(false);
    setConfirmRun(null);
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

  async function runTier1(targetIds: string[]) {
    if (tier1Running || tier2Running || tier3Running) return;
    setTier1Running(true);
    setPendingTier1(new Set(targetIds));

    try {
      const res = await fetch("/api/enrich/tier1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: table.id, accountIds: targetIds }),
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

  async function runTier2(targetIds: string[]) {
    if (tier1Running || tier2Running || tier3Running) return;
    setTier2Running(true);
    setPendingTier2(new Set(targetIds));

    try {
      const res = await fetch("/api/enrich/tier2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: table.id, accountIds: targetIds }),
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

  async function runTier3(targetIds: string[]) {
    if (tier1Running || tier2Running || tier3Running) return;
    setTier3Running(true);
    setPendingTier3(new Set(targetIds));

    // Tier 3 is slow (2 Brave searches + LLM per row). Chunk into batches of 20
    // so each request stays well under Vercel's 300s function timeout.
    const CHUNK = 20;
    try {
      for (let i = 0; i < targetIds.length; i += CHUNK) {
        const batch = targetIds.slice(i, i + CHUNK);
        const res = await fetch("/api/enrich/tier3", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tableId: table.id, accountIds: batch }),
        });
        if (!res.ok || !res.body) throw new Error("Tier 3 enrichment request failed");
        await consumeEventStream(res, (event) => applyEnrichmentEvent(event, setPendingTier3));
      }
    } catch {
      toast.error("Tier 3 enrichment failed.");
    } finally {
      setTier3Running(false);
      setPendingTier3(new Set());
    }
  }

  /** Selected rows if any are ticked, otherwise rows tier `tier` hasn't run for yet — filtered to rows the tier can actually process. */
  function computeRunTargets(tier: 1 | 2 | 3): { targetIds: string[]; selectionBased: boolean } {
    const selectionBased = selectedIds.size > 0;
    const base = selectionBased
      ? accounts.filter((a) => selectedIds.has(a.id))
      : accounts.filter((a) => tierEnrichedAt(a, tier) === null);

    return { targetIds: base.filter((a) => isEligibleForTier(a, tier)).map((a) => a.id), selectionBased };
  }

  function handleRunClick(tier: 1 | 2 | 3) {
    if (tier1Running || tier2Running || tier3Running) return;

    const { targetIds, selectionBased } = computeRunTargets(tier);
    if (targetIds.length === 0) {
      toast.info(
        selectionBased
          ? "None of the selected rows are eligible for this step."
          : "All rows already have this data — select rows to re-run.",
      );
      return;
    }

    setConfirmRun({ tier, targetIds, selectionBased });
  }

  function buildConfirmMessage({ tier, targetIds, selectionBased }: ConfirmRun): string {
    const labels = tierOutputLabels(tier);
    const fieldsText =
      labels.length > 3
        ? `${labels.slice(0, 3).join(", ")} and ${labels.length - 3} more field${labels.length - 3 === 1 ? "" : "s"}`
        : labels.join(", ");

    const rowText = selectionBased
      ? `${targetIds.length} selected row${targetIds.length === 1 ? "" : "s"}`
      : `${targetIds.length} row${targetIds.length === 1 ? "" : "s"} without existing data`;

    const downstream =
      tier === 1
        ? " This will also clear existing Tier 2 and Tier 3 data for these rows."
        : tier === 2
          ? " This will also clear existing Tier 3 data for these rows."
          : "";

    return `You are about to generate ${fieldsText} for ${rowText}.${downstream} Continue?`;
  }

  async function executeRun() {
    if (!confirmRun) return;
    const { tier, targetIds } = confirmRun;
    setConfirmRun(null);

    if (tier === 1 || tier === 2) {
      const idSet = new Set(targetIds);
      const scores = await wipeDownstreamFields(table.id, targetIds, tier);
      const nullFields: Record<string, null> = {};
      for (const field of TIER_DOWNSTREAM_FIELDS[tier]) nullFields[field] = null;

      setAccounts((prev) =>
        prev.map((a) => {
          if (!idSet.has(a.id)) return a;
          const scoreResult = scores[a.id];
          return {
            ...a,
            ...nullFields,
            pass1: scoreResult?.pass1 ?? null,
            score: scoreResult?.score ?? null,
            score_confidence: scoreResult?.score_confidence ?? null,
            score_flags: JSON.stringify(scoreResult?.score_flags ?? []),
          } as Account;
        }),
      );
    }

    if (tier === 1) await runTier1(targetIds);
    else if (tier === 2) await runTier2(targetIds);
    else await runTier3(targetIds);
  }

  const allSelected = accounts.length > 0 && selectedIds.size === accounts.length;
  const hasHelpCentreUrl = accounts.some((a) => a.help_centre_url);
  const hasTier2Run = accounts.some((a) => a.tier2_enriched_at !== null);

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

      <div className="mb-4 flex min-h-9 items-center gap-3">
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

        {confirmRun && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm text-blue-900">
            <span>{buildConfirmMessage(confirmRun)}</span>
            <button
              type="button"
              onClick={executeRun}
              className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Continue
            </button>
            <button
              type="button"
              onClick={() => setConfirmRun(null)}
              className="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="overflow-auto rounded-md border border-gray-200 bg-white">
        <table className="w-full whitespace-nowrap text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 w-10 bg-white px-3 py-2 text-left">
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
                  className={`cursor-pointer select-none px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500 hover:text-gray-700 ${
                    column.key === "company_name" ? "sticky left-10 z-20 border-r border-gray-200 bg-white" : ""
                  }`}
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
                        onClick={() => handleRunClick(1)}
                        disabled={tier1Running || tier2Running || tier3Running}
                        loading={tier1Running}
                        title={
                          selectedIds.size > 0
                            ? "Run Tier 1 enrichment for selected rows"
                            : "Run Tier 1 enrichment for rows missing data"
                        }
                      />
                    )}
                    {column.tier === 2 && (
                      <RunIcon
                        onClick={() => handleRunClick(2)}
                        disabled={tier1Running || tier2Running || tier3Running || !hasHelpCentreUrl}
                        loading={tier2Running}
                        title={
                          !hasHelpCentreUrl
                            ? "Run Tier 1 first to discover help centres"
                            : selectedIds.size > 0
                              ? "Run Tier 2 enrichment for selected rows"
                              : "Run Tier 2 enrichment for rows missing data"
                        }
                      />
                    )}
                    {column.tier === 3 && TIER3_RUN_ICON_KEYS.has(column.key) && (
                      <RunIcon
                        onClick={() => handleRunClick(3)}
                        disabled={tier1Running || tier2Running || tier3Running || !hasTier2Run}
                        loading={tier3Running}
                        title={
                          !hasTier2Run
                            ? "Run Tier 2 first to count pages"
                            : selectedIds.size > 0
                              ? "Run Tier 3 enrichment for selected rows"
                              : "Run Tier 3 enrichment for rows missing data"
                        }
                      />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sortedAccounts.map((account, index) => (
              <tr
                key={account.id}
                className={selectedIds.has(account.id) ? "bg-gray-50" : undefined}
              >
                <td
                  className={`sticky left-0 z-10 w-10 px-3 py-2 ${
                    selectedIds.has(account.id) ? "bg-gray-50" : "bg-white"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(account.id)}
                    onChange={(e) => toggleRow(account.id, index, e.nativeEvent instanceof MouseEvent && e.nativeEvent.shiftKey)}
                    aria-label={`Select ${account.company_name ?? "row"}`}
                  />
                </td>
                {FIXED_COLUMNS.map((column) => (
                  <td
                    key={column.key}
                    className={`px-3 py-2 text-gray-700 ${
                      column.key === "company_name"
                        ? `sticky left-10 z-10 border-r border-gray-200 ${
                            selectedIds.has(account.id) ? "bg-gray-50" : "bg-white"
                          }`
                        : ""
                    }`}
                  >
                    {column.getValue(account) ?? ""}
                  </td>
                ))}
                {ENRICHMENT_COLUMNS.map((column) => (
                  <td key={column.key} className="bg-gray-50 px-3 py-2 text-gray-700">
                    {(column.tier === 1 && pendingTier1.has(account.id)) ||
                    (column.tier === 2 && pendingTier2.has(account.id)) ||
                    (column.tier === 3 && pendingTier3.has(account.id)) ? (
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
