#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
#  Cave d'Affinage — Script d'installation
#
#  Usage :
#    sudo bash install.sh                  # installation standard (HTTP)
#    sudo bash install.sh --https          # avec HTTPS (caméra QR)
#    sudo bash install.sh --port 8080      # port personnalisé
#    sudo bash install.sh --https --port 443
#    sudo bash install.sh --uninstall      # désinstaller
#
#  Options :
#    --https          Active HTTPS avec certificat auto-signé
#    --port PORT      Port d'écoute (défaut : 3000)
#    --dir  DIR       Répertoire d'installation (défaut : /opt/cave-affinage)
#    --user USER      Utilisateur système du service (défaut : cave)
#    --uninstall      Arrête et supprime le service + les fichiers
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ─── Couleurs ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✓${RESET}  $*"; }
info() { echo -e "  ${CYAN}→${RESET}  $*"; }
warn() { echo -e "  ${YELLOW}⚠${RESET}  $*"; }
err()  { echo -e "  ${RED}✗${RESET}  $*" >&2; exit 1; }
step() { echo ""; echo -e "  ${BOLD}$*${RESET}"; }
hr()   { echo -e "  ${DIM}──────────────────────────────────────────────────${RESET}"; }

# ─── Defaults ─────────────────────────────────────────────────────────────────
INSTALL_DIR="/opt/cave-affinage"
SERVICE_USER="cave"
SERVICE_NAME="cave-affinage"
PORT="3000"
USE_HTTPS="true"
UNINSTALL="false"
NODE_MIN_VERSION=18

# ─── Parsing des arguments ────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --https)       USE_HTTPS="true";     shift ;;
    --port)        PORT="$2";            shift 2 ;;
    --dir)         INSTALL_DIR="$2";     shift 2 ;;
    --user)        SERVICE_USER="$2";    shift 2 ;;
    --uninstall)   UNINSTALL="true";     shift ;;
    -h|--help)
      echo ""
      echo -e "  ${BOLD}Cave d'Affinage — install.sh${RESET}"
      echo ""
      echo "  Usage : sudo bash install.sh [options]"
      echo ""
      echo "  Options :"
      echo "    --https          Active HTTPS avec certificat auto-signé (requis pour la caméra QR)"
      echo "    --port PORT      Port d'écoute (défaut : 3000)"
      echo "    --dir  DIR       Répertoire d'installation (défaut : /opt/cave-affinage)"
      echo "    --user USER      Utilisateur système (défaut : cave)"
      echo "    --uninstall      Arrête et supprime le service + les fichiers"
      echo ""
      exit 0 ;;
    *) warn "Option inconnue ignorée : $1"; shift ;;
  esac
done

# ─── Vérification root ────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && err "Ce script doit être exécuté en tant que root.  →  sudo bash install.sh"

# ─── Détecter le gestionnaire de paquets ─────────────────────────────────────
if   command -v apt-get &>/dev/null; then PKG="apt"
elif command -v apk     &>/dev/null; then PKG="apk"
elif command -v dnf     &>/dev/null; then PKG="dnf"
elif command -v yum     &>/dev/null; then PKG="yum"
else err "Aucun gestionnaire de paquets reconnu (apt / apk / dnf / yum)."
fi

