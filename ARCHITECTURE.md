# Architecture et fonctionnement — Global Exam Assistant v6.4

Ce document décrit l’architecture effective actuelle. La base navigateur reste `global-exam-assistant-v6.3.js`, mais la version réellement exécutée est construite dynamiquement par `loader.js` avec plusieurs patches v6.4.

## Vue d’ensemble

```text
Global Exam / navigateur
        |
        | loader.js
        v
assistant.js = base v6.3
        |
        +-> runtime-patch-v6.4
        +-> runtime-hotfix-v6.4-content-loop
        +-> runtime-context-v6.4
        +-> runtime-page-audit-v6.4
        +-> garde récursion page-audit
        +-> runtime-finalize-v6.4
        +-> runtime-quality-v6.4
        +-> garde faux ordering partiel
        +-> lecture DOM complète obligatoire
        +-> garde grammatical ordering
        |
        | new Function(code) : contrôle syntaxique
        v
Assistant v6.4 effectif
        |
        | POST http://localhost:3000/api/chat
        v
Nginx local :3000
        |
        v
multi-ai-proxy.mjs :3001
        |
        +-> Groq
        +-> OpenAI
        +-> Gemini
        +-> Anthropic
        +-> Mistral
        +-> OpenRouter
        |
        v
Réponse JSON normalisée
        |
        v
Consensus / contrôle structurel
        |
        v
Application DOM
        |
        v
Audit pré-validation
        |
        v
Valider / Suivant / Terminer
```

## 1. `loader.js`

Le loader est le point d’entrée du Snippet DevTools.

Il :

1. refuse de charger une seconde instance sur la même page ;
2. télécharge la base et tous les patches avec `cache: no-store` ;
3. vérifie les versions attendues ;
4. applique les patches dans un ordre déterministe ;
5. ajoute plusieurs réparations directement dans le code généré ;
6. vérifie la syntaxe avec `new Function(code)` ;
7. évalue uniquement ensuite l’assistant final.

Le loader expose `geRuntimeVersions()` pour contrôler toutes les couches réellement actives.

## 2. Base navigateur `global-exam-assistant-v6.3.js`

La base contient les primitives principales :

- détection des types de questions ;
- extraction des choix/items/zones/champs ;
- sérialisation des questions ;
- requêtes IA ;
- normalisation initiale des résultats ;
- consensus ;
- interaction React/DOM ;
- audit avant soumission ;
- navigation ;
- interface du panneau.

Les corrections v6.4 ne dupliquent donc pas la base de plus de 200 Ko : elles la transforment au chargement.

## 3. Patches runtime

### `runtime-patch-v6.4.js`

Compatibilité avec différentes variantes DOM Global Exam :

- filtrage des chaînes i18n parasites ;
- amélioration de la banque d’ordering ;
- contrôles avant clic ;
- robustesse des interactions selon les PC.

### `runtime-hotfix-v6.4-content-loop.js`

Gère notamment :

- reprise après action manuelle ;
- distinction entre phase `validated` et phase `transition` ;
- pages de contenu passif ;
- interdiction de `Passer` comme faux mécanisme de validation.

### `runtime-context-v6.4.js`

Maintient la mémoire utile de l’activité :

- contenus pédagogiques vus précédemment ;
- contexte du sujet ;
- transcription lorsqu’elle existe ;
- identité de l’activité.

Un média sans transcription n’est jamais inventé.

### `runtime-page-audit-v6.4.js`

Scanne le `document.body` complet et relève notamment :

- progression `N/Total` ;
- radios/cases ;
- champs ;
- zones ;
- ordering ;
- boutons Valider/Suivant/Passer ;
- correction visible ;
- transcript ;
- sélections déjà présentes.

L’audit est utilisé avant traitement, navigation et certains clics sensibles.

Le loader ajoute un garde spécifique afin que `pageDomAudit()` ne rappelle pas indirectement `looksLikeQuestionPage()` et ne crée plus de récursion infinie.

### `runtime-finalize-v6.4.js`

Responsabilités actuelles :

