# Global Exam Assistant v6.4 — Multi-IA

Assistant navigateur pour analyser les exercices Global Exam, appliquer les réponses dans le DOM, vérifier que l’interaction a réellement été enregistrée, puis seulement autoriser la validation ou la navigation.

## État actuel

La version effective reste **v6.4**, construite à partir de `global-exam-assistant-v6.3.js` puis renforcée au chargement par plusieurs patches runtime et gardes du `loader.js`.

Fonctions principales actuellement actives :

- lecture complète du DOM avant chaque appel IA ;
- audit global de la page avant réponse, validation et navigation ;
- pages de correction/résultat reconnues sans appel IA ;
- vrai multi-fournisseurs avec Groq, OpenAI, Gemini, Anthropic, Mistral et OpenRouter ;
- stratégie adaptative selon le nombre de fournisseurs configurés ;
- récupération des HTTP 429 et fallback fournisseur ;
- contexte d’activité filtré pour ne garder que les extraits pertinents ;
- drag/drop avec labels sémantiques, contexte de phrase et normalisation des réponses IA ;
- ordering par clic avec contrôle des fragments restants, faux états partiels filtrés et vérification grammaticale renforcée ;
- finalisation `Terminer/Finish` autorisée uniquement sur la dernière question complète et vérifiée ;
- rythme par défaut fixé à **15 minutes par activité**.

## 1. Fichiers importants

- `global-exam-assistant-v6.3.js` : base navigateur.
- `runtime-patch-v6.4.js` : compatibilité DOM v6.4.
- `runtime-hotfix-v6.4-content-loop.js` : navigation manuelle, pages passives et boucles de contenu.
- `runtime-context-v6.4.js` : mémoire du contexte d’activité et transcriptions disponibles.
- `runtime-page-audit-v6.4.js` : audit DOM global et blocage des navigations dangereuses.
- `runtime-finalize-v6.4.js` : finalisation, rythme 15 min, corrections drag/drop et dernière question.
- `runtime-quality-v6.4.js` : sélection de contexte, stratégie IA adaptative, consensus et qualité drag/drop.
- `loader.js` : charge tous les éléments précédents et ajoute les gardes de lecture, récursion DOM et ordering.
- `multi-ai-proxy.mjs` : proxy Node local vers les fournisseurs IA.
- `docker-compose.yml` / `nginx.conf` : proxy local sur `http://localhost:3000`.
- `.env.example` : exemple de clés, modèles et réglages de quota.
- `ARCHITECTURE.md` : fonctionnement interne détaillé.
- `CHANGELOG.md` : historique des corrections.

## 2. Configuration IA

Copie le fichier d’exemple puis renseigne au moins une clé :

```powershell
Copy-Item .env.example .env
notepad .env
```

Exemple avec plusieurs fournisseurs :

```env
AI_PROVIDERS=groq,gemini,mistral,openai,anthropic,openrouter
AI_FALLBACK=true
AI_SINGLE_PROVIDER_429_RETRY=true
AI_RATE_LIMIT_MAX_WAIT_MS=12000

GROQ_API_KEY=...
GEMINI_API_KEY=...
MISTRAL_API_KEY=...
```

Les clés restent uniquement dans `.env` côté Docker et ne sont jamais envoyées au Snippet.

Avec un seul fournisseur, le moteur évite les répétitions inutiles et peut attendre un `Retry-After` en cas de 429. Avec plusieurs fournisseurs, les slots utilisent autant que possible des IA différentes pour la vérification et l’arbitrage.

## 3. Démarrer Docker

```powershell
docker compose down --remove-orphans
docker compose up -d --force-recreate
```

Vérification :

```powershell
docker compose ps
Invoke-RestMethod http://localhost:3000/health
```

## 4. Charger l’assistant

Dans Chrome/Brave/Edge :

1. ouvrir Global Exam ;
2. `F12` → `Sources` → `Snippets` ;
3. créer ou ouvrir le Snippet `Auto` ;
4. y coller le contenu actuel de `loader.js` ;
5. `Ctrl+R` sur Global Exam ;
6. `Ctrl+Enter` sur le Snippet.

Puis :

```js
gs()
```

Le loader récupère automatiquement les fichiers runtime servis par Docker avec un cache-buster.

## 5. Chaîne de chargement v6.4

```text
loader.js
  -> assistant.js (base v6.3)
  -> runtime-patch-v6.4
  -> runtime-hotfix-v6.4-content-loop
  -> runtime-context-v6.4
  -> runtime-page-audit-v6.4
  -> garde récursion page-audit
  -> runtime-finalize-v6.4
  -> runtime-quality-v6.4
  -> garde faux ordering partiel
  -> lecture DOM complète obligatoire
  -> garde grammatical ordering
  -> vérification syntaxique
  -> exécution v6.4
```

Pour contrôler les couches chargées :

```js
geRuntimeVersions()
```

## 6. Rythme

Le rythme par défaut est désormais :

```text
15 min minimum
15 min maximum
```

Pour le réaffirmer :

```js
geActivityPace(15, 15)
```

Pour le désactiver :

```js
geActivityPaceOff()
```

## 7. Multi-IA adaptatif

Mode recommandé :

```js
geSetProvider("auto")
```

Voir les fournisseurs réellement configurés :

```js
geDebugAiProviders()
```

