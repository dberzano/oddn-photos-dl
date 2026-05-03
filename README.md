# oddn-photos-dl
Download photos from ondonnedesnouvelles.com or toutemonannee.com

## Configuration

La variable cookie correspond au remember_web_* qui est envoyé à chaque requête après la connexion.

![token](docs/token.png)

L'id du séjour est trouvable ici :

![id](docs/id.png)

Le base_url correspond à soit https://www.ondonnedesnouvelles.com ou https://www.toutemonannee.com

## Structure des fichiers téléchargés

Les téléchargements sont enregistrés dans `./data/` avec la structure suivante :

```
data/
├── 2025-09-06 21-45 Titre du post/
│   ├── id.txt              # ID du post (utilisé pour la reprise)
│   ├── message.txt         # Contenu texte du post
│   ├── 01.jpg              # Images et vidéos (numérotation zéro-remplie)
│   ├── 02.jpg
│   ├── ...
│   ├── 22.mp4
│   └── misc/               # Créé uniquement si nécessaire
│       ├── youtube_01.txt  # Liens YouTube
│       └── 01.pdf          # Autres types de fichiers non reconnus
├── 2025-12-20 19-49 Autre post/
│   └── ...
└── INPROGRESS 2025-12-20 19-49 Post incomplet/
    └── ...                 # Téléchargements incomplets (supprimés au prochain lancement)
```

- Les noms de dossiers utilisent la date du post : `AAAA-MM-JJ HH-MM Titre`
- Les images et vidéos sont numérotées séquentiellement à la racine du dossier
- Les horodatages des fichiers correspondent à la date d'activité du post
- Les téléchargements incomplets sont préfixés par `INPROGRESS` et supprimés au prochain lancement
- Les posts déjà téléchargés (identifiés par `id.txt`) sont ignorés lors d'une reprise
