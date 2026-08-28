# Global Exam Assistant v6.3 — Multi-IA

Assistant navigateur pour analyser les exercices Global Exam, appliquer les réponses dans le DOM, vérifier que l'interaction a réellement fonctionné, puis seulement autoriser la validation/navigation.

## Nouveautés principales

- proxy **multi-IA** : Groq, OpenAI, Gemini, Anthropic Claude, Mistral et OpenRouter ;
- les exercices complexes peuvent être contrôlés par plusieurs fournisseurs différents (slots 0/1/2) ;
- fallback automatique vers une autre IA si un fournisseur configuré échoue ;
- fenêtre de l'assistant **réductible** avec le bouton `−` / `+` ou `gePanel()` ;
- correction de l'ordering partiellement rempli : l'ordre est remis à zéro avant une nouvelle analyse au lieu de continuer une phrase potentiellement fausse ;
- vérification plus stricte des petits fragments comme `in`, `the`, `?` (pas de faux positif par simple sous-chaîne) ;
- objectif de durée **30 minutes par activité par défaut** ;
- clic manuel sur Valider / Suivant / Passer / Terminer : le mode Auto reprend ensuite ;
- textes, logs et interface utilisateur en français avec accents.

## 1. Contenu du dossier

- `global-exam-assistant-v6.3.js` : assistant injecté dans la page Global Exam.
- `loader.js` : petit chargeur à conserver dans un Snippet DevTools pour éviter de recoller le gros script.
- `multi-ai-proxy.mjs` : proxy Node local qui garde les clés secrètes et route les requêtes vers les IA.
- `docker-compose.yml` : lance le proxy Node et Nginx.
- `nginx.conf` : CORS, reverse proxy et exposition locale de `/assistant.js`.
- `.env.example` : exemple de configuration des clés et modèles.
- `ARCHITECTURE.md` : explication globale du fonctionnement et des responsabilités de chaque fichier.

## 2. Pré-requis

- Docker Desktop démarré.
- Chrome / Brave / Edge avec DevTools.
- Au moins **une** clé API parmi les fournisseurs pris en charge.

Le navigateur ne reçoit jamais les clés. Elles restent dans `.env`, côté Docker.

## 3. Configuration des clés

Dans PowerShell, depuis le dossier extrait :

```powershell
Copy-Item .env.example .env
notepad .env
```

Renseigne au moins une clé :

```env
GROQ_API_KEY=gsk_...
```

ou par exemple :

```env
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...
MISTRAL_API_KEY=...
OPENROUTER_API_KEY=...
```

Tu peux laisser les autres lignes vides.

L'ordre du mode automatique est configurable :

```env
AI_PROVIDERS=groq,openai,gemini,anthropic,mistral,openrouter
AI_FALLBACK=true
```

Si trois clés sont disponibles, un exercice complexe peut par exemple faire :

```text
Analyse A     -> Groq
Analyse B     -> OpenAI
Arbitrage     -> Gemini
```

Avec seulement une clé, le système continue de fonctionner avec ce seul fournisseur.

## 4. Démarrer le proxy

```powershell
docker compose down --remove-orphans
docker compose up -d --force-recreate
```

Vérification :

```powershell
docker compose ps
Invoke-RestMethod http://localhost:3000/health
```

`/health` indique les fournisseurs configurés sans afficher les clés.

## 5. Charger le script sans coller 190 Ko dans la console

### Méthode recommandée : Snippet DevTools très court

1. Ouvre Global Exam.
2. `F12` -> `Sources` -> `Snippets`.
3. Crée un snippet nommé par exemple `global-exam-loader`.
4. Colle **une seule fois** le contenu de `loader.js`.
5. `Ctrl+S`.
6. À chaque `Ctrl+R` de Global Exam, lance ce snippet avec `Ctrl+Enter`.

Le chargeur récupère automatiquement :

```text
http://localhost:3000/assistant.js
```

Le fichier servi est celui présent dans ce dossier Docker.

### Alternative : script complet dans un Snippet

Tu peux aussi enregistrer directement `global-exam-assistant-v6.3.js` dans un Snippet, mais `loader.js` est beaucoup plus pratique pour les mises à jour.

## 6. Démarrer l'automatisation

Après chargement :

```js
gs()
```

Le rythme est déjà configuré pour viser **30 minutes** par activité.

Pour le réaffirmer :

```js
geActivityPace(30, 30)
```

## 7. Réduire la fenêtre de l'assistant

Clique sur `−` en haut à droite du panneau.

Pour la rouvrir, clique sur `+`.

Ou depuis la console :

```js
gePanel()
```

La réduction ne coupe pas l'automatisation.

## 8. Choisir l'IA

Mode recommandé :

```js
geSetProvider("auto")
```

Voir les fournisseurs disponibles :

```js
geProviders()
```

Forcer un fournisseur :

```js
geSetProvider("groq")
geSetProvider("openai")
geSetProvider("gemini")
geSetProvider("anthropic")
geSetProvider("mistral")
geSetProvider("openrouter")
```

Pour revenir au multi-IA :

```js
geSetProvider("auto")
```

Un modèle spécifique peut être imposé :

```js
geSetProvider("openai")
geSetModel("gpt-5-mini")
```

Quand tu reviens sur `auto`, le proxy reprend les modèles définis dans `.env`.

## 9. Commandes utiles

