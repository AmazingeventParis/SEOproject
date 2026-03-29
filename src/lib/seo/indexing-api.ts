// ============================================================
// Google Indexing API
// Notifies Google of new/updated URLs for faster indexation
// Uses the same Service Account as GSC (needs indexing scope added)
// API: https://developers.google.com/search/apis/indexing-api/v3/quickstart
// ============================================================

/**
 * Get an access token with the Indexing API scope.
 * Reuses the same JWT auth mechanism as GSC but with a different scope.
 */
async function getIndexingAccessToken(): Promise<string> {
  const clientEmail = process.env.GSC_CLIENT_EMAIL
  const privateKey = process.env.GSC_PRIVATE_KEY

  if (!clientEmail || !privateKey) {
    throw new Error(
      'GSC non configure. Ajoutez GSC_CLIENT_EMAIL et GSC_PRIVATE_KEY dans Settings. ' +
      'Le compte de service doit avoir le role "Owner" dans la Search Console.'
    )
  }

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claimSet = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/indexing',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }

  const encodedHeader = base64urlEncode(JSON.stringify(header))
  const encodedClaim = base64urlEncode(JSON.stringify(claimSet))
  const signInput = `${encodedHeader}.${encodedClaim}`

  // Handle literal \n from Coolify env vars
  const literalBackslashN = String.fromCharCode(92) + 'n'
  const cleanedKey = privateKey.split(literalBackslashN).join('\n')
  const key = await importPrivateKey(cleanedKey)
  const signature = await sign(key, signInput)
  const jwt = `${signInput}.${signature}`

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
    throw new Error(`Indexing API token exchange failed (${tokenRes.status}): ${errBody}`)
  }

  const tokenData = await tokenRes.json()
  return tokenData.access_token
}

// ---- Crypto helpers (same as gsc.ts) ----

function base64urlEncode(str: string): string {
  const encoder = new TextEncoder()
  const data = encoder.encode(str)
  let binary = ''
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function arrayBufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace(/-----BEGIN (RSA )?PRIVATE KEY-----/g, '')
    .replace(/-----END (RSA )?PRIVATE KEY-----/g, '')
    .replace(/[\s"]/g, '')

  const buf = Buffer.from(pemContents, 'base64')
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)

  return crypto.subtle.importKey(
    'pkcs8',
    bytes,
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

// ---- Indexing API ----

export type IndexingAction = 'URL_UPDATED' | 'URL_DELETED'

export interface IndexingResult {
  success: boolean
  url: string
  action: IndexingAction
  notifyTime?: string
  error?: string
}

/**
 * Notify Google Indexing API of a new or updated URL.
 *
 * @param url     The full URL to notify (e.g., https://example.com/my-article)
 * @param action  'URL_UPDATED' for new/updated content, 'URL_DELETED' for removed pages
 * @returns       Result with success status and notification time
 *
 * Requirements:
 * - Service account must have "Owner" role in Search Console for the property
 * - The Indexing API must be enabled in Google Cloud Console
 * - Quota: 200 requests/day per property
 */
export async function requestIndexing(
  url: string,
  action: IndexingAction = 'URL_UPDATED'
): Promise<IndexingResult> {
  try {
    const accessToken = await getIndexingAccessToken()

    const res = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        url,
        type: action,
      }),
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => 'unknown')

      // Parse Google API error for clearer message
      let errorMsg = `Indexing API error (${res.status}): ${errBody}`
      try {
        const errJson = JSON.parse(errBody)
        if (errJson.error?.message) {
          errorMsg = errJson.error.message
        }
      } catch { /* keep raw error */ }

      return {
        success: false,
        url,
        action,
        error: errorMsg,
      }
    }

    const data = await res.json()
    return {
      success: true,
      url,
      action,
      notifyTime: data.urlNotificationMetadata?.latestUpdate?.notifyTime || new Date().toISOString(),
    }
  } catch (err) {
    return {
      success: false,
      url,
      action,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Check the indexing status of a URL.
 */
export async function getIndexingStatus(
  url: string
): Promise<{ url: string; latestUpdate?: { type: string; notifyTime: string }; error?: string }> {
  try {
    const accessToken = await getIndexingAccessToken()

    const res = await fetch(
      `https://indexing.googleapis.com/v3/urlNotifications/metadata?url=${encodeURIComponent(url)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    )

    if (!res.ok) {
      const errBody = await res.text().catch(() => 'unknown')
      return { url, error: `Status check failed (${res.status}): ${errBody}` }
    }

    const data = await res.json()
    return {
      url,
      latestUpdate: data.latestUpdate,
    }
  } catch (err) {
    return { url, error: err instanceof Error ? err.message : String(err) }
  }
}