# ══════════════════════════════════════════════════════════════════════════════
#  DÉSINSTALLATION
# ══════════════════════════════════════════════════════════════════════════════
if [[ "$UNINSTALL" == "true" ]]; then
  echo ""; hr
  echo -e "  ${BOLD}🗑  Désinstallation de Cave d'Affinage${RESET}"
  hr

  if command -v systemctl &>/dev/null; then
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
      info "Arrêt du service systemd..."
      systemctl stop "$SERVICE_NAME"
      ok "Service arrêté"
    fi

    if systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
      info "Désactivation du service..."
      systemctl disable "$SERVICE_NAME"
      ok "Service désactivé"
    fi

    SVC_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
    if [[ -f "$SVC_FILE" ]]; then
      rm -f "$SVC_FILE"
      systemctl daemon-reload
      ok "Fichier service supprimé"
    fi
  elif command -v rc-service &>/dev/null; then
    if rc-service "$SERVICE_NAME" status 2>/dev/null | grep -q 'started'; then
      info "Arrêt du service openrc..."
      rc-service "$SERVICE_NAME" stop
      ok "Service arrêté"
    fi
    rc-update del "$SERVICE_NAME" default 2>/dev/null || true
    SVC_FILE="/etc/init.d/${SERVICE_NAME}"
    if [[ -f "$SVC_FILE" ]]; then
      rm -f "$SVC_FILE"
      ok "Fichier service supprimé"
    fi
  fi

  if [[ -d "$INSTALL_DIR" ]]; then
    read -rp "  Supprimer aussi $INSTALL_DIR (données incluses) ? [o/N] " CONFIRM
    if [[ "${CONFIRM,,}" == "o" ]]; then
      rm -rf "$INSTALL_DIR"
      ok "Répertoire $INSTALL_DIR supprimé"
    else
      info "Répertoire conservé : $INSTALL_DIR"
    fi
  fi

  if id "$SERVICE_USER" &>/dev/null; then
    read -rp "  Supprimer l'utilisateur système '$SERVICE_USER' ? [o/N] " CONFIRM
    if [[ "${CONFIRM,,}" == "o" ]]; then
      if command -v deluser &>/dev/null; then
        deluser "$SERVICE_USER" 2>/dev/null || true
      else
        userdel "$SERVICE_USER" 2>/dev/null || true
      fi
      ok "Utilisateur $SERVICE_USER supprimé"
    fi
  fi

  echo ""; hr; ok "Désinstallation terminée."; hr; echo ""
  exit 0
fi

# ══════════════════════════════════════════════════════════════════════════════
#  INSTALLATION
# ══════════════════════════════════════════════════════════════════════════════
echo ""
hr
echo -e "  ${BOLD}🥩  Cave d'Affinage — Installation${RESET}"
hr
echo ""
info "Répertoire  :  ${BOLD}$INSTALL_DIR${RESET}"
info "Utilisateur :  ${BOLD}$SERVICE_USER${RESET}"
info "Port        :  ${BOLD}$PORT${RESET}"
if [[ "$USE_HTTPS" == "true" ]]; then
  info "HTTPS       :  ${GREEN}activé${RESET} (certificat auto-signé)"
else
  info "HTTPS       :  ${DIM}désactivé${RESET}  (ajoutez --https pour activer la caméra QR)"
fi
echo ""

# ─── Étape 1 : Python 3 ───────────────────────────────────────────────────────
hr; step "[1/5] Python 3"

if command -v python3 &>/dev/null; then
  ok "Python 3 $(python3 --version) déjà installé"
else
  info "Installation de Python 3 et venv..."
  if [[ "$PKG" == "apt" ]]; then
    apt-get update -qq
    apt-get install -y -qq python3 python3-pip python3-venv
  elif [[ "$PKG" == "apk" ]]; then
    apk update -q
    # python3 already includes venv, py3-pip includes pip
    apk add -q python3 py3-pip
  else
    $PKG install -y python3 python3-pip
  fi
  ok "Python 3 installé"
fi

# ─── Étape 2 : OpenSSL (si HTTPS) ────────────────────────────────────────────
hr; step "[2/5] OpenSSL"

if [[ "$USE_HTTPS" == "true" ]]; then
  if command -v openssl &>/dev/null; then
    ok "openssl $(openssl version | awk '{print $2}') déjà installé"
  else
    info "Installation d'openssl..."
    if [[ "$PKG" == "apt" ]]; then
      apt-get install -y -qq openssl
    elif [[ "$PKG" == "apk" ]]; then
      apk add -q openssl
    else
      $PKG install -y openssl
    fi
    ok "openssl installé"
  fi
else
  info "Ignoré (HTTPS désactivé)"
fi

# ─── Étape 3 : Copie des fichiers ─────────────────────────────────────────────
hr; step "[3/5] Fichiers applicatifs"

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/certs"

info "Copie de $SRC → $INSTALL_DIR ..."

if command -v rsync &>/dev/null; then
  rsync -a \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='data' \
    --exclude='certs' \
    "$SRC/" "$INSTALL_DIR/"
else
  # Fallback sans rsync
  cp -r "$SRC/." "$INSTALL_DIR/"
  rm -rf "$INSTALL_DIR/node_modules" "$INSTALL_DIR/.git"
fi

ok "Fichiers copiés"

# ─── Étape 4 : Environnement virtuel & pip ────────────────────────────────────
hr; step "[4/5] Dépendances Python"

cd "$INSTALL_DIR"

info "Création de l'environnement virtuel..."
python3 -m venv venv
info "Installation des dépendances (pip)..."
./venv/bin/pip install --quiet -r requirements.txt

