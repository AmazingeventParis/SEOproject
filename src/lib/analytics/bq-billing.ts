// ============================================================
// Google Cloud Billing Export — BigQuery client
//
// Reads the cost data Google pushes daily into the
// `shootnbox:billing_export` dataset. The BQ export is the
// authoritative source for what GCP actually billed (vs the
// internal seo_pipeline_runs table which tracks our own
// estimates and can drift from the truth).
//
// Auth: a service account key JSON. In production it is passed
// via the GCP_SERVICE_ACCOUNT_KEY env var (raw JSON, single line).
// In local dev it can also be read from a path stored in
// GOOGLE_APPLICATION_CREDENTIALS.
//
// Resilience: every public function returns null/[] when the
// export tables don't exist yet (Google takes 4-24h to push the
// first batch after enabling export). Callers must treat absence
// as "not yet available", not as an error.
// ============================================================

import { BigQuery } from '@google-cloud/bigquery'

const PROJECT_ID = 'shootnbox'
const DATASET_ID = 'billing_export'

// ---- Client construction ----

let cachedClient: BigQuery | null = null

function getClient(): BigQuery | null {
  if (cachedClient) return cachedClient

  const inlineKey = process.env.GCP_SERVICE_ACCOUNT_KEY
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS

  if (!inlineKey && !keyPath) {
    return null // analytics page will show "credentials not configured"
  }

  try {
    if (inlineKey) {
      const credentials = JSON.parse(inlineKey)
      cachedClient = new BigQuery({
        projectId: credentials.project_id ?? PROJECT_ID,
        credentials,
      })
    } else {
      // Falls back to GOOGLE_APPLICATION_CREDENTIALS path
      cachedClient = new BigQuery({ projectId: PROJECT_ID })
    }
    return cachedClient
  } catch (err) {
    console.error('[bq-billing] Failed to initialise BigQuery client:', err)
    return null
  }
}

// ---- Table discovery ----

let cachedTables: { detailed: string | null; standard: string | null } | null = null

/**
 * Look up the actual export table names. Google generates them
 * as `gcp_billing_export_resource_v1_<billingAccountId>` and
 * `gcp_billing_export_v1_<billingAccountId>`, where the billing
 * account id has dashes replaced by underscores.
 */
async function discoverTables(): Promise<{ detailed: string | null; standard: string | null }> {
  if (cachedTables) return cachedTables

  const client = getClient()
  if (!client) return { detailed: null, standard: null }

  try {
    const [tables] = await client.dataset(DATASET_ID).getTables()
    const names = tables.map((t) => t.id ?? '').filter(Boolean)
    const detailed = names.find((n) => n.startsWith('gcp_billing_export_resource_v1_')) ?? null
    const standard = names.find((n) => n.startsWith('gcp_billing_export_v1_')) ?? null
    cachedTables = { detailed, standard }
    // Cache for 5 minutes — tables show up exactly once after which the name is stable
    setTimeout(() => { cachedTables = null }, 5 * 60 * 1000)
    return cachedTables
  } catch (err) {
    console.error('[bq-billing] Failed to discover export tables:', err)
    return { detailed: null, standard: null }
  }
}

// ---- Public API ----

export interface BqExportStatus {
  configured: boolean // service account key is set
  tablesReady: boolean // export tables exist
  detailedTable: string | null
  standardTable: string | null
  message: string
}

export async function getBqExportStatus(): Promise<BqExportStatus> {
  const client = getClient()
  if (!client) {
    return {
      configured: false,
      tablesReady: false,
      detailedTable: null,
      standardTable: null,
      message: "Service account non configure. Definir GCP_SERVICE_ACCOUNT_KEY dans l'environnement.",
    }
  }
  const tables = await discoverTables()
  if (!tables.detailed && !tables.standard) {
    return {
      configured: true,
      tablesReady: false,
      detailedTable: null,
      standardTable: null,
      message: "Export BigQuery active, en attente du premier push de Google (delai 4-24h).",
    }
  }
  return {
    configured: true,
    tablesReady: true,
    detailedTable: tables.detailed,
    standardTable: tables.standard,
    message: 'Export operationnel.',
  }
}

