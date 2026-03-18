import os
import subprocess
import json
import base64
import urllib.request
import threading
import time
from datetime import datetime, timezone, timedelta
from flask import Flask, jsonify, request, send_from_directory
from pydantic import ValidationError
import database
import schemas


def parse_body(Model):
    """Parse and validate request JSON against a Pydantic model.

    Returns (instance, None) on success, (None, error_response) on failure.
    """
    data = request.get_json(silent=True)
    if data is None:
        return None, (jsonify({'error': 'Corps JSON requis'}), 400)
    try:
        return Model.model_validate(data), None
    except ValidationError as exc:
        errors = [
            {'field': '.'.join(str(l) for l in e['loc']), 'msg': e['msg']}
            for e in exc.errors(include_url=False)
        ]
        return None, (jsonify({'error': 'Validation échouée', 'details': errors}), 422)

TYPE_ICONS = {
    'coppa': '🥩',
    'lonzo': '🥩',
    'pancetta': '🥓',
    'guanciale': '🥓',
    'bresaola': '🥩',
    'jambon': '🍖',
    'saucisson': '🌭',
    'magret': '🦆',
    'filet_mignon': '🐖',
    'boeuf_seche': '🦬',
    'jerky': '🥓',
    'lomo': '🥩',
    'pastrami': '🥩',
    'autre': '🥩',
}

TYPE_LABELS = {
    'coppa':       'Coppa',
    'lonzo':       'Lonzo',
    'pancetta':    'Pancetta',
    'guanciale':   'Guanciale',
    'bresaola':    'Bresaola',
    'jambon':      'Jambon',
    'saucisson':   'Saucisson',
    'magret':      'Magret de canard',
    'filet_mignon':'Filet mignon (porc)',
    'boeuf_seche': 'Bœuf séché',
    'jerky':       'Beef Jerky',
    'lomo':        'Lomo embuchado',
    'pastrami':    'Pastrami',
    'autre':       'Autre',
}

TYPE_ORDER = [
    'coppa', 'lonzo', 'pancetta', 'guanciale', 'bresaola', 'jambon',
    'saucisson', 'magret', 'filet_mignon', 'boeuf_seche', 'jerky',
    'lomo', 'pastrami', 'autre',
]

# --- States for spam prevention ---
ALERT_STATE = {
    'temperature': 'ok' # ok, too_low, too_high
}

app = Flask(__name__, static_folder='public', static_url_path='')

database.init()
print('✅ Base de données SQLite initialisée')

def initialize_alert_state():
    print("🌡️ Initialisation silencieuse de l'état des alertes...", flush=True)
    settings = database.query_db('SELECT * FROM sensor_settings WHERE id = 1', one=True)
    sensor = database.query_db('SELECT * FROM sensors WHERE id = 1', one=True)
    if settings and sensor:
        temp = sensor['temperature']
        t_min, t_max = settings['temp_min'], settings['temp_max']
        global ALERT_STATE
        if temp < t_min: ALERT_STATE['temperature'] = 'too_low'
        elif temp > t_max: ALERT_STATE['temperature'] = 'too_high'
        else: ALERT_STATE['temperature'] = 'ok'
        print(f"🏠 État initial : {ALERT_STATE['temperature']} ({temp}°C)", flush=True)

initialize_alert_state()

# --- Configuration Loading ---
def load_config():
    config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')
    defaults = {
        'PORT': int(os.environ.get('PORT', 3000)),
        'HTTPS': os.environ.get('HTTPS', 'false').lower() == 'true'
    }
    
    if os.path.exists(config_path):
        try:
            with open(config_path, 'r') as f:
                file_config = json.load(f)
                if 'PORT' in file_config:
                    defaults['PORT'] = int(file_config['PORT'])
                if 'HTTPS' in file_config:
                    defaults['HTTPS'] = str(file_config['HTTPS']).lower() == 'true'
                print(f"📖 Configuration chargée depuis {config_path}")
        except Exception as e:
            print(f"⚠️ Erreur lors de la lecture du fichier de configuration : {e}")
            
    return defaults

CONFIG = load_config()
PORT = CONFIG['PORT']
USE_HTTPS = CONFIG['HTTPS']

@app.route('/api/config', methods=['GET'])
def get_config():
    return jsonify(load_config())

