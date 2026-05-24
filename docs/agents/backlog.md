# Backlog audit — items cosmétiques / faible risque

Issus de l'audit workspace/multi-repo (mai 2026). Pas de PRD dédié :
items mineurs, à reprendre si un cas concret les rend gênants.

- **#8 — Résolution repo ambiguë en multi-workspace + multi-repo.**
  Quand deux workspaces du même projet ont des arborescences
  différentes, `resolveProjectRepos(projectId, workspacePath)` peut
  résoudre des repos différents selon le workspace passé. Comportement
  documenté ; l'enregistrement explicite des repos via `project_repo`
  résout en pratique.

- **#10 — `assertPrdInWorkspace` laisse passer `workspaceId = null`.**
  La garde renvoie OK quand le PRD n'a pas encore de workspace (avant
  activation). Cohérent avec le modèle, mais inconsistant avec
  l'intuition « activation lock le binding ». À renommer / clarifier si
  on s'y trompe à l'usage.

- **#22 — Suppression d'un workspace : pas de déplacement en masse des
  PRD.** Sans `--force`, refuse si des PRD y sont liés ; avec
  `--force`, supprime les PRD. Pas d'opération « déplacer les PRD vers
  un autre workspace ». UX, pas un risque de données.

- **#24 — Fenêtre TOCTOU activation/binding.** `activatePrd` valide le
  workspace puis le set dans deux requêtes séparées. SQLite sérialise ;
  risque très faible. À envisager si on durcit un jour le modèle de
  concurrence.
