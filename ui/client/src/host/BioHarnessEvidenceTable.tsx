/**
 * Structured CSV/TSV evidence viewer powered by AG Grid Community 36.2.0 (MIT)
 * (not upstream LibreChat code).
 *
 * Strictly displays bounded server-parsed pages from `GET .../evidence-table`, discloses
 * exact loaded range, unknown totals when truncated, and local-to-loaded-rows sort/filter scope.
 */
import React, { memo, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AllCommunityModule, ModuleRegistry, colorSchemeDark, themeQuartz } from 'ag-grid-community';
import type { ColDef } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Spinner, isDark, useTheme } from '@librechat/client';
import type { EvidenceAnchor, EvidenceTableResponse } from './bioharness';
import { bhKeys, fetchEvidenceTable } from './bioharness';

ModuleRegistry.registerModules([AllCommunityModule]);

export interface BioHarnessEvidenceTableProps {
  service: string;
  workspace: string;
  anchor: EvidenceAnchor;
}

const BioHarnessEvidenceTable = memo(function BioHarnessEvidenceTable({
  service,
  workspace,
  anchor,
}: BioHarnessEvidenceTableProps) {
  const { theme } = useTheme();
  const dark = isDark(theme);
  const gridTheme = useMemo(
    () => (dark ? themeQuartz.withPart(colorSchemeDark) : themeQuartz),
    [dark],
  );
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(100);

  const query = useQuery<EvidenceTableResponse>({
    queryKey: bhKeys.evidenceTable(service, workspace, anchor, offset, limit),
    queryFn: () => fetchEvidenceTable(workspace, anchor, offset, limit),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const table = query.data?.ok ? query.data.table : undefined;

  const columnDefs = useMemo<ColDef[]>(() => {
    if (!table?.columns) {
      return [];
    }
    return [
      {
        field: '__row_index',
        headerName: '#',
        width: 72,
        pinned: 'left',
        sortable: false,
        filter: false,
      },
      ...table.columns.map((col) => ({
        field: col.id,
        headerName: col.name,
        sortable: true,
        filter: true,
        resizable: true,
        minWidth: 110,
      })),
    ];
  }, [table?.columns]);

  if (query.isLoading) {
    return (
      <div className="text-text-secondary flex items-center gap-2 py-8 text-sm">
        <Spinner className="h-4 w-4" />
        <span>Verifying & parsing bounded table page…</span>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div role="alert" className="border-status-error-border bg-status-error-subtle rounded-xl border p-4 text-xs">
        {(query.error as Error)?.message || 'Failed to load structured table.'}
      </div>
    );
  }

  if (!query.data?.ok || !table || !table.content_available) {
    const reason =
      table?.unavailable_reason ||
      query.data?.error?.message ||
      'Structured table preview is not available for this evidence item.';
    return (
      <div
        role="alert"
        data-testid="bh-table-unavailable"
        className="flex items-start gap-2 rounded-xl border border-amber-400/70 bg-amber-50/90 p-4 text-xs text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">Table viewer unavailable ({reason})</p>
          <p className="mt-1 opacity-85">
            Current file identity: <code>{table?.current_file_identity ?? 'NOT_CHECKED'}</code>.
            BioHarness refuses to present drifted or unverified bytes as the recorded table.
          </p>
        </div>
      </div>
    );
  }

  const startRow = table.returned_rows > 0 ? table.offset + 1 : 0;
  const endRow = table.offset + table.returned_rows;

  return (
    <div className="space-y-2.5" data-testid="bh-ag-grid-container" data-theme-mode={dark ? 'dark' : 'light'}>
      {/* Honest data bounds & sort/filter scope bar */}
      <div
        data-testid="bh-table-disclosure"
        className="border-border-light bg-surface-primary/60 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs"
      >
        <div className="space-y-0.5">
          <div className="text-text-primary font-medium">
            Rows {startRow}–{endRow}{' '}
            {table.total_rows_known && typeof table.total_rows === 'number'
              ? `of ${table.total_rows.toLocaleString()} total`
              : '(full row count unknown — bounded preview)'}
            {' · '}
            {table.columns.length} columns{table.columns_truncated ? ' (columns capped)' : ''}
          </div>
          <div className="text-text-tertiary text-[11px]">
            Sorting & column filters apply to currently loaded rows only ({table.sort_scope}).
            {table.truncated && <> Preview contains {table.preview_rows ?? 'an unknown number of'} complete rows.
              {!table.has_more && ' End of available preview; further source rows may exist.'}</>}
            {table.cells_truncated && ' Long cell values shortened for preview.'}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            aria-label="Rows per page"
            data-testid="bh-table-limit-select"
            value={limit}
            onChange={(e) => {
              setLimit(Number(e.target.value));
              setOffset(0);
            }}
            className="border-border-medium bg-surface-primary rounded border px-1.5 py-1 text-xs"
          >
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
            <option value={250}>250 / page</option>
          </select>

          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="bh-table-prev-btn"
            disabled={offset === 0}
            onClick={() => setOffset((prev) => Math.max(0, prev - limit))}
            className="gap-1 text-xs"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Prev</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="bh-table-next-btn"
            disabled={!table.has_more}
            onClick={() => setOffset((prev) => prev + limit)}
            className="gap-1 text-xs"
          >
            <span>Next</span>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="h-[540px] w-full overflow-hidden rounded-xl border border-border-light">
        <AgGridReact
          theme={gridTheme}
          rowData={table.rows}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, resizable: true }}
          animateRows={false}
          suppressCellFocus={false}
        />
      </div>
    </div>
  );
});

export default BioHarnessEvidenceTable;