@app.route('/api/config', methods=['PUT'])
def update_config():
    data = request.json
    if not data: return jsonify({'error': 'No data'}), 400
    
    config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')
    current_config = load_config()
    
    if 'PORT' in data:
        try:
            current_config['PORT'] = int(data['PORT'])
        except ValueError:
            return jsonify({'error': 'Invalid port'}), 400
            
    if 'HTTPS' in data:
        current_config['HTTPS'] = str(data['HTTPS']).lower() == 'true'
        
    try:
        with open(config_path, 'w') as f:
            json.dump(current_config, f, indent=2)
        
        # Reload global config (though port change needs restart)
        global CONFIG, PORT, USE_HTTPS
        CONFIG = current_config
        PORT = CONFIG['PORT']
        USE_HTTPS = CONFIG['HTTPS']
        
        return jsonify({'success': True, 'config': CONFIG})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/types', methods=['GET'])
def get_types():
    rows = database.query_db('SELECT type, days, loss FROM type_defaults')
    db_map = {r['type']: r for r in rows}
    result = []
    for t in TYPE_ORDER:
        d = db_map.get(t, {})
        result.append({
            'id':    t,
            'label': TYPE_LABELS.get(t, t),
            'icon':  TYPE_ICONS.get(t, '🥩'),
            'days':  d.get('days', 60),
            'loss':  d.get('loss', 30),
        })
    return jsonify(result)

@app.route('/api/recipes', methods=['GET'])
def get_recipes():
    rows = database.query_db('SELECT * FROM recipes ORDER BY type, name')
    return jsonify(rows)

@app.route('/api/recipes', methods=['POST'])
def create_recipe():
    body, err = parse_body(schemas.RecipeBody)
    if err: return err
    rid = database.execute_db(
        'INSERT INTO recipes (name, type, salt_pct, sugar_pct, spices, notes) VALUES (?,?,?,?,?,?)',
        (body.name, body.type, body.salt_pct, body.sugar_pct, body.spices, body.notes)
    )
    row = database.query_db('SELECT * FROM recipes WHERE id = ?', (rid,), one=True)
    return jsonify(row), 201

@app.route('/api/recipes/<int:rid>', methods=['PUT'])
def update_recipe(rid):
    body, err = parse_body(schemas.RecipeBody)
    if err: return err
    database.execute_db(
        'UPDATE recipes SET name=?, type=?, salt_pct=?, sugar_pct=?, spices=?, notes=? WHERE id=?',
        (body.name, body.type, body.salt_pct, body.sugar_pct, body.spices, body.notes, rid)
    )
    row = database.query_db('SELECT * FROM recipes WHERE id = ?', (rid,), one=True)
    return jsonify(row)

@app.route('/api/recipes/<int:rid>', methods=['DELETE'])
def delete_recipe(rid):
    database.execute_db('DELETE FROM recipes WHERE id = ?', (rid,))
    return jsonify({'ok': True})

@app.route('/manifest.json')
def serve_manifest():
    return send_from_directory(app.static_folder, 'manifest.json', mimetype='application/manifest+json')

@app.route('/sw.js')
def serve_sw():
    return send_from_directory(app.static_folder, 'sw.js', mimetype='application/javascript')

# --- API Routes ---

def _get_meat_with_weights(meat_id):
    meat = database.query_db('SELECT * FROM meats WHERE id = ?', (meat_id,), one=True)
    if not meat: return None
    meat['weights'] = database.query_db('SELECT id, weight, date FROM weight_entries WHERE meatId = ? ORDER BY date ASC', (meat_id,))
    for k in ['salt', 'sugar', 'spices', 'notes']:
        if meat.get(k) == '': meat[k] = None
    return meat

@app.route('/api/meats', methods=['GET'])
def get_all_meats():
    meats = database.query_db('SELECT * FROM meats ORDER BY createdAt DESC')
    for m in meats:
        m['weights'] = database.query_db('SELECT id, weight, date FROM weight_entries WHERE meatId = ? ORDER BY date ASC', (m['id'],))
        for k in ['salt', 'sugar', 'spices', 'notes', 'price']:
            if m.get(k) == '': m[k] = None
    return jsonify(meats)

@app.route('/api/meats/export/all', methods=['GET'])
def export_all():
    meats = database.query_db('SELECT * FROM meats ORDER BY createdAt DESC')
    for m in meats:
        m['weights'] = database.query_db('SELECT id, weight, date FROM weight_entries WHERE meatId = ? ORDER BY date ASC', (m['id'],))
    
    resp = jsonify({
        'version': '2.0',
        'exportDate': datetime.now(timezone.utc).isoformat(),
        'meats': meats
    })
    resp.headers['Content-Disposition'] = 'attachment; filename="cave-affinage-backup.json"'
    return resp

