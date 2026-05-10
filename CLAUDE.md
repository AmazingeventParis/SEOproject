# SEO Content Studio - Journal de Progression

## Projet
- **URL** : https://seo.swipego.app
- **Stack** : Next.js 14 (TypeScript), Supabase, Claude/Gemini AI, WordPress REST API
- **Repo** : https://github.com/AmazingeventParis/SEOproject
- **Branche** : main

## Deploiement
- **Coolify** : auto-deploy sur push GitHub (webhook manuel)
- **Coolify App UUID** : `z8oskso4cg484w00s8g0g000`
- **Serveur SEO** : 217.182.89.133 (OVH)
- **Git auth** : token GitHub configure dans le remote URL
- **Webhook GitHub** : ID 605112680, push → `http://217.182.89.133:8000/webhooks/source/github/events/manual`
- **Workflow** : modifs → commit → `git push` → webhook GitHub → Coolify build + deploy automatique
- **Deploy manuel** : `curl -s "http://217.182.89.133:8000/api/v1/deploy?uuid=z8oskso4cg484w00s8g0g000&force=true" -H "Authorization: Bearer 1|FNcssp3CipkrPNVSQyv3IboYwGsP8sjPskoBG3ux98e5a576"`

## Infrastructure GCP (cout monitoring)
- **Compte authentifie** : `aureliedumas75@gmail.com` (owner sur les 4 projets)
- **Projets** :
  - `gen-lang-client-0271962854` (Default Gemini Project) — **principal** pour les appels Gemini API du SEO project (cle "Default Gemini API Key" du 2026-01-18)
  - `gen-lang-client-0078876474` (IA Vulcan Project) — secondaire
  - `shootnbox` — Search Console + Indexing API (gratuites) + dataset BigQuery `billing_export`
  - `shootnbox-app` — sans billing (inactif)
- **Billing account actif** : `01AE3A-25AB35-6F9C08`
- **Budget mensuel** : `9c7b64d3-3749-4bdc-8587-c1948cb88a1e` — 50€/mois sur les 2 projets Gemini, alertes 50/90/100% aux admins du billing
- **Export Billing → BigQuery** : actif sur `shootnbox:billing_export` (Standard + Detailed). Push Google quotidien, delai 4-24h apres activation pour les premieres tables.
- **Service account analytics** : `seo-analytics-reader@shootnbox.iam.gserviceaccount.com`
  - Roles : `BigQuery Data Viewer` sur dataset `billing_export` + `BigQuery Job User` au niveau projet
  - Cle JSON : `/home/coder/.config/gcloud/seo-analytics-reader-key.json` (chmod 600, hors repo)
  - Env var Coolify : `GCP_SERVICE_ACCOUNT_KEY` (base64-encoded, `is_buildtime: false`, `is_runtime: true`)
- **gcloud CLI** : installe dans `/home/coder/google-cloud-sdk/`, PATH dans `~/.zshrc`. ADC stocke quota project `shootnbox`.

## Coolify API
- **Token** : `1|FNcssp3CipkrPNVSQyv3IboYwGsP8sjPskoBG3ux98e5a576`
- **Base URL** : `http://217.182.89.133:8000`
- **Endpoints utiles** :
  - `GET /api/v1/applications/{uuid}/envs` — liste env vars
  - `POST /api/v1/applications/{uuid}/envs` — cree (champs : `key`, `value`, `is_preview`, `is_buildtime`, `is_runtime`, `is_literal`, `is_multiline`)
  - `PATCH /api/v1/applications/{uuid}/envs` — upsert (meme body)
  - `GET /api/v1/deploy?uuid={uuid}&force=true` — trigger deploy
  - `GET /api/v1/deployments/{deployment_uuid}` — statut + logs
  - `POST /api/v1/applications/{uuid}/stop` — stoppe le container immediatement
  - `GET /api/v1/applications/{uuid}/logs` — logs runtime du container (stdout)
- **Piege** : `is_build_time` (avec underscore) est rejete. La bonne syntaxe est `is_buildtime` (un seul mot).
- **Piege Dockerfile** : Coolify injecte les env vars `is_buildtime: true` comme `ARG` directement dans le Dockerfile. Une valeur contenant des guillemets non echappes (JSON) casse la syntaxe Docker. Solution : encoder en base64 et decoder a runtime.

