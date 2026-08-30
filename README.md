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

## 7. Utilisation

Une fois Docker démarré et le Snippet chargé, lance :

```js
gs()
```

Avec `Auto : ON`, l’assistant détecte la page, lit la question complète, interroge les IA configurées, applique la réponse, vérifie le DOM puis valide et passe à la suite uniquement si tout est confirmé. Les pages de contenu et de correction sont reconnues automatiquement. En cas de doute ou de réponse non confirmée, il bloque au lieu de passer la question.

Tu peux intervenir manuellement à tout moment. Après un clic manuel sur `Valider`, `Suivant`, `Passer` ou `Terminer`, l’assistant reprend sur le nouvel état de la page.

## 8. Commandes utiles

```js
// Démarrage / contrôle
gs()                         // démarrer ou reprendre
gx()                         // arrêter
geAuto()                     // Auto ON/OFF
gePanel()                    // réduire / agrandir le panneau
geAnalyze()                  // analyser sans appliquer
geAnswer()                   // appliquer la dernière réponse
geUnblock()                  // lever un blocage après vérification manuelle

// Rythme
geActivityPace(15, 15)       // cible 15 min
geActivityPaceOff()          // désactiver le rythme
geDelay(60)                  // délai entre traitements en secondes

// IA
geSetProvider("auto")        // mode multi-IA automatique
geProviders()                // fournisseurs disponibles
geDebugAiProviders()         // fournisseurs réellement configurés
geAdaptiveAiProfile()        // profil IA courant
geSetProvider("groq")        // forcer un fournisseur
geSetProvider("gemini")
geSetProvider("mistral")
geSetProvider("openai")
geSetProvider("anthropic")
geSetProvider("openrouter")
geSetModel("nom-du-modele")  // forcer un modèle
geSetModel("auto")           // revenir au modèle automatique

// Version / diagnostic\ ngeVersion()                  // version principale
geRuntimeVersions()          // versions des patches chargés
geDebugQuestion()            // question détectée
geDebugPageState()           // état de la page
geDebugDomPage()             // audit DOM
geDebugQuestionReading()     // ce qui est réellement lu avant IA
geDebugRelevantContext()     // contexte envoyé aux IA

// Ordering
geDebugOrdering()
geDebugOrderingCandidates()
geDebugOrderingCount()
geDebugOrderingGrammar()

// Drag/drop
geDebugDrag()
geDebugDragFillState()
geDebugDragSentenceContexts()
```

## 9. Mise à jour et dépannage

Pour mettre à jour :

```powershell
git pull
```

Si `.env`, Docker, Nginx ou le proxy a changé :

```powershell
docker compose down --remove-orphans
docker compose up -d --force-recreate
```

Si `loader.js` a changé, remplace aussi son contenu dans le Snippet `Auto`, puis fais toujours :

```text
Ctrl+R
Ctrl+Enter sur Auto
```

Si le script bloque :

```js
geDebugQuestion()
geDebugDomPage()
geDebugQuestionReading()
```

Puis, après vérification ou correction manuelle :

```js
geUnblock();
gs();
```

Pour les détails techniques et l’historique des correctifs, voir `ARCHITECTURE.md` et `CHANGELOG.md`.
