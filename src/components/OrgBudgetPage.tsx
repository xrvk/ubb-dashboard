import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowSquareOut, Bell, CurrencyDollar, Pencil, Plus, ShieldCheck, ShieldWarning } from '@phosphor-icons/react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCredentials } from '@/hooks/use-credentials'
import { createApiFetch, createOrgBudget, patchOrgBudget, budgetEditUrl, orgBudgetsUrl } from '@/lib/api'
import { formatCurrency, openExternal } from '@/lib/utils'
import { describeError } from '@/lib/errors'
import { ConstraintsBanner } from '@/components/ConstraintsBanner'

/**
 * Org Budget tab — single-card editor for the organization's ai_credits
 * org-scope budget. In the org variant this replaces the enterprise
 * `OverviewPage` + `BudgetsTable` + `BudgetStructureDiagram` combo: there's
 * only one top-level envelope to manage. Hard cap + dollar amount are
 * editable inline here; alert recipients are managed in the GitHub admin UI
 * (deep-linked below).
 */
export function OrgBudgetPage() {
  const { credentials, orgBudget, refresh } = useCredentials()
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState('')
  const [hardCap, setHardCap] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  if (!credentials) return null

  const isDemo = credentials.base === 'demo://'
  const webBudgetsUrl = isDemo ? null : orgBudgetsUrl(credentials.base, credentials.org)
  const editUrl =
    isDemo || !orgBudget ? null : budgetEditUrl(credentials.base, credentials.org, orgBudget.id)

  const openEdit = () => {
    if (orgBudget) {
      setAmount(String(orgBudget.budgetAmount))
      setHardCap(orgBudget.preventFurtherUsage)
    } else {
      setAmount('')
      setHardCap(true)
    }
    setEditing(true)
  }

  const submit = async () => {
    const n = Number(amount)
    if (!Number.isFinite(n) || n < 0) {
      toast.error('Enter a non-negative dollar amount.')
      return
    }
    setSubmitting(true)
    try {
      const apiFetch = createApiFetch(credentials)
      if (orgBudget) {
        const patch: { budgetAmount?: number; preventFurtherUsage?: boolean } = {}
        if (n !== orgBudget.budgetAmount) patch.budgetAmount = n
        if (hardCap !== orgBudget.preventFurtherUsage) patch.preventFurtherUsage = hardCap
        if (Object.keys(patch).length > 0) {
          await patchOrgBudget(apiFetch, orgBudget.id, patch)
        }
      } else {
        await createOrgBudget(apiFetch, {
          orgSlug: credentials.org,
          budgetAmount: n,
          preventFurtherUsage: hardCap,
        })
      }
      toast.success(orgBudget ? 'Org budget updated' : 'Org budget created')
      setEditing(false)
      await refresh()
    } catch (e) {
      const desc = describeError(e, 'OrgBudgetPage.submit')
      toast.error(desc.title, { description: desc.body })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid gap-6">
      <ConstraintsBanner />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CurrencyDollar size={20} weight="duotone" className="text-emerald-600" />
              Organization AI-credits budget
            </CardTitle>
            <p className="mt-1 text-sm text-neutral-500">
              The single top-level cap on Copilot AI credit consumption for{' '}
              <span className="font-medium text-neutral-700 dark:text-neutral-300">
                {credentials.org}
              </span>
              . All individual and universal ULBs must fit under this number.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {webBudgetsUrl ? (
              <a
                href={webBudgetsUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={openExternal(webBudgetsUrl)}
                className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 underline-offset-2 hover:underline"
                title="Open the GitHub admin Budgets page"
              >
                Admin UI <ArrowSquareOut size={12} weight="bold" />
              </a>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {!orgBudget && !editing ? (
            <div className="rounded-md border border-dashed border-neutral-300 dark:border-neutral-700 px-4 py-6 text-center">
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                No organization-level AI-credits budget is set. Without one, any
                child ULB cap is unconstrained by an envelope.
              </p>
              <Button size="sm" className="mt-3" onClick={openEdit} disabled={isDemo}>
                <Plus size={14} weight="bold" /> Create org budget
              </Button>
              {isDemo ? (
                <p className="mt-2 text-xs text-neutral-500">
                  Editing is disabled in demo mode.
                </p>
              ) : null}
            </div>
          ) : null}

          {orgBudget && !editing ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat
                icon={<CurrencyDollar size={18} weight="duotone" className="text-emerald-600" />}
                label="Monthly cap"
                value={formatCurrency(orgBudget.budgetAmount)}
              />
              <Stat
                icon={
                  orgBudget.preventFurtherUsage ? (
                    <ShieldCheck size={18} weight="duotone" className="text-emerald-600" />
                  ) : (
                    <ShieldWarning size={18} weight="duotone" className="text-amber-600" />
                  )
                }
                label="Cap behaviour"
                value={orgBudget.preventFurtherUsage ? 'Hard stop' : 'Soft (alert only)'}
              />
              <Stat
                icon={<Bell size={18} weight="duotone" className="text-neutral-500" />}
                label="Alerts"
                value={
                  orgBudget.willAlert
                    ? `${orgBudget.alertRecipients.length} recipient${
                        orgBudget.alertRecipients.length === 1 ? '' : 's'
                      }`
                    : 'Off'
                }
              />
              <div className="sm:col-span-3 flex items-center gap-2 pt-2">
                <Button size="sm" variant="outline" onClick={openEdit} disabled={isDemo}>
                  <Pencil size={14} weight="bold" /> Edit cap
                </Button>
                {editUrl ? (
                  <a
                    href={editUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={openExternal(editUrl)}
                    className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 underline-offset-2 hover:underline"
                  >
                    Manage alerts in admin UI <ArrowSquareOut size={12} weight="bold" />
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}

          {editing ? (
            <form
              onSubmit={e => {
                e.preventDefault()
                void submit()
              }}
              className="grid gap-3 max-w-md"
            >
              <label className="text-sm">
                <span className="block font-medium mb-1">Monthly cap (USD)</span>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  required
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={hardCap}
                  onChange={e => setHardCap(e.target.checked)}
                  className="rounded"
                />
                <span>
                  Block usage once the cap is reached (hard stop). Uncheck for
                  alert-only.
                </span>
              </label>
              <div className="flex items-center gap-2 pt-1">
                <Button type="submit" size="sm" disabled={submitting}>
                  {submitting ? 'Saving…' : orgBudget ? 'Save changes' : 'Create budget'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(false)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 dark:border-neutral-800 px-3 py-2.5">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-neutral-500">
        {icon} {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}
