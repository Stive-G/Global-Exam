# Architecture et fonctionnement — Global Exam Assistant v6.3

Ce document explique comment les fichiers du projet travaillent ensemble et comment une question passe de la page Global Exam à une réponse validée.

## Vue d'ensemble

```text
Global Exam dans le navigateur
        |
        | Détection DOM / extraction question
        v
global-exam-assistant-v6.3.js
        |
        | POST http://localhost:3000/api/chat
        v
Nginx local (port 3000)
        |
        v
multi-ai-proxy.mjs (Node, port interne 3001)
        |
        +--> Groq
        +--> OpenAI
        +--> Gemini
        +--> Anthropic Claude
        +--> Mistral
        +--> OpenRouter
        |
        v
JSON normalisé
        |
        v
Vérification structurelle + consensus
        |
        v
Application dans le DOM
        |
        v
Vérification DOM + audit pré-validation
        |
        v
Valider / Suivant / Terminer
```

## Rôle des fichiers

### `global-exam-assistant-v6.3.js`

C'est la partie navigateur.

Responsabilités principales :

1. détecter le type d'exercice ;
2. extraire l'énoncé, les choix, les zones ou les champs ;
3. construire un prompt structuré ;
4. demander une réponse au proxy local ;
5. comparer plusieurs analyses pour les exercices complexes ;
6. appliquer la réponse dans les composants Global Exam ;
7. vérifier que React/DOM a réellement enregistré l'interaction ;
8. effectuer l'audit de sécurité ;
9. respecter le rythme cible de l'activité ;
10. valider et naviguer seulement après confirmation.

Le script ne contient aucune clé API.

### `multi-ai-proxy.mjs`

C'est la couche serveur locale.

Elle :

- lit les clés depuis `.env` ;
- choisit un fournisseur ;
- transforme la requête vers le format de son API ;
- demande une sortie JSON structurée ;
- normalise la réponse vers un format commun proche de Chat Completions ;
- bascule vers une autre IA si le fournisseur courant échoue ;
- renvoie au navigateur le nom du fournisseur et du modèle réellement utilisés.

### `docker-compose.yml`

Lance deux conteneurs :

- `global-exam-ai-proxy` : Node 22 ;
- `global-exam-proxy` : Nginx exposé sur `localhost:3000`.

### `nginx.conf`

A deux fonctions :

1. ajouter les en-têtes CORS nécessaires au navigateur ;
2. router `/api/chat`, `/health`, etc. vers Node.

Il expose également le script via :

```text
http://localhost:3000/assistant.js
```

C'est ce qui permet à `loader.js` de rester très court.

### `.env`

Fichier local non versionné contenant les secrets.

Il peut contenir une ou plusieurs clés. Le proxy ignore les fournisseurs dont la clé est vide.

### `loader.js`

Bootstrap minimal pour DevTools.

Il télécharge la version du script servie par Nginx et l'évalue dans le contexte de la page Global Exam.

## Cycle d'une question

### 1. Stabilisation

Le script attend que la page cesse de muter pendant un court instant.

### 2. Détection

`detectQuestion()` cherche d'abord les états spéciaux :

- correction/résultat ;
- réponse déjà présente ;
- ordering ;
- drag/drop ou placement par clic ;
- radio/checkbox ;
- texte ;
- select/combobox ;
- matching/matrix ;
- absence de question ;
- type inconnu.

L'ordre des détecteurs est important. Les consignes explicites d'ordering/placement passent avant le fallback `button-choice`.

### 3. Sérialisation

Le DOM brut n'est jamais envoyé tel quel.

Le script transforme la question en données utiles :

```json
{
  "type": "ordering",
  "prompt": "...",
  "items": [
    {"index": 0, "text": "when"},
    {"index": 1, "text": "was"}
  ]
}
```

### 4. Routage multi-IA

En mode `auto`, le navigateur envoie un `provider_slot`.

Pour une question complexe :

```text
slot 0 -> première analyse
slot 1 -> seconde analyse indépendante
slot 2 -> arbitrage en cas de désaccord
```

Le proxy fait correspondre les slots aux clés réellement configurées. Avec deux clés, le troisième slot revient cycliquement sur la première. Avec une seule clé, tous les slots utilisent le même fournisseur.

Si `AI_FALLBACK=true`, une erreur réseau, limite ou erreur fournisseur entraîne un essai sur le fournisseur suivant.

## Adaptateurs fournisseurs

### Groq / OpenAI / OpenRouter

Format Chat Completions compatible OpenAI. Le proxy demande un `json_schema` strict lorsque le fournisseur/modèle le permet.

### Mistral

Endpoint de chat compatible. Le proxy utilise le mode JSON pour maximiser la compatibilité entre modèles.

### Gemini

Le proxy convertit les messages vers `generateContent` et demande une réponse JSON conforme au schéma attendu.

### Anthropic Claude

Le proxy utilise l'API Messages et un outil forcé `submit_answer` dont `input_schema` correspond au type de question. L'entrée de l'outil devient la réponse JSON normalisée.

## Consensus

Les types simples n'ont pas systématiquement besoin de trois appels.

Pour les types complexes :

- A et B identiques -> consensus `2/2` ;
- A et B différents -> appel d'arbitrage ;
- arbitre = A ou B -> consensus `2/3` ;
- troisième réponse différente -> acceptée seulement avec les garde-fous de confiance et de structure ;
- sortie invalide -> réparation ou blocage.

