import { useRef } from 'react'
import { toast } from 'sonner'
import { FileArrowUp, X, Trash } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import {
  saveCachedReport,
  clearCachedReport,
  type CachedReport,
} from '@/lib/reportCache'
import { aggregateAicByUser, parseUsageCsv } from '@/lib/usageReport'
import { describeError } from '@/lib/errors'

interface Props {
  enterprise: string
  months: CachedReport[]
  onChanged: () => void
}

/**
 * Multi-file CSV picker. For each file:
 *   1. Parse via parseUsageCsv → aggregate per user.
 *   2. Infer YYYY-MM from MIN(row.date).
 *   3. Save to reportCache, replacing any existing entry for that month.
 *
 * Shows the loaded months as removable chips.
 */
export function UsageCsvImport({ enterprise, months, onChanged }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    let imported = 0
    const skipped: string[] = []
    for (const file of Array.from(files)) {
      try {
        const text = await file.text()
        const rows = parseUsageCsv(text)
        if (rows.length === 0) {
          skipped.push(`${file.name}: no rows`)
          continue
        }
        // Earliest date in the file → month bucket. CSV dates are YYYY-MM-DD,
        // so lexical min is correct.
        let minDate = ''
        for (const r of rows) {
          if (!r.date) continue
          if (!minDate || r.date < minDate) minDate = r.date
        }
        if (!minDate || minDate.length < 7) {
          skipped.push(`${file.name}: no usable date`)
          continue
        }
        const monthKey = minDate.slice(0, 7)
        const aggregated = aggregateAicByUser(rows)
        if (aggregated.length === 0) {
          skipped.push(`${file.name}: no Copilot AIC rows`)
          continue
        }
        saveCachedReport({
          enterprise,
          monthKey,
          reportId: null,
          ingestedAt: Date.now(),
          source: 'uploaded',
          rows: aggregated,
        })
        imported += 1
      } catch (err) {
        const desc = describeError(err, 'usage-csv-import')
        skipped.push(`${file.name}: ${desc.body}`)
      }
    }
    if (imported > 0) {
      toast.success(
        `Imported ${imported} month${imported === 1 ? '' : 's'} of usage data.`,
      )
      onChanged()
    }
    if (skipped.length > 0) {
      toast.warning(`Skipped ${skipped.length}: ${skipped.slice(0, 3).join(', ')}`)
    }
  }

  const handleRemove = (monthKey: string) => {
    clearCachedReport(enterprise, monthKey)
    onChanged()
  }

  const handleClearAll = () => {
    if (months.length === 0) return
    if (!window.confirm(`Remove all ${months.length} cached months?`)) return
    for (const m of months) clearCachedReport(enterprise, m.monthKey)
    onChanged()
  }

  return (
    <div className="grid gap-3">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        multiple
        className="hidden"
        onChange={e => {
          void handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
          <FileArrowUp size={14} weight="duotone" />
          Upload usage CSV{months.length > 0 ? 's' : ''}
        </Button>
        {months.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={handleClearAll}>
            <Trash size={14} weight="duotone" />
            Clear all
          </Button>
        ) : null}
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {months.length === 0
            ? 'Select one or more monthly detailed billing reports to ingest.'
            : `${months.length} month${months.length === 1 ? '' : 's'} loaded — total users sized off per-user max month.`}
        </span>
      </div>
      {months.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {months.map(m => (
            <span
              key={m.monthKey}
              className="inline-flex items-center gap-1 rounded-full border border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800/60 pl-2.5 pr-1 py-0.5 text-xs"
            >
              <span className="tabular-nums">{m.monthKey}</span>
              <span className="text-neutral-500">· {m.rows.length.toLocaleString()} users</span>
              <button
                type="button"
                onClick={() => handleRemove(m.monthKey)}
                className="ml-1 rounded-full p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                aria-label={`Remove ${m.monthKey}`}
              >
                <X size={12} weight="bold" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