ok "Dépendances installées"

# ─── Étape 5 : Utilisateur & permissions ─────────────────────────────────────
hr; step "[5/5] Utilisateur système & permissions"

if ! id "$SERVICE_USER" &>/dev/null; then
  info "Création de l'utilisateur système '$SERVICE_USER'..."
  if [[ "$PKG" == "apk" ]]; then
    adduser -S -D -H -h "$INSTALL_DIR" -s /sbin/nologin "$SERVICE_USER"
  else
    useradd --system --shell /bin/false --home-dir "$INSTALL_DIR" --no-create-home "$SERVICE_USER"
  fi
  ok "Utilisateur '$SERVICE_USER' créé"
else
  ok "Utilisateur '$SERVICE_USER' existe déjà"
fi

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
chmod 750 "$INSTALL_DIR"
chmod 770 "$INSTALL_DIR/data" "$INSTALL_DIR/certs"
ok "Permissions appliquées (propriétaire : $SERVICE_USER)"

# ─── Configuration du service ─────────────────────────────────────────────────
hr; step "[+] Configuration du service"

PYTHON_BIN="${INSTALL_DIR}/venv/bin/python"
HTTPS_LINE=""
[[ "$USE_HTTPS" == "true" ]] && HTTPS_LINE="Environment=HTTPS=true"

  # Génération du fichier config.json
  cat > "${INSTALL_DIR}/config.json" << CONFIG
{
  "PORT": ${PORT},
  "HTTPS": ${USE_HTTPS}
}
CONFIG
  chown "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}/config.json"
  chmod 660 "${INSTALL_DIR}/config.json"
  ok "Fichier de configuration créé : ${INSTALL_DIR}/config.json"

if command -v systemctl &>/dev/null; then
  cat > "/etc/systemd/system/${SERVICE_NAME}.service" << SERVICE
[Unit]
Description=Cave d'Affinage - Suivi de maturation et séchage
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${PYTHON_BIN} app.py
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

Environment=FLASK_ENV=production

# Sécurité
NoNewPrivileges=true
ProtectSystem=strict
PrivateTmp=true
ReadWritePaths=${INSTALL_DIR}/data
ReadWritePaths=${INSTALL_DIR}/certs
ReadWritePaths=${INSTALL_DIR}/config.json

[Install]
WantedBy=multi-user.target
SERVICE

  ok "Service écrit : /etc/systemd/system/${SERVICE_NAME}.service"

  info "Activation et démarrage du service..."
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" 2>/dev/null
  systemctl restart "$SERVICE_NAME"

  sleep 3

  if systemctl is-active --quiet "$SERVICE_NAME"; then
    ok "Service ${SERVICE_NAME} actif et activé au démarrage"
  else
    warn "Le service n'est pas actif — diagnostic :"
    echo ""
    systemctl status "$SERVICE_NAME" --no-pager -l 2>&1 | head -20 | sed 's/^/    /' || true
    echo ""
    warn "Consultez les logs complets :  journalctl -u ${SERVICE_NAME} -n 50"
  fi

elif command -v rc-service &>/dev/null; then
  # Configuration OpenRC pour Alpine
  cat > "/etc/init.d/${SERVICE_NAME}" << SERVICE
#!/sbin/openrc-run

name="Cave d'Affinage"
description="Suivi de maturation et séchage"
command="${PYTHON_BIN}"
command_args="app.py"
command_background="yes"
pidfile="/run/${SERVICE_NAME}.pid"
directory="${INSTALL_DIR}"
output_log="/var/log/${SERVICE_NAME}.log"
error_log="/var/log/${SERVICE_NAME}.err"
command_user="${SERVICE_USER}:${SERVICE_USER}"

  # Génération du fichier config.json (déjà fait plus haut si systemctl existait, mais on assure ici aussi pour OpenRC)
  if [[ ! -f "${INSTALL_DIR}/config.json" ]]; then
    cat > "${INSTALL_DIR}/config.json" << CONFIG
{
  "PORT": ${PORT},
  "HTTPS": ${USE_HTTPS}
}
CONFIG
    chown "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}/config.json"
    chmod 660 "${INSTALL_DIR}/config.json"
  fi

  cat > "/etc/init.d/${SERVICE_NAME}" << SERVICE
#!/sbin/openrc-run