Le panneau affiche les fournisseurs réellement impliqués lorsque cette information est disponible.

## Application des réponses

### QCM

Le script réacquiert les inputs après les rerenders React et vérifie l'état `checked`/ARIA final.

### Drag/drop Global Exam

Pour les variantes observées, le site effectue le placement quand l'utilisateur clique sur le mot. Le script utilise donc `click-auto-drop`, pas un drag artificiel.

### Ordering

Le site ajoute les fragments dans l'ordre des clics.

Le script :

1. clique les fragments séquentiellement ;
2. vérifie chaque mutation ;
3. vérifie l'ordre final ;
4. vérifie qu'il ne reste aucun fragment dans la banque.

## Correction v6.3 : ordering partiel

Le problème observé était :

```text
plusieurs fragments déjà placés
+ un clic tardif échoue
-> ancienne version réanalyse seulement le dernier fragment
-> la phrase partielle peut déjà être fausse
```

v6.3 ne considère plus un ordering partiel comme un état sûr à conserver.

Il tente une remise à zéro confirmée :

- bouton local undo/reset si détecté près de la zone ;
- sinon clic sur le dernier fragment sélectionné si le composant le permet ;
- vérification après chaque retrait : `selectedCount` doit baisser ou `remainingCount` augmenter.

Si aucune remise à zéro n'est confirmée, le script bloque au lieu de valider.

## Correction v6.3 : petits mots

Les anciennes vérifications utilisaient parfois :

```js
targetText.includes("in")
```

C'est dangereux car `in` existe à l'intérieur de `protecting`.

La nouvelle vérification utilise des limites de mots et un comptage d'occurrences. Un clic n'est confirmé que si le fragment exact apparaît réellement comme fragment supplémentaire ou si sa source quitte la banque de manière confirmée.

La même logique est utilisée pour vérifier la séquence finale.

## Audit pré-validation

Même une réponse IA valide ne suffit pas.

`preValidationAudit()` vérifie notamment :

- application DOM confirmée ;
- confiance/consensus ;
- nombre de choix sélectionnés ;
- correspondance exacte avec la réponse calculée ;
- champs obligatoires ;
- zones vides ;
- fragments d'ordering encore disponibles ;
- présence du `?` final lorsque la question contient une tuile `?` ;
- matrice complète.

Seulement après cet audit un clic automatique sur Valider/Suivant/Terminer est autorisé.

## Gestion des réponses déjà présentes

Le script mémorise l'identité stable de la page et inspecte le DOM avant de relancer l'IA.

Cela évite le cas où un exercice déjà rempli est ensuite redétecté comme `button-choice` parce que React a changé sa structure.

## Reprise après clic manuel

Le listener de clic distingue :

- clics internes au script ;
- clics de l'utilisateur.

Si l'utilisateur valide, passe ou navigue manuellement alors que Auto est ON, le script :

1. laisse le clic se produire ;
2. supprime les blocages/résultats devenus obsolètes ;
3. attend le nouvel état ;
4. réveille ou relance la boucle automatique.

## Rythme de 30 minutes

Le rythme par défaut est :

```text
30 min minimum
30 min maximum
```

Le script choisit donc exactement 30 minutes comme cible.

Pour une activité à 13 étapes, il calcule un temps cumulé attendu à chaque progression `N/13`. S'il a répondu trop vite, il attend avant la soumission afin de rester proche de la trajectoire des 30 minutes.

Si le script est chargé en cours d'activité, il estime le temps déjà écoulé à partir de la progression actuelle au lieu d'ajouter 30 minutes complètes.

## Interface réductible

`renderPanel()` conserve un état `panelCollapsed`.

En mode réduit, seuls restent visibles :

- le titre ;
- Auto ON/OFF ;
- le dernier fournisseur ;
- le bouton `+`.

La logique d'automatisation continue normalement.

## Sécurité des clés

La règle est simple :

```text
Navigateur -> aucune clé
Docker/.env -> clés API
```

`.env` est inclus dans `.gitignore` et ne doit jamais être commité.

## Limites connues

- Les interfaces Global Exam peuvent évoluer : les détecteurs sont basés sur le DOM observé.
- Les événements synthétiques ne sont pas toujours équivalents à un clic `isTrusted`; plusieurs stratégies React/DOM et des vérifications fortes sont donc utilisées.
- Le proxy IA ne contourne pas les restrictions CORS du CDN audio Global Exam.
- Si un contenu audio n'est ni accessible ni transcrit dans le DOM, l'IA ne dispose pas magiquement de cet audio.
- Les modèles et tarifs des fournisseurs changent : les noms de modèles restent configurables dans `.env`.


## v6.3 — Vérification robuste des `button-choice`

Un `button-choice` n'est plus validé seulement parce que la classe CSS du bouton a changé.

Pour les exercices où un clic remplit un trou, l'assistant prend un snapshot avant le clic puis vérifie après le clic :

1. si le texte attendu apparaît dans une zone de réponse ;
2. si le nombre de zones vides diminue ;
3. si le contrôle passe en état `selected`, `pressed` ou `checked` ;
4. si la puce disparaît de la banque en même temps que le DOM de la question change.

La recherche de la puce est refaite dans le DOM avant chaque tentative afin de supporter les re-renders React.

L'audit pré-validation considère maintenant aussi le cas d'un **seul trou** pour les consignes `Fill in the blank...`. Une zone vide suffit alors à bloquer `Valider`.
