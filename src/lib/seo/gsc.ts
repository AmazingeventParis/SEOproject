// ============================================================
// Google Search Console integration
// Uses Service Account authentication with JWT
// API: https://developers.google.com/webmaster-tools/v1/api_reference
// ============================================================

// ---- Types ----

export interface GSCRow {
  keys: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface GSCQueryParams {
  siteUrl: string
  startDate: string
  endDate: string
  dimensions?: ('query' | 'page' | 'country' | 'device' | 'date')[]
  dimensionFilterGroups?: {
    filters: {
      dimension: string
      operator: 'equals' | 'notEquals' | 'contains' | 'notContains'
      expression: string
    }[]
  }[]
  rowLimit?: number
  startRow?: number
}

export interface GSCQueryResult {
  rows: GSCRow[]
  responseAggregationType: string
}

// ---- Date helpers ----

function getDateDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}

// ---- JWT-based auth (Service Account) ----

/**
 * Create a JWT token for Google Service Account authentication.
 * This is a simplified implementation - for production, consider using
 * the google-auth-library package.
 *
 * Required env vars:
 * - GSC_CLIENT_EMAIL: Service account email
 * - GSC_PRIVATE_KEY: PEM private key (with \n escaped)
 */
async function getAccessToken(): Promise<string> {
  const clientEmail = process.env.GSC_CLIENT_EMAIL
  const privateKey = process.env.GSC_PRIVATE_KEY

  if (!clientEmail || !privateKey) {
    throw new Error(
      'GSC non configure. Ajoutez GSC_CLIENT_EMAIL et GSC_PRIVATE_KEY dans Settings. ' +
      'Voir la documentation Google pour creer un compte de service: ' +
      'https://developers.google.com/webmaster-tools/v1/how-tos/service_accounts'
    )
  }

  // Build JWT header and claim set
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claimSet = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }

  const encodedHeader = base64urlEncode(JSON.stringify(header))
  const encodedClaim = base64urlEncode(JSON.stringify(claimSet))
  const signInput = `${encodedHeader}.${encodedClaim}`

  // Sign with the private key using Web Crypto API
  const key = await importPrivateKey(privateKey.replace(/\\n/g, '\n'))
  const signature = await sign(key, signInput)
  const jwt = `${signInput}.${signature}`

  // Exchange JWT for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text().catch(() => 'unknown')
    throw new Error(`GSC token exchange failed (${tokenRes.status}): ${errBody}`)
  }

  const tokenData = await tokenRes.json()
  return tokenData.access_token
}

function base64urlEncode(str: string): string {
  const encoder = new TextEncoder()
  const data = encoder.encode(str)
  let binary = ''
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i])
  }
  const base64 = btoa(binary)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function arrayBufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const base64 = btoa(binary)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace(/-----BEGIN (RSA )?PRIVATE KEY-----/, '')
    .replace(/-----END (RSA )?PRIVATE KEY-----/, '')
    .replace(/\s/g, '')

  const binaryStr = atob(pemContents)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i)
  }

  return crypto.subtle.importKey(
    'pkcs8',
    bytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
}

async function sign(key: CryptoKey, data: string): Promise<string> {
  const encoder = new TextEncoder()
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(data)
  )
  return arrayBufferToBase64url(signature)
}

// ---- API functions ----

/**
 * Query Search Analytics from Google Search Console.
 *
 * @param params  Query parameters (site URL, date range, dimensions, etc.)
 * @returns       Search analytics result with rows of data
 */
