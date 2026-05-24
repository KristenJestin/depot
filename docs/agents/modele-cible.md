# Modèle cible de depot

> Synthèse à plat du fonctionnement (état au 2026-05-22). Source de
> vérité pour le modèle. Les PRD individuels (un `PRD.md` par dossier
> sous `.scratch/0001-…`–`0010-…`, plus `backlog.md`) sont des tickets
> d'implémentation qui pointent ici, pas des définitions parallèles.
>
> Lecture conseillée : sections 1–3 pour les fondations, 4–6 pour
> l'état des données, 7–9 pour les mécaniques, 10–12 pour la
> cartographie.

## 1. Les trois notions

| Notion           | Rôle unique                                                                                        | Table          |
| ---------------- | -------------------------------------------------------------------------------------------------- | -------------- |
| **project**      | conteneur logique : regroupe PRD, tâches, config, directives, ADR                                  | `projects`     |
| **workspace**    | dossier disque rattaché à un projet : sert à la résolution cwd → projet                            | `workspaces`   |
| **project_repo** | entrée du registre des repos git du projet : sert à orienter les opérations git (ship, directives) | `project_repo` |

- Un projet **n'a pas** de chemin disque (purement logique).
- Un workspace **a** un chemin (unique en base).
- Un `project_repo` a un chemin (absolu ou relatif au workspace).
  Registre vide ⇒ repo implicite unique au chemin du workspace.

## 2. Ce que depot fait — et ne fait pas

**Fait :**

- Suit le cycle de vie des PRD et des tâches.
- Stocke et sert les ADR (décisions architecturales) liées à un PRD ou
  à un projet (PRD 0010).
- Contraint les agents (un seul PRD `in_progress` par workspace,
  transitions strictes, validations cross-entity).
- Lit l'état git **dynamiquement** quand le pipeline ship en a besoin
  (`git worktree list`, etc.) — mais ne stocke aucun SHA, ni branch,
  ni autre métadonnée git.

**Ne fait pas :**

- Créer / supprimer des worktrees ou des dossiers (assumé hors depot,
  voir § 9).
- Imposer une convention de nommage de branche (retiré — PRD 0003).
- Stocker du SHA git ou des refs git en base (retiré — PRD 0009).
- Exécuter des opérations git mutantes (commit, push) — retiré côté
  web par PRD 0009.
- Afficher des diffs (retiré côté web par PRD 0009 ; les IDE, GitHub,
  Bitbucket le font mieux).
- Versionner du code, prendre des décisions produit.

**Règle de design** : un champ que depot ne lit/n'écrit jamais n'a
pas sa place dans le modèle (leçons `branchNamingConvention`,
`worktreePath`, et toutes les colonnes SHA retirées par PRD 0009).

## 3. Les trois dispositions disque possibles

Un projet depot mappe au disque de l'une de ces trois façons. **Aucun
mécanisme de détection automatique ne couvre les trois cas.** La
mécanique retenue est l'enregistrement explicite via
`depot workspace add` (PRD 0001) — voir § 9.

- **A — Mono-repo git classique.** Le dossier du projet _est_ un repo
  git. 1 workspace = ce dossier. 0 `project_repo` ⇒ repo implicite.
- **B — Multi-repo, racine coquille avec git.** Le dossier racine a son
  propre `.git` qui versionne la config d'agent (ex. `.claude`,
  `CLAUDE.md`). Les vrais repos sont des sous-dossiers, chacun son
  remote. N `project_repo` en chemins relatifs. Exemple réel : nyx.
- **C — Non-git (mono ou multi).** Project doc-only, scripts, configs.
  Aucune résolution git ne marche ; tout passe par l'enregistrement
  explicite.

## 4. Cycle de vie d'un PRD

| État          | Comment on y entre                           | `workspaceId`               | Modifiable ?                 |
| ------------- | -------------------------------------------- | --------------------------- | ---------------------------- |
| `draft`       | `prd create`, ou fork d'une révision `ready` | `null`                      | oui, librement               |
| `ready`       | `prd ready`                                  | `null`                      | non — fork pour modifier     |
| `in_progress` | `prd activate` (depuis cwd)                  | **lié** au workspace résolu | findings / reviews seulement |
| `done`        | `prd done`                                   | inchangé (figé)             | non (immuable)               |
| `canceled`    | `prd cancel`                                 | inchangé (figé)             | non (immuable)               |

**Liaisons à l'activation** :

- `workspaceId` ← workspace résolu du cwd. **Figé ensuite** (le
  re-pointage a été abandonné avec le retrait du diff/review web —
  PRD 0009).
- **Pas de capture SHA.** Plus aucun SHA git n'est stocké côté PRD
  (retiré par PRD 0009).
- Contrainte d'unicité : un seul PRD `in_progress` par workspace.

## 5. Liaison PRD ↔ repo et tâche ↔ repo (futur — PRD 0005)

