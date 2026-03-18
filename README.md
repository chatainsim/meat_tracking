# 🥩 Cave d'Affinage — Application Web

Suivi de maturation et séchage de charcuterie maison : pesées, courbes de séchage, alertes cave, recettes d'assaisonnement.

## Fonctionnalités

| Module | Détail |
|---|---|
| **Tableau de bord** | KPIs (pièces actives, prêtes, trop sèches, poids cave), alertes capteurs, prochaines pesées, grille "prêt à déguster" |
| **Suivi des pièces** | Tri (statut, date, progression, ETA, type) · Filtres (type, statut) · Groupement automatique |
| **Pesée rapide** | Bouton `+` sur chaque carte, sans quitter la liste |
| **Tournée de cave** | Mode plein écran mobile : une pièce à la fois, triée par date de dernière pesée, avance automatique |
| **Courbe de séchage** | Graphique Chart.js par pièce avec barres de vitesse (%/jour), points colorés selon le rythme, info-strip ETA |
| **ETA vélocimétrique** | Date de fin estimée calculée sur la vitesse des 3 derniers intervalles (pas la durée cible) |
| **Prix au kg** | Calculé automatiquement à partir du poids actuel / objectif ; affiché sur la carte et dans le détail |
| **Recettes** | Mélanges d'assaisonnement (sel%, sucre%, épices, notes) liés à un type de viande, réutilisables, exportables/importables JSON |
| **Capteurs** | Température & humidité en temps réel via Home Assistant, historique 30 jours, alertes Telegram |
| **Étiquettes QR** | Génération et impression d'étiquettes suivi + étiquette finale |
| **Notifications Telegram** | Rappels de pesée, alertes hors-seuil, rapports périodiques (quotidien/hebdo/mensuel) |
| **Sauvegarde GitHub** | Export JSON manuel ou automatique (heure configurable), historique dans un dépôt Git |
| **Validation API** | Schémas Pydantic v2 sur toutes les routes mutantes — erreurs 422 avec détail par champ |
| **PWA** | Installable sur mobile/desktop, Service Worker, icônes |
| **Thème** | Clair / sombre |

---

## Stack technique

- **Backend** : Python 3 · Flask ≥ 3.0 · Gunicorn · Pydantic v2
- **Base de données** : SQLite3 — fichier `data/cave.db` (WAL mode)
- **Frontend** : HTML/CSS/JS vanilla · Chart.js 4.4 · QRCode.js · jsQR

---

## Installation sur Debian/Ubuntu

### 1. Prérequis

```bash
sudo apt-get update
sudo apt-get install -y python3 python3-pip python3-venv

python3 --version
pip3 --version
```

### 2. Déploiement de l'application

```bash
# Créer un utilisateur dédié (recommandé)
sudo useradd -r -s /bin/false cave

# Copier les fichiers
sudo mkdir -p /opt/cave-affinage
sudo cp -r . /opt/cave-affinage/
sudo chown -R cave:cave /opt/cave-affinage

# Installer les dépendances
cd /opt/cave-affinage
sudo -u cave python3 -m venv venv
sudo -u cave ./venv/bin/pip install -r requirements.txt

# Créer le dossier data
sudo mkdir -p /opt/cave-affinage/data
sudo chown cave:cave /opt/cave-affinage/data
```

### 3. Service systemd (démarrage automatique)

```bash
sudo cp cave-affinage.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable cave-affinage
sudo systemctl start cave-affinage
sudo systemctl status cave-affinage
```

L'application tourne sur **http://0.0.0.0:3000** (port configurable dans Paramètres → Réseau).

### 4. Nginx en reverse proxy (optionnel)

```bash
sudo apt-get install -y nginx
sudo nano /etc/nginx/sites-available/cave-affinage
```

```nginx
server {
    listen 80;
    server_name cave.mondomaine.fr;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/cave-affinage /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 5. HTTPS avec Let's Encrypt (optionnel)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d cave.mondomaine.fr
```

---

## Commandes utiles

```bash
# Logs en temps réel
sudo journalctl -u cave-affinage -f

# Redémarrer après mise à jour
sudo systemctl restart cave-affinage

# Base de données
ls -lh /opt/cave-affinage/data/cave.db
```

---

## Sauvegarde

### Manuelle

```bash
# Copie du fichier SQLite
cp /opt/cave-affinage/data/cave.db /backup/cave-$(date +%Y%m%d).db

# Export JSON via l'API
curl http://localhost:3000/api/meats/export/all > /backup/cave-$(date +%Y%m%d).json
```

### GitHub (intégré)

Depuis **Paramètres → GitHub Sync** : renseignez un Personal Access Token, le dépôt (`owner/repo`) et le chemin du fichier. Activez la sauvegarde automatique pour déclencher un push une fois par jour à l'heure configurée (le serveur doit être actif à cette heure).