@app.route('/api/meats/import/all', methods=['POST'])
def import_all():
    data = request.json
    meats = data.get('meats') if data else None
    if not meats or not isinstance(meats, list):
        return jsonify({'error': 'Invalid data'}), 400
    
    conn = database.get_db()
    for m in meats:
        conn.execute(
            'INSERT OR REPLACE INTO meats (id,name,type,initialWeight,startDate,targetDays,targetLoss,salt,sugar,spices,notes,price,archived,smoked) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (m.get('id'), m.get('name'), m.get('type'), m.get('initialWeight'), m.get('startDate'), m.get('targetDays', 60), m.get('targetLoss', 30),
             m.get('salt'), m.get('sugar'), m.get('spices'), m.get('notes'), m.get('price'), m.get('archived', 0), m.get('smoked', 0))
        )
        conn.execute('DELETE FROM weight_entries WHERE meatId=?', (m.get('id'),))
        for w in m.get('weights', []):
            conn.execute('INSERT INTO weight_entries (meatId,weight,date) VALUES (?,?,?)', (m.get('id'), w.get('weight'), w.get('date')))
    
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'count': len(meats)})

@app.route('/api/meats/<meat_id>', methods=['GET'])
def get_one_meat(meat_id):
    meat = _get_meat_with_weights(meat_id)
    if not meat: return jsonify({'error': 'Not found'}), 404
    return jsonify(meat)

@app.route('/api/meats', methods=['POST'])
def create_meat():
    body, err = parse_body(schemas.MeatCreate)
    if err: return err

    database.execute_db(
        'INSERT INTO meats (id,name,type,initialWeight,startDate,targetDays,targetLoss,salt,sugar,spices,notes,price,archived,smoked) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        (body.id, body.name, body.type, body.initialWeight, body.startDate,
         body.targetDays, body.targetLoss, body.salt, body.sugar,
         body.spices, body.notes, body.price, body.archived, body.smoked)
    )

    weights = body.weights or [schemas.WeightBody(weight=body.initialWeight, date=body.startDate)]
    conn = database.get_db()
    for w in weights:
        conn.execute('INSERT INTO weight_entries (meatId,weight,date) VALUES (?,?,?)', (body.id, w.weight, w.date))
    conn.commit()
    conn.close()

    return jsonify(_get_meat_with_weights(body.id)), 201

@app.route('/api/meats/<meat_id>', methods=['PUT'])
def update_meat(meat_id):
    if not database.query_db('SELECT id FROM meats WHERE id=?', (meat_id,), one=True):
        return jsonify({'error': 'Not found'}), 404

    body, err = parse_body(schemas.MeatUpdate)
    if err: return err

    database.execute_db(
        'UPDATE meats SET name=?,type=?,initialWeight=?,startDate=?,targetDays=?,targetLoss=?,salt=?,sugar=?,spices=?,notes=?,price=?,archived=?,smoked=? WHERE id=?',
        (body.name, body.type, body.initialWeight, body.startDate,
         body.targetDays, body.targetLoss, body.salt, body.sugar,
         body.spices, body.notes, body.price, body.archived, body.smoked, meat_id)
    )
    return jsonify(_get_meat_with_weights(meat_id))

@app.route('/api/meats/<meat_id>', methods=['DELETE'])
def delete_meat(meat_id):
    if not database.query_db('SELECT id FROM meats WHERE id=?', (meat_id,), one=True):
        return jsonify({'error': 'Not found'}), 404
    database.execute_db('DELETE FROM weight_entries WHERE meatId=?', (meat_id,))
    database.execute_db('DELETE FROM meats WHERE id=?', (meat_id,))
    return jsonify({'success': True})

@app.route('/api/meats/<meat_id>/weights', methods=['POST'])
def add_weight(meat_id):
    if not database.query_db('SELECT id FROM meats WHERE id=?', (meat_id,), one=True):
        return jsonify({'error': 'Not found'}), 404
    body, err = parse_body(schemas.WeightBody)
    if err: return err
    database.execute_db('INSERT INTO weight_entries (meatId,weight,date) VALUES (?,?,?)', (meat_id, body.weight, body.date))
    return jsonify(_get_meat_with_weights(meat_id))

@app.route('/api/meats/<meat_id>/weights/<int:entry_id>', methods=['PUT'])
def update_weight(meat_id, entry_id):
    body, err = parse_body(schemas.WeightBody)
    if err: return err
    database.execute_db('UPDATE weight_entries SET weight=?,date=? WHERE id=? AND meatId=?', (body.weight, body.date, entry_id, meat_id))
    return jsonify(_get_meat_with_weights(meat_id))

