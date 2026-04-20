# depot product backlog

## Remaining Work After Core Foundation

Ce document liste ce qui reste a faire apres le premier PRD de fondation du coeur CLI.

## Next Product Areas

### Playbooks

- Ajouter la commande `playbook` avec les roles PRD, Dev, et Review.
- Formaliser le contenu des playbooks comme sorties stables et versionnees.
- Definir comment un agent charge ces instructions dans son contexte.
- Tester que chaque playbook retourne un contenu exploitable et cohérent.

### UX CLI

- Rendre les sorties terminal plus lisibles et plus uniformes.
- Ajouter des messages d'erreur actionnables quand aucun workspace ou projet n'est resolu.
- Ajouter une commande de statut global lisible pour resumer le projet ou le workspace courant.
- Definir une strategie de couleurs ou de formats sans rendre le parsing fragile.

### Output Contracts

- Ajouter des options de sortie structuree, notamment JSON pour `handoff`.
- Stabiliser les contrats de sortie pour usages machine-first.
- Documenter les champs garantis des sorties structurees.

### PRD Authoring Experience

- Concevoir une vraie experience de creation interactive de PRD.
- Ajouter des aides de saisie pour user stories, decisions, et risques.
- Introduire un challenge final guide avant activation du PRD.

### Task Workflow Extensions

- Reevaluer le besoin de sous-taches ou de hierarchies de travail.
- Ajouter des vues filtrees par statut, assignee, ou dependances.
- Etudier la gestion de plusieurs agents concurrents sur un meme workspace.

### Storage and Portability

- Evaluer un mode repo-local ou configurable si le besoin reapparait.
- Prevoir export, import, ou sauvegarde de la base globale.
- Documenter la localisation exacte des donnees selon l'OS.

### Reliability and Operations

- Renforcer la gestion des erreurs autour de la base et des chemins invalides.
- Ajouter davantage de smoke tests CLI sur les commandes critiques.
- Definir la strategie de migrations et de compatibilite de schema.

### Documentation

- Ecrire une documentation d'installation et de demarrage rapide.
- Documenter le modele `projects + workspaces` et ses implications.
- Clarifier les invariants de workflow pour les agents et les humains.

## Open Questions For Later PRDs

- Faut-il exposer des sorties JSON pour toutes les commandes ou seulement pour `handoff` ?
- Faut-il introduire une notion d'agent identity plus structuree que du texte libre ?
- Faut-il permettre plusieurs PRDs `in_progress` dans un meme workspace ou garder une contrainte plus forte ?
- Faut-il offrir une experience interactive pour `task done` quand les done criteria sont nombreux ?
- Faut-il outiller des rapports agreges au niveau projet au-dela du handoff workspace-first ?