name="Cave d'Affinage"
description="Suivi de maturation et séchage"
command="${PYTHON_BIN}"
command_args="app.py"
command_background="yes"
pidfile="/run/${SERVICE_NAME}.pid"
directory="${INSTALL_DIR}"
output_log="/var/log/${SERVICE_NAME}.log"
error_log="/var/log/${SERVICE_NAME}.err"
command_user="${SERVICE_USER}:${SERVICE_USER}"

export FLASK_ENV=production

depend() {
    need net
}

start_pre() {
    checkpath --directory --owner ${SERVICE_USER}:${SERVICE_USER} --mode 0770 ${INSTALL_DIR}/data
    checkpath --directory --owner ${SERVICE_USER}:${SERVICE_USER} --mode 0770 ${INSTALL_DIR}/certs
}
SERVICE

  chmod +x "/etc/init.d/${SERVICE_NAME}"
  ok "Service écrit : /etc/init.d/${SERVICE_NAME}"

  info "Activation et démarrage du service..."
  rc-update add "$SERVICE_NAME" default 2>/dev/null
  rc-service "$SERVICE_NAME" restart

  sleep 3

  if rc-service "$SERVICE_NAME" status 2>/dev/null | grep -q 'started'; then
    ok "Service ${SERVICE_NAME} actif et activé au démarrage"
  else
    warn "Le service n'est pas actif — consultez /var/log/${SERVICE_NAME}.err"
  fi

else
  warn "Aucun gestionnaire de services (systemd / openrc) détecté."
  warn "Veuillez démarrer l'application manuellement :"
  warn "  su -s /bin/sh -c 'cd $INSTALL_DIR && PORT=$PORT FLASK_ENV=production $PYTHON_BIN app.py' $SERVICE_USER"
fi

# ─── Résumé final ─────────────────────────────────────────────────────────────
PROTO="http"
[[ "$USE_HTTPS" == "true" ]] && PROTO="https"

LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null \
  | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' \
  || hostname -I 2>/dev/null | awk '{print $1}' \
  || echo "<IP_DU_SERVEUR>")

echo ""
hr
echo ""
echo -e "  ${GREEN}${BOLD}✅  Installation terminée !${RESET}"
echo ""
echo -e "  ${BOLD}Accès :${RESET}"
echo -e "    ${CYAN}${PROTO}://${LOCAL_IP}:${PORT}${RESET}"
echo ""
if [[ "$USE_HTTPS" == "true" ]]; then
  echo -e "  ${YELLOW}⚠  Certificat auto-signé :${RESET} acceptez l'avertissement du navigateur"
  echo -e "     (généré automatiquement dans ${INSTALL_DIR}/certs/ au 1er démarrage)"
  echo ""
fi
echo -e "  ${BOLD}Commandes utiles :${RESET}"
if command -v systemctl &>/dev/null; then
  echo -e "    ${CYAN}systemctl status  ${SERVICE_NAME}${RESET}    — état"
  echo -e "    ${CYAN}journalctl -u     ${SERVICE_NAME} -f${RESET}  — logs temps réel"
  echo -e "    ${CYAN}systemctl restart ${SERVICE_NAME}${RESET}    — redémarrer"
  echo -e "    ${CYAN}systemctl stop    ${SERVICE_NAME}${RESET}    — arrêter"
elif command -v rc-service &>/dev/null; then
  echo -e "    ${CYAN}rc-service ${SERVICE_NAME} status${RESET}     — état"
  echo -e "    ${CYAN}tail -f /var/log/${SERVICE_NAME}.log${RESET} — logs temps réel"
  echo -e "    ${CYAN}rc-service ${SERVICE_NAME} restart${RESET}    — redémarrer"
  echo -e "    ${CYAN}rc-service ${SERVICE_NAME} stop${RESET}       — arrêter"
fi
echo ""
echo -e "  ${BOLD}Sauvegarde des données :${RESET}"
echo -e "    ${DIM}cp ${INSTALL_DIR}/data/cave.db ~/cave-backup-\$(date +%F).db${RESET}"
echo ""
echo -e "  ${BOLD}Activer HTTPS plus tard :${RESET}"
echo -e "    ${CYAN}sudo bash ${INSTALL_DIR}/install.sh --https --port ${PORT}${RESET}"
echo ""
echo -e "  ${BOLD}Désinstaller :${RESET}"
echo -e "    ${CYAN}sudo bash ${INSTALL_DIR}/install.sh --uninstall${RESET}"
echo ""
hr
echo ""