## Statut actuel
Phases 1-4 terminees. App en pause depuis 2026-05-10 :
- Cle API Anthropic a 0 credits (HTTP 400 `credit_balance_too_low`).
- 4 cles Gemini API verrouillees a 127.0.0.1 (verrou belt+suspenders, pas de fallback possible).
- Pipeline coupe par defaut : `PIPELINE_ENABLED` non defini = endpoints actifs, mais le pre-flight retourne 402 ANTHROPIC_CREDITS_EXHAUSTED tant que les credits Anthropic = 0.
- Procedure de redemarrage : voir bloc 2026-05-10 ci-dessous.

## Progressions

### 2026-05-10
- Investigation 3 prelevements Google de 500EUR (~1500EUR total)
  - **Cause racine** : suite directe du pic du 7 mai. Apres le fix `30d6455` qui a redirige le fallback Anthropic→Gemini Pro vers Flash, la cause profonde (concurrence trop elevee saturant le rate-limit Anthropic) n'a pas ete adressee. Les 9 et 10 mai, Gemini Flash a brule **40-50M tokens output/jour** (~200-260$/jour de sortie + input + 13M tokens d'images = ~500EUR/jour) en absorbant tous les fallback de write_block.
  - **Decouverte** : les credits Anthropic ont fini par s'epuiser pendant le spike. L'API Anthropic retourne maintenant HTTP 400 `"Your credit balance is too low to access the Anthropic API"`. Cette erreur n'est pas retryable et pas matchee par le regex de `isRetryableError`, donc l'app plantait directement sans relancer Gemini — mais avant ca, des milliers d'appels avaient deja fallback.
- Coupure d'urgence (avant tout fix code)
  - **App Coolify stoppee** via `POST /api/v1/applications/{uuid}/stop` (statut `exited:unhealthy`, HTTP 503)
  - **4 cles API Gemini verrouillees a 127.0.0.1** via `gcloud services api-keys update <UID> --allowed-ips=127.0.0.1` (3 cles sur projet `gen-lang-client-0271962854` + 1 sur `gen-lang-client-0078876474`). Empeche tout appel Gemini depuis la prod meme si du code zombie tournait.
  - **Verification** : zero trafic Gemini sur 5 min (Cloud Monitoring `serviceruntime.googleapis.com/api/request_count`).