export async function querySearchAnalytics(
  params: GSCQueryParams
): Promise<GSCQueryResult> {
  const accessToken = await getAccessToken()

  // Encode site URL for the API path
  const encodedSiteUrl = encodeURIComponent(params.siteUrl)

  const requestBody: Record<string, unknown> = {
    startDate: params.startDate,
    endDate: params.endDate,
    dimensions: params.dimensions || ['query'],
    rowLimit: params.rowLimit || 1000,
    startRow: params.startRow || 0,
  }

  if (params.dimensionFilterGroups) {
    requestBody.dimensionFilterGroups = params.dimensionFilterGroups
  }

  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodedSiteUrl}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    }
  )

  if (!res.ok) {
    const errBody = await res.text().catch(() => 'unknown')
    throw new Error(`GSC Search Analytics API error (${res.status}): ${errBody}`)
  }

  const data = await res.json()

  const rows: GSCRow[] = (data.rows || []).map((row: Record<string, unknown>) => ({
    keys: (row.keys as string[]) || [],
    clicks: (row.clicks as number) || 0,
    impressions: (row.impressions as number) || 0,
    ctr: (row.ctr as number) || 0,
    position: (row.position as number) || 0,
  }))

  return {
    rows,
    responseAggregationType: (data.responseAggregationType as string) || 'auto',
  }
}

/**
 * Get top queries for a site in the last N days.
 *
 * @param siteUrl  The GSC property URL (e.g. "https://example.com")
 * @param limit    Max number of rows to return (default 20)
 * @param days     Number of days to look back (default 30)
 * @returns        Top queries sorted by clicks descending
 */
export async function getTopQueries(
  siteUrl: string,
  limit: number = 20,
  days: number = 30
): Promise<GSCRow[]> {
  const result = await querySearchAnalytics({
    siteUrl,
    startDate: getDateDaysAgo(days),
    endDate: getDateDaysAgo(1),
    dimensions: ['query'],
    rowLimit: limit,
  })

  // Sort by clicks descending
  return result.rows.sort((a, b) => b.clicks - a.clicks).slice(0, limit)
}

/**
 * Get top pages for a site in the last N days.
 *
 * @param siteUrl  The GSC property URL
 * @param limit    Max number of rows to return (default 20)
 * @param days     Number of days to look back (default 30)
 * @returns        Top pages sorted by clicks descending
 */
export async function getTopPages(
  siteUrl: string,
  limit: number = 20,
  days: number = 30
): Promise<GSCRow[]> {
  const result = await querySearchAnalytics({
    siteUrl,
    startDate: getDateDaysAgo(days),
    endDate: getDateDaysAgo(1),
    dimensions: ['page'],
    rowLimit: limit,
  })

  return result.rows.sort((a, b) => b.clicks - a.clicks).slice(0, limit)
}

/**
 * Get queries for a specific page URL.
 *
 * @param siteUrl  The GSC property URL
 * @param pageUrl  The page URL to filter by
 * @param days     Number of days to look back (default 30)
 * @returns        Queries for the given page
 */
export async function getQueriesForPage(
  siteUrl: string,
  pageUrl: string,
  days: number = 30
): Promise<GSCRow[]> {
  const result = await querySearchAnalytics({
    siteUrl,
    startDate: getDateDaysAgo(days),
    endDate: getDateDaysAgo(1),
    dimensions: ['query'],
    dimensionFilterGroups: [
      {
        filters: [
          {
            dimension: 'page',
            operator: 'equals',
            expression: pageUrl,
          },
        ],
      },
    ],
    rowLimit: 100,
  })

  return result.rows.sort((a, b) => b.impressions - a.impressions)
}

/**
 * Find low-hanging fruit keywords: high impressions, low CTR, position 5-20.
 * These are great candidates for content optimization or new articles.
 *
 * @param siteUrl  The GSC property URL
 * @param days     Number of days to look back (default 30)
 * @returns        Opportunity keywords sorted by potential impact
 */
export async function findOpportunityKeywords(
  siteUrl: string,
  days: number = 30
): Promise<(GSCRow & { opportunityScore: number })[]> {
  const result = await querySearchAnalytics({
    siteUrl,
    startDate: getDateDaysAgo(days),
    endDate: getDateDaysAgo(1),
    dimensions: ['query'],
    rowLimit: 500,
  })

  return result.rows
    .filter((row) => row.position >= 5 && row.position <= 20 && row.impressions >= 10)
    .map((row) => ({
      ...row,
      // Score: high impressions + low position = high opportunity
      opportunityScore: Math.round(row.impressions * (1 - row.ctr) * (21 - row.position)),
    }))
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 50)
}
