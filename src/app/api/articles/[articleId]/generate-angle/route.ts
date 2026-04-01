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
  const serpData = article.serp_data as Record<string, unknown> | null
  const semanticAnalysis = serpData?.semanticAnalysis as Record<string, unknown> | null

  // Build context for AI
  const competitorTitles = ((serpData?.organic as { title: string }[]) || [])
    .slice(0, 10)
    .map((r: { title: string }, i: number) => `${i + 1}. ${r.title}`)
    .join('\n')

  const paa = ((serpData?.peopleAlsoAsk as { question: string }[]) || [])
    .map((q: { question: string }) => `- ${q.question}`)
    .join('\n')

  const contentGaps = ((semanticAnalysis?.contentGaps as string[]) || [])
    .map((g: string | { label: string }) => typeof g === 'string' ? g : g.label)
    .join(', ')

  const keyDifferentiators = ((semanticAnalysis?.keyDifferentiators as string[]) || [])
    .join(', ')

  const siteContext = editorialAngle
    ? `\nCONTEXTE DU SITE "${site?.name || ''}" :\n- Description : ${editorialAngle.site_description || 'Non defini'}\n- Ton : ${editorialAngle.tone || 'Non defini'}\n- USP : ${editorialAngle.unique_selling_point || 'Non defini'}\n- Approche contenu : ${editorialAngle.content_approach || 'Non defini'}\n- Audience cible : ${editorialAngle.target_audience || 'Non defini'}`
    : ''

  const aiResponse = await routeAI('generate_article_angle', [
    {
      role: 'user',
      content: `Tu es un strategiste editorial SEO. Genere 4 ANGLES UNIQUES pour differencer cet article des concurrents.

MOT-CLE : "${article.keyword}"
INTENTION DE RECHERCHE : ${article.search_intent}
TITRE ACTUEL : ${article.title || 'Non defini'}
${siteContext}

TITRES CONCURRENTS (top 10) :
${competitorTitles || 'Non disponible'}

QUESTIONS PAA :
${paa || 'Aucune'}

LACUNES DE CONTENU : ${contentGaps || 'Aucune'}
DIFFERENCIATEURS : ${keyDifferentiators || 'Aucun'}

REGLES :
- Chaque angle doit DIFFERENCER cet article des 10 concurrents ci-dessus
- Les angles doivent correspondre au ton et a l'approche du site
- Privilegie les angles bases sur : experience reelle, donnees concretes, contre-pieds, expertise terrain
- Chaque angle = 1-2 phrases precises et actionnables

Exemples de bons angles :
- "Test terrain : on a utilise le produit pendant 3 mois, voici nos mesures reelles"
- "Contre-pied : pourquoi cette solution populaire n'est PAS adaptee a tous les cas"
- "Angle budget : comparaison du cout reel sur 2 ans avec calculs detailles"
- "Retour d'expert : interview d'un professionnel du secteur avec conseils exclusifs"

JSON : { "suggestions": [{ "angle": "description de l'angle", "rationale": "pourquoi cet angle fonctionne vs les concurrents" }] }`,
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
    return NextResponse.json({ suggestions: parsed.suggestions || [] })
  } catch {
    return NextResponse.json({ error: 'Echec du parsing IA', raw: aiResponse.content.slice(0, 500) }, { status: 500 })
  }
}
