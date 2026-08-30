# Global Exam Assistant v6.4 — Multi-IA

Assistant navigateur pour analyser les exercices Global Exam, appliquer les réponses dans le DOM, vérifier que l’interaction a réellement été enregistrée, puis seulement autoriser la validation ou la navigation.

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

## 7. Utilisation au quotidien

Une fois Docker démarré et le Snippet chargé, lance simplement :

```js
gs()
```

L’assistant fonctionne ensuite automatiquement tant que `Auto : ON`.

Pour chaque page, il :

1. attend que le DOM soit stable ;
2. détecte s’il s’agit d’une question, d’une page de contenu ou d’une correction ;
3. lit l’énoncé et tous les éléments utiles visibles dans le DOM ;
4. interroge l’IA et, lorsque nécessaire, effectue une contre-vérification ou un arbitrage avec d’autres fournisseurs configurés ;
5. applique la réponse dans la page ;
6. vérifie que Global Exam a réellement enregistré l’interaction ;
7. respecte le rythme configuré ;
8. valide puis passe à la suite uniquement lorsque l’état de la page est sûr.

Sur une page de correction ou de résultat, aucune nouvelle analyse IA n’est lancée. L’assistant attend l’état approprié puis continue.

Tu peux intervenir manuellement à tout moment. Avec `Auto : ON`, un clic manuel sur `Valider`, `Suivant`, `Passer` ou `Terminer` est détecté et l’assistant reprend ensuite sur le nouvel état de la page.

En cas de doute, de réponse incomplète ou d’interaction non confirmée, l’assistant bloque la navigation au lieu de passer la question.

## 8. Types d’exercices gérés

Le script prend notamment en charge :

- choix unique et choix multiples ;
- boutons cliquables ;
- champs texte et plusieurs champs ;
- listes/selects ;
- drag/drop et matching ;
- ordering / construction de phrases ;
- matrices ;
- pages de contenu ;
- pages de correction/résultat.

Les ordering sont construits dans l’ordre des clics. La phrase complète est relue avant application et chaque fragment doit être utilisé exactement une fois.

Les exercices drag/drop sont vérifiés zone par zone afin d’éviter qu’une zone vide soit considérée comme remplie uniquement à cause du texte présent autour d’elle.

## 9. Commandes utiles

### Démarrer, arrêter et contrôler l’assistant

```js
gs()                         // démarrer ou reprendre
gx()                         // arrêter
geAuto()                     // activer / désactiver Auto
gePanel()                    // réduire / agrandir le panneau
geAnalyze()                  // analyser la question sans appliquer
geAnswer()                   // appliquer la dernière réponse calculée
geUnblock()                  // lever un blocage après contrôle manuel
```

### Rythme

```js
geActivityPace(15, 15)       // fixer la cible à 15 min
geActivityPaceOff()          // désactiver le rythme
geDelay(60)                  // modifier le délai entre traitements, en secondes
```

### IA / fournisseurs

```js
geSetProvider("auto")        // mode multi-IA automatique
geProviders()                // afficher les fournisseurs disponibles
geDebugAiProviders()         // afficher les fournisseurs réellement configurés
geAdaptiveAiProfile()        // afficher le profil IA adaptatif courant

geSetProvider("groq")
geSetProvider("openai")
geSetProvider("gemini")
geSetProvider("anthropic")
geSetProvider("mistral")
geSetProvider("openrouter")

geSetModel("nom-du-modele")  // forcer un modèle pour le fournisseur sélectionné
```

Pour revenir au fonctionnement normal après avoir forcé un fournisseur ou un modèle :

```js
geSetProvider("auto")
geSetModel("auto")
```

### Vérifier la version chargée

```js
geVersion()                  // version principale, attendu : 6.4
geRuntimeVersions()          // versions des patches et gardes chargés
```

### Diagnostic général

```js
geDebugQuestion()            // question et type détectés
geDebugPageState()           // état question / correction / contenu
geDebugDomPage()             // audit complet du DOM
geDebugVerification()        // vérification de sécurité avant validation
geDebugQuestionReading()     // données de la question réellement lues
geDebugRelevantContext()     // contexte d’activité retenu pour la question
```

### Diagnostic ordering / construction de phrases

```js
geDebugOrdering()            // diagnostic général ordering
geDebugOrderingCandidates()  // fragments détectés
geDebugOrderingCount()       // fragments placés / restants
geDebugOrderingGrammar()     // phrase reconstruite et problèmes détectés
```

### Diagnostic drag/drop

```js
geDebugDrag()                // diagnostic drag/drop général
geDebugDragFillState()       // état des zones et éléments restants
geDebugDragSentenceContexts()// contexte lu autour de chaque zone
```

## 10. Mise à jour

Pour récupérer les dernières modifications :

```powershell
git pull
```

Si le proxy, `.env`, Nginx, Docker ou un fichier runtime servi par les conteneurs a changé, recrée les conteneurs :

```powershell
docker compose down --remove-orphans
docker compose up -d --force-recreate
```

Si seul `loader.js` a changé, remplace son contenu dans le Snippet `Auto`. Un redémarrage Docker n’est pas nécessaire pour une modification uniquement dans le loader.

Après toute mise à jour du script :

```text
Ctrl+R sur Global Exam
Ctrl+Enter sur le Snippet Auto
```

Puis vérifie :

```js
geRuntimeVersions()
```

## 11. Dépannage rapide

Si le proxy ne démarre pas :

```powershell
docker compose logs ai-proxy --tail 100
```

Vérifie également qu’au moins une clé API est renseignée dans `.env`.

Si l’assistant se bloque sur une page :

```js
geDebugQuestion()
geDebugPageState()
geDebugDomPage()
geDebugQuestionReading()
```

Pour un ordering :

```js
geDebugOrdering()
geDebugOrderingCandidates()
geDebugOrderingCount()
geDebugOrderingGrammar()
```

Pour un drag/drop :

```js
geDebugDrag()
geDebugDragFillState()
geDebugDragSentenceContexts()
```

Après avoir corrigé ou vérifié manuellement la page :

```js
geUnblock()
gs()
```

Si une ancienne version semble encore chargée, fais `Ctrl+R`, relance le Snippet puis vérifie :

```js
geVersion()
geRuntimeVersions()
```

Les erreurs CORS provenant du lecteur audio/CDN Global Exam sont indépendantes du proxy IA local. Si aucun transcript n’est disponible, l’assistant ne doit pas inventer le contenu audio.

Pour les détails techniques et l’historique des corrections, consulte `ARCHITECTURE.md` et `CHANGELOG.md`.