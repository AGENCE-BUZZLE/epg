# Guide TV ouvert

Guide des programmes TV gratuit, fusionné à partir de plusieurs sources ouvertes, regénéré toutes les 3 heures par
GitHub Actions et publié en fichiers statiques dans la branche `data` de ce dépôt. Aucun serveur, aucun abonnement.

Adresse de base : `https://raw.githubusercontent.com/AGENCE-BUZZLE/epg/data/` (par exemple
`…/data/fr/now.json`). La branche `data` ne garde que la dernière génération (un seul commit, remplacé à chaque fois).
Le tableau de bord est `index.html` de cette branche.

## Ce que fait la génération

1. Télécharge toutes les sources du pays (`src/sources.mjs`) et **écarte celles qui sont périmées** (un fichier qui
   ne va pas au-delà du lendemain soir, comme EPG.lat France en novembre 2026).
2. **Relie les chaînes** entre sources (« TF1 HD », `TF1.fr`, « tf1 » sont la même chaîne : `chanKey` dans
   `src/merge.mjs`).
3. **Fusionne** chaîne par chaîne : la source qui couvre le mieux les 48 h à venir sert de base, les autres comblent
   les trous et complètent les champs manquants (image, description, épisode). Une source décalée d'un nombre
   d'heures entier sur une chaîne (erreur de fuseau ou de changement d'heure) est mise de côté pour cette chaîne.
4. **Sport** : récupère les matchs (ESPN pour le foot européen, NBA, NFL, NHL, MLB ; Jolpica pour la F1), puis les
   **croise avec le guide**. Une chaîne n'est « confirmée » que si elle a vraiment le match au programme à cette heure-là :
   les diffuseurs annoncés par ESPN (souvent américains, « Paramount+ ») restent à part, marqués non vérifiés.
   Les retransmissions que seul le guide connaît (rugby, handball, tennis, cyclisme…) sont ajoutées et regroupées
   quand plusieurs chaînes ont le même match. Les rediffusions sont rattachées au match d'origine.
5. Publie les fichiers ci-dessous. Si le guide est anormalement petit (sources en panne), rien n'est publié et la
   version précédente reste en ligne.

## Fichiers publiés

Toutes les heures sont en **millisecondes UTC** : l'app les affiche à l'heure de l'appareil (`Intl.DateTimeFormat`).
L'en-tête HTTP `Date` des réponses permet de corriger une horloge d'appareil fausse.

| Fichier | Contenu |
|---|---|
| `index.json` | Date de génération, chiffres par pays, liste des fichiers |
| `fr/channels.json` | Chaînes : `id`, `name`, `names` (tous les noms vus), `logo`, `file`, `sources`, `sport` |
| `fr/aliases.json` | Nom de chaîne normalisé → `id` (pour relier les chaînes d'un fournisseur) |
| `fr/now.json` | Pour chaque chaîne, les programmes de l'heure passée aux 9 prochaines heures (version courte) |
| `fr/ch/<id>.json` | Tous les programmes d'une chaîne (environ 10 jours) |
| `fr/xmltv.xml.gz` | Le guide fusionné au format XMLTV (Kodi, TiviMate, Plex…) |
| `sport/events.json` | Matchs en cours et à venir, avec les chaînes qui les diffusent vraiment |
| `report.json` | État de chaque source, décalages détectés, chiffres du sport |

Programme : `s` début, `e` fin, `t` titre, `st` sous-titre, `d` description, `i` image, `c` catégories,
`ep` `{ season, episode }`, `r` classification, `rerun` rediffusion, `src` source retenue, `n` nombre de sources d'accord.

Événement sportif : `sport`, `competition`, `name`, `start`, `home` / `away` (nom, logo, score), `tv` (chaînes
trouvées dans le guide, `niveau` = `confirmé` si les deux équipes sont dans le titre, `probable` si seulement dans la
description), `rediffusions`, `announced` (diffuseurs annoncés par ESPN, `dansLeGuide` vrai seulement si confirmé).

## Sources (France)

| Source | Licence ou conditions |
|---|---|
| xmltvfr.fr (projet open source racacax/XML-TV-Fr) | à vérifier |
| epgshare01.online (France, beIN) | « usage légal seulement » |
| i.mjh.nz (Samsung TV Plus, Pluto TV, Plex) | gratuit |
| epg.lat | écartée automatiquement quand périmée |
| ESPN (API publique du site), Jolpica (F1) | gratuit, sans clé |

Ajouter une source : une ligne dans `src/sources.mjs`. Ajouter un pays : une nouvelle clé dans `SOURCES`.

## Développement

```bash
node --test test/*.test.mjs
node src/build.mjs --out dist
```

Node 20 ou plus, aucune dépendance.
