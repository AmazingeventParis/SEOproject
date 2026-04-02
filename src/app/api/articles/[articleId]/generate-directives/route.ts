import { NextRequest, NextResponse } from 'next/server'
import { getServerClient } from '@/lib/supabase/client'
import { routeAI } from '@/lib/ai/router'

interface RouteContext {
  params: { articleId: string }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const supabase = getServerClient()

  const { data: article, error } = await supabase
    .from('seo_articles')
    .select('*, seo_sites!seo_articles_site_id_fkey(name, domain, niche, editorial_angle)')
    .eq('id', params.articleId)
    .single()

  if (error || !article) {
    return NextResponse.json({ error: 'Article non trouve' }, { status: 404 })
  }

  const site = (article as Record<string, unknown>).seo_sites as Record<string, unknown> | null
  const editorialAngle = site?.editorial_angle as Record<string, string> | null
  const articleAngle = article.article_angle || ''

  const siteContext = editorialAngle
    ? `SITE "${site?.name || ''}" — Ton: ${editorialAngle.tone || '?'}, Approche: ${editorialAngle.content_approach || '?'}, Audience: ${editorialAngle.target_audience || '?'}`
    : ''

  const aiResponse = await routeAI('generate_writing_directives', [
    {
      role: 'user',
      content: `Tu es un coach editorial. Genere 6 DIRECTIVES D'ECRITURE concretes qui donneront une touche humaine et authentique a cet article SEO.

MOT-CLE : "${article.keyword}"
INTENTION : ${article.search_intent}
${siteContext}
ANGLE EDITORIAL CHOISI : ${articleAngle || 'Pas encore defini'}

Chaque directive doit appartenir a l'une de ces categories :
1. EXPERIENCE VECUE : une anecdote, un test reel, un vecu personnel a raconter
2. DONNEES CONCRETES : un chiffre mesure, un calcul reel, une comparaison factuelle a inclure
3. CONTRE-PIED : une idee recue a challenger ou un avis tranche a donner
4. ASTUCE EXPERT : un conseil de professionnel que le lecteur ne trouvera pas ailleurs
5. ENGAGEMENT LECTEUR : une interpellation, une question rhetorique, un scenario "et si..."
6. PREUVE SOCIALE : un temoignage, une reference client, un cas d'usage reel

REGLES :
- Chaque directive = 1 phrase precise et actionnable (pas vague)
- Adaptee au mot-cle "${article.keyword}" et a l'intention "${article.search_intent}"
- Le redacteur doit pouvoir l'appliquer directement sans chercher
- Les directives doivent couvrir differentes categories (pas toutes pareilles)

JSON : { "directives": [{ "id": "uuid-like string", "label": "directive precise", "category": "experience|donnees|contre_pied|astuce|engagement|preuve_sociale", "checked": true, "source": "ai" }] }`,
    },
  ])

  try {
    let raw = aiResponse.content.trim()
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fence) raw = fence[1].trim()
    if (!raw.startsWith('{')) {
      const m = raw.match(/\{[\s\S]*\}/)
      if (m) raw = m[0]
    }
    const parsed = JSON.parse(raw)
    return NextResponse.json({ directives: parsed.directives || [] })
  } catch {
    return NextResponse.json({ error: 'Echec du parsing IA', raw: aiResponse.content.slice(0, 500) }, { status: 500 })
  }
}
