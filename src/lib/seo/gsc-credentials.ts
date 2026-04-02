import { getServerClient } from '@/lib/supabase/client'

interface GscCredentials {
  clientEmail: string
  privateKey: string
}

/**
 * Get GSC/Indexing credentials from seo_config DB, with env var fallback.
 * Priority: DB (seo_config) > env vars (GSC_CLIENT_EMAIL / GSC_PRIVATE_KEY)
 */
export async function getGscCredentials(): Promise<GscCredentials> {
  const supabase = getServerClient()

  const { data } = await supabase
    .from('seo_config')
    .select('key, value')
    .in('key', ['gsc_client_email', 'gsc_private_key'])

  const dbConfig: Record<string, string> = {}
  if (data) {
    for (const row of data) {
      dbConfig[row.key] = typeof row.value === 'string' ? row.value : String(row.value ?? '')
    }
  }

  const clientEmail = dbConfig['gsc_client_email'] || process.env.GSC_CLIENT_EMAIL || ''
  const privateKey = dbConfig['gsc_private_key'] || process.env.GSC_PRIVATE_KEY || ''

  if (!clientEmail || !privateKey) {
    throw new Error(
      'GSC non configure. Ajoutez le Client Email et la Private Key dans Settings > Google Indexing API. ' +
      'Le compte de service doit avoir le role "Owner" dans la Search Console.'
    )
  }

  return { clientEmail, privateKey }
}