@app.route('/api/meats/<meat_id>/weights/<int:entry_id>', methods=['DELETE'])
def delete_weight(meat_id, entry_id):
    database.execute_db('DELETE FROM weight_entries WHERE id=? AND meatId=?', (entry_id, meat_id))
    return jsonify(_get_meat_with_weights(meat_id))

@app.route('/api/sensors', methods=['GET'])
def get_sensors():
    sensor = database.query_db('SELECT * FROM sensors WHERE id = 1', one=True)
    settings = database.query_db('SELECT * FROM sensor_settings WHERE id = 1', one=True)
    return jsonify({
        'current': sensor if sensor else {},
        'settings': settings if settings else {}
    })

@app.route('/api/sensors/settings', methods=['GET'])
def get_sensor_settings():
    settings = database.query_db('SELECT * FROM sensor_settings WHERE id = 1', one=True)
    return jsonify(settings if settings else {})

@app.route('/api/settings', methods=['GET'])
def get_app_settings():
    settings = database.query_db('SELECT * FROM app_settings WHERE id = 1', one=True)
    return jsonify(settings if settings else {})

@app.route('/api/settings', methods=['PUT'])
def update_app_settings():
    body, err = parse_body(schemas.AppSettings)
    if err: return err
    database.execute_db(
        'UPDATE app_settings SET producer_name=? WHERE id=1',
        (body.producer_name,)
    )
    return jsonify({'success': True})

@app.route('/api/sensors/settings', methods=['PUT'])
def update_sensor_settings():
    body, err = parse_body(schemas.SensorSettings)
    if err: return err
    database.execute_db(
        'UPDATE sensor_settings SET temp_min=?, temp_max=?, hum_min=?, hum_max=?, alerts_enabled=? WHERE id=1',
        (body.temp_min, body.temp_max, body.hum_min, body.hum_max, body.alerts_enabled)
    )
    return jsonify({'success': True})

@app.route('/api/sensors', methods=['POST'])
def update_sensors():
    body, err = parse_body(schemas.SensorUpdate)
    if err: return err

    now_iso = datetime.now(timezone.utc).isoformat()
    temp = body.temperature
    hum = body.humidity

    # Update current status
    database.execute_db(
        'INSERT OR REPLACE INTO sensors (id, temperature, humidity, updatedAt) VALUES (1, ?, ?, ?)',
        (temp, hum, now_iso)
    )

    # Record history
    database.execute_db(
        'INSERT INTO sensor_history (temperature, humidity, timestamp) VALUES (?, ?, ?)',
        (temp, hum, now_iso)
    )

    # Prune old data (keep last 30 days)
    database.execute_db(
        "DELETE FROM sensor_history WHERE timestamp < datetime('now', '-30 days')"
    )

    # --- Telegram Alerts ---
    settings = database.query_db('SELECT * FROM sensor_settings WHERE id = 1', one=True)
    if settings and settings.get('alerts_enabled'):
        tg = database.query_db('SELECT * FROM telegram_settings WHERE id = 1', one=True)
        if tg and tg['enabled'] and tg['token'] and tg['chat_id']:
            t_min = settings['temp_min']
            t_max = settings['temp_max']
            global ALERT_STATE
            
            new_state = 'ok'
            msg = None
            
            if temp < t_min:
                new_state = 'too_low'
                if ALERT_STATE['temperature'] != 'too_low':
                    msg = f"⚠️ <b>ALERTE FRIGO</b>\nTempérature trop basse : <b>{temp}°C</b>\n(Seuil min : {t_min}°C)"
            elif temp > t_max:
                new_state = 'too_high'
                if ALERT_STATE['temperature'] != 'too_high':
                    msg = f"⚠️ <b>ALERTE FRIGO</b>\nTempérature trop élevée : <b>{temp}°C</b>\n(Seuil max : {t_max}°C)"
            else:
                if ALERT_STATE['temperature'] != 'ok':
                    msg = f"✅ <b>Température Rétablie</b>\nLa température est de nouveau normale : <b>{temp}°C</b>"
            
            if msg:
                if send_telegram_message(tg['token'], tg['chat_id'], msg):
                    ALERT_STATE['temperature'] = new_state

    return jsonify({'success': True})