---

## Intégrations

### Home Assistant

Envoyez les relevés température/humidité de votre cave vers l'application :

```yaml
# configuration.yaml
rest_command:
  update_cave_sensors:
    url: "http://IP_SERVEUR:3000/api/sensors"
    method: post
    content_type: "application/json"
    payload: '{"temperature": {{ states("sensor.votre_temp") }}, "humidity": {{ states("sensor.votre_hum") }}}'
```

```yaml
# automations.yaml
- alias: "Envoi capteurs → Cave d'Affinage"
  trigger:
    - platform: time_pattern
      minutes: "/15"
  action:
    - service: rest_command.update_cave_sensors
```

### Homepage

Widget avec 4 métriques live via `/api/homepage` :

```yaml
# services.yaml
- Cave d'Affinage:
    widget:
      type: customapi
      url: http://IP_SERVEUR:3000/api/homepage
      mappings:
        - field: en_cours
          label: En cours
          format: number
        - field: pretes
          label: Prêtes
          format: number
        - field: temperature
          label: Température
          format: float
          suffix: "°C"
        - field: humidity
          label: Humidité
          format: float
          suffix: "%"
```

Les snippets avec l'URL auto-détectée sont également disponibles dans **Paramètres → Homepage**.

---

## Structure du projet

```
cave-affinage/
├── app.py                 # Application Flask et routes API
├── database.py            # Accès SQLite, initialisation et migrations
├── schemas.py             # Schémas de validation Pydantic v2
├── requirements.txt       # Dépendances Python
├── cave-affinage.service  # Unité systemd
├── data/
│   └── cave.db            # Base SQLite (créée au premier démarrage)
└── public/
    ├── index.html         # Application frontend (SPA)
    ├── css/style.css      # Feuille de style
    ├── js/app.js          # Logique frontend
    ├── manifest.json      # Manifest PWA
    └── sw.js              # Service Worker
```

---

## API REST

### Pièces

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/meats` | Liste toutes les pièces avec leurs pesées |
| POST | `/api/meats` | Créer une pièce |
| GET | `/api/meats/:id` | Détail d'une pièce |
| PUT | `/api/meats/:id` | Modifier une pièce |
| DELETE | `/api/meats/:id` | Supprimer une pièce |
| POST | `/api/meats/:id/weights` | Ajouter une pesée |
| PUT | `/api/meats/:id/weights/:eid` | Modifier une pesée |
| DELETE | `/api/meats/:id/weights/:eid` | Supprimer une pesée |
| GET | `/api/meats/export/all` | Export JSON complet (sauvegarde) |
| POST | `/api/meats/import/all` | Import JSON (restauration) |

### Types & recettes

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/types` | Liste des types de viande (icônes, labels, durées, pertes cibles) |
| GET | `/api/recipes` | Liste toutes les recettes d'assaisonnement |
| POST | `/api/recipes` | Créer une recette |
| PUT | `/api/recipes/:id` | Modifier une recette |
| DELETE | `/api/recipes/:id` | Supprimer une recette |

### Capteurs

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/sensors` | Lecture courante + paramètres de seuils |
| POST | `/api/sensors` | Mettre à jour température & humidité (appelé par HA) |
| GET | `/api/sensors/settings` | Seuils d'alerte |
| PUT | `/api/sensors/settings` | Modifier les seuils |
| GET | `/api/sensors/history` | Historique (param `?days=7`) |

### Paramètres & intégrations

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/settings` | Paramètres de l'application (nom producteur) |
| PUT | `/api/settings` | Modifier les paramètres |
| GET | `/api/config` | Configuration réseau (port, HTTPS) |
| PUT | `/api/config` | Modifier la configuration réseau |
| GET | `/api/github/settings` | Configuration GitHub Sync |
| PUT | `/api/github/settings` | Modifier (token, dépôt, sauvegarde auto) |
| POST | `/api/github/backup` | Déclencher une sauvegarde immédiate |
| GET | `/api/telegram/settings` | Configuration Telegram |
| PUT | `/api/telegram/settings` | Modifier (token, chat_id, fréquence) |
| POST | `/api/telegram/check` | Forcer la vérification des rappels de pesée |
| POST | `/api/telegram/report` | Envoyer un rapport d'état immédiat |
| GET | `/api/homepage` | Métriques pour le widget Homepage |
| GET | `/api/health` | Healthcheck (`{"status":"ok"}`) |

### Format des erreurs de validation (422)

```json
{
  "error": "Validation échouée",
  "details": [
    { "field": "initialWeight", "msg": "Input should be greater than 0" },
    { "field": "startDate",     "msg": "format invalide — attendu YYYY-MM-DD" }
  ]
}
```