Voir le profil adaptatif courant :

```js
geAdaptiveAiProfile()
```

Avec plusieurs fournisseurs, une question complexe suit généralement :

```text
slot 0 -> analyse principale
slot 1 -> contre-vérification indépendante
slot 2 -> arbitrage si désaccord
```

Les votes supplémentaires ne sont utilisés que s’il existe réellement d’autres fournisseurs indépendants.

## 8. Lecture complète avant IA

Avant chaque analyse, le script construit un snapshot comprenant notamment :

- progression courante ;
- consigne ;
- texte visible du bloc question ;
- choix ;
- fragments d’ordering ;
- items/zones de drag/drop ;
- champs et options.

Si cette lecture est incomplète, aucune réponse n’est appliquée.

Diagnostic :

```js
geDebugQuestionReading()
```

## 9. Ordering / construction de phrases

Les ordering Global Exam sont traités par clics successifs.

La v6.4 vérifie maintenant :

- tous les fragments sont réellement lus ;
- une zone vide n’est pas prise pour un fragment déjà placé ;
- chaque fragment est utilisé exactement une fois ;
- `?` reste en dernière position pour les questions ;
- la phrase est reconstruite avant conversion en index ;
- la contre-vérification voit la phrase candidate complète, pas seulement une liste d’index ;
- l’arbitre compare les phrases reconstruites ;
- les inversions évidentes sujet/verbe dans une phrase déclarative sont rejetées avant application.

Exemple d’erreur désormais ciblée :

```text
is when a interoperability solution can be ...
```

Le terme/sujet doit être placé avant le fragment verbal :

```text
interoperability is when a solution can be ...
```

Diagnostics :

```js
geDebugOrdering()
geDebugOrderingCandidates()
geDebugOrderingCount()
geDebugOrderingGrammar()
```

## 10. Drag/drop et matching

Le script conserve maintenant le sens de chaque zone :

- label cible situé au-dessus de la zone pour les matching ;
- phrase complète autour de `[[ZONE_n]]` pour les fill-in-the-blanks ;
- normalisation des réponses 0-based/1-based et des variantes `source/target` ;
- aucune zone ne peut être considérée remplie uniquement parce qu’un wrapper parent contient du texte.

Diagnostics :

```js
geDebugDragFillState()
geDebugDragSentenceContexts()
geDebugNormalizeDrag(...)
```

## 11. Sécurité avant validation

Une réponse IA ne suffit jamais à déclencher `Valider`, `Suivant` ou `Terminer`.

L’assistant exige notamment :

- résultat structurel valide ;
- confiance ou consensus suffisant ;
- application réellement confirmée dans React/DOM ;
- aucune zone obligatoire vide ;
- aucun fragment d’ordering restant ;
- ordre final confirmé ;
- audit DOM pré-validation réussi.

En cas de doute, la page reste en place et le script bloque.

## 12. Correction / résultat

Les écrans contenant par exemple :

```text
Pas d’inquiétude !
Presque !
Bravo !
Vos réponses / Correction / Explication
```

sont traités comme des pages de correction/résultat, même si d’anciens radios, cases ou fragments restent visibles. Aucune nouvelle analyse IA n’y est lancée.

## 13. Commandes utiles

```js
gs()                         // démarrer / reprendre
gx()                         // arrêter
geAuto()                     // Auto ON/OFF
gePanel()                    // réduire / agrandir
geAnalyze()                  // analyser sans appliquer
geAnswer()                   // appliquer le dernier résultat
geUnblock()                  // lever un blocage après contrôle
geRuntimeVersions()          // versions de toutes les couches
geDebugAiProviders()         // fournisseurs configurés
geDebugQuestionReading()     // lecture envoyée aux IA
geDebugDomPage()             // audit DOM global
geDebugVerification()        // vérification de sécurité
geDebugOrderingCount()       // ordering placé/restant
geDebugOrderingGrammar()     // phrase reconstruite + problèmes locaux
geDebugDragFillState()       // état drag/drop
```

## 14. Mise à jour

Après modification de `.env` ou du proxy Node :

```powershell
docker compose down --remove-orphans
docker compose up -d --force-recreate
```

Après modification d’un fichier runtime monté par Docker, un `git pull` puis un rechargement de la page suffit souvent, mais recréer les conteneurs reste la procédure la plus sûre.

Après modification de `loader.js`, il faut aussi remplacer le contenu du Snippet `Auto` par le nouveau `loader.js`.

Toujours faire `Ctrl+R` avant de charger une nouvelle version : deux instances de l’assistant ne doivent pas coexister sur la même page.

## 15. Dépannage rapide

```js
geRuntimeVersions()
geDebugDomPage()
geDebugQuestionReading()
geDebugAiProviders()
```

Pour un ordering :

```js
geDebugOrderingCount()
geDebugOrderingGrammar()
```

Pour un drag/drop :

```js
geDebugDragFillState()
geDebugDragSentenceContexts()
```

Après vérification manuelle :

```js
geUnblock();
gs();
```

Les erreurs CORS provenant du CDN audio Global Exam sont indépendantes du proxy IA local. Un média inaccessible sans transcription n’est pas inventé par l’assistant ; les exercices entièrement textuels restent toutefois traitables lorsque toutes les informations nécessaires sont visibles dans le DOM.
