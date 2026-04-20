# Depo — Agent Task & PRD Management CLI

> Depo est un CLI de gestion de tâches et de PRDs conçu exclusivement pour les agents IA.  
> Son objectif principal : assurer la continuité d'exécution entre sessions, agents, et contextes.

---

## 1. Problème

Les agents IA n'ont aucune mémoire persistante entre sessions. Quand un chat plante, que le contexte est perdu, ou qu'un agent doit être remplacé, toute la progression est opaque. Le workflow actuel compense manuellement : PRDs en markdown dans des dossiers, checklists forcées, relances manuelles, reviews ad hoc.

Depo formalise et automatise cette orchestration. Il est conçu pour être utilisé **par des agents**, pas par des humains.

---

## 2. Utilisateurs

| Rôle             | Description                                                      |
| ---------------- | ---------------------------------------------------------------- |
| **Agent PRD**    | Interviewe l'utilisateur, crée le PRD, génère les tâches         |
| **Agent Dev**    | Exécute les tâches, met à jour les statuts, logue son activité   |
| **Agent Review** | Vérifie le code, la sécurité, le métier en fin de cycle          |
| **Humain**       | Interagit uniquement lors de la phase PRD et de la review finale |

---

## 3. Architecture générale

```
depo/
├── cli/              → Commandes principales
├── db/               → SQLite + migrations
├── playbooks/        → Instructions markdown par rôle d'agent
└── config/           → Bootstrap minimal pour OpenCode / Claude
```

### Stack

- **Runtime** : Node.js (TypeScript) ou Python — à décider selon l'environnement agent cible
- **Base de données** : SQLite (fichier local dans le repo ou répertoire projet)
- **Interface** : CLI pur, communication stdio — pas de serveur web

---

## 4. Schéma de base de données

### `projects`

```sql
id          TEXT PRIMARY KEY
name        TEXT NOT NULL
description TEXT
status      TEXT CHECK(status IN ('active', 'paused', 'done'))
created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
```

### `prds`

```sql
id          TEXT PRIMARY KEY
project_id  TEXT REFERENCES projects(id)
title       TEXT NOT NULL
context     TEXT           -- Pourquoi ce PRD existe
scope       TEXT           -- Ce qui est inclus / exclu
status      TEXT CHECK(status IN ('draft', 'committed', 'archived'))
created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
committed_at DATETIME      -- NULL tant que non validé
```

### `tasks`

```sql
id            TEXT PRIMARY KEY
prd_id        TEXT REFERENCES prds(id)
title         TEXT NOT NULL
description   TEXT
done_criteria TEXT NOT NULL  -- Critères de complétion explicites et testables
depends_on    TEXT           -- JSON array de task ids
effort        TEXT CHECK(effort IN ('xs', 's', 'm', 'l', 'xl'))
status        TEXT CHECK(status IN ('pending', 'in_progress', 'blocked', 'done', 'skipped'))
assigned_to   TEXT           -- Identifiant de l'agent (optionnel)
created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
started_at    DATETIME
completed_at  DATETIME
```

### `activity_log`

```sql
id          INTEGER PRIMARY KEY AUTOINCREMENT
project_id  TEXT REFERENCES projects(id)
task_id     TEXT REFERENCES tasks(id)  -- NULL si action projet/PRD
agent_id    TEXT           -- Identifiant de la session agent
event_type  TEXT NOT NULL  -- started, completed, blocked, error, note, handoff
payload     TEXT           -- JSON : contexte libre selon event_type
created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
```

---

## 5. Commandes CLI

### Projet

```
depo project create <name>
depo project list
depo project status [project_id]    → Vue complète pour briefing agent
```

### PRD

```
depo prd create [project_id]        → Lance le playbook PRD interactif
depo prd show <prd_id>
depo prd commit <prd_id>            → Rend le PRD immuable
depo prd amend <prd_id>             → Ouvre une fenêtre de modification explicite
depo prd list [project_id]
```

### Tâche

```
depo task list [prd_id]             → Liste avec statuts
depo task start <task_id>           → Passe en in_progress, logue le démarrage
depo task done <task_id>            → Marque complété, vérifie done_criteria
depo task block <task_id> <reason>  → Marque bloqué avec raison
depo task skip <task_id> <reason>
depo task show <task_id>
```

### Log & Handoff

```
depo log <project_id> [--last N]    → Dernières N entrées de l'activity log
depo log add <project_id> <event_type> [--task task_id] [--payload JSON]
depo handoff <project_id>           → Résumé complet prêt à coller dans nouveau contexte
```

### Playbooks

```
depo playbook list                  → Liste les playbooks disponibles
depo playbook prd                   → Retourne les instructions du mode PRD
depo playbook dev                   → Retourne les instructions du mode Dev
depo playbook review                → Retourne les instructions du mode Review
```

---

## 6. Playbooks

Les playbooks sont des instructions markdown retournées par le CLI que l'agent incorpore dans son contexte. Ils définissent le comportement attendu selon le rôle.