export interface DailyGcpCost {
  date: string // YYYY-MM-DD
  costEur: number
  service: string | null // null when grouped overall
}

/**
 * Daily cost over the last `days` days. Falls back to standard export
 * if detailed isn't available yet. Returns [] when no tables exist.
 */
export async function getDailyGcpCosts(days: number = 30): Promise<DailyGcpCost[]> {
  const client = getClient()
  const tables = await discoverTables()
  const tableName = tables.detailed ?? tables.standard
  if (!client || !tableName) return []

  const query = `
    SELECT
      DATE(usage_start_time) AS day,
      ROUND(SUM(cost), 4) AS cost
    FROM \`${PROJECT_ID}.${DATASET_ID}.${tableName}\`
    WHERE DATE(usage_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
    GROUP BY day
    ORDER BY day ASC
  `

  try {
    const [rows] = await client.query({
      query,
      params: { days },
    })
    return (rows as Array<{ day: { value: string } | string; cost: number }>).map((r) => ({
      date: typeof r.day === 'string' ? r.day : r.day.value,
      costEur: Number(r.cost) || 0,
      service: null,
    }))
  } catch (err) {
    console.error('[bq-billing] getDailyGcpCosts failed:', err)
    return []
  }
}

export interface ServiceCost {
  service: string
  costEur: number
  usageAmount: number | null
  usageUnit: string | null
}

/**
 * Cost broken down by GCP service over the last `days` days.
 * Sorted by cost descending.
 */
export async function getCostByService(days: number = 30): Promise<ServiceCost[]> {
  const client = getClient()
  const tables = await discoverTables()
  const tableName = tables.detailed ?? tables.standard
  if (!client || !tableName) return []

  const query = `
    SELECT
      service.description AS service,
      ROUND(SUM(cost), 4) AS cost,
      SUM(usage.amount) AS usage_amount,
      ANY_VALUE(usage.unit) AS usage_unit
    FROM \`${PROJECT_ID}.${DATASET_ID}.${tableName}\`
    WHERE DATE(usage_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
    GROUP BY service
    ORDER BY cost DESC
    LIMIT 50
  `

  try {
    const [rows] = await client.query({ query, params: { days } })
    return (rows as Array<{ service: string; cost: number; usage_amount: number; usage_unit: string }>).map((r) => ({
      service: r.service ?? 'unknown',
      costEur: Number(r.cost) || 0,
      usageAmount: r.usage_amount != null ? Number(r.usage_amount) : null,
      usageUnit: r.usage_unit ?? null,
    }))
  } catch (err) {
    console.error('[bq-billing] getCostByService failed:', err)
    return []
  }
}

export interface SkuCost {
  service: string
  sku: string
  costEur: number
  usageAmount: number | null
  usageUnit: string | null
}

/**
 * Cost broken down by SKU. The detailed export is required for this
 * granularity. Useful to identify which exact Gemini operation
 * (input tokens vs output tokens vs thinking tokens) drives spend.
 */
export async function getCostBySku(days: number = 30, limit: number = 30): Promise<SkuCost[]> {
  const client = getClient()
  const tables = await discoverTables()
  if (!client || !tables.detailed) return []

  const query = `
    SELECT
      service.description AS service,
      sku.description AS sku,
      ROUND(SUM(cost), 4) AS cost,
      SUM(usage.amount) AS usage_amount,
      ANY_VALUE(usage.unit) AS usage_unit
    FROM \`${PROJECT_ID}.${DATASET_ID}.${tables.detailed}\`
    WHERE DATE(usage_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
    GROUP BY service, sku
    ORDER BY cost DESC
    LIMIT @limit
  `

  try {
    const [rows] = await client.query({ query, params: { days, limit } })
    return (rows as Array<{ service: string; sku: string; cost: number; usage_amount: number; usage_unit: string }>).map((r) => ({
      service: r.service ?? 'unknown',
      sku: r.sku ?? 'unknown',
      costEur: Number(r.cost) || 0,
      usageAmount: r.usage_amount != null ? Number(r.usage_amount) : null,
      usageUnit: r.usage_unit ?? null,
    }))
  } catch (err) {
    console.error('[bq-billing] getCostBySku failed:', err)
    return []
  }
}