- rythme par défaut de **15 minutes** ;
- `Terminer/Finish` traité comme action finale uniquement sur la dernière question complète ;
- exception DOM strictement limitée à cette finalisation ;
- contexte complet des phrases de fill-word drag/drop ;
- normalisation tolérante des placements drag/drop ;
- média non requis pour les exercices textuels autonomes.

### `runtime-quality-v6.4.js`

Renforce la qualité IA :

- sélection du contexte pertinent à la question courante ;
- réinitialisation de l’identité de rythme lors d’un changement d’activité ;
- labels sémantiques pour les zones de matching ;
- limitation des votes aux fournisseurs réellement indépendants ;
- stratégie adaptative fournisseur unique / multi-fournisseurs ;
- réduction des appels inutiles ;
- correction des faux états complets drag/drop.

## 4. Gardes ajoutés par le loader

### Lecture DOM complète

Avant toute requête IA, `questionReadingSnapshot(q)` rassemble :

```text
progression
consigne
texte visible du bloc
choix
items
zones
champs/options
lignes de matrice
```

Si un élément essentiel manque, l’automatisation se bloque avant l’appel IA.

La lecture est également ajoutée au prompt sous `page_dom_reading`.

### Ordering vide ≠ ordering partiel

Certaines variantes Global Exam laissent un badge ou un élément interne dans une zone d’ordering visuellement vide.

Le garde `6.4-ordering-empty-target-v1` n’accepte `selectedCount > 0` que s’il existe une vraie preuve sémantique qu’un fragment a été placé. Cela évite les fausses remises à zéro et les blocages associés.

### Qualité grammaticale ordering

Le garde `6.4-ordering-grammar-v1` ajoute une couche sémantique spécifique aux exercices de construction de phrases.

Avant de convertir une réponse en clics :

1. la phrase complète est reconstruite depuis l’ordre proposé ;
2. la seconde IA reçoit la phrase candidate A et doit la critiquer grammaticalement ;
3. l’arbitre reçoit les phrases candidates A et B, pas seulement leurs index ;
4. les inversions évidentes d’une phrase déclarative commençant par une copule/auxiliaire sans sujet sont rejetées ;
5. les règles de ponctuation, sujet/verbe, articles, accord et sens sont explicitement rappelées dans le prompt.

Exemple ciblé :

```text
is when a interoperability solution can be ...   // rejeté
interoperability is when a solution can be ...   // structure attendue
```

Le but du garde local n’est pas de remplacer l’IA par un parseur grammatical complet, mais d’empêcher les erreurs manifestes et de forcer une vraie critique multi-IA avant application.

## 5. Cycle d’une question

### Stabilisation

La boucle attend un état DOM suffisamment stable.

### Audit page

`pageDomAudit()` détermine si une question, une correction ou une page passive est réellement visible.

### Détection

`detectQuestion()` classe la page :

- `single-choice` ;
- `multi-choice` ;
- `button-choice` ;
- `text` / `multi-text` ;
- `select` / `multi-select` ;
- `drag-drop` ;
- `ordering` ;
- `matching` ;
- `matrix` ;
- `feedback` ;
- `none` ;
- `unknown-question`.

Une `unknown-question` bloque la navigation.

### Lecture complète

Le snapshot DOM est vérifié avant IA.

### IA / consensus

En mode `auto`, le navigateur transmet `provider_slot`.

Avec plusieurs fournisseurs :

```text
slot 0 -> analyse principale
slot 1 -> contre-vérification
slot 2 -> arbitrage si désaccord
```

Avec un seul fournisseur, le moteur peut éviter la deuxième requête si la structure et la confiance sont très fortes. En cas de 429 temporaire, le proxy peut attendre puis réessayer selon les réglages.

Avec plusieurs fournisseurs, un 429 provoque normalement un fallback vers une autre IA disponible.

## 6. `multi-ai-proxy.mjs`

Le proxy :

- lit les clés depuis `.env` ;
- ne les expose jamais au navigateur ;
- choisit le fournisseur demandé ou le slot automatique ;
- convertit le prompt vers l’API correspondante ;
- demande du JSON structuré ;
- gère les timeouts ;
- extrait `Retry-After` / reset quota ;
- maintient un cooldown temporaire ;
- effectue le fallback si autorisé ;
- renvoie fournisseur et modèle effectivement utilisés.

