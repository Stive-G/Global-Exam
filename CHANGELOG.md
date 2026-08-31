# Changelog

## v6.4 — état actuel

### Lecture et sécurité DOM

- Audit du `document.body` complet avant traitement et navigation.
- Correction de la récursion `pageDomAudit -> isRealFeedbackPage -> looksLikeQuestionPage`.
- Lecture DOM complète obligatoire avant chaque appel IA.
- Envoi explicite de `page_dom_reading` avec consigne, texte visible, choix, items, zones et champs.
- Blocage si une question probable est incomplètement lue ou non reconnue.
- Reconnaissance renforcée des pages de correction/résultat (`Bravo`, `Presque`, `Pas d’inquiétude`, onglets Correction/Explication).
- `Passer` ne peut plus être utilisé comme soumission implicite.

### Multi-IA / qualité

- Support Groq, OpenAI, Gemini, Anthropic, Mistral et OpenRouter.
- Stratégie adaptative selon le nombre de fournisseurs configurés.
- Avec un seul fournisseur : réduction des doubles appels inutiles lorsque confiance et structure sont très fortes.
- Avec plusieurs fournisseurs : contre-vérifications par fournisseurs distincts autant que possible.
- Votes supplémentaires limités aux fournisseurs réellement indépendants encore disponibles.
- Gestion des HTTP 429, `Retry-After`, cooldown et fallback fournisseur.
- Sélection du contexte d’activité réellement pertinent pour la question courante.
- Anciennes transcriptions hors sujet fortement pénalisées.
- Média sans transcription : confiance limitée uniquement lorsque la question dépend réellement de ce média.

### Drag/drop / matching

- Faux états `drag-drop déjà rempli` supprimés tant que des zones restent réellement visibles.
- Labels sémantiques de zone conservés pour les exercices de matching.
- Contexte complet autour des trous avec marqueurs `[[ZONE_n]]` pour les fill-in-the-blanks.
- Normalisation des réponses drag/drop entre fournisseurs : 0-based, 1-based, libellés et variantes `source/target`.
- Prompt JSON drag/drop explicite pour les fournisseurs moins stricts comme Mistral.
- Aucun média audio non requis ne réduit artificiellement la confiance d’un exercice entièrement textuel.

### Ordering / construction de phrases

- Banque d’ordering limitée aux vrais fragments utiles et filtrage des clés i18n parasites.
- Vérification exacte des petits fragments (`in`, `on`, `the`, `?`).
- Faux état `1 fragment déjà placé` ignoré lorsque la zone est en réalité vide (`6.4-ordering-empty-target-v1`).
- Nouvelle vérification grammaticale `6.4-ordering-grammar-v1` :
  - reconstruction de la phrase complète avant conversion en index ;
  - prompt renforcé sur sujet/verbe, articles, accords, prépositions et ponctuation ;
  - deuxième IA utilisée comme critique grammaticale de la phrase candidate ;
  - arbitre informé des phrases candidates A et B, pas seulement des index ;
  - rejet local conservateur des inversions manifestes sujet/copule dans une phrase déclarative.
- Garde `6.4-ordering-carousel-v2` pour les banques de fragments paginées/virtualisées :
  - la pagination est évaluée à partir des fragments réellement accessibles à l’écran, et non de tous les éléments DOM virtuels ;
  - plusieurs balayages gauche → droite → gauche → droite sont effectués avant l’analyse afin de récupérer les fragments qui n’apparaissent qu’après plusieurs défilements ;
  - une vue identique doit rester stable plusieurs fois avant d’être considérée comme une extrémité du carrousel ;
  - recherche automatique d’un fragment dans les différentes vues avant chaque clic ;
  - jusqu’à trois tentatives de clic avant de déclarer l’interaction impossible ;
  - corrige le cas où l’IA ne recevait que 6 fragments alors qu’un 7e (`an email,` par exemple) n’apparaissait qu’après consommation des autres fragments.
- Ajout de `geDebugOrderingGrammar()` et `geDebugOrderingCarousel()`.

### Finalisation et rythme

- `Terminer/Finish` autorisé comme soumission uniquement sur la dernière question complète et vérifiée.
- Audit final spécifique avant clic sur `Terminer`.
- Objectif de durée par défaut passé de **30 minutes à 15 minutes**.
- Réinitialisation du chrono quand une nouvelle activité est détectée.

### Diagnostics

Ajouts principaux :

```text
geRuntimeVersions()
geDebugDomPage()
geDebugVerification()
geDebugQuestionReading()
geDebugRelevantContext()
geDebugAiProviders()
geAdaptiveAiProfile()
geDebugDragFillState()
geDebugDragSentenceContexts()
geDebugNormalizeDrag()
geDebugOrderingCandidates()
geDebugOrderingCount()
geDebugOrderingGrammar()
geDebugOrderingCarousel()
```

### Fichiers runtime v6.4

Le loader construit maintenant l’assistant dans l’ordre suivant :

```text
base v6.3
-> runtime-patch-v6.4
-> runtime-hotfix-v6.4-content-loop
-> runtime-context-v6.4
-> runtime-page-audit-v6.4
-> garde récursion page-audit
-> runtime-finalize-v6.4
-> runtime-quality-v6.4
-> garde faux ordering partiel
-> lecture DOM complète
-> garde grammatical ordering
-> garde banque ordering paginée/virtualisée
-> contrôle syntaxique
-> exécution v6.4
```

## v6.3

- Gestion déterministe des exercices avec un seul choix et un seul trou.
- Aucune requête IA inutile dans ce cas.
- Suppression du badge avant le clic pour ne pas modifier le texte/target React.
- Recherche des wrappers parents et activators React.
- Fallback vers le handler React direct après clic natif et pointer/mouse.
- Vérification robuste des `button-choice` qui remplissent directement un trou.
- Ajout de `geDebugButtonChoice()`.

## v6.1

- Reprise Auto après un clic manuel.
- Interruption immédiate de l’attente de rythme lors d’une action manuelle.
- Priorité à la nouvelle page sur les anciens blocages de sécurité.
- Rafraîchissement immédiat du panneau après Valider/Suivant/Passer/Terminer.

## v6.0

- Passage Groq-only vers multi-IA.
- Ajout Groq/OpenAI/Gemini/Anthropic/Mistral/OpenRouter.
- Rotation de fournisseurs pour double vérification/arbitrage.
- Fallback fournisseur.
- Panneau réductible.
- Première gestion du rythme d’activité.
- Correction ordering partiel avec remise à zéro.
- Maintien de l’audit pré-validation.
- Ajout de `loader.js`, README et documentation d’architecture.