- **PRD ↔ repos** : table `prd_repo`, **M:N**, posée sur
  `prd_revisions` (la portée repo peut changer d'une révision à
  l'autre). Cardinalité 0 valide.
- **Tâche ↔ repo** : `task.repoId` **0..1** (nullable). **Une tâche
  est rattachée à au plus un repo.** Pas de N par tâche — un
  changement cross-repo se découpe en 2 tâches + dépendance.
- **Validation** : si `task.repoId` non-null, il doit être dans les
  `prd_repo` du PRD parent.
- **`task.repoId = null` est valide même en multi-repo** : cas d'une
  modif qui n'appartient à aucun `project_repo` (ex. `CLAUDE.md` à la
  racine d'un projet de type B).

## 6. Matrice des champs nullables

Le principe directeur : **`null` veut dire « repo implicite » ou « pas
applicable » — jamais « inconnu / à deviner ».** depot ne tente jamais
d'inférer.

| Entité                    | Champ               | `null` veut dire                                                   | Non-null veut dire                     |
| ------------------------- | ------------------- | ------------------------------------------------------------------ | -------------------------------------- |
| `prd_revisions`           | `workspaceId`       | PRD pas encore activé                                              | depuis `activate` (figé ensuite)       |
| `activity_log` (PRD 0006) | `repoName`          | non-attribuable (mono-repo, ou ligne historique)                   | attribution explicite (log multi-repo) |
| `task` (PRD 0005)         | `repoId`            | tâche hors d'un `project_repo` précis (mono-repo, ou modif racine) | tâche rattachée à un `project_repo`    |
| `adrs` (PRD 0010)         | `prdRevisionId`     | ADR project-wide (décision d'archi indépendante d'un PRD)          | ADR émergée d'un PRD précis            |
| `adrs` (PRD 0010)         | `supersededByAdrId` | ADR encore en vigueur                                              | ADR remplacée (statut `superseded`)    |

## 7. Résolution cwd → workspace → project

**Algorithme actuel** :

1. Plus long préfixe parmi les workspaces enregistrés : si match
   direct (le workspace est ancêtre du cwd) → retourne ce workspace.
2. Sinon, repli worktree git : `resolveWorktreeMainPath` remonte
   chercher un `.git` de worktree → match contre les workspaces.
3. Sinon, `null` (et la commande échoue avec un message clair).

**Problèmes connus** (PRD 0004) :

- Un workspace enregistré à un chemin trop large (`/home/kris`)
  **shadow** tout ce qui est en dessous.
- Le repli worktree ne tourne **pas** quand un match direct existe
  (même mauvais).
- `depot context` peut **auto-créer** un workspace à un chemin
  aberrant en silence.

**Modèle cible** :

- Match direct **exact** (cwd == workspace.path) gagne toujours.
- Pour un match direct par ancêtre, tenter d'abord le repli worktree ;
  préférer son résultat quand il aboutit.
- Auto-create refusé pour les chemins aberrants
  (PRD 0004 Q1, retenu : liste minimale — home dir + racine FS, sans
  bloquer les projets non-git).
- Pas de résolution git pour les projets non-git (couverts par
  enregistrement explicite uniquement).

**Extension — résolution du `project_repo` courant (PRD 0008)** : une
fois le workspace résolu, depot calcule en plus le `project_repo`
courant par chemin relatif (workspace + sous-chemin du cwd), avec
prise en charge des worktrees git via `git rev-parse --git-common-dir`.
Pas de magie pour les workspaces non enregistrés — il faut passer par
`workspace add`.

## 8. Règles cross-entity

- `workspace.projectId` : projet auquel le workspace est rattaché
  (1:N).
- `prd_revision.projectId` = `prd.projectId` (cohérence par triggers
  DB).
- `prd_revision.workspaceId` (non-null) → workspace du **même projet**
  que la PRD (`assertWorkspaceInProject`).
- `task.prdRevisionId` → la tâche appartient à la révision ; immutable
  une fois la révision `ready+`.
- `task.repoId` (PRD 0005) → doit être dans les `prd_repo` du PRD
  parent ; `null` toléré.
- `prd_repo.repoId` (PRD 0005) → doit être un `project_repo` du même
  projet que la PRD.
- `adr.projectId` (PRD 0010) → projet auquel l'ADR appartient.
- `adr.prdRevisionId` (PRD 0010, optionnel) → si renseigné, doit
  appartenir au même projet que `adr.projectId`.
- `adr.supersededByAdrId` (PRD 0010, optionnel) → doit pointer un ADR
  différent du même projet.

## 9. Création et suppression d'un workspace — tranché (piste 1)

**Mécanique retenue : enregistrement explicite par le skill (PRD
0001).** Quel que soit le mode de création du dossier (worktree git,
copie de projet, autre), l'agent (ou l'utilisateur) appelle :

```
depot workspace add --project <id|name> [--path <chemin>] [--label <label>]
```