```js
gs()                         // démarrer / reprendre
gx()                         // arrêter
gePanel()                    // réduire / agrandir le panneau
geAuto()                     // activer/désactiver Auto
geAnalyze()                  // analyser seulement
geAnswer()                   // appliquer la réponse calculée
geUnblock()                  // lever un blocage après contrôle manuel
geActivityPace(30, 30)       // objectif 30 min
geProviders()                // fournisseurs IA configurés
geSetProvider("auto")        // multi-IA
geDebugQuestion()            // détection courante
geDebugOrdering()            // diagnostic ordering
geDebugOrderingCount()       // nombre placé/restant
geDebugPageState()           // état de la page
geDebugDrag()                // diagnostic placement
```

## 10. Sécurité avant validation

Le script ne doit pas cliquer sur `Valider`, `Suivant` ou `Terminer` simplement parce qu'une IA a répondu.

Il exige notamment :

- application confirmée dans le DOM ;
- aucune zone de placement encore vide ;
- aucun fragment d'ordering restant ;
- ordre final vérifié ;
- sélection exacte pour les QCM ;
- champs texte/select remplis ;
- résultat structurel valide ;
- confiance/consensus suffisant ;
- audit pré-validation réussi.

En cas de doute, il bloque la navigation.

## 11. Correction spécifique de l'ordering

Un ordering est dépendant de l'ordre complet. Si un clic échoue après plusieurs fragments, conserver les premiers fragments peut rendre toute la phrase fausse.

v6.3 fait donc :

```text
ordering partiel
      -> tentative de remise à zéro confirmée
      -> redétection de TOUS les fragments
      -> nouvelle analyse complète
      -> application complète
      -> audit
      -> validation
```

Les mots très courts (`in`, `on`, `the`, etc.) sont recherchés avec des limites de mots. `in` ne peut donc plus être considéré comme présent uniquement parce qu'il apparaît à l'intérieur de `protecting`.

## 12. Clics manuels

Tant que `Auto : ON`, tu peux intervenir manuellement.

Si tu cliques sur :

- Valider / Confirmer / Soumettre ;
- Suivant / Continuer ;
- Passer ;
- Terminer ;

le script observe le nouvel état puis reprend automatiquement.

## 13. Mise à jour du script

Remplace simplement `global-exam-assistant-v6.3.js` dans le dossier puis :

```powershell
docker compose restart cors-proxy
```

Avec `loader.js`, aucun gros copier-coller n'est nécessaire.

Après une nouvelle version du script, fais toujours `Ctrl+R` sur Global Exam avant de la charger, car une protection empêche deux versions de l'assistant de coexister sur la même page.

## 14. Dépannage

### Le proxy ne démarre pas

```powershell
docker compose logs ai-proxy --tail 100
```

Vérifie qu'au moins une clé est renseignée dans `.env`.

### L'assistant affiche un blocage

```js
geDebugQuestion()
geDebugPageState()
```

Pour un ordering :

```js
geDebugOrdering()
geDebugOrderingCount()
```

Après correction manuelle :

```js
geUnblock()
gs()
```

### Erreurs CORS du lecteur audio Global Exam

Les erreurs provenant du CDN audio Global Exam sont indépendantes du proxy IA local. Si le texte/transcript audio n'existe pas dans le DOM, l'assistant ne doit pas prétendre connaître le contenu audio inaccessible.


## Reprise automatique après une action manuelle

En mode `Auto : ON`, un clic manuel sur **Valider**, **Confirmer**, **Soumettre**, **Suivant**, **Passer** ou **Terminer** interrompt immédiatement une éventuelle attente de rythme et force le script à analyser le nouvel état de la page.

La v6.3 corrige notamment le cas où le script restait `running=true` dans l'attente des 30 minutes et ne reprenait pas après une navigation manuelle.


## Vérifier que la bonne version est chargée

Après avoir exécuté `loader.js`, tape :

```js
geVersion()
```

Résultat attendu :

```text
6.2
```

Si le panneau affiche encore `v6.0` ou `v6.1`, l'ancienne version est toujours présente dans la page. Fais obligatoirement :

1. `Ctrl+R` sur Global Exam ;
2. vérifie que Docker a été relancé depuis le dossier `global-exam-assistant-v6.3` ;
3. relance le Snippet `loader.js`.

Le loader v6.3 affiche également un avertissement si le serveur local fournit encore une ancienne version.

## Correction v6.3 — choix cliquable qui remplit un trou

Les exercices du type **"Fill in the blank with a phrase..."** peuvent être rendus comme des `button-choice`.
Le script :

- recherche à nouveau la vraie puce React à partir de son texte ;
- essaie la surface cliquable la plus précise ;
- possède un fallback `pointer/mouse` ;
- confirme le clic si la réponse apparaît dans le trou, si le nombre de trous vides diminue, si la puce est consommée ou si un état `selected/pressed` est activé ;
- interdit `Valider` tant qu'un trou visible de ce type reste vide, même s'il n'y a qu'un seul trou.


## v6.3 — Un seul choix pour un seul trou

Exemple :

```text
Fill in the blank with a phrase that means: "free"
... connect to an [____] wireless network.
Choix disponible : open
```

Quand il n'existe réellement qu'une seule puce visible et un seul trou vide :

- aucune requête IA n'est envoyée ;
- la réponse est déterministe (`choice: 0`, confiance 100 %) ;
- le script recherche le vrai wrapper React cliquable ;
- il essaie clic natif, pointer/mouse puis handler React direct ;
- il vérifie ensuite que le trou a été rempli ou que la puce a été consommée.

Commande de diagnostic :

```js
geDebugButtonChoice()
```