@app.route('/api/homepage', methods=['GET'])
def get_homepage_data():
    meats = database.query_db('SELECT * FROM meats WHERE archived = 0 OR archived IS NULL')
    
    en_cours = 0
    pretes = 0
    
    for m in meats:
        weights = database.query_db('SELECT weight FROM weight_entries WHERE meatId = ? ORDER BY date DESC LIMIT 1', (m['id'],))
        if weights and m.get('initialWeight'):
            current_w = weights[0]['weight']
            initial_w = m['initialWeight']
            
            if initial_w > 0:
                current_loss = ((initial_w - current_w) / initial_w) * 100
                target_loss = m.get('targetLoss', 30)
                
                # Using the same threshold logic as the frontend (loss >= 85% of target means ready/almost ready)
                if current_loss >= target_loss * 0.85:
                    pretes += 1
                else:
                    en_cours += 1
        else:
            en_cours += 1  # No weight history, assume it's curing

    sensor = database.query_db('SELECT temperature, humidity FROM sensors WHERE id = 1', one=True)
    temp = sensor['temperature'] if sensor and sensor['temperature'] is not None else 0
    hum = sensor['humidity'] if sensor and sensor['humidity'] is not None else 0
    
    return jsonify({
        "en_cours": en_cours,
        "pretes": pretes,
        "temperature": temp,
        "humidity": hum
    })

@app.route('/api/sensors/history', methods=['GET'])
def get_sensor_history():
    days = request.args.get('days', 7, type=int)
    history = database.query_db(
        "SELECT * FROM sensor_history WHERE timestamp > datetime('now', ? || ' days') ORDER BY timestamp ASC",
        (f"-{days}",)
    )
    return jsonify(history)

@app.route('/api/github/settings', methods=['GET'])
def get_github_settings():
    settings = database.query_db('SELECT * FROM github_settings WHERE id = 1', one=True)
    return jsonify(settings if settings else {})

@app.route('/api/github/settings', methods=['PUT'])
def update_github_settings():
    body, err = parse_body(schemas.GitHubSettings)
    if err: return err
    database.execute_db(
        'UPDATE github_settings SET token=?, repo=?, path=?, enabled=?, auto_backup_enabled=?, auto_backup_hour=? WHERE id=1',
        (body.token, body.repo, body.path, body.enabled, body.auto_backup_enabled, body.auto_backup_hour)
    )
    return jsonify({'success': True})


def _do_github_backup():
    """Run the GitHub backup. Returns (success: bool, error_msg: str|None).
    On success, updates last_backup_at in DB."""
    settings = database.query_db('SELECT * FROM github_settings WHERE id = 1', one=True)
    if not settings or not settings.get('token') or not settings.get('repo'):
        return False, 'GitHub integration not configured'

    meats = database.query_db('SELECT * FROM meats ORDER BY createdAt DESC')
    for m in meats:
        m['weights'] = database.query_db('SELECT id, weight, date FROM weight_entries WHERE meatId = ? ORDER BY date ASC', (m['id'],))

    sensor_settings = database.query_db('SELECT * FROM sensor_settings WHERE id = 1', one=True)

    backup_data = {
        'version': '2.1',
        'exportDate': datetime.now(timezone.utc).isoformat(),
        'meats': meats,
        'sensor_settings': sensor_settings,
    }

    content = json.dumps(backup_data, indent=2, ensure_ascii=False).encode('utf-8')
    content_b64 = base64.b64encode(content).decode('ascii')

    token = settings['token']
    repo  = settings['repo']
    path  = settings.get('path', 'backup.json')
    api_url = f"https://api.github.com/repos/{repo}/contents/{path}"

    # Get existing SHA (required for updates)
    sha = None
    try:
        req = urllib.request.Request(api_url)
        req.add_header('Authorization', f'token {token}')
        req.add_header('Accept', 'application/vnd.github.v3+json')
        with urllib.request.urlopen(req) as response:
            sha = json.loads(response.read().decode('utf-8')).get('sha')
    except urllib.error.HTTPError as e:
        if e.code != 404:
            return False, f'GitHub API check error: {e.reason}'

    put_data = {
        'message': f"Auto-backup Cave d'Affinage — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        'content': content_b64,
    }
    if sha:
        put_data['sha'] = sha

    try:
        req = urllib.request.Request(api_url, data=json.dumps(put_data).encode('utf-8'), method='PUT')
        req.add_header('Authorization', f'token {token}')
        req.add_header('Accept', 'application/vnd.github.v3+json')
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req) as response:
            response.read()
    except urllib.error.HTTPError as e:
        return False, f'GitHub API upload error: {e.reason} — {e.read().decode("utf-8", errors="replace")}'
    except Exception as e:
        return False, str(e)

    database.execute_db(
        'UPDATE github_settings SET last_backup_at=? WHERE id=1',
        (datetime.now(timezone.utc).isoformat(),)
    )
    return True, None