## 7. Adaptateurs

### Groq / OpenAI / OpenRouter

API compatible Chat Completions avec `json_schema` strict lorsque disponible.

### Gemini

`generateContent` avec `responseMimeType: application/json` et schéma adapté.

### Mistral

Chat Completions en `json_object`. Comme le schéma est moins strict côté API, les prompts et normalisations navigateur sont renforcés.

### Anthropic

API Messages avec outil `submit_answer` forcé et `input_schema` correspondant au type d’exercice.

## 8. Drag/drop / matching

Deux variantes principales sont traitées.

### Matching définition ↔ terme

La zone reçoit un label sémantique, par exemple :

```text
Zone 1 — cible: RJ45
Zone 2 — cible: Port
Zone 3 — cible: WiFi
```

### Fill in the blanks

La position exacte du trou est envoyée :

```text
Servers [[ZONE_0]] data with computers called clients.
Those clients can [[ZONE_1]] to the network through cables.
```

Les résultats IA sont normalisés vers `{item, zone}` 0-based, y compris lorsque certains fournisseurs utilisent des libellés ou du 1-based.

## 9. Ordering

Global Exam ajoute les fragments dans l’ordre des clics.

Le pipeline actuel vérifie :

- banque de fragments complète ;
- absence de faux fragment déjà placé ;
- réponse IA = permutation complète ;
- contrôle grammatical local conservateur ;
- contre-vérification avec phrase candidate reconstruite ;
- arbitrage avec phrases A/B en cas de désaccord ;
- clic de chaque fragment confirmé ;
- aucun fragment restant ;
- ordre final présent dans la zone ;
- `?` final si applicable.

## 10. Pages de correction / résultat

Les bandeaux `Bravo`, `Presque`, `Pas d’inquiétude`, ainsi que les onglets `Vos réponses / Correction / Explication`, sont utilisés pour reconnaître une correction même lorsque les anciens contrôles restent dans le DOM.

Une page de correction ne lance aucune IA.

## 11. Audit pré-validation

Une réponse n’est pas soumise simplement parce que le JSON IA est valide.

L’audit exige notamment :

- réponse appliquée et confirmée ;
- résultat structurel valide ;
- contrôle des choix sélectionnés ;
- champs obligatoires remplis ;
- aucune zone vide ;
- aucun fragment ordering restant ;
- progression cohérente ;
- absence de bouton `Passer` utilisé comme soumission implicite.

## 12. Finalisation

Sur la dernière question seulement, `Terminer` / `Finish` peut être l’action qui crée elle-même l’état soumis.

Le script l’autorise uniquement si :

- progression `N/N` ;
- réponse complète ;
- application DOM confirmée ;
- aucun `Valider` ;
- aucun `Passer` ;
- audit final réussi.

## 13. Rythme

Le rythme par défaut est désormais :

```text
15 min minimum
15 min maximum
```

Le temps attendu est réparti selon la progression de l’activité. Une action manuelle peut interrompre une attente et réveiller immédiatement la boucle.

## 14. Sécurité des clés

```text
Navigateur : aucune clé
Docker/.env : clés API
```

`.env` reste ignoré par Git et ne doit jamais être versionné.

## 15. Diagnostics principaux

```js
geRuntimeVersions()
geDebugDomPage()
geDebugQuestionReading()
geDebugAiProviders()
geDebugRelevantContext()
geDebugOrderingCount()
geDebugOrderingGrammar()
geDebugDragFillState()
geDebugDragSentenceContexts()
```

## 16. Limites connues

- Global Exam peut modifier son DOM ; les détecteurs doivent rester conservateurs.
- Les événements synthétiques ne sont pas identiques à des clics `isTrusted` ; chaque application est donc vérifiée après interaction.
- Le proxy local ne contourne pas les restrictions CORS du CDN audio Global Exam.
- Une transcription absente reste inconnue ; un média visible ne suffit pas à inventer son contenu.
- Le contrôle grammatical local d’ordering cible les erreurs manifestes ; le jugement complet repose toujours sur les fournisseurs IA et le consensus.
