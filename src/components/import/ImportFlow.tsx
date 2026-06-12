"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { mapApolloRow } from "@/lib/csv";
import type { AccountInput } from "@/lib/types";
import { importAccounts } from "@/app/(app)/import/actions";

interface ExistingTable {
  id: string;
  name: string;
}

type Step = "upload" | "destination";
type DestinationType = "new" | "existing";

export default function ImportFlow({ existingTables }: { existingTables: ExistingTable[] }) {
  const router = useRouter();

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<AccountInput[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  const [destinationType, setDestinationType] = useState<DestinationType>(
    existingTables.length > 0 ? "existing" : "new",
  );
  const [newTableName, setNewTableName] = useState("");
  const [existingTableId, setExistingTableId] = useState(existingTables[0]?.id ?? "");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setParseError(null);
    setFileName(file.name);
    setRows([]);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          setParseError(results.errors[0].message);
          return;
        }
        setRows(results.data.map(mapApolloRow));
      },
      error: (err) => {
        setParseError(err.message);
      },
    });
  }

  const canImport =
    rows.length > 0 &&
    !isSubmitting &&
    (destinationType === "new" ? newTableName.trim().length > 0 : existingTableId.length > 0);

  async function handleImport() {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const destination =
        destinationType === "new"
          ? { type: "new" as const, name: newTableName.trim() }
          : { type: "existing" as const, tableId: existingTableId };

      const result = await importAccounts(rows, destination);

      const params = new URLSearchParams({
        imported: String(result.imported),
        duplicates: String(result.duplicates),
      });
      router.push(`/tables/${result.tableId}?${params.toString()}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Import failed");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Import accounts</h1>

      <ol className="mb-6 flex gap-6 text-sm font-medium">
        <li className={step === "upload" ? "text-gray-900" : "text-gray-400"}>1. Upload CSV</li>
        <li className={step === "destination" ? "text-gray-900" : "text-gray-400"}>
          2. Destination
        </li>
      </ol>

      {step === "upload" && (
        <div className="space-y-4 rounded-md border border-gray-200 bg-white p-6">
          <div>
            <label className="block text-sm font-medium text-gray-700">Apollo CSV export</label>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="mt-2 block w-full text-sm text-gray-700 file:mr-4 file:rounded-md file:border-0 file:bg-gray-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-gray-800"
            />
          </div>

          {parseError && <p className="text-sm text-red-600">{parseError}</p>}

          {fileName && rows.length > 0 && !parseError && (
            <p className="text-sm text-gray-600">
              Parsed <span className="font-medium text-gray-900">{rows.length}</span> rows from{" "}
              <span className="font-medium text-gray-900">{fileName}</span>.
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setStep("destination")}
              disabled={rows.length === 0}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {step === "destination" && (
        <div className="space-y-4 rounded-md border border-gray-200 bg-white p-6">
          <p className="text-sm text-gray-600">
            Importing <span className="font-medium text-gray-900">{rows.length}</span> rows from{" "}
            <span className="font-medium text-gray-900">{fileName}</span>.
          </p>

          <div className="space-y-3">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="radio"
                  name="destination"
                  checked={destinationType === "new"}
                  onChange={() => setDestinationType("new")}
                />
                New table
              </label>
              {destinationType === "new" && (
                <input
                  type="text"
                  value={newTableName}
                  onChange={(e) => setNewTableName(e.target.value)}
                  placeholder="Table name"
                  autoFocus
                  className="ml-6 block w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                />
              )}
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="radio"
                  name="destination"
                  checked={destinationType === "existing"}
                  onChange={() => setDestinationType("existing")}
                  disabled={existingTables.length === 0}
                />
                Add to existing table
                {existingTables.length === 0 && (
                  <span className="text-gray-400">(none yet)</span>
                )}
              </label>
              {destinationType === "existing" && existingTables.length > 0 && (
                <select
                  value={existingTableId}
                  onChange={(e) => setExistingTableId(e.target.value)}
                  className="ml-6 block w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                >
                  {existingTables.map((table) => (
                    <option key={table.id} value={table.id}>
                      {table.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {submitError && <p className="text-sm text-red-600">{submitError}</p>}

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep("upload")}
              disabled={isSubmitting}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={!canImport}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? "Importing…" : "Import"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