@app.route('/api/github/backup', methods=['POST'])
def github_backup():
    success, err = _do_github_backup()
    if success:
        settings = database.query_db('SELECT last_backup_at FROM github_settings WHERE id=1', one=True)
        return jsonify({'success': True, 'last_backup_at': settings['last_backup_at'] if settings else None})
    return jsonify({'error': err}), 500


def _github_backup_worker():
    """Background thread: runs _do_github_backup() once per day at the configured hour."""
    print('☁ GitHub auto-backup worker démarré', flush=True)
    while True:
        try:
            settings = database.query_db('SELECT * FROM github_settings WHERE id = 1', one=True)
            if settings and settings.get('auto_backup_enabled') and settings.get('token') and settings.get('repo'):
                target_hour = int(settings.get('auto_backup_hour', 2))
                now = datetime.now()
                if now.hour == target_hour:
                    # Check not already done today
                    last = settings.get('last_backup_at')
                    already_done = False
                    if last:
                        try:
                            already_done = datetime.fromisoformat(last).date() == now.date()
                        except Exception:
                            pass
                    if not already_done:
                        print(f'⏰ Sauvegarde GitHub automatique ({target_hour:02d}h)…', flush=True)
                        success, err = _do_github_backup()
                        if success:
                            print('✅ Sauvegarde GitHub automatique réussie.', flush=True)
                        else:
                            print(f'❌ Échec sauvegarde GitHub automatique : {err}', flush=True)
        except Exception as e:
            print(f'❌ Erreur github backup worker : {e}', flush=True)
        time.sleep(60)  # Check every minute — only fires once per day at the right hour

# --- Telegram Notifications ---
def send_telegram_message(token, chat_id, text):
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {'chat_id': chat_id, 'text': text, 'parse_mode': 'HTML'}
    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), method='POST')
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req) as response:
            return True
    except Exception as e:
        print(f"❌ Erreur Telegram : {e}")
        return False

@app.route('/api/telegram/settings', methods=['GET'])
def get_telegram_settings():
    settings = database.query_db('SELECT * FROM telegram_settings WHERE id = 1', one=True)
    return jsonify(settings if settings else {})

@app.route('/api/telegram/settings', methods=['PUT'])
def update_telegram_settings():
    body, err = parse_body(schemas.TelegramSettings)
    if err: return err
    database.execute_db(
        'UPDATE telegram_settings SET token=?, chat_id=?, interval_days=?, enabled=?, report_frequency=? WHERE id=1',
        (body.token, body.chat_id, body.interval_days, body.enabled, body.report_frequency or 'off')
    )
    return jsonify({'success': True})

def send_status_report(token, chat_id):
    meats = database.query_db('SELECT * FROM meats WHERE archived = 0')
    if not meats:
        return send_telegram_message(token, chat_id, "📊 <b>Rapport de la Cave</b>\nAucune pièce en cours actuellement.")
    
    msg = f"📊 <b>Rapport de la Cave</b> ({datetime.now().strftime('%d/%m/%Y')})\n\n"
    for m in meats:
        # Get last weight entries for progress calculation
        weights = database.query_db('SELECT weight, date FROM weight_entries WHERE meatId = ? ORDER BY date DESC', (m['id'],))
        
        progress = 0
        current_w = 0
        days_left = "?"
        last_date_str = m.get('startDate') or m.get('date') or "Inconnue"
        
        if weights:
            current_w = weights[0]['weight']
            initial_w = weights[-1]['weight']
            last_date_str = weights[0]['date']
            target_loss = m.get('targetLoss', 30)
            
            if initial_w > 0:
                current_loss = ((initial_w - current_w) / initial_w) * 100
                progress = min(100, round((current_loss / target_loss) * 100))
            
        # Estimate days left (simple linear estimation based on start date)
        try:
            # Use startDate for estimation logic
            raw_start = m.get('startDate') or m.get('date')
            if raw_start:
                date_str = raw_start.replace('Z', '+00:00')
                if ' ' in date_str and 'T' not in date_str: date_str = date_str.replace(' ', 'T')
                if '+' not in date_str and 'Z' not in date_str: date_str += '+00:00'
                    
                start_date = datetime.fromisoformat(date_str)
                if start_date.tzinfo is None: start_date = start_date.replace(tzinfo=timezone.utc)
                days_passed = (datetime.now(timezone.utc) - start_date).days
                
                if progress > 0 and progress < 100:
                    total_est = (days_passed * 100) / progress
                    days_left = max(0, round(total_est - days_passed))
                elif progress >= 100:
                    days_left = 0
                else:
                    # Fallback: use default days for this type
                    from_defaults = database.query_db('SELECT days FROM type_defaults WHERE type = ?', (m['type'],), one=True)
                    if from_defaults:
                        days_left = max(0, from_defaults['days'] - days_passed)
        except Exception as e:
            print(f"DEBUG: Erreur estimation {m['name']}: {e}")

        icon = TYPE_ICONS.get(m['type'], '🥩')
        try:
            # Format display date
            d_obj = datetime.fromisoformat(last_date_str.replace('Z', '+00:00'))
            display_date = d_obj.strftime('%d/%m/%Y')
        except:
            display_date = last_date_str

        msg += f"{icon} <b>{m['name']}</b>\n"
        msg += f"┣ Date : {display_date}\n"
        msg += f"┣ Avancement : {progress}%\n"
        msg += f"┣ Poids : {current_w}g\n"
        msg += f"┗ Reste : ~{days_left} jours\n\n"
    
    return send_telegram_message(token, chat_id, msg)

