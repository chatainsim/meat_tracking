# 🥩 Cave d'Affinage — Application Web

Suivi de maturation et séchage de charcuterie, avec stockage persistant SQLite.

## Stack technique

- **Backend** : Python + Flask
- **Base de données** : SQLite3 — fichier `data/cave.db`
- **Frontend** : HTML/CSS/JS vanilla, Chart.js, QRCode.js

---

## Installation sur Debian/Ubuntu

### 1. Prérequis

```bash
# Python 3, pip et venv
sudo apt-get update
sudo apt-get install -y python3 python3-pip python3-venv

# Vérifier
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

# Installer les dépendances (Python venv)
cd /opt/cave-affinage
sudo -u cave python3 -m venv venv
sudo -u cave ./venv/bin/pip install -r requirements.txt

# Créer le dossier data avec les bonnes permissions
sudo mkdir -p /opt/cave-affinage/data
sudo chown cave:cave /opt/cave-affinage/data
```

### 3. Service systemd (démarrage automatique)

```bash
# Copier le fichier service
sudo cp cave-affinage.service /etc/systemd/system/

# Activer et démarrer
sudo systemctl daemon-reload
sudo systemctl enable cave-affinage
sudo systemctl start cave-affinage

# Vérifier le statut
sudo systemctl status cave-affinage
```

L'application tourne sur **http://0.0.0.0:3000**.

### 4. Nginx en reverse proxy (optionnel, pour exposer sur le port 80/443)

```bash
sudo apt-get install -y nginx

sudo nano /etc/nginx/sites-available/cave-affinage
```

Contenu du fichier nginx :

```nginx
server {
    listen 80;
    server_name cave.mondomaine.fr;  # ou l'IP de la VM

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
# Voir les logs en temps réel
sudo journalctl -u cave-affinage -f

# Redémarrer après mise à jour
sudo systemctl restart cave-affinage

# Localisation de la base de données
ls -lh /opt/cave-affinage/data/cave.db
```

## Sauvegarde de la base de données

```bash
# Copie simple du fichier SQLite
cp /opt/cave-affinage/data/cave.db /backup/cave-$(date +%Y%m%d).db

# Ou utiliser l'export JSON intégré à l'application
curl http://localhost:3000/api/meats/export/all > /backup/cave-$(date +%Y%m%d).json
```

---

## Structure du projet

```
cave-affinage/
├── app.py                 # Application et API REST Flask
├── database.py            # Logique SQLite
├── requirements.txt       # Dépendances Python
├── cave-affinage.service  # Fichier systemd
├── data/
│   └── cave.db            # Base de données SQLite (créée au démarrage)
└── public/
    └── index.html         # Application frontend
```

## API REST

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | /api/meats | Liste toutes les pièces |
| POST | /api/meats | Créer une pièce |
| GET | /api/meats/:id | Détail d'une pièce |
| PUT | /api/meats/:id | Modifier une pièce |
| DELETE | /api/meats/:id | Supprimer une pièce |
| POST | /api/meats/:id/weights | Ajouter une pesée |
| PUT | /api/meats/:id/weights/:entryId | Modifier une pesée |
| DELETE | /api/meats/:id/weights/:entryId | Supprimer une pesée |
| GET | /api/meats/export/all | Export JSON complet |
| POST | /api/meats/import/all | Import JSON |