- Round 1 — 5 garde-fous concurrence + budget (commit `4880704`)
  - **`WRITE_BATCH_SIZE: 3 → 1`** dans `write-all/route.ts` et `autopilot/route.ts`. Ecriture des blocs sequentielle, plus de batches paralleles.
  - **Queue concurrency default `2 → 1`** dans `queue/route.ts` (max 3 reste possible si l'utilisateur le passe explicitement).
  - **`FALLBACK_RATE_LIMIT: 50 → 10` /min** dans `router.ts` (50/min permettait jusqu'a ~360M tokens/jour de fallback Flash, beaucoup trop large).
  - **`NO_FALLBACK_TASKS`** Set ajoute dans `router.ts` : `write_block`, `plan_article`, `analyze_serp`, `optimize_blocks`, `generate_netlinking_article` ne fallback plus jamais (taches a fort volume de tokens).
  - **Circuit breaker queue** : abort apres 5 echecs consecutifs + cap par article 5$ + cap queue 30$ (object `costBudget` partage entre toutes les iterations, propage via `accumulate(result.costUsd)` dans `runArticlePipeline`).
- Round 2 — 5 couches defense en profondeur apres decouverte 0 credits (commit `92ef63f`)
  - **A. Suppression totale du fallback cross-provider** dans `router.ts` : `FALLBACK_MODEL`, `NO_FALLBACK_TASKS`, `checkFallbackRateLimit`, `fallbackTimestamps` supprimes. `callWithRetryAndFallback` renommee en `callWithRetry`. Une erreur Anthropic = exception remontee, point. Plus aucune voie pour Gemini en backup.
  - **B. AIError structure** : nouveau `src/lib/ai/errors.ts` avec `kind: OUT_OF_CREDITS | RATE_LIMIT | OVERLOADED | AUTH | OTHER`. `claude.ts` wrap les erreurs SDK dans try/catch et rethrow `classifyAnthropicError(err)` qui matche 400 + "credit balance is too low" → `OUT_OF_CREDITS` (non-retryable).
  - **C. Pre-flight credit check** : nouveau `src/lib/ai/preflight.ts`. `pipelinePreflight()` ping Anthropic Haiku 4.5 (1 token, ~$0.000005) avant chaque demarrage de pipeline. Retourne 402 + `ANTHROPIC_CREDITS_EXHAUSTED` + URL de recharge si 0 credits, 401 si auth invalide, 503 + `PIPELINE_DISABLED` si kill switch off. Wired dans `queue/route.ts`, `autopilot/route.ts`, `write-all/route.ts` POST handlers.
  - **D. Boot health check** : nouveau `src/instrumentation.ts` + `experimental.instrumentationHook: true` dans `next.config.mjs` (Next 14, stable en Next 15). Affiche `[boot] Anthropic credits: OK` ou detail `OUT_OF_CREDITS` au demarrage de l'app dans les logs Coolify. Confirme en prod : `[boot] Anthropic check FAILED — kind=OUT_OF_CREDITS`.
  - **E. Kill switch env var** `PIPELINE_ENABLED=false` : si defini, `pipelinePreflight()` court-circuite tous les endpoints lourds avec 503 `PIPELINE_DISABLED` sans rebuild. Modifiable en 30s via API Coolify pour reagir a un incident.
- Procedure de redemarrage du pipeline (a faire dans cet ordre)
  1. **Recharger les credits Anthropic** sur https://console.anthropic.com/settings/plans. Configurer aussi des **budget alerts** (50EUR / 100EUR / 200EUR) comme on a deja sur GCP.
  2. **Lever les restrictions IP Gemini** :
     ```
     gcloud services api-keys update 3b7d22c5-0429-4a56-ac1f-b7408a09d33a --project=gen-lang-client-0271962854 --clear-allowed-ips
     gcloud services api-keys update 497607ae-5eb0-43f7-842f-c010b4e0fa0e --project=gen-lang-client-0271962854 --clear-allowed-ips
     gcloud services api-keys update fff063e7-3867-4f02-a1dd-d6b576b23446 --project=gen-lang-client-0271962854 --clear-allowed-ips
     gcloud services api-keys update 4cf879bd-925a-4594-b2f9-9adccf162934 --project=gen-lang-client-0078876474 --clear-allowed-ips
     ```
  3. **Verifier les logs boot Coolify** : doit afficher `[boot] Anthropic credits: OK`.
  4. **Test** : lancer une queue avec **1 article** pour valider que le preflight passe et que tout marche.

### 2026-05-08
- Investigation pic 545€ sur Gemini API du 7 mai (apres alerte Google Cloud)
  - **Cause racine** : cascade de fallback Claude Sonnet -> Gemini 3.1 Pro pendant un rate limit Anthropic. 20 901 requetes Gemini Pro concentrees entre 18h-19h Paris (~6 req/s pendant 1h).
  - Avant le fix : le fallback de `claude-sonnet-4-6` etait `gemini-3.1-pro-preview` (12-25x plus cher que Flash). Avec retries de 1+2s seulement, le rate limit Anthropic declenchait massivement le fallback.
- 3 fixes anti-cost-spike dans `src/lib/ai/router.ts` (commit `30d6455`)
  - **Fallback Sonnet → Flash** : `claude-sonnet-4-6` -> `gemini-3-flash-preview` (au lieu de Pro). Idem `gemini-3.1-flash-preview`. Reduit l'impact d'un fallback massif de ~25x.
  - **Retries plus longs** : `[1s, 2s]` -> `[5s, 15s, 30s]` (50s total). Laisse le temps au rate limit Anthropic de se reset (typiquement 30-60s) avant de fallback.
  - **Hard cap fallbacks** : 50 fallbacks/min max via `checkFallbackRateLimit()` (timestamps en memoire avec fenetre glissante 60s). Au-dela, throw avec message explicite "primary provider likely down" pour stopper la cascade.
- Phase 1 — Tracking complet des couts internes (commit `94e7fa4`)
  - **Pricing manquant** : ajout de `claude-sonnet-4-6`, `claude-haiku-4-5`, `claude-opus-4-7` dans `COST_PER_1K_TOKENS`. Avant : tous les appels Sonnet 4.6 etaient comptes a $0 (33 executions "inconnu" sur le dashboard).
  - **Normalisation model id** : nouveau `lookupPricing()` qui strip le suffix date (`-YYYYMMDD`) car Anthropic SDK retourne le full id `claude-sonnet-4-6-20250929`.
  - **AsyncLocalStorage** : nouvelle classe `CostAccumulator` + helper `withCostTracking(fn)`. Le wrapping est fait une seule fois dans `executeStep` de l'orchestrator. Toutes les fonctions internes (executeSeo avec ses 12 appels routeAI, executeMedia, executePublish, executeRefresh) sont automatiquement comptees sans modification de code. Avant : ces 4 fonctions retournaient `costUsd: undefined` -> $0 dans `seo_pipeline_runs`.
  - **Page analytics en EUR** : conversion USD → EUR (taux 0.92 hardcode), icone `Euro` au lieu de `DollarSign`. Permet la parite avec les chiffres Google Cloud Console.
- Phase 2 — Integration BigQuery billing export (commits `a840260`, `249c80f`)
  - **Module `src/lib/analytics/bq-billing.ts`** : client BigQuery avec auth via `GCP_SERVICE_ACCOUNT_KEY` (base64) ou `GOOGLE_APPLICATION_CREDENTIALS`. 4 fonctions : `getBqExportStatus`, `getDailyGcpCosts`, `getCostByService`, `getCostBySku`. Resilience : retourne `[]` si tables pas encore creees (delai 4-24h Google).
  - **Discovery automatique des tables** : `gcp_billing_export_resource_v1_*` (detailed) et `gcp_billing_export_v1_*` (standard). Cache 5 min.
  - **Route API `/api/analytics/gcp-billing`** : expose status + daily + byService + bySku.
  - **Section dashboard "Couts reels Google Cloud"** : affiche total periode, pic journalier, moyenne/jour, timeline 14 derniers jours (barres horizontales), top 10 services GCP, top 10 SKU. Affiche un message d'attente si tables pas encore disponibles.
  - **Hotfix base64** : la JSON de la cle SA contient des guillemets qui cassaient le Docker ARG. Solution : encoder en base64 + decoder cote app (avec backward compat raw JSON pour dev local).
- Setup infrastructure GCP (voir section "Infrastructure GCP" en haut)
  - Installation gcloud CLI, auth interactive, creation projet/dataset BQ, service account read-only avec least-privilege, configuration env var Coolify via API (sans manipulation manuelle).
  - Budget 50€/mois alerte automatique avant que la facture explose.

### 2026-03-29
- 4 optimisations de performance ecriture
  - **Ecriture parallele par batch de 3** : write-all et autopilot ecrivent 3 blocs en parallele avec `skipSave` puis merge DB une fois par batch
  - **Gemini 3.1 Flash pour write_block** : modele passe de gemini-3.1-pro-preview a gemini-3.1-flash-preview (3x plus rapide, cout divise par 4)
  - **Thinking level LOW** : `thinkingLevel: 'LOW'` pour write_block (nouveau champ dans ModelConfig, supporte par callGemini)
  - **Pre-generation images concurrente** : dans autopilot, les images sont generees en parallele pendant l'ecriture des blocs via `preGenerateArticleImages()`
- Conversion Gutenberg native
  - **`src/lib/pipeline/gutenberg.ts`** : convertit HTML en blocs WP natifs (wp:paragraph, wp:list, wp:table, wp:blockquote, wp:image)
  - Utilise dans orchestrator (executePublish) et revamp generator
- Verification liens casses + Google Indexing API
  - **`src/lib/seo/link-checker.ts`** : HEAD requests (fallback GET), timeout 8s, batches de 5, deduplication. Integre dans executeSeo (step 5f), stocke dans `serp_data.seo_audit.brokenLinks`
  - **`src/lib/seo/indexing-api.ts`** : notification auto apres publish WP (fire-and-forget), meme service account que GSC (scope `indexing`)
  - **`/api/articles/[articleId]/request-indexing`** : POST (demander indexation) + GET (statut + historique). Historique dans `serp_data.indexing_requests` (max 10)
  - Pre-requis : activer "Web Search Indexing API" dans Google Cloud Console + role "Owner" dans Search Console
- 5 analyses semantiques SEO
  - **Validation semantique post-ecriture** (Axe 1+3) : verifie algorithmiquement la presence des termes TF-IDF (top 30) et champ semantique dans le contenu. Score global pondere (60% TF-IDF + 40% champ semantique). Stocke dans `serp_data.seo_audit.semanticCoverage`
  - **Extraction entites NLP** (Axe 2) : extraction IA des entites nommees (personnes, marques, concepts, outils, metriques) depuis le contenu concurrent pendant executeAnalyze. Validation de couverture post-ecriture. Stocke dans `serp_data.semanticAnalysis.entities` + `seo_audit.entityCoverage`
  - **Termes manquants dans critique** (Axe 4) : les termes TF-IDF et entites absents sont injectes dans le prompt du critique IA pour penaliser le score SEO/E-E-A-T. Suggestions d'injection par bloc dans `seo_audit.missingTerms`
  - **Cannibalisation semantique** (Axe 5) : compare les tokens du contenu avec les autres articles du meme silo. Alerte si overlap >60%. Stocke dans `seo_audit.semanticCannibalization`
  - **Fichier** : `src/lib/seo/semantic-analysis.ts`
- 4 optimisations SEO supplementaires
  - **Featured Snippets (Position Zero)** : plan-architect genere `featured_snippet_type` par bloc H2 (definition/list/table/steps/none). Block-writer commence par la reponse directe selon le type (40-50 mots autonome pour definition, liste numerotee pour list, tableau comparatif pour table). Checklist de validation dans plan-architect.
  - **Score de lisibilite algorithmique** : `src/lib/seo/readability.ts` — score 0-100 base sur longueur moyenne phrases (<20 mots ideal), ratio phrases longues (>25 mots), longueur paragraphes, densite elements visuels (listes/tableaux), blocs prose consecutifs. Integre dans seo_audit.readability.
  - **Attributs images optimises** : premiere image section = `fetchpriority="high"` (LCP Core Web Vitals), images suivantes = `loading="lazy"`. `width` et `height` toujours presents (evite CLS).
  - **Open Graph + Twitter Cards** : meta OG poussees vers WP via champs Yoast + Rank Math (`og:title`, `og:description`, `og:image`, `twitter:card=summary_large_image`, canonical URL). Hero image = og:image.

### 2026-03-11
- 5 features majeures ajoutees
  - **Verification key_ideas** : apres ecriture, check programmatique que chaque bloc couvre ses idees cles MECE. Resultat envoye via SSE `key_ideas_check` + inclus dans `done` payload. Fichier `src/lib/pipeline/quality-checks.ts`.
  - **Coherence persona** : nouveau sub-step dans `executeSeo` — analyse IA (Gemini Flash) de la coherence de voix sur tout l'article. Score 0-100 + drifts par bloc. Stocke dans `serp_data.seo_audit.personaConsistency`. Nouveau task AI `check_persona_consistency`.
  - **Pipeline Autopilot** : `POST /api/articles/[id]/autopilot` — enchaine analyze → plan → auto-select titre → write-all → media → seo en SSE. Resume depuis n'importe quel statut. Bouton gradient violet dans le frontend avec barre de progression par etape.
  - **File d'attente** : `POST /api/articles/queue` — traite N articles en parallele (concurrence 1-3). Chaque article passe par le pipeline complet. SSE progress par article.
  - **Optimisation CTR** : `POST /api/articles/[id]/optimize-ctr` — genere 3 variantes seo_title + meta_description basees sur les donnees GSC. `POST /api/articles/[id]/apply-ctr-variant` pour appliquer + push WP optionnel. Card dans l'onglet SEO.
- Fix deduplication nuggets (commit precedent)
  - Tracking `usedNuggetIds` entre blocs dans write-all
  - Seuil score fallback >= 6 (au lieu de > 0), max 2 nuggets fallback
  - Garde-fou pertinence dans le prompt block-writer

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
