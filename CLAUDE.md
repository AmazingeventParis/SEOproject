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

### 2026-03-09
- Architecture MECE anti-redite pour la redaction
  - **Contrainte MECE dans plan-architect** : chaque section a un perimetre etanche avec `key_ideas` (3-5 idees exclusives). Aucun chevauchement entre sections (Mutuellement Exclusif, Collectivement Exhaustif).
  - **key_ideas dans ContentBlock** : nouveau champ `key_ideas?: string[]` dans l'interface ContentBlock (`types.ts`)
  - **Contexte complet dans block-writer** : injection du plan complet (`articleOutline`) + idees cles du bloc (`blockKeyIdeas`) + texte integral section precedente (3000 chars au lieu de 800)
  - **3 regles strictes** : TRANSITION naturelle (pas de "Voyons maintenant"), ZERO REDITE (aucun argument/exemple deja present), PAS DE CONCLUSION (pas de "En resume...")
  - **Digest enrichi** : resume cumulatif passe de 150 → 500 chars par section
  - **Parametres API optimises** : write_block temperature 0.8 → 0.7, topP 0.8 (nouveau), JSON thinking LOW → HIGH
  - **Support topP** : nouveau champ `topP?: number` dans ModelConfig, passe a callGemini via router

### 2026-03-04
- Systeme d'import WordPress + refresh contenu
  - **Import WP** : nouveau endpoint `GET /api/sites/[siteId]/wp-posts` (liste posts WP non importes) + `POST /api/sites/[siteId]/wp-import` (import batch avec parsing HTML → ContentBlock[])
  - **HTML Parser** : `src/lib/pipeline/html-parser.ts` — split par headings (h2/h3/h4), detection FAQ (`<details>/<summary>`), detection listes, extraction mot-cle principal (`extractMainKeyword`)
  - **WP Import Dialog** : `src/components/sites/wp-import-dialog.tsx` — dialog multi-etapes (chargement → selection checkable → import), selection persona/silo optionnelle, resultats detailles
  - **MAJ annees batch** : `POST /api/sites/[siteId]/year-update` — remplace annees obsoletes dans content_blocks + content_html + JSON-LD dateModified, push WP optionnel
  - **Refresh enrichi** : `executeRefresh` met a jour dateModified dans JSON-LD, push WP optionnel (flag `pushToWp`), suggestions de nuggets a injecter (match par mots-cles)
  - **Endpoint refresh** : `POST /api/articles/[articleId]/refresh` (nouveau)
  - **Carte Refresh** : dans l'onglet SEO pour articles published/refresh_needed — scores critique, blocs MAJ, nuggets suggeres, boutons "Lancer le refresh" et "Refresh + MAJ WP"
  - **State machine** : rollback `refresh_needed → published` ajoute
  - **Badge "Importe"** : dans la liste articles pour les articles importes (wp_post_id + serp_data null)
  - **Page sites** : boutons "Importer depuis WordPress" (ouvre dialog) et "Mettre a jour les annees" (batch avec confirmation) par site

