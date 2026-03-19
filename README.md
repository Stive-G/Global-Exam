# Global Exam Pager

Script JavaScript a coller dans la console du navigateur sur une page Global Exam.

Il automatise une sequence simple :

- il cherche un bouton du type `Suivant`, `Terminer`, `Next` ou `Continuer`
- il clique dessus si le bouton est visible et actif
- il attend 1 minute entre deux clics `Next`
- il boucle jusqu'a voir un bouton du type `Passer a la suite` ou `Skip`
- il clique sur `Passer`
- il recommence un nouveau cycle

## Usage

1. Ouvrir la page Global Exam cible dans le navigateur.
2. Ouvrir la console developpeur (`F12` ou `Ctrl+Shift+I`).
3. Si Chrome bloque le collage, taper d'abord `allow pasting` dans la console puis appuyer sur `Entree`.
4. Coller le contenu de `Script.js` dans la console.
5. Appuyer sur `Entree`.

Le script affiche ensuite son aide et demarre automatiquement.

## Commandes disponibles

Une fois le script colle dans la console, plusieurs commandes sont exposees :

- `geStart()` : demarre la boucle si elle n'est pas deja lancee
- `geStop()` : demande l'arret propre du script
- `geStatus()` : affiche l'etat courant dans la console
- `geHelp()` : reaffiche l'aide
- `geDelay(30)` : change le delai principal a 30 secondes

Alias courts :

- `gs()` : start
- `gx()` : stop
- `gi()` : status
- `gh()` : help
- `gd(30)` : delay

## Ce que le script fait en detail

- normalise les textes des boutons pour mieux gerer les accents et les variantes
- ignore les elements invisibles
- ne clique pas sur les boutons desactives
- attend un changement du DOM avant de retenter quand aucun bouton n'est trouvable
- evite de lancer une deuxieme instance si le script est deja charge
- garde un petit etat interne visible avec `geStatus()`
- permet de modifier le delai principal a chaud avec `geDelay(...)`

## Arret du script

Le moyen recommande est :

```js
geStop()
```

Ou en version courte :

```js
gx()
```

L'arret est maintenant reactif, y compris pendant l'attente entre deux clics.

## Limites

- le script depend du DOM de la page Global Exam et peut cesser de fonctionner si les libelles ou la structure changent
- il doit etre execute dans la console du navigateur, pas avec `node`
- il repose sur des correspondances textuelles simples, donc il peut rater certains cas specifiques

## Fichier principal

- `Script.js`