@app.route('/api/telegram/test', methods=['POST'])
def test_telegram():
    settings = database.query_db('SELECT * FROM telegram_settings WHERE id = 1', one=True)
    if not settings or not settings['token'] or not settings['chat_id']:
        return jsonify({'error': 'Configuration incomplète'}), 400
    ok = send_telegram_message(settings['token'], settings['chat_id'], "🥩 <b>Cave d'Affinage</b>\nCeci est un message de test !")
    return jsonify({'success': ok})

def run_notification_check():
    print("🔍 Vérification des notifications Telegram...", flush=True)
    settings = database.query_db('SELECT * FROM telegram_settings WHERE id = 1', one=True)
    if not settings:
        print("⚠️ Pas de réglages Telegram trouvés.", flush=True)
        return 0
    print(f"⚙️ Settings: Enabled={settings['enabled']}, Interval={settings['interval_days']}j, Token={'OK' if settings['token'] else 'Manquant'}", flush=True)
    
    if not settings['enabled']:
        print("ℹ️ Notifications Telegram désactivées.", flush=True)
        return 0
    if not settings['token'] or not settings['chat_id']:
        print("⚠️ Token ou Chat ID manquant.", flush=True)
        return 0
    
    count = 0
    # On enlève la condition archived = 0 temporairement ou on vérifie les valeurs
    meats = database.query_db('SELECT * FROM meats')
    now = datetime.now(timezone.utc)
    print(f"📋 Analyse de {len(meats)} pièces au total (Seuil: {settings['interval_days']} jours)", flush=True)

    for m in meats:
        if m.get('archived'): 
            print(f"  - {m['name']}: Ignoré (Archivé)", flush=True)
            continue
            
        # Chercher la dernière pesée
        last_w = database.query_db('SELECT date FROM weight_entries WHERE meatId = ? ORDER BY date DESC LIMIT 1', (m['id'],), one=True)
        
        date_to_check = None
        if last_w:
            date_to_check = last_w['date']
            source = "dernière pesée"
        else:
            date_to_check = m.get('startDate') or m.get('date')
            source = "date de création"
        
        if date_to_check:
            # Robust date parsing
            date_str = date_to_check.replace('Z', '+00:00')
            if ' ' in date_str and 'T' not in date_str:
                date_str = date_str.replace(' ', 'T')
                
            try:
                last_date = datetime.fromisoformat(date_str)
                # Ensure it's aware
                if last_date.tzinfo is None:
                    last_date = last_date.replace(tzinfo=timezone.utc)
                
                delta = now - last_date
                days_since = delta.days
                
                print(f"  - {m['name']}: {days_since}j depuis {source} ({date_to_check})", flush=True)
                
                if days_since >= settings['interval_days']:
                    # Cooldown 24h pour les rappels
                    last_notif_str = m.get('lastNotificationDate')
                    if last_notif_str:
                        last_notif_dt = datetime.fromisoformat(last_notif_str)
                        if last_notif_dt.tzinfo is None: last_notif_dt = last_notif_dt.replace(tzinfo=timezone.utc)
                        if (now - last_notif_dt).total_seconds() < 24 * 3600:
                            print(f"    ⏳ Notification déjà envoyée il y a moins de 24h pour {m['name']}", flush=True)
                            continue

                    msg = f"🥩 <b>Rappel de pesée</b>\nLa pièce <b>{m['name']}</b> n'a pas été pesée depuis {days_since} jours."
                    if send_telegram_message(settings['token'], settings['chat_id'], msg):
                        count += 1
                        database.execute_db('UPDATE meats SET lastNotificationDate = ? WHERE id = ?', (now.isoformat(), m['id']))
                        print(f"    ✅ Notification envoyée pour {m['name']}", flush=True)
                    else:
                        print(f"    ❌ Échec de l'envoi Telegram pour {m['name']}", flush=True)
            except Exception as de:
                print(f"    ❌ Erreur format date pour {m['name']} ({date_to_check}): {de}", flush=True)
    
    print(f"🏁 Vérification terminée. {count} notifications envoyées.", flush=True)
    
    # --- Part 2: Periodic Status Reports ---
    if settings['enabled'] and settings['report_frequency'] != 'off':
        now_dt = datetime.now(timezone.utc)
        last_rep_str = settings.get('last_report_date')
        should_send = False
        
        if not last_rep_str:
            should_send = True
        else:
            try:
                last_rep_date = datetime.fromisoformat(last_rep_str)
                if last_rep_date.tzinfo is None: last_rep_date = last_rep_date.replace(tzinfo=timezone.utc)
                
                diff = now_dt - last_rep_date
                freq = settings['report_frequency']
                if freq == 'daily' and diff.days >= 1: should_send = True
                elif freq == 'weekly' and diff.days >= 7: should_send = True
                elif freq == 'monthly' and diff.days >= 30: should_send = True
            except:
                should_send = True
        
        if should_send:
            print(f"📢 Envoi du rapport périodique ({settings['report_frequency']})...", flush=True)
            if send_status_report(settings['token'], settings['chat_id']):
                database.execute_db('UPDATE telegram_settings SET last_report_date = ? WHERE id = 1', (now_dt.isoformat(),))
                print("✅ Rapport périodique envoyé.", flush=True)

    return count

