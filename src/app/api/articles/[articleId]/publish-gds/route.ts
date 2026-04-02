/**
 * POST /api/articles/[articleId]/publish-gds
 * Publication vers GestionnaireDeSite — route indépendante de /publish (WordPress).
 * La route /publish existante n'est pas modifiée.
 */

import { NextRequest, NextResponse } from 'next/server'
import { executeStep } from '@/lib/pipeline/orchestrator'

export async function POST(
  req: NextRequest,
  { params }: { params: { articleId: string } }
) {
  try {
    const { articleId } = params
    const body = await req.json().catch(() => ({}))

    const result = await executeStep(articleId, 'publish_gds', body)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Publication GDS échouée' },
        { status: 400 }
      )
    }

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