### 2026-03-03
- Audit SEO complet dans l'etape Verification SEO
  - **Sous-etape A — Verification headings** (programmatique, pas d'IA) : longueur >80 chars, mot-cle dans au moins 1 H2 (match par mots a 50%), hierarchie Hn (H3 sans H2 parent, H4 sans H3), alerte si <3 ou >8 H2
  - **Sous-etape B — Densite mots-cles** : reutilise `analyzeKeywordDensity()` de `keyword-analysis.ts`, verification mot-cle dans les 100 premiers mots de l'intro
  - **Sous-etape C — Critique IA** : reutilise `buildCritiquePrompt()` + `validateCritiqueResult()` de `critique.ts`, route vers `gemini-2.5-flash` via `routeAI('critique')`, retourne 4 scores (global, E-E-A-T, lisibilite, SEO) + issues + suggestions
  - **Sous-etape D — Correction auto des headings** : si headings trop longs ou mot-cle absent, appel `routeAI('generate_title')` pour corriger, mise a jour directe dans `content_blocks`
  - **Stockage** : `serp_data.seo_audit` (JSONB) avec auditedAt, headings (issues + corrections), keywordDensity, keywordInIntro, critique
  - **Card Audit SEO** (frontend) : dans l'onglet SEO entre Links Summary et GSC. 4 scores en grille colores (vert >=75, jaune 60-74, rouge <60), densite mot-cle + badge statut, mot-cle dans intro badge, corrections headings avant/apres, issues AlertTriangle, suggestions Sparkles
- Balises alt images en francais optimisees SEO
  - **Refonte `generateAltText()`** dans `seo-rename.ts` : le `imagePromptHint` (anglais pour Fal.ai) n'est plus utilise pour le alt
  - **Templates varies en francais** : 3 templates hero, 5 templates section avec heading, 3 templates section sans heading. Index de rotation (`sectionIndex`) pour eviter la repetition
  - **Mot-cle integre naturellement** dans chaque alt. Si le heading contient deja le mot-cle, format simplifie
  - Orchestrator mis a jour : compteur `sectionImageIdx` incremente par image pour varier les templates
- Forcage Gemini 3.1 Pro + debug erreurs
  - **Modeles changes** : `analyze_serp` (gemini-2.5-flash → gemini-3.1-pro-preview), `write_block` (gemini-3-flash-preview → gemini-3.1-pro-preview), `plan_article` (deja gemini-3.1-pro-preview)
  - **Fallback supprime** pour ces 3 taches : nouveau `NO_FALLBACK_TASKS` Set + fonction `callWithRetryNoFallback()` (3 tentatives, pas de cross-provider fallback)
  - **Log erreur brute** : `console.error` avec tag `[ai-router] [task_name] ERREUR BRUTE (tentative N):` + objet erreur complet pour debug dans les logs Coolify

### 2026-03-02
- Import de nuggets depuis YouTube
  - **Extraction automatique** : coller une URL YouTube → transcription auto via `youtube-transcript` (gratuit, pas d'API key) → extraction IA via Gemini 2.0 Flash → selection manuelle → sauvegarde
  - **Nouveau task AI** : `extract_nuggets` route vers Gemini 2.0 Flash (maxTokens: 4096, temperature: 0.3)
  - **Nouveau endpoint** : `POST /api/nuggets/youtube-import` — fetch transcript, cap 30K chars, prompt Gemini pour 3-15 nuggets (JSON), retourne preview sans sauvegarder
  - **Nouveau composant** : `youtube-import-dialog.tsx` — dialog multi-etapes (input → loading → preview → saving → done) avec selecteur site/persona, tags supplementaires, checkboxes de selection, progress bar
  - **Source type youtube** : ajoute dans types Supabase, Zod validations (routes nuggets), filtre page nuggets, nugget-form
  - **Migration DB** : constraint `seo_nuggets_source_type_check` mise a jour pour inclure `'youtube'`

### 2026-02-27 (2)
- 5 optimisations pipeline et publication WordPress
  - **Images strategiques (plus 1 par H2)** : plan-architect ne force plus `generate_image: true` sur chaque H2. L'IA choisit strategiquement 4-5 sections visuelles avec repartition equilibree. Regle "OBLIGATOIRE" remplacee par "STRATEGIQUE, PAS SYSTEMATIQUE".
  - **Decoupe H3 des sections longues** : nouvelle regle dans plan-architect — si un H2 depasse 400 mots, il doit etre decoupe en 2-4 sous-sections H3 (150-300 mots chacune) avec directives d'ecriture propres.
  - **Maillage interne silo + sitemap WP** : nouvelle fonction `getAllPublishedPosts()` dans `wordpress/client.ts` (fetch jusqu'a 200 posts publies). Le plan-architect recoit les articles DB + posts WP dedupliques. L'etape SEO injecte aussi des liens depuis le sitemap WP (matching par overlap de mots du titre dans le contenu).
  - **Categories WP existantes uniquement** : nouvelle fonction `findBestCategory()` (match exact, slug, partiel, overlap de mots). Ne cree JAMAIS de nouvelle categorie. Le publish essaie d'abord le niche du site, puis le keyword de l'article.
  - **Espacement Gutenberg 50px** : remplacement du `style="margin-top:50px"` inline par un vrai bloc spacer Gutenberg (`<!-- wp:spacer -->`) avant chaque section H2/H3/H4.

### 2026-02-27
- 4 ameliorations post-publication
  - **Fix publication bloquee a 90%** : Transition directe `reviewing → published` (suppression de l'etat intermediaire `publishing`). La barre de progression atteint 100% immediatement apres publication. Suppression de `publishing` dans les step labels du pipeline progress.
  - **Badge brouillon WP** : Badge vert "Publie (brouillon WP)" affiche dans les boutons d'action pour les articles publies. Bouton rollback disponible depuis l'etat `published` (retour vers `reviewing`).
  - **Detection de rafraichissement 120 jours** : Seuil passe de 90 a 120 jours (~4 mois) dans `refresh-detector.ts`.
  - **Analyse GSC pour articles publies** : Nouvel endpoint `/api/articles/[articleId]/gsc-analysis` qui recupere les donnees GSC (90 jours), genere des recommandations (CTR faible, mots-cles en position 5-20, performance du mot-cle principal). Carte "Performance GSC" dans l'onglet SEO avec metriques (clics, impressions, CTR, position), recommandations colorees par severite, tableau des top requetes. Donnees mises en cache dans `serp_data.gsc_analysis`.

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
