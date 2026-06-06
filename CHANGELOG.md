# Changelog

Toutes les modifications notables sont consignées ici. Le format suit
[Keep a Changelog](https://keepachangelog.com/) et la convention SemVer.

## [2.7.0] — 2026-05-29

> Cette release fusionne en un seul saut `2.6.0 → 2.7.0` tout le travail
> de la chaîne « polish agent-friendliness » round 2 (la 2.6.1 planifiée
> n'a jamais été taguée séparément).

### Ajouté — concepts produit majeurs

- **Tâches humaines** (`task.kind = "human"`). Une tâche qu'un agent ne
  peut pas exécuter lui-même (action manuelle, secret dans un vault…) :
  l'agent affiche un hand-off script standard, l'utilisateur fait
  l'action et répond, puis l'agent lance `depot task verify <id>
--user-confirmed "<citation>"`. Champ optionnel `verificationCommand`
  exécuté par depot pour vérifier (exit 0 → done, ≠ 0 → reste pending +
  stderr capturé). `phase-advance` reste bloqué tant que la tâche est
  pending. Section dédiée dans `dev.md` / `coder.md`. (PRD 0018)

- **Groupements et organisation des PRDs** (PRD 0019). Quatre axes
  orthogonaux, surface CLI + Web :
  - **Tags** M:N libres (`depot prd tag add/remove/list`,
    `prd list --tag`).
  - **Dépendances** PRD ↔ PRD en DAG avec détection de cycle
    (`depot prd depend add/remove/list/graph`, `prd list --depends-on`).
  - **Milestones** (`prds.target_version`, `depot prd milestone
set/unset/list/summary`, `prd list --milestone`, page
    `/milestones/<v>`).
  - **Priorité** enum `critical | high | normal | low`
    (`depot prd priority set/unset`, `prd list --priority`, tri par
    défaut par priorité, badge web).

### Corrigé

- **`--user-confirmed` accepte les confirmations courtes** : la validation
  refusait toute valeur < 6 caractères, rejetant des réponses parfaitement
  authentiques comme « go », « ok », « yes ». La longueur min n'apportait
  aucune sécurité réelle (un agent malhonnête peut inventer une phrase
  longue tout aussi facilement). Désormais, **toute valeur non-vide après
  trim** est acceptée et persistée verbatim dans `activity_log`. La
  protection contre la sur-interprétation reste assurée par la trace
  d'audit + la convention agent de citer verbatim. Les encarts d'approbation
  distinguent désormais explicitement la **forme** (une confirmation courte
  suffit) de la **portée** (elle doit viser la transition en cours). (PRD 0022 / T1)

- **Erreurs DB lisibles** : les erreurs SQLite/Effect (`file is not a database`,
  `attempt to write a readonly database`, etc.) ne s'affichent plus sous la forme
  d'un `(FiberFailure)` avec stack trace de `node_modules/effect`. Le message
  d'erreur, le path de la DB, et un _hint_ d'action figurent maintenant sur une
  seule ligne lisible. La trace complète reste disponible en activant
  `DEPOT_DEBUG=1`. (PRD 0017 / T1)

- **`depot task add --phase N` initialise correctement le PRD en multi-phase**.
  Avant le fix, créer une tâche avec `--phase` laissait `currentPhase` à `null`
  sur le PRD, et toute tentative ultérieure de `depot prd phase-advance`
  échouait avec « no phases defined ». Désormais, la première tâche phasée
  bascule automatiquement le PRD à `currentPhase = 1`. (PRD 0017 / T2)

- **`depot prd activate` dérive `currentPhase` depuis les tâches existantes**.
  Quand un PRD est activé alors qu'il contient déjà des tâches portant un
  `phaseNumber` (cas typique : PRD chargé via `prd load` ou créé depuis la web
  UI), `activate` pose `currentPhase` sur la première phase non terminée
  (fallback : la dernière phase si tout est `done`). (PRD 0017 / T4a)

- **Migration de backfill pour les PRDs piégés**. Une migration data-only
  scanne les `prd_revisions` historiques avec `currentPhase = NULL` et des
  tâches phasées, et seed `currentPhase` selon la même logique que le fix
  d'`activate`. Idempotente — re-running est un no-op. (PRD 0017 / T4c)

- **`depot serve` ne plante plus quand `dist/web/` est absent**. Le serveur
  démarre en mode **API-only** avec un message stderr clair, les routes
  `/api/*` fonctionnent normalement, et `/` répond 200 avec un texte
  explicatif (`Run 'vp build' to enable the web UI`). (PRD 0017 / T3)

### Ajouté

- **Nouvelle commande `depot prd phase init <prd-id> [--phase <n>]`**. Permet
  de poser explicitement `currentPhase` sur un PRD legacy déjà activé qui a
  des tâches phasées mais `currentPhase = null`, sans devoir attendre la
  migration de backfill. Sans `--phase`, derive depuis les tâches comme
  `activate`. Refuse sur un PRD déjà phasé sans `--force`. `--user-confirmed`
  obligatoire (cohérent PRD 0012). (PRD 0017 / T4b)

- **Variable d'environnement `DEPOT_DEBUG=1`**. Active l'affichage de la
  trace complète après le message d'erreur formatté — utile en débogage,
  invisible en usage normal. (PRD 0017 / T1)

- **Nouvelle commande `depot project directive update <id>`**. Permet de
  modifier tous les champs editable d'une directive existante — y compris
  `category` et `scope` qui demandaient auparavant du SQL direct. Validation
  `(category, scope)` cohérente avec `create`. Inscrit un event
  `directive_updated` dans `activity_log` avec le détail des champs modifiés.
  (PRD 0017 / T5)

### Tests

- **+1 scénario E2E** : `backfill-current-phase.e2e.test.ts` vérifie que la
  migration de backfill répare un PRD seedé manuellement dans l'état piégé.
- **+1 nouveau fichier de tests CLI** : `tests/cli/prd-phase-init.test.ts`
  (4 cas : missing user-confirmed, default derive, explicit phase, refus
  sur PRD déjà phasé).
- **+12 tests unitaires** dans `tests/cli/error-format.test.ts` couvrant
  les variantes d'erreurs (DatabaseError, ValidationError, CrossEntityError,
  FiberFailure unwrap, modes quiet/debug).
- **+4 tests unitaires** dans `tests/lib/workflow.test.ts` pour le seed
  via `createTask` (T2).
- **+4 tests unitaires** dans `tests/lib/workflow.test.ts` pour le derive
  via `activatePrd` (T4a).
- Suite E2E `serve-http-probes` nettoyée du workaround `ensureDistWebStub` —
  le test atteste désormais le bon comportement du mode API-only.

**Total** (au moment du merge 2.7.0) : 803 unit tests, 62 E2E,
check + typecheck + build verts.

---

## [2.6.0] — 2026-05-26

Première release de la chaîne « polish agent-friendliness ». Pas de
CHANGELOG rétro-actif détaillé ; voir les PRDs `0011`–`0016` dans
`.scratch/` pour le détail des changements.

Points marquants :

- **PRD 0011** : phases d'un PRD draft/ready toutes dépliées dans la
  timeline web (plus de section « Future phases » grisée).
- **PRD 0012** : flag `--user-confirmed "<quote>"` obligatoire sur les 7
  transitions de statut PRD (`ready`, `activate`, `request-review`,
  `done`, `phase-advance`, `cancel`, `close`). Templates agent
  (`dev.md`, `prd.md`) durcis avec encart STOP et handoff script
  Branch A/B.
- **PRD 0013** : refonte des directives projet en hooks catégorisés et
  rendus inline dans `depot context X`. Nouvelle colonne `category` sur
  `project_directives`, 4 nouveaux scopes (`pre-coder-spawn`,
  `post-auditor-pass`, `pre-handoff`, `pre-phase-advance`), wrappers
  CLI `prd …-check` correspondants.
- **PRD 0014** : isolation DB dev/prod via `DEPOT_DB_PATH` (rétro-compat
  `DB_PATH` avec warning de dépréciation). Boot log explicite indiquant
  la DB ciblée (`[depot] DB: dev|prod|custom (<path>)`), warning jaune
  sur prod en TTY.
- **PRD 0015** : nouveau dispositif de tests E2E par scénarios
  (`bun run test:e2e`). Runtime DSL `ctx.{dir,git,agent,expect}` qui
  invoque la CLI buildée contre une DB SQLite tmp par scénario.
  4 scénarios initiaux (lifecycle smoke, feature-group resolution,
  multi-repo currentRepo, hooks rendus inline).
- **PRD 0016** : couverture E2E exhaustive (phase-advance multi-phase,
  doc sync, ADR, human review Branch B, depot context tous modes,
  depot install matérialisation, depot serve + HTTP probes, chaos /
  edge cases, robustesse DB).
- **Follow-ups intégrés** : résolution workspace dans feature-group
  nyx (longest path wins), CrossEntityError enrichi avec
  labels/paths, message « no workspace » avec suggestions
  copy-pasteables, web POST `/directives` validation `category`.

---

## Versions antérieures

Pas de CHANGELOG. Voir l'historique git (`git log v2.5.0..v2.6.0`).