`--project` est requis (id ou nom du projet), `--path` défaut à cwd.
depot **ne crée pas** de dossier, **ne devine pas** un nouveau
dossier, n'a aucun mécanisme de détection automatique d'un _nouveau_
workspace. Une fois enregistré, la résolution `cwd → workspace` par
plus long préfixe (et le repli worktree git) joue normalement.

**Pistes écartées :**

- _depot crée le dossier_ — casse « depot ne gère pas l'env », ne
  couvre ni B (multi-repo coquille, logique skill spécifique) ni C
  (non-git).
- _Marqueur dans le dossier_ — pollue le disque, demande de repenser
  list/show, pas indispensable pour résoudre le problème actuel.
- _Hybride_ — complexité non justifiée tant que (1) seule pose
  problème.

**Revers — suppression physique (PRD 0002).** L'agent qui supprime le
dossier sans appeler `workspace remove` est fautif, mais depot l'aide
en **masquant** les workspaces sans dossier physique partout
(résolution, listings CLI, sélecteur web). La ligne reste en base —
récupérable, supprimable explicitement — mais n'apparaît plus dans le
quotidien.

**Aide opportuniste — PRD 0008.** Une fois le workspace résolu, depot
calcule en plus le `project_repo` courant par chemin relatif. Pas de
magie pour les workspaces non enregistrés — c'est piste 1 ou rien.

## 10. Ce qui est explicitement hors depot

- Création / suppression de worktrees ou de copies de projet (assumé
  hors depot — § 9).
- Choix du nom de branche (orchestrateurs ; PRD 0003 a retiré la
  convention forcée).
- Mise en place de l'environnement de dev (yalc, install, build).
- Versionnement de code (depot ne commit pas tout seul).
- **Exécution d'opérations git mutantes** depuis le web (commit, push,
  capture SHA) — retiré par PRD 0009.
- **Affichage de diffs git** — les IDE et trackers de PR le font
  mieux ; retiré par PRD 0009.
- **Stockage de SHA, branches, ancrages post-merge** en base — retiré
  par PRD 0009 ; on se contente du PR/branch git natif.
- Décisions produit (depot suit, ne décide pas).

## 11. Cartographie des PRD vis-à-vis de ce modèle

Les PRD sont numérotés dans l'ordre de livraison logique : 0001 = à
livrer en premier, 0010 = en dernier.

| PRD     | Statut | Ce qu'il apporte au modèle                                                                       |
| ------- | ------ | ------------------------------------------------------------------------------------------------ |
| 0001    | draft  | Ajoute `depot workspace add` (§ 9). Mécanique universelle d'enregistrement.                      |
| 0002    | draft  | Masquage des workspaces sans dossier physique (§ 9).                                             |
| 0003    | draft  | Retire `branchNamingConvention` (§ 10).                                                          |
| 0004    | draft  | Durcit la résolution (§ 7) ; garde l'auto-create.                                                |
| 0005    | draft  | **Fondationnel.** `prd_repo` M:N + `task.repoId` 0..1 (§ 5).                                     |
| 0006    | draft  | Ajoute `repoName` à l'activity log + autres dimensions repo (§ 6). Réduit après retrait des SHA. |
| 0007    | draft  | Directives multi-repo. **Dépend de 0005** (§ 5) pour « repos du PRD ».                           |
| 0008    | draft  | Résolution du `project_repo` courant par chemin (§ 7).                                           |
| 0009    | draft  | **Gros nettoyage.** Retire le diff/review/SHA dans la couche web (§§ 2, 10).                     |
| 0010    | draft  | Introduit l'ADR comme entité de premier ordre dans depot (§§ 1, 2, 6, 8).                        |
| backlog | —      | 4 items cosmétiques sans PRD dédié.                                                              |

Trois PRDs intermédiaires (re-pointage workspace, cohérence workspace
web, intégrité git web) ont été **absorbés par PRD 0009** ou rendus
obsolètes par le retrait du diff/review web, et n'apparaissent plus.

## 12. Open / non encore tranché

Aucune question ouverte critique au niveau du modèle global. Quelques
questions résiduelles vivent dans les PRD individuels (cf. leurs
sections « Questions ouvertes ») et seront tranchées au moment du
slicing en issues :

- **PRD 0006** — migration de l'activity log (backfill ou nullable
  seul) ; périmètre exact des dimensions repo restantes après le
  retrait des SHA.
- **PRD 0007** — définition de « repos du PRD » pour les pré-checks.
- **PRD 0009** — snapshots de phase entièrement supprimés ou
  partiellement ? `WorkspaceSwitcher` conservé ou non ?
  `capture-merge` CLI à retirer aussi.
- **PRD 0010** — linkage `prdId` vs `prdRevisionId`, convention d'ID
  (contigu vs hex), surface write web (v1 vs v2), format body, statut
  `deprecated` en plus de `superseded`.
