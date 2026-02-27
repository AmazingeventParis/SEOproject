# SEO Content Studio - Journal de Progression

## Projet
- **URL** : https://seo.swipego.app
- **Stack** : Next.js 14 (TypeScript), Supabase, Claude/Gemini AI, WordPress REST API
- **Repo** : https://github.com/AmazingeventParis/SEOproject
- **Branche** : main

## Statut actuel
Phases 1-4 terminées. Projet en production.

## Progressions

<!-- Ajouter les nouvelles entrées en haut -->

### 2026-02-26 (7)
- 4 ameliorations pipeline SEO
  - **Annee courante dans les prompts** : plan-architect et block-writer injectent `new Date().getFullYear()` (section "Annee de reference"). Nouvelle colonne `year_tag INTEGER` dans seo_articles (sauvegardee dans executePlan). Migration ajoutee.
  - **Barre de progression write-all** : write-all converti en SSE (Server-Sent Events) avec `event: progress` apres chaque bloc. Frontend lit le stream via `ReadableStream` et affiche un composant `Progress` temps reel (X/Y blocs).
  - **Analyse + Plan en un clic** : bouton "Analyser et planifier" (status draft) enchaine analyse → plan automatiquement. Si content gaps detectes, arret pour selection puis auto-plan apres confirmation. ContentGapSelector.onConfirm declenche le plan auto.
  - **Intro entre H1 et premier H2** : verifie OK — le bloc intro (type paragraph, heading null) est genere en premier par plan-architect et affiche comme orphan avant les sections H2 dans les deux tabs (Plan + Content).

### 2026-02-26 (6)
- 2 ameliorations
  - **Selection des content gaps** : apres analyse, l'utilisateur choisit les lacunes de contenu a integrer au plan via checkboxes (ContentGapSelector dans page.tsx). Stockage dans `serp_data.selectedContentGaps` (JSONB). Nouvel endpoint `/select-content-gaps`. plan-architect filtre les lacunes selon la selection utilisateur (backward compat si undefined).
  - **Design system tableaux UX/UI** : refonte CSS `.table-container` (shadow, border-radius 8px, min-width 600px, scroll mobile), zebra-striping, hover, pas de bordures lourdes. block-writer et seo-guidelines mis a jour pour generer `<div class="table-container"><table>...</table></div>`. Backward compat `.table-responsive`/`.info-table`/`.comparison-table`.

### 2026-02-26 (5)
- 4 ameliorations contenu SEO
  - **Tableaux themes par site** : `theme_color` dans seo_sites, color picker dans site-form, styles inline dans block-writer (couleur site sur th/td), CSS `.table-responsive`/`.info-table` responsive
  - **Bloc intro obligatoire** : plan-architect genere un bloc paragraph (heading null, 100-140 mots) en premier, strategies intro par intention dans INTENT_STRATEGIES, regles intro dans block-writer
  - **Editeur texte riche** : Tiptap WYSIWYG (Bold/Italic/Underline/Link/Lists/Blockquote/Undo/Redo) remplace le Textarea HTML brut pour l'edition des blocs, composant `rich-text-editor.tsx`
  - **Style humain** : interdiction guillemets francais/tirets cadratins dans SEO_ANTI_AI_PATTERNS, style accessible dans SEO_WRITING_STYLE_RULES
  - Boutons Ecrire/Modifier sur les orphan blocks (avant premier H2)
  - Migration : `ALTER TABLE seo_sites ADD COLUMN theme_color`

### 2026-02-26 (4)
- Strategies de redaction specifiques par intention de recherche
  - 6 strategies detaillees (traffic, review, comparison, discover, lead_gen, informational)
  - Dictionnaire `INTENT_STRATEGIES` dans seo-guidelines.ts (plan/writing/critique par intention)
  - plan-architect.ts : strategie de structure injectee selon l'intention (remplace les 4 lignes generiques)
  - block-writer.ts : strategie d'ecriture injectee, `searchIntent` passe via orchestrator
  - critique.ts : criteres d'evaluation specifiques par intention
  - Styles CSS : `.comparison-table`, `.lead-form`, `blockquote.testimonial`
  - Chaque intention a sa propre fourchette de mots, structure, style et techniques SEO

### 2026-02-26 (3)
- Liens d'autorite externes pour renforcer l'E-E-A-T
  - Generation automatique de 2-3 suggestions lors du plan (filtrage SERP + Serper supplementaire)
  - Verification HEAD des URLs (is_valid)
  - Evaluation par Gemini Flash (rationale + anchor_context)
  - Selection manuelle dans l'UI (ou lien personnalise avec verification)
  - Injection naturelle dans le premier bloc H2 lors de la redaction
  - Nouvelles colonnes: `authority_link_suggestions` + `selected_authority_link` (jsonb)
  - Nouveaux endpoints: `/select-authority-link`, `/suggest-authority-links`
  - Nouveau task type AI: `evaluate_authority_links` (Gemini Flash)
- Resume des liens (LinksSummaryCard)
  - Composant frontend dans l'onglet SEO
  - Parse les `<a>` dans les blocs ecrits
  - Classification internes/externes avec compteurs

### 2026-02-26 (2)
- Instructions SEO renforcees dans les prompts AI
  - Placement strategique du mot-cle selon la position du bloc (intro/milieu/fin/FAQ)
  - Au moins un H2 doit contenir le mot-cle principal
  - FAQ en accordion HTML natif `<details>/<summary>` avec reponses courtes (2-4 phrases)
  - Styles CSS responsive pour l'accordion FAQ
- Ajout du champ `seo_title` (balise `<title>` distincte du H1)
  - Nouvelle colonne `seo_title` dans seo_articles (migration)
  - Genere par le plan architect avec chaque suggestion de titre
  - Sauvegarde lors de la selection du titre
  - Affichage dans l'UI (preview + sidebar Meta SEO)
  - Envoi vers WordPress via meta Yoast/Rank Math a la publication

### 2026-02-26
- Ajout des suggestions de titres H1 SEO avec selection manuelle
  - 3 variantes par plan (question, promesse, specifique)
  - Selection obligatoire avant redaction (guard pipeline)
  - Regeneration des titres via Gemini Flash
  - Nouvelle colonne `title_suggestions` (jsonb) dans seo_articles
  - Nouveaux endpoints: `/select-title`, `/suggest-titles`, `/migrate`
- Creation du fichier CLAUDE.md pour le suivi des progressions