@app.route('/api/telegram/check', methods=['POST'])
def manual_telegram_check():
    try:
        count = run_notification_check()
        return jsonify({'success': True, 'notifications_sent': count})
    except Exception as e:
        print(f"❌ Erreur check manuel: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/telegram/report', methods=['POST'])
def manual_telegram_report():
    try:
        settings = database.query_db('SELECT * FROM telegram_settings WHERE id = 1', one=True)
        if not settings or not settings['token'] or not settings['chat_id']:
            return jsonify({'error': 'Configuration incomplète'}), 400
        ok = send_status_report(settings['token'], settings['chat_id'])
        return jsonify({'success': ok})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def notification_worker():
    print("🔔 Notification worker : attente de 5 minutes avant le premier passage...", flush=True)
    time.sleep(300) # Délai de démarrage (5 min) pour éviter le burst
    print("🔔 Notification worker démarré", flush=True)
    while True:
        try:
            run_notification_check()
            # Sleep for 12 hours between checks
            time.sleep(12 * 3600)
        except Exception as e:
            print(f"❌ Erreur worker : {e}", flush=True)
            time.sleep(60)

# Start background threads
threading.Thread(target=notification_worker, daemon=True).start()
threading.Thread(target=_github_backup_worker, daemon=True).start()

@app.route('/api/health')
def health():
    return jsonify({'status': 'ok', 'https': USE_HTTPS, 'timestamp': datetime.now(timezone.utc).isoformat()})

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, 'index.html')

def start_https():
    cert_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'certs')
    cert_file = os.path.join(cert_dir, 'cert.pem')
    key_file = os.path.join(cert_dir, 'key.pem')
    
    if not os.path.exists(cert_file) or not os.path.exists(key_file):
        print('🔐 Génération du certificat auto-signé...')
        os.makedirs(cert_dir, exist_ok=True)
        try:
            subprocess.run(
                ['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-keyout', key_file, '-out', cert_file,
                 '-days', '3650', '-nodes', '-subj', '/CN=cave-affinage/O=Cave/C=FR'],
                check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE
            )
            print('✅ Certificat généré dans', cert_dir)
        except subprocess.CalledProcessError:
            print('❌ openssl non disponible. Installez openssl : sudo apt install openssl (sous Windows, utilisez Git Bash ou installez openssl)')
            exit(1)
            
    print(f"🥩 Cave d'Affinage → https://0.0.0.0:{PORT}")
    print(f"📷 Caméra QR activée (HTTPS)")
    print(f"⚠️  Certificat auto-signé : acceptez l'avertissement du navigateur.")
    app.run(host='0.0.0.0', port=PORT, ssl_context=(cert_file, key_file))

if __name__ == '__main__':
    if USE_HTTPS:
        start_https()
    else:
        print(f"🥩 Cave d'Affinage → http://0.0.0.0:{PORT}")
        print(f"⚠️  Caméra QR désactivée en HTTP. Lancez avec HTTPS=true pour l'activer.")
        app.run(host='0.0.0.0', port=PORT)
