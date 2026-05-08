import { NextRequest, NextResponse } from 'next/server'
import {
  getBqExportStatus,
  getDailyGcpCosts,
  getCostByService,
  getCostBySku,
} from '@/lib/analytics/bq-billing'

function parseDays(value: string | null): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 30
  return Math.min(Math.max(Math.floor(n), 1), 365)
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const days = parseDays(searchParams.get('days'))

    const status = await getBqExportStatus()

    if (!status.configured || !status.tablesReady) {
      return NextResponse.json({
        status,
        daily: [],
        byService: [],
        bySku: [],
      })
    }

    const [daily, byService, bySku] = await Promise.all([
      getDailyGcpCosts(days),
      getCostByService(days),
      getCostBySku(days, 30),
    ])

    return NextResponse.json({
      status,
      daily,
      byService,
      bySku,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur interne du serveur'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
