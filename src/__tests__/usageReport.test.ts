import { describe, it, expect } from 'vitest'
import { aggregateAicByUser, parseUsageCsv, type UsageRow } from '@/lib/usageReport'

function billingRow(over: Partial<UsageRow> = {}): UsageRow {
  return {
    date: '2026-05-01',
    product: 'copilot',
    sku: 'copilot_ai_credit',
    quantity: 0,
    unit_type: 'aic',
    applied_cost_per_quantity: 0.01,
    gross_amount: 0,
    discount_amount: 0,
    net_amount: 0,
    username: 'alice',
    organization: 'acme',
    repository: '',
    workflow_path: '',
    cost_center_name: '',
    ...over,
  }
}

describe('parseUsageCsv', () => {
  it('returns an empty array for empty / header-only input', () => {
    expect(parseUsageCsv('')).toEqual([])
    expect(parseUsageCsv('date,sku,quantity\n')).toEqual([])
  })

  it('strips a leading UTF-8 BOM from the header row', () => {
    const csv = '\uFEFFdate,sku,quantity,username\n2026-05-01,copilot_ai_credit,5,alice\n'
    const rows = parseUsageCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].date).toBe('2026-05-01')
    expect(rows[0].quantity).toBe(5)
  })

  it('handles CRLF line endings', () => {
    const csv = 'date,sku,quantity,username\r\n2026-05-01,copilot_ai_credit,3,alice\r\n'
    const rows = parseUsageCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].username).toBe('alice')
  })

  it('parses quoted fields that contain commas', () => {
    const csv =
      'date,sku,quantity,username,organization\n2026-05-01,copilot_ai_credit,1,alice,"Acme, Inc."\n'
    const rows = parseUsageCsv(csv)
    expect(rows[0].organization).toBe('Acme, Inc.')
  })

  it('parses doubled-up "" as a literal quote character inside a quoted field', () => {
    const csv = 'date,sku,quantity,username\n2026-05-01,copilot_ai_credit,1,"al""ice"\n'
    const rows = parseUsageCsv(csv)
    expect(rows[0].username).toBe('al"ice')
  })

  it('coerces numeric columns to Number and maps non-numeric / blank values to 0', () => {
    const csv = [
      'date,sku,quantity,gross_amount,net_amount,username',
      '2026-05-01,copilot_ai_credit,not_a_number,,1.5,alice',
    ].join('\n')
    const rows = parseUsageCsv(csv)
    expect(rows[0].quantity).toBe(0) // "not_a_number"
    expect(rows[0].gross_amount).toBe(0) // blank
    expect(rows[0].net_amount).toBe(1.5)
  })

  it('preserves the order of rows from the input file', () => {
    const csv = [
      'date,sku,quantity,username',
      '2026-05-01,copilot_ai_credit,1,alice',
      '2026-05-02,copilot_ai_credit,1,bob',
      '2026-05-03,copilot_ai_credit,1,carol',
    ].join('\n')
    expect(parseUsageCsv(csv).map(r => r.username)).toEqual(['alice', 'bob', 'carol'])
  })
})