### Playbook PRD

**Phase 1 — Interview**

```
Interview l'utilisateur de façon relentless sur chaque aspect du plan.
- Parcours chaque branche de l'arbre de décision
- Résous les dépendances entre décisions une par une
- Pour chaque question, fournis ta recommandation
- Ne passe pas à la question suivante sans réponse validée
```

**Phase 2 — Draft structuré**

Chaque tâche générée doit obligatoirement contenir :

- `title` : action concrète, verbe à l'infinitif
- `description` : contexte et détail d'implémentation
- `done_criteria` : liste de conditions testables — pas d'ambiguïté possible
- `depends_on` : dépendances explicites avec d'autres tâches
- `effort` : estimation xs/s/m/l/xl

**Phase 3 — Challenge final (avocat du diable)**

```
Avant de committer le PRD :
1. Identifie les 3 principaux risques techniques ou métier
2. Identifie ce qui est sous-spécifié
3. Identifie les dépendances ambiguës
Présente-les à l'utilisateur. Itère jusqu'à résolution.
```

**Phase 4 — Commit**

```
depo prd commit <prd_id>
```

Une fois committé, le PRD ne peut plus être modifié sans `depo prd amend`.

---

### Playbook Dev

Au démarrage de session :

```
depo handoff <project_id>           → Lis le résumé de handoff complet
depo task list <prd_id>             → Identifie la prochaine tâche pending sans blocage
depo task start <task_id>           → Démarre la tâche
```

Pendant l'exécution :

- Logger chaque étape significative avec `depo log add`
- Ne marquer `done` qu'une fois **tous** les `done_criteria` satisfaits
- En cas de blocage : `depo task block` avec raison explicite, ne pas continuer

En fin de session :

```
depo log add <project_id> handoff --payload '{"next": "...", "context": "..."}'
```

---

### Playbook Review

```
depo task list <prd_id> --status done    → Tâches à reviewer
```

Checklist obligatoire par tâche :

- [ ] Le `done_criteria` est-il réellement satisfait ?
- [ ] Sécurité : surface d'attaque, inputs non validés, secrets exposés
- [ ] Métier : la tâche répond-elle à l'intention du PRD ?
- [ ] Cohérence : pas de régression sur les tâches précédentes
- [ ] Code : lisibilité, maintenabilité, pas de dette évidente

---

## 7. Commande `handoff`

C'est la commande la plus critique du système. Elle génère un briefing complet pour permettre à un nouvel agent de reprendre sans perte de contexte.

**Sortie type :**

```
=== DEPO HANDOFF — [project_name] ===
Date : 2025-01-15 14:32

PRD actif : [titre]
Statut global : 4/12 tâches complétées

Tâche en cours : [task_id] — [titre]
Démarrée le : 2025-01-15 10:00
Dernière activité : [résumé du dernier log]

Tâches bloquées :
- [task_id] : [raison]

Prochaine tâche recommandée : [task_id] — [titre]
Dépendances satisfaites : oui

Dernières 5 entrées de log :
[timestamp] [event_type] [résumé]
...

Instructions : Lance `depo playbook dev` pour les instructions complètes.
```

---

## 8. Bootstrap agent (OpenCode / Claude)

Le seul contenu nécessaire dans `CLAUDE.md` ou la config OpenCode :

```markdown
## Depo

Ce projet utilise Depo pour la gestion des tâches agent.

- `depo handoff <project_id>` → état complet du projet (commence toujours par ça)
- `depo playbook prd` → si tu dois créer ou amender un PRD
- `depo playbook dev` → si tu dois exécuter des tâches
- `depo playbook review` → si tu dois faire une review
```

C'est un pointeur, pas les instructions. Les instructions vivent dans le CLI.

---

## 9. Règles immuables

1. **Un agent ne marque jamais `done` sans satisfaire le `done_criteria`**
2. **Un PRD committé est immuable sans `depo prd amend` explicite**
3. **Chaque session agent commence par `depo handoff`**
4. **Chaque fin de session logue un event `handoff` avec le contexte pour le suivant**
5. **Un agent bloqué logue le blocage et s'arrête — il ne contourne pas**

---

## 10. Ce qui n'est pas dans Depo

- Pas d'interface web ou de dashboard
- Pas de notifications
- Pas d'intégration Git (hors scope v1)
- Pas d'authentification multi-utilisateur
- Pas de gestion de branches de tâches parallèles (v1 séquentiel)

---

## 11. Phases de développement

### Phase 1 — Core

- Schéma SQLite + migrations
- Commandes `project`, `prd`, `task` basiques
- `activity_log` + `log` command
- `handoff` command

### Phase 2 — Playbooks

- Commande `playbook` avec les 3 rôles
- Contenu des 3 playbooks finalisé et testé

### Phase 3 — Polish

- `depo status` global lisible
- Gestion des erreurs robuste
- Documentation d'installation

---

_Document généré le 2025-01-15. Statut : Draft — non committé._
