# Changelog

## v6.3

- Gestion déterministe des exercices avec un seul choix et un seul trou.
- Aucune requête IA inutile dans ce cas.
- Suppression du badge avant le clic pour ne pas modifier le texte/target React.
- Recherche des wrappers parents et activators React.
- Fallback vers le handler React direct après clic natif et pointer/mouse.
- Ajout de `geDebugButtonChoice()`.

## v6.3

- Correction des `button-choice` qui remplissent directement un trou.
- Réacquisition de la vraie puce React avant le clic.
- Fallback pointer/mouse si `.click()` n'est pas pris en compte.
- Vérification par contenu du trou, diminution des trous vides, état sélectionné ou consommation de la puce.
- Audit pré-validation renforcé pour les exercices avec un seul trou.
- Ajout de `geVersion()`.
- `loader.js` détecte plus clairement une ancienne version déjà chargée ou servie par Docker.

## v6.1

- correction de la reprise Auto après un clic manuel ;
- interruption immédiate de l'attente de rythme (30 min) lors d'une action manuelle ;
- priorité à la nouvelle page sur les anciens blocages de sécurité ;
- rafraîchissement immédiat du panneau après Valider/Suivant/Passer/Terminer.

## v6.0

- passage Groq-only -> multi-IA ;
- ajout Groq/OpenAI/Gemini/Anthropic/Mistral/OpenRouter ;
- rotation de fournisseurs pour double vérification/arbitrage ;
- fallback fournisseur ;
- panneau réductible ;
- durée cible fixe à 30 min ;
- correction ordering partiel avec remise à zéro ;
- vérification exacte des petits fragments (`in`, `on`, `the`, `?`) ;
- maintien de l'audit pré-validation ;
- accents dans l'interface, les logs et la documentation ;
- ajout `loader.js`, README et documentation d'architecture.