describe('aggregateAicByUser', () => {
  it('returns an empty array when there are no AIC or premium-request rows', () => {
    const rows: UsageRow[] = [
      billingRow({ sku: 'copilot_seat', quantity: 1, gross_amount: 19 }),
      billingRow({ sku: 'some_other_sku', quantity: 100 }),
    ]
    expect(aggregateAicByUser(rows)).toEqual([])
  })

  it('sums AIC quantity and gross_amount across both AIC SKUs per user', () => {
    const rows: UsageRow[] = [
      billingRow({ username: 'alice', sku: 'copilot_ai_credit', quantity: 100, gross_amount: 1 }),
      billingRow({
        username: 'alice',
        sku: 'coding_agent_ai_credit',
        quantity: 50,
        gross_amount: 0.5,
      }),
      billingRow({ username: 'bob', sku: 'copilot_ai_credit', quantity: 200, gross_amount: 2 }),
    ]
    const out = aggregateAicByUser(rows)
    expect(out).toHaveLength(2)
    const alice = out.find(u => u.username === 'alice')!
    expect(alice.aicConsumed).toBe(150)
    expect(alice.grossAmount).toBeCloseTo(1.5, 9)
    expect(alice.codingAgentAic).toBe(50) // coding-agent SKU only
  })

  it('sorts users by aicConsumed descending', () => {
    const rows: UsageRow[] = [
      billingRow({ username: 'small', sku: 'copilot_ai_credit', quantity: 10 }),
      billingRow({ username: 'big', sku: 'copilot_ai_credit', quantity: 1000 }),
      billingRow({ username: 'mid', sku: 'copilot_ai_credit', quantity: 100 }),
    ]
    expect(aggregateAicByUser(rows).map(u => u.username)).toEqual(['big', 'mid', 'small'])
  })

  it('keeps lastUsedDate as the MAX date seen for that user (string-comparable ISO)', () => {
    const rows: UsageRow[] = [
      billingRow({ username: 'alice', date: '2026-05-02', quantity: 1 }),
      billingRow({ username: 'alice', date: '2026-05-01', quantity: 1 }),
      billingRow({ username: 'alice', date: '2026-05-10', quantity: 1 }),
      billingRow({ username: 'alice', date: '2026-05-05', quantity: 1 }),
    ]
    const out = aggregateAicByUser(rows)
    expect(out[0].lastUsedDate).toBe('2026-05-10')
  })

  it('reads AIC value from aic_quantity / aic_gross_amount for premium-request rows', () => {
    const rows: UsageRow[] = [
      billingRow({
        username: 'alice',
        sku: 'copilot_premium_request',
        quantity: 1, // request count, NOT AIC
        gross_amount: 0.04, // USD, NOT AIC value
        aic_quantity: 25,
        aic_gross_amount: 0.25,
      }),
    ]
    const out = aggregateAicByUser(rows)
    expect(out[0].aicConsumed).toBe(25) // from aic_quantity, not quantity
    expect(out[0].grossAmount).toBeCloseTo(0.25, 9) // from aic_gross_amount
    expect(out[0].codingAgentAic).toBe(0) // not a coding-agent SKU
  })

  it('drops rows with blank or whitespace-only username', () => {
    const rows: UsageRow[] = [
      billingRow({ username: '', quantity: 100 }),
      billingRow({ username: '   ', quantity: 50 }),
      billingRow({ username: 'alice', quantity: 1 }),
    ]
    const out = aggregateAicByUser(rows)
    expect(out.map(u => u.username)).toEqual(['alice'])
  })

  it('skips rows where both AIC quantity and AIC gross amount are 0', () => {
    const rows: UsageRow[] = [
      billingRow({ username: 'alice', sku: 'copilot_ai_credit', quantity: 0, gross_amount: 0 }),
      billingRow({ username: 'alice', sku: 'copilot_ai_credit', quantity: 5, gross_amount: 0.05 }),
    ]
    const out = aggregateAicByUser(rows)
    expect(out[0].aicConsumed).toBe(5)
  })

  it('keeps billing AIC and premium-request AIC separable per user (sums into one row)', () => {
    const rows: UsageRow[] = [
      billingRow({ username: 'alice', sku: 'copilot_ai_credit', quantity: 100, gross_amount: 1 }),
      billingRow({
        username: 'alice',
        sku: 'copilot_premium_request',
        aic_quantity: 50,
        aic_gross_amount: 0.5,
      }),
    ]
    const out = aggregateAicByUser(rows)
    expect(out).toHaveLength(1)
    expect(out[0].aicConsumed).toBe(150)
    expect(out[0].grossAmount).toBeCloseTo(1.5, 9)
  })
})
