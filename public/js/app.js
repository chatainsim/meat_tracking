// ══════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════
var meats = [];
var currentMeat = null;
var cameraStream = null;
var scanningInterval = null;
var currentListView = 'list';
var quickWeighMeatId = null;
var weighInterval = 7;       // days between weigh reminders, synced from Telegram settings
var _dashSensorData = null;  // cached sensor data for dashboard
var listSort = 'status';     // 'status'|'date'|'progress'|'eta'|'type'
var listFilterType = '';
var listFilterStatus = '';
var tourList = [];
var tourIdx = 0;
var recipes = [];

// Populated from /api/types — single source of truth
var TYPES = {};      // { id: { id, label, icon, days, loss } }
var TYPE_ORDER = []; // ordered list of ids

function typeIcon(t)  { return (TYPES[t] && TYPES[t].icon)  || '🥩'; }
function typeLabel(t) { return (TYPES[t] && TYPES[t].label) || t; }

function buildTypeOptions(selected) {
  return TYPE_ORDER.map(function (id) {
    var t = TYPES[id];
    var text = t ? (t.icon + ' ' + t.label) : id;
    return '<option value="' + id + '"' + (id === selected ? ' selected' : '') + '>' + text + '</option>';
  }).join('');
}

async function loadTypes() {
  try {
    var list = await apiFetch('/api/types');
    TYPES = {};
    TYPE_ORDER = [];
    list.forEach(function (t) { TYPES[t.id] = t; TYPE_ORDER.push(t.id); });
    var sel = document.getElementById('meat-type');
    if (sel) sel.innerHTML = buildTypeOptions(sel.value || TYPE_ORDER[0]);
    var tf = document.getElementById('list-filter-type');
    if (tf) tf.innerHTML = '<option value="">Tous les types</option>' +
      TYPE_ORDER.map(function (id) { return '<option value="' + id + '">' + (TYPES[id] ? TYPES[id].label : id) + '</option>'; }).join('');
    applyTypeDefaults();
  } catch (e) {
    console.error('loadTypes:', e);
  }
}

// ══════════════════════════════════════════════════════
// API
// ══════════════════════════════════════════════════════
async function apiFetch(url, opts) {
  opts = opts || {};
  var res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    method: opts.method || 'GET',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    var e = await res.json().catch(function () { return {}; });
    var msg = e.error || 'HTTP ' + res.status;
    if (e.details && e.details.length) {
      msg += ' — ' + e.details.map(function (d) { return (d.field ? d.field + ' : ' : '') + d.msg; }).join(' | ');
    }
    throw new Error(msg);
  }
  return res.json();
}

async function loadMeats() {
  try {
    meats = await apiFetch('/api/meats');
    renderList();
    var dbView = document.getElementById('dashboard-view');
    if (dbView && dbView.classList.contains('active')) renderDashboard();
  } catch (e) {
    showToast('Erreur serveur', 'error');
  }
}

// ══════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════
function showToast(msg, type) {
  type = type || 'ok';
  var t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  var styles = {
    ok: 'background:#1a2e1a;color:#7aaa8a;border:1px solid rgba(90,138,106,.4);',
    error: 'background:#2e1a1a;color:#e06050;border:1px solid rgba(184,64,42,.4);',
    info: 'background:#1a1e2e;color:#7aaaca;border:1px solid rgba(58,106,154,.4);',
  };
  t.style.cssText = 'position:fixed;bottom:1.75rem;right:1.75rem;padding:.7rem 1.1rem;border-radius:8px;font-size:.8rem;font-weight:500;z-index:9999;pointer-events:none;max-width:300px;' + (styles[type] || styles.ok);
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(function () { t.classList.remove('show'); }, 3000);
}

// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// THEME
// ══════════════════════════════════════════════════════
function toggleTheme(isDark) {
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  try { localStorage.setItem('cave-theme', isDark ? 'dark' : 'light'); } catch (e) { }
}

function initTheme() {
  var saved = null;
  try { saved = localStorage.getItem('cave-theme'); } catch (e) { }
  // Défaut : sombre
  var isDark = saved ? saved === 'dark' : true;
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  var cb = document.getElementById('theme-checkbox');
  if (cb) cb.checked = isDark;
}

document.addEventListener('DOMContentLoaded', function () {
  initTheme();
  loadTypes().then(loadMeats);
  loadRecipes();
  loadAppSettings();
  loadNetworkSettings();
  loadTelegramSettings();
  document.getElementById('meat-date').valueAsDate = new Date();
  refreshSensors();
  loadSensorSettings();
  setInterval(refreshSensors, 60000);
  document.getElementById('scan-input').addEventListener('keypress', function (e) { if (e.key === 'Enter') scanManual(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeQuickWeigh(); closeTour(); closeSaveRecipeModal(); } });
  // Live SSV hints on weight/seasoning input
  var wInput = document.getElementById('meat-weight');
  if (wInput) wInput.addEventListener('input', updateSeasoningHints);
  var saltInput = document.getElementById('meat-salt');
  var sugarInput = document.getElementById('meat-sugar');
  var spicesInput = document.getElementById('meat-spices');
  if (saltInput) saltInput.addEventListener('input', updateSeasoningHints);
  if (sugarInput) sugarInput.addEventListener('input', updateSeasoningHints);
  if (spicesInput) spicesInput.addEventListener('input', updateSeasoningHints);
});

function loadNetworkSettings() {
  fetch('/api/config')
    .then(function (res) { return res.json(); })
    .then(function (cfg) {
      var portEl = document.getElementById('setting-port');
      var httpsEl = document.getElementById('setting-https');
      if (portEl) portEl.value = cfg.PORT || 3000;
      if (httpsEl) httpsEl.checked = !!cfg.HTTPS;
    })
    .catch(function (e) { console.error('Erreur chargement config réseau:', e); });
}

async function saveNetworkSettings() {
  var portEl = document.getElementById('setting-port');
  var httpsEl = document.getElementById('setting-https');
  var port = parseInt(portEl ? portEl.value : 3000);
  if (!port || port < 1 || port > 65535) {
    showToast('Port invalide (1–65535)', 'error');
    return;
  }
  try {
    await apiFetch('/api/config', { method: 'PUT', body: { PORT: port, HTTPS: httpsEl ? httpsEl.checked : false } });
    showToast('Configuration réseau enregistrée ✓ — Redémarrez le serveur pour appliquer.', 'info');
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

function refreshSensors() {
  fetch('/api/sensors')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var el = document.getElementById('sensor-display');
      if (!el) return;
      var cur = data.current;
      var set = data.settings;
      if (!cur || cur.temperature === undefined || cur.temperature === null) {
        el.style.display = 'none';
        return;
      }
      el.style.display = 'flex';
      var tEl = document.getElementById('sensor-temp');
      var hEl = document.getElementById('sensor-hum');

      if (tEl) {
        tEl.innerText = cur.temperature.toFixed(1) + '°C';
        if (set && set.temp_min !== undefined) {
          var isOk = cur.temperature >= set.temp_min && cur.temperature <= set.temp_max;
          tEl.classList.remove('ok', 'alert');
          tEl.classList.add(isOk ? 'ok' : 'alert');
        }
      }
      if (hEl) {
        hEl.innerText = cur.humidity.toFixed(1) + '%';
        if (set && set.hum_min !== undefined) {
          var isOk = cur.humidity >= set.hum_min && cur.humidity <= set.hum_max;
          hEl.classList.remove('ok', 'alert');
          hEl.classList.add(isOk ? 'ok' : 'alert');
        }
      }

      // Check if data is stale (> 30 mins)
      var last = new Date(cur.updatedAt);
      var now = new Date();
      if (now - last > 30 * 60 * 1000) {
        el.classList.add('sensor-stale');
        el.title = 'Données potentiellement obsolètes (' + last.toLocaleTimeString() + ')';
      } else {
        el.classList.remove('sensor-stale');
        el.title = 'Dernière mise à jour : ' + last.toLocaleTimeString();
      }
    })
    .catch(function (err) { console.error('Error fetching sensors:', err); });
}

function loadSensorSettings() {
  fetch('/api/sensors/settings')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (!data || data.id === undefined) return;
      var sminT = document.getElementById('setting-temp-min');
      var smaxT = document.getElementById('setting-temp-max');
      var sminH = document.getElementById('setting-hum-min');
      var smaxH = document.getElementById('setting-hum-max');
      var sAlert = document.getElementById('setting-alerts-enabled');
      if (sminT) sminT.value = data.temp_min;
      if (smaxT) smaxT.value = data.temp_max;
      if (sminH) sminH.value = data.hum_min;
      if (smaxH) smaxH.value = data.hum_max;
      if (sAlert) sAlert.checked = !!data.alerts_enabled;
    });
}

async function saveSensorSettings() {
  var body = {
    temp_min: parseFloat(document.getElementById('setting-temp-min').value),
    temp_max: parseFloat(document.getElementById('setting-temp-max').value),
    hum_min: parseFloat(document.getElementById('setting-hum-min').value),
    hum_max: parseFloat(document.getElementById('setting-hum-max').value),
    alerts_enabled: document.getElementById('setting-alerts-enabled').checked ? 1 : 0
  };
  try {
    await apiFetch('/api/sensors/settings', { method: 'PUT', body: body });
    showToast('Seuils enregistrés ✓');
    refreshSensors();
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

function openSensorHelp() {
  var m = document.getElementById('sensor-help-modal');
  if (m) m.classList.add('open');
}

function closeSensorHelp() {
  var m = document.getElementById('sensor-help-modal');
  if (m) m.classList.remove('open');
}

// ══════════════════════════════════════════════════════
// DEFAULTS
// ══════════════════════════════════════════════════════
function applyTypeDefaults() {
  var sel = document.getElementById('meat-type');
  if (!sel) return;
  var d = TYPES[sel.value] || { days: 60, loss: 30 };
  document.getElementById('meat-target-days').value = d.days;
  document.getElementById('meat-target-loss').value = d.loss;
  updateSeasoningHints();
  populateRecipeSelector();
}

function updateSeasoningHints() {
  var wEl = document.getElementById('meat-weight');
  var w = wEl ? parseFloat(wEl.value) : 0;
  var saltEl = document.getElementById('meat-salt');
  var sugarEl = document.getElementById('meat-sugar');
  var sh = document.getElementById('salt-pct-hint');
  var ugh = document.getElementById('sugar-pct-hint');
  var sph = document.getElementById('spices-pct-hint');
  if (!w || w <= 0) return;
  // Auto-fill with SSV 421 defaults if empty or matches previous auto-fill
  if (saltEl) {
    var newSalt = (w * 0.045).toFixed(1);
    if (!saltEl.value || saltEl.dataset.autoVal === saltEl.value) {
      saltEl.value = newSalt;
      saltEl.dataset.autoVal = newSalt;
    }
  }
  if (sugarEl) {
    var newSugar = (w * 0.020).toFixed(1);
    if (!sugarEl.value || sugarEl.dataset.autoVal === sugarEl.value) {
      sugarEl.value = newSugar;
      sugarEl.dataset.autoVal = newSugar;
    }
  }
  // Show % hints
  if (sh && saltEl && saltEl.value) {
    var sp = (parseFloat(saltEl.value) / w * 100).toFixed(1);
    sh.textContent = sp + '% du poids — recommandé : 3 à 6%';
    sh.style.color = (sp >= 3 && sp <= 6) ? 'var(--sage)' : 'var(--warn)';
  }
  if (ugh && sugarEl && sugarEl.value) {
    var up = (parseFloat(sugarEl.value) / w * 100).toFixed(1);
    ugh.textContent = up + '% du poids — recommandé : ~2%';
    ugh.style.color = (up >= 1 && up <= 3) ? 'var(--sage)' : 'var(--warn)';
  }
  if (sph) {
    var ep = (w * 0.010).toFixed(1);
    sph.textContent = 'Dose indicative : ' + ep + 'g (1% du poids)';
    sph.style.color = 'var(--muted)';
  }
}

// ══════════════════════════════════════════════════════
// SPICES MANAGEMENT
// ══════════════════════════════════════════════════════
function addSpiceItem(inputId, containerId, hiddenId) {
  inputId = inputId || 'spice-input';
  containerId = containerId || 'spices-container';
  hiddenId = hiddenId || 'meat-spices';
  var input = document.getElementById(inputId);
  if (!input || !input.value.trim()) return;
  var spice = input.value.trim();

  var hidden = document.getElementById(hiddenId);
  var currentSpices = hidden.value ? hidden.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
  if (currentSpices.indexOf(spice) === -1) {
    currentSpices.push(spice);
    hidden.value = currentSpices.join(', ');
    renderSpices(containerId, hiddenId);
    input.value = '';
    updateSeasoningHints();
  }
}

function removeSpiceItem(index, containerId, hiddenId) {
  containerId = containerId || 'spices-container';
  hiddenId = hiddenId || 'meat-spices';
  var hidden = document.getElementById(hiddenId);
  var currentSpices = hidden.value ? hidden.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
  currentSpices.splice(index, 1);
  hidden.value = currentSpices.join(', ');
  renderSpices(containerId, hiddenId);
  updateSeasoningHints();
}

function renderSpices(containerId, hiddenId) {
  containerId = containerId || 'spices-container';
  hiddenId = hiddenId || 'meat-spices';
  var container = document.getElementById(containerId);
  var hidden = document.getElementById(hiddenId);
  if (!container || !hidden) return;

  var currentSpices = hidden.value ? hidden.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
  container.innerHTML = currentSpices.map(function (s, idx) {
    return '<span class="pill" style="background:var(--ink4); color:var(--ivory2); font-weight:normal; border:1px solid var(--border); padding: 0.2rem 0.5rem;">' +
      s +
      ' <span style="margin-left:6px;cursor:pointer;color:var(--muted);font-size:1.1em;line-height:1;" onclick="removeSpiceItem(' + idx + ', \'' + containerId + '\', \'' + hiddenId + '\')">&times;</span>' +
      '</span>';
  }).join('');
}

// ══════════════════════════════════════════════════════
// ADD MEAT
// ══════════════════════════════════════════════════════
async function addMeat(ev) {
  ev.preventDefault();
  var id = Date.now().toString();
  var startDate = document.getElementById('meat-date').value;
  var initialWeight = parseFloat(document.getElementById('meat-weight').value);
  var saltVal = document.getElementById('meat-salt').value;
  var sugarVal = document.getElementById('meat-sugar').value;
  var spicesVal = document.getElementById('meat-spices').value.trim();
  var notesVal = document.getElementById('meat-notes').value.trim();
  var priceVal = document.getElementById('meat-price').value;
  var meat = {
    id: id,
    name: document.getElementById('meat-name').value,
    type: document.getElementById('meat-type').value,
    initialWeight: initialWeight,
    startDate: startDate,
    targetDays: parseInt(document.getElementById('meat-target-days').value),
    targetLoss: parseFloat(document.getElementById('meat-target-loss').value),
    salt: saltVal ? parseFloat(saltVal) : null,
    sugar: sugarVal ? parseFloat(sugarVal) : null,
    spices: spicesVal || null,
    notes: notesVal || null,
    price: priceVal ? parseFloat(priceVal) : null,
    smoked: document.getElementById('meat-smoked').checked ? 1 : 0,
    archived: 0,
    weights: [{ weight: initialWeight, date: startDate }],
  };
  try {
    await apiFetch('/api/meats', { method: 'POST', body: meat });
    await loadMeats();
    document.getElementById('add-meat-form').reset();
    renderSpices('spices-container', 'meat-spices');
    document.getElementById('meat-date').valueAsDate = new Date();
    applyTypeDefaults();
    showView('list');
    showToast('Pièce ajoutée ✓');
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

// ══════════════════════════════════════════════════════
// MATURATION CALC
// ══════════════════════════════════════════════════════
function calcMat(meat) {
  var cw = meat.weights[meat.weights.length - 1].weight;
  var loss = ((meat.initialWeight - cw) / meat.initialWeight) * 100;
  var days = Math.floor((new Date() - new Date(meat.startDate)) / 86400000);
  var tLoss = meat.targetLoss || 30;
  var tDays = meat.targetDays || 60;
  var lp = Math.min(loss / tLoss, 1);
  var dp = Math.min(days / tDays, 1);
  var progress = Math.round(((lp + dp) / 2) * 100);
  var status, label, color;
  if (meat.archived) { status = 'eaten'; label = 'Mangé / Archivé'; color = 'var(--muted)'; }
  else if (loss < tLoss * 0.5) { status = 'curing'; label = 'En séchage'; color = 'var(--blue)'; }
  else if (loss < tLoss * 0.85) { status = 'almost'; label = 'Bientôt prêt'; color = 'var(--warn)'; }
  else if (loss <= tLoss * 1.15) { status = 'ready'; label = 'Prêt à déguster'; color = 'var(--sage)'; }
  else { status = 'over'; label = 'Peut-être trop sec'; color = 'var(--danger)'; }
  return { loss: loss, days: days, status: status, label: label, color: color, progress: progress, tLoss: tLoss, tDays: tDays };
}

// Velocity-based ETA: uses last 3 intervals; falls back to target rate with 1 weighing.
// Returns { daysLeft, eta:Date, ratePerDay } or null if indeterminate.
function calcEta(meat) {
  var sorted = meat.weights.slice().sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
  var tLoss = meat.targetLoss || 30;
  var currentLoss = (meat.initialWeight - sorted[sorted.length - 1].weight) / meat.initialWeight * 100;
  var remaining = tLoss - currentLoss;
  if (remaining <= 0) return { daysLeft: 0, eta: new Date(sorted[sorted.length - 1].date), ratePerDay: 0 };

  var rate = null;
  if (sorted.length >= 2) {
    var N = Math.min(sorted.length - 1, 3);
    var sumLoss = 0, sumDays = 0;
    for (var i = sorted.length - N; i < sorted.length; i++) {
      sumDays += (new Date(sorted[i].date) - new Date(sorted[i - 1].date)) / 86400000;
      sumLoss += (sorted[i - 1].weight - sorted[i].weight) / meat.initialWeight * 100;
    }
    if (sumDays > 0 && sumLoss > 0) rate = sumLoss / sumDays;
  }
  if (rate === null) {
    // Fallback: target rate
    var targetRate = tLoss / (meat.targetDays || 60);
    if (targetRate <= 0) return null;
    rate = targetRate;
  }
  var daysLeft = Math.max(0, Math.round(remaining / rate));
  var base = new Date(sorted[sorted.length - 1].date);
  base.setDate(base.getDate() + daysLeft);
  return { daysLeft: daysLeft, eta: base, ratePerDay: rate };
}

function formatWeight(g) {
  if (g >= 1000) return (g / 1000).toFixed(2) + ' kg';
  return Math.round(g) + ' g';
}

// Returns { current, projected } price in €/kg, or null if no price set.
// current  = price / current_weight_in_kg
// projected = price / weight_at_target_loss_in_kg
function calcPricePerKg(meat) {
  if (!meat.price) return null;
  var lastW = meat.weights[meat.weights.length - 1].weight;
  var targetW = meat.initialWeight * (1 - (meat.targetLoss || 30) / 100);
  return {
    current:   meat.price / (lastW    / 1000),
    projected: meat.price / (targetW  / 1000),
  };
}

// ══════════════════════════════════════════════════════
// RENDER LIST
// ══════════════════════════════════════════════════════
function buildMeatCard(m) {
  var mat = calcMat(m);
  var c = mat.status === 'ready' ? 'var(--sage)' :
    mat.status === 'almost' ? 'var(--warn)' :
    mat.status === 'over' ? 'var(--danger)' :
    mat.status === 'eaten' ? 'var(--muted)' : 'var(--blue)';
  var eta = calcEta(m);
  var ppkg = calcPricePerKg(m);
  var done = mat.status === 'ready' || mat.status === 'over' || mat.status === 'eaten';
  var etaMetric;
  // For finished pieces with a price, replace the redundant "✓ Prêt" ETA with actual price/kg
  if (done && ppkg) {
    etaMetric = '<div class="metric"><div class="metric-k">Prix / kg réel</div><div class="metric-v" style="color:var(--copper2);">' + ppkg.current.toFixed(2) + ' <small>€/kg</small></div></div>';
  } else if (!eta || m.archived) {
    etaMetric = '<div class="metric"><div class="metric-k">Durée</div><div class="metric-v">' + mat.days + 'j <small>/ ' + mat.tDays + 'j</small></div></div>';
  } else if (eta.daysLeft === 0) {
    etaMetric = '<div class="metric"><div class="metric-k">Fin est.</div><div class="metric-v" style="color:var(--sage2);font-size:.75rem;">✓ Prêt</div></div>';
  } else {
    var etaFmt = eta.eta.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    etaMetric = '<div class="metric"><div class="metric-k">Fin est.</div><div class="metric-v" style="font-size:.72rem;">' + etaFmt + ' <small>~' + eta.daysLeft + 'j</small></div></div>';
  }
  var card = document.createElement('div');
  card.className = 'meat-card';
  card.dataset.id = m.id;
  card.innerHTML =
    '<div class="card-stripe" style="background:linear-gradient(90deg,' + c + ',transparent)"></div>' +
    '<div class="card-body">' +
    '<div class="card-top">' +
    '<div>' +
    '<div class="card-name"><span style="margin-right:6px;">' + typeIcon(m.type) + '</span>' + m.name +
    (m.smoked ? ' <span title="Fumé" style="font-size:0.9rem;margin-left:4px;filter:grayscale(1) brightness(1.5);">💨</span>' : '') +
    '</div>' +
    '<div class="card-type">' + typeLabel(m.type) + '</div>' +
    '</div>' +
    '<span class="card-progress-label">' + mat.progress + '%</span>' +
    '</div>' +
    '<div class="track"><div class="track-fill" style="width:' + mat.progress + '%;background:' + c + ';"></div></div>' +
    '<div class="card-metrics">' +
    '<div class="metric"><div class="metric-k">Perte</div><div class="metric-v">' + mat.loss.toFixed(1) + '% <small>/ ' + mat.tLoss + '%</small></div></div>' +
    etaMetric +
    '</div>' +
    (!done && ppkg ? '<div class="card-ppkg">Prix/kg estimé <strong>' + ppkg.projected.toFixed(2) + ' €/kg</strong> <span>à objectif</span></div>' : '') +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;">' +
    '<span class="pill" style="background:' + c + '22;color:' + c + ';border:1px solid ' + c + '44;">' + mat.label + '</span>' +
    '<div style="display:flex;gap:4px;">' +
    '<button class="card-print-btn" onclick="event.stopPropagation();printLabels(\'' + m.id + '\',\'tracking\')" title="Étiquette QR">🔍</button>' +
    '<button class="card-print-btn" onclick="event.stopPropagation();printLabels(\'' + m.id + '\',\'final\')" title="Étiquette finale">⭐</button>' +
    '<button class="card-weigh-btn" onclick="quickWeigh(\'' + m.id + '\',event)" title="Pesée rapide">+</button>' +
    '</div>' +
    '</div>' +
    '</div>';
  card.addEventListener('click', function () { showMeatDetail(m.id); });
  return card;
}

function renderList() {
  var isArchive = currentListView === 'archive';
  var displayMeats = meats.filter(function (m) { return !!m.archived === isArchive; });

  // Filters
  if (listFilterType)   displayMeats = displayMeats.filter(function (m) { return m.type === listFilterType; });
  if (listFilterStatus) displayMeats = displayMeats.filter(function (m) { return calcMat(m).status === listFilterStatus; });

  // Sort
  if (listSort !== 'status') {
    displayMeats = displayMeats.slice().sort(function (a, b) {
      if (listSort === 'date')     return new Date(a.startDate) - new Date(b.startDate);
      if (listSort === 'progress') return calcMat(b).progress - calcMat(a).progress;
      if (listSort === 'eta') {
        var ea = calcEta(a), eb = calcEta(b);
        return (ea ? ea.daysLeft : 9999) - (eb ? eb.daysLeft : 9999);
      }
      if (listSort === 'type') return typeLabel(a.type).localeCompare(typeLabel(b.type));
      return 0;
    });
  }

  // Sync clear-filter button visibility
  var clearBtn = document.getElementById('list-clear-btn');
  if (clearBtn) clearBtn.style.display = (listFilterType || listFilterStatus || listSort !== 'status') ? 'inline-flex' : 'none';

  var el = document.getElementById('meat-list');
  var countEl = document.getElementById('meat-count');
  var weightEl = document.getElementById('meat-total-weight');
  if (countEl) countEl.textContent = displayMeats.length + (displayMeats.length > 1 ? ' pièces' : ' pièce');

  if (weightEl) {
    var totalW = displayMeats.reduce(function (sum, m) {
      var lastW = m.weights[m.weights.length - 1].weight;
      return sum + lastW;
    }, 0);
    weightEl.textContent = formatWeight(totalW);
  }

  if (!displayMeats.length) {
    el.innerHTML = '';
    var emptyDiv = document.createElement('div');
    emptyDiv.className = 'empty';
    emptyDiv.style.cssText = 'grid-column:1/-1';
    if (isArchive) {
      emptyDiv.innerHTML = '<div class="empty-icon">📦</div><h3>Aucune archive</h3><p>Vous n\'avez pas encore archivé de pièces.</p>';
      var btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.style.marginTop = '1.5rem';
      btn.textContent = 'Retour aux pièces →';
      btn.onclick = function () { showView('list'); };
      emptyDiv.appendChild(btn);
    } else {
      emptyDiv.innerHTML = '<div class="empty-icon">🥩</div><h3>Cave vide</h3><p>Aucune pièce en cours de maturation.<br>Commencez par en ajouter une.</p>';
      var btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.style.marginTop = '1.5rem';
      btn.textContent = 'Nouvelle pièce →';
      btn.onclick = function () { showView('add'); };
      emptyDiv.appendChild(btn);
    }
    el.appendChild(emptyDiv);
    return;
  }

  el.innerHTML = '';

  if (listSort !== 'status') {
    // ── Flat sorted grid ──────────────────────────────
    var flatGrid = document.createElement('div');
    flatGrid.className = 'grid';
    displayMeats.forEach(function (m) { flatGrid.appendChild(buildMeatCard(m)); });
    el.appendChild(flatGrid);
    updateSettingsStats();
    return;
  }

  // ── Grouped by status ─────────────────────────────
  var GROUPS = [
    { status: 'ready', label: 'Prêtes à déguster', color: 'var(--sage)', icon: '✦' },
    { status: 'almost', label: 'Bientôt prêtes', color: 'var(--warn)', icon: '◎' },
    { status: 'curing', label: 'En séchage', color: 'var(--blue)', icon: '○' },
    { status: 'over', label: 'Peut-être trop sec', color: 'var(--danger)', icon: '△' },
    { status: 'eaten', label: 'Archivées', color: 'var(--muted)', icon: '📦' },
  ];

  GROUPS.forEach(function (g) {
    var group = displayMeats.filter(function (m) { return calcMat(m).status === g.status; });
    if (!group.length) return;

    // Group wrapper
    var groupDiv = document.createElement('div');
    groupDiv.className = 'status-group';
    groupDiv.style.cssText = 'grid-column:1/-1';

    // Header
    var header = document.createElement('div');
    header.className = 'group-header';
    header.innerHTML =
      '<div class="group-label" style="color:' + g.color + ';">' +
      '<span>' + g.icon + '</span>' +
      '<span>' + g.label + '</span>' +
      '<span class="group-count" style="border-color:' + g.color + ';color:' + g.color + ';">' + group.length + '</span>' +
      '</div>' +
      '<div class="group-line"></div>';
    groupDiv.appendChild(header);

    // Grid of cards
    var grid = document.createElement('div');
    grid.className = 'grid';

    group.forEach(function (m) { grid.appendChild(buildMeatCard(m)); });

    groupDiv.appendChild(grid);
    el.appendChild(groupDiv);
  });

  updateSettingsStats();
}

// ══════════════════════════════════════════════════════
// DETAIL
// ══════════════════════════════════════════════════════
function showMeatDetail(meatId) {
  var meat = meats.find(function (m) { return m.id === meatId; });
  if (!meat) return;
  currentMeat = meat;
  var mat = calcMat(meat);
  var lastW = meat.weights[meat.weights.length - 1];

  var weightsHTML = meat.weights.slice().reverse().map(function (w, idx) {
    var ri = meat.weights.length - 1 - idx;
    var loss = ((meat.initialWeight - w.weight) / meat.initialWeight) * 100;
    var eid = w.id || '';
    var delBtn = meat.weights.length > 1 ? '<button class="ibtn del" onclick="deleteWeight(' + ri + ',\'' + eid + '\')" title="Supprimer">✕</button>' : '';
    return '<div class="wentry" id="we-' + ri + '">' +
      '<div class="wentry-main">' +
      '<div class="wentry-g">' + w.weight + 'g</div>' +
      '<div class="wentry-d">' + new Date(w.date).toLocaleDateString('fr-FR') + '</div>' +
      '</div>' +
      '<span class="wentry-loss" style="color:' + (loss > 0 ? 'var(--danger)' : 'var(--sage)') + ';">' + (loss > 0 ? '-' : '+') + Math.abs(loss).toFixed(1) + '%</span>' +
      '<div class="wentry-actions">' +
      '<button class="ibtn" onclick="startEditW(' + ri + ',\'' + eid + '\')" title="Modifier">✎</button>' +
      delBtn +
      '</div>' +
      '</div>' +
      '<div class="wedit" id="wed-' + ri + '" style="display:none;">' +
      '<input type="number" id="wev-' + ri + '" value="' + w.weight + '" min="1" placeholder="g">' +
      '<input type="date" id="wed2-' + ri + '" value="' + w.date + '">' +
      '<button class="btn btn-primary btn-sm" onclick="saveEditW(' + ri + ',\'' + eid + '\')">✓</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="cancelEditW(' + ri + ')">✕</button>' +
      '</div>';
  }).join('');

  var stripeColor = mat.status === 'ready' ? 'var(--sage)' : mat.status === 'almost' ? 'var(--warn)' : mat.status === 'over' ? 'var(--danger)' : mat.status === 'eaten' ? 'var(--muted)' : 'var(--blue)';

  var archiveAction = meat.archived ?
    '<button class="btn btn-ghost btn-sm" onclick="toggleArchiveMeat(\'' + meat.id + '\', 0)">📦 Restaurer</button>' :
    '<button class="btn btn-ghost btn-sm" onclick="toggleArchiveMeat(\'' + meat.id + '\', 1)">📦 Archiver</button>';

  document.getElementById('detail-view').innerHTML =
    '<div style="display:flex;gap:.625rem;margin-bottom:1.5rem;flex-wrap:wrap;">' +
    '<button class="btn btn-ghost btn-sm" onclick="showView(currentListView)">← Retour</button>' +
    '<button class="btn btn-ghost btn-sm" onclick="showEditMeatForm(\'' + meat.id + '\')">✎ Modifier</button>' +
    archiveAction +
    '</div>' +
    '<div class="detail-grid">' +
    '<div>' +
    '<div class="big-name">' +
    '<span style="margin-right:8px;">' + typeIcon(meat.type) + '</span>' +
    meat.name +
    (meat.smoked ? ' <span title="Fumé" style="font-size:0.8em;margin-left:8px;filter:grayscale(1) brightness(1.5);">💨</span>' : '') +
    (meat.archived ? ' <span style="font-size:0.45em;vertical-align:middle;padding:3px 6px;border-radius:4px;background:var(--ink4);color:var(--muted);border:1px solid var(--border)">ARCHIVÉ</span>' : '') +
    '</div>' +
    '<div class="big-type">' + typeLabel(meat.type) + '</div>' +
    '<div class="status-block" style="background:' + stripeColor + '12;border:1px solid ' + stripeColor + '33;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;">' +
    '<span class="pill" style="background:' + stripeColor + '22;color:' + stripeColor + ';border:1px solid ' + stripeColor + '44;">' + mat.label + '</span>' +
    '<span style="font-family:\'Fira Code\',monospace;font-size:.8rem;color:' + stripeColor + ';">' + mat.progress + '%</span>' +
    '</div>' +
    '<div class="progress-xl"><div class="progress-xl-fill" style="width:' + mat.progress + '%;background:' + stripeColor + ';"></div></div>' +
    '<div class="three-metrics">' +
    '<div class="mbox"><div class="mbox-k">Perte</div><div class="mbox-v" style="color:' + stripeColor + ';">' + mat.loss.toFixed(1) + '%</div><div class="mbox-s">/ ' + mat.tLoss + '%</div></div>' +
    (function () {
      var eta = calcEta(meat);
      if (!eta) return '<div class="mbox"><div class="mbox-k">Durée</div><div class="mbox-v" style="color:var(--copper2);">' + mat.days + 'j</div><div class="mbox-s">/ ' + mat.tDays + 'j</div></div>';
      if (eta.daysLeft === 0) return '<div class="mbox"><div class="mbox-k">Fin estimée</div><div class="mbox-v" style="color:var(--sage2);font-size:.85rem;">✓ Atteint</div><div class="mbox-s">objectif perte</div></div>';
      var etaFmt = eta.eta.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
      var note = eta.ratePerDay ? eta.ratePerDay.toFixed(2) + '%/j' : 'cible';
      return '<div class="mbox"><div class="mbox-k">Fin estimée</div><div class="mbox-v" style="color:var(--copper2);font-size:.82rem;">' + etaFmt + '</div><div class="mbox-s">~' + eta.daysLeft + 'j · ' + note + '</div></div>';
    })() +
    (function () {
      var ppkg2 = calcPricePerKg(meat);
      var done2 = mat.status === 'ready' || mat.status === 'over' || mat.status === 'eaten';
      if (ppkg2 && done2) {
        return '<div class="mbox"><div class="mbox-k">Prix / kg réel</div><div class="mbox-v" style="color:var(--copper2);">' + ppkg2.current.toFixed(2) + ' €</div><div class="mbox-s">achat : ' + meat.price.toFixed(2) + ' €</div></div>';
      }
      return '<div class="mbox"><div class="mbox-k">Poids actuel</div><div class="mbox-v" style="color:var(--ivory2);">' + lastW.weight + 'g</div><div class="mbox-s">initial : ' + meat.initialWeight + 'g</div></div>';
    })() +
    '</div>' +
    '</div>' +

    '<div class="dcard" style="margin-top:0;">' +
    '<div class="dcard-title">Ajouter une pesée</div>' +
    '<div class="wadd">' +
    '<input type="number" id="nw" placeholder="Poids (g)" min="1">' +
    '<input type="date" id="nwd">' +
    '<button onclick="addWeight()" class="btn btn-primary">Ajouter</button>' +
    '</div>' +
    '<div class="dcard-title" style="margin-top:0.875rem;">Historique</div>' +
    '<div id="weight-history">' + weightsHTML + '</div>' +
    '</div>' +

    '<div class="chart-wrap">' +
    '<div class="chart-label">Courbe de séchage</div>' +
    '<div class="chart-canvas-wrap"><canvas id="weight-chart"></canvas></div>' +
    '<div id="chart-info" class="chart-info"></div>' +
    '</div>' +

    '<div style="margin-top:1rem;">' +
    '<button onclick="deleteMeat(\'' + meat.id + '\')" class="btn btn-danger">🗑 Supprimer cette pièce</button>' +
    '</div>' +
    '</div>' +

    '<div>' +
    '<div class="dcard qr-wrap">' +
    '<h3>' + meat.name + '</h3>' +
    '<div id="qrcode-holder"></div>' +
    '<div class="qr-id">ID : ' + meat.id + '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:.875rem;">' +
    '<button onclick="printLabels(\'' + meat.id + '\', \'tracking\')" class="btn btn-ghost btn-sm">🔍 Suivi (QR)</button>' +
    '<button onclick="printLabels(\'' + meat.id + '\', \'final\')" class="btn btn-ghost btn-sm">⭐ Finale</button>' +
    '</div>' +
    '</div>' +
    '<div class="dcard" style="margin-top:.875rem;">' +
    '<div class="dcard-title">Informations</div>' +
    '<div class="irow"><span class="irow-k">Poids initial</span><span class="irow-v">' + meat.initialWeight + 'g</span></div>' +
    '<div class="irow"><span class="irow-k">Poids actuel</span><span class="irow-v">' + lastW.weight + 'g</span></div>' +
    '<div class="irow"><span class="irow-k">Poids perdu</span><span class="irow-v">' + (meat.initialWeight - lastW.weight).toFixed(0) + 'g</span></div>' +
    '<div class="irow"><span class="irow-k">Date de début</span><span class="irow-v">' + new Date(meat.startDate).toLocaleDateString('fr-FR') + '</span></div>' +
    '<div class="irow"><span class="irow-k">Dernière pesée</span><span class="irow-v">' + new Date(lastW.date).toLocaleDateString('fr-FR') + '</span></div>' +
    (meat.smoked ? '<div class="irow"><span class="irow-k">Traitement</span><span class="irow-v">💨 Fumé</span></div>' : '') +
    (meat.price !== null && meat.price !== undefined ? '<div class="irow"><span class="irow-k">Prix d\'achat</span><span class="irow-v">' + meat.price.toFixed(2) + ' €</span></div>' : '') +
    (function () {
      var ppkg = calcPricePerKg(meat);
      if (!ppkg) return '';
      var matD = calcMat(meat);
      var done = matD.status === 'ready' || matD.status === 'over' || matD.status === 'eaten';
      var actual = '<div class="irow"><span class="irow-k">Prix/kg ' + (done ? 'réel' : 'actuel') + '</span><span class="irow-v" style="color:var(--copper2);font-weight:600;">' + ppkg.current.toFixed(2) + ' €/kg</span></div>';
      var proj = done ? '' : '<div class="irow"><span class="irow-k">Prix/kg estimé</span><span class="irow-v" style="color:var(--muted);">' + ppkg.projected.toFixed(2) + ' €/kg <span style="font-size:.7rem;">à objectif</span></span></div>';
      return actual + proj;
    })() +
    (meat.salt ? '<div class="irow"><span class="irow-k">Sel</span><span class="irow-v">' + meat.salt + 'g <span style=\'color:var(--muted);font-size:.7rem;\'>' + (meat.salt / meat.initialWeight * 100).toFixed(1) + '%</span></span></div>' : '') +
    (meat.sugar ? '<div class="irow"><span class="irow-k">Sucre</span><span class="irow-v">' + meat.sugar + 'g <span style=\'color:var(--muted);font-size:.7rem;\'>' + (meat.sugar / meat.initialWeight * 100).toFixed(1) + '%</span></span></div>' : '') +
    (meat.spices ? '<div class="irow"><span class="irow-k">Épices</span><span class="irow-v" style=\'font-family:var(--font-body, Syne);font-size:.75rem;text-align:right;max-width:130px;word-break:break-word;\'>' + meat.spices + '</span></div>' : '') +
    (meat.notes ? '<div class="irow" style=\'flex-direction:column;align-items:flex-start;gap:.2rem;\'><span class="irow-k">Notes</span><span style=\'font-size:.78rem;color:var(--ivory2);line-height:1.45;\'>' + meat.notes + '</span></div>' : '') +
    '</div>' +
    '</div>' +
    '</div>';

  showView('detail');
  setTimeout(function () {
    generateQR(meat.id);
    var nwd = document.getElementById('nwd');
    if (nwd) nwd.valueAsDate = new Date();
    renderChart(meat);
  }, 80);
}

// ══════════════════════════════════════════════════════
// WEIGHT ACTIONS
// ══════════════════════════════════════════════════════
async function addWeight() {
  var w = parseFloat(document.getElementById('nw').value);
  var d = document.getElementById('nwd').value || new Date().toISOString().split('T')[0];
  if (!w || !currentMeat) return;
  try {
    var updated = await apiFetch('/api/meats/' + currentMeat.id + '/weights', { method: 'POST', body: { weight: w, date: d } });
    meats = meats.map(function (m) { return m.id === updated.id ? updated : m; });
    currentMeat = updated;
    showMeatDetail(currentMeat.id);
    showToast('Pesée ajoutée ✓');
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

function startEditW(idx, eid) {
  document.getElementById('we-' + idx).style.opacity = '0.4';
  document.getElementById('wed-' + idx).style.display = 'flex';
}

function cancelEditW(idx) {
  document.getElementById('we-' + idx).style.opacity = '1';
  document.getElementById('wed-' + idx).style.display = 'none';
}

async function saveEditW(idx, eid) {
  var w = parseFloat(document.getElementById('wev-' + idx).value);
  var d = document.getElementById('wed2-' + idx).value;
  if (!w || !d || !currentMeat) return;
  try {
    var updated = await apiFetch('/api/meats/' + currentMeat.id + '/weights/' + eid, { method: 'PUT', body: { weight: w, date: d } });
    meats = meats.map(function (m) { return m.id === updated.id ? updated : m; });
    currentMeat = updated;
    showMeatDetail(currentMeat.id);
    showToast('Pesée mise à jour ✓');
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

async function deleteWeight(idx, eid) {
  if (!currentMeat || currentMeat.weights.length <= 1) return;
  if (!confirm('Supprimer cette pesée ?')) return;
  try {
    var updated = await apiFetch('/api/meats/' + currentMeat.id + '/weights/' + eid, { method: 'DELETE' });
    meats = meats.map(function (m) { return m.id === updated.id ? updated : m; });
    currentMeat = updated;
    showMeatDetail(currentMeat.id);
    showToast('Pesée supprimée');
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

// ══════════════════════════════════════════════════════
// QUICK WEIGH
// ══════════════════════════════════════════════════════
function quickWeigh(meatId, event) {
  event.stopPropagation();
  var meat = meats.find(function (m) { return m.id === meatId; });
  if (!meat) return;
  quickWeighMeatId = meatId;

  var lastW = meat.weights[meat.weights.length - 1];
  document.getElementById('qw-name').textContent = meat.name;
  document.getElementById('qw-last-weight').textContent = lastW.weight + ' g';
  document.getElementById('qw-last-date').textContent = new Date(lastW.date).toLocaleDateString('fr-FR');

  var wInput = document.getElementById('qw-weight');
  var dInput = document.getElementById('qw-date');
  wInput.value = '';
  dInput.valueAsDate = new Date();

  var overlay = document.getElementById('quick-weigh-overlay');
  overlay.classList.add('open');
  setTimeout(function () { wInput.focus(); }, 80);
}

function closeQuickWeigh() {
  document.getElementById('quick-weigh-overlay').classList.remove('open');
  quickWeighMeatId = null;
}

async function submitQuickWeight() {
  var w = parseFloat(document.getElementById('qw-weight').value);
  var d = document.getElementById('qw-date').value || new Date().toISOString().split('T')[0];
  if (!w || w <= 0 || !quickWeighMeatId) {
    showToast('Poids invalide', 'error');
    return;
  }
  var btn = document.getElementById('qw-submit-btn');
  if (btn) btn.disabled = true;
  try {
    var updated = await apiFetch('/api/meats/' + quickWeighMeatId + '/weights', { method: 'POST', body: { weight: w, date: d } });
    meats = meats.map(function (m) { return m.id === updated.id ? updated : m; });
    closeQuickWeigh();
    renderList();
    showToast('Pesée enregistrée ✓');
  } catch (e) {
    showToast('Erreur : ' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════
// EDIT MEAT FORM
// ══════════════════════════════════════════════════════
function showEditMeatForm(meatId) {
  var meat = meats.find(function (m) { return m.id === meatId; });
  if (!meat) return;
  currentMeat = meat;
  var opts = buildTypeOptions(meat.type);
  document.getElementById('detail-view').innerHTML =
    '<div style="display:flex;gap:.625rem;margin-bottom:1.5rem;">' +
    '<button class="btn btn-ghost btn-sm" onclick="showMeatDetail(\'' + meat.id + '\')">← Annuler</button>' +
    '</div>' +
    '<div class="page-head"><div class="page-head-left"><div class="eyebrow">Modification</div><h2><span style="margin-right:8px;">' + typeIcon(meat.type) + '</span>' + meat.name + '</h2></div></div>' +
    '<div class="form-shell">' +
    '<div class="form-divider" style="margin-top:0;border-top:none;">Identification</div>' +
    '<div class="fg"><label>Nom</label><input type="text" id="em-name" value="' + meat.name + '"></div>' +
    '<div class="form-row">' +
    '<div class="fg"><label>Type</label><select id="em-type">' + opts + '</select></div>' +
    '<div class="fg"><label>Poids initial (g)</label><input type="number" id="em-weight" value="' + meat.initialWeight + '" min="1"><div class="fg-hint">⚠ Recalcule tous les %</div></div>' +
    '</div>' +
    '<div class="form-row">' +
    '<div class="fg"><label>Date de début</label><input type="date" id="em-date" value="' + meat.startDate + '"></div>' +
    '<div class="fg"><label>Prix (€)</label><input type="number" id="em-price" value="' + (meat.price !== null && meat.price !== undefined ? meat.price : '') + '" step="0.01" min="0"></div>' +
    '</div>' +
    '<div class="form-divider">Objectifs</div>' +
    '<div class="form-row">' +
    '<div class="fg"><label>Durée cible (jours)</label><input type="number" id="em-days" value="' + (meat.targetDays || 60) + '" min="1" max="730"></div>' +
    '<div class="fg"><label>Perte cible (%)</label><input type="number" id="em-loss" value="' + (meat.targetLoss || 30) + '" min="1" max="60" step="0.5"></div>' +
    '</div>' +
    '<div class="form-divider">Assaisonnement</div>' +
    '<div class="form-row">' +
    '<div class="fg"><label>Sel (g)</label><input type="number" id="em-salt" value="' + (meat.salt || '') + '" min="0" step="0.1" placeholder="—"></div>' +
    '<div class="fg"><label>Sucre (g)</label><input type="number" id="em-sugar" value="' + (meat.sugar || '') + '" min="0" step="0.1" placeholder="—"></div>' +
    '</div>' +
    '<div class="fg">' +
    '<label>Épices &amp; aromates</label>' +
    '<div style="display:flex; gap:0.5rem; margin-bottom:0.5rem;">' +
    '<input type="text" id="em-spice-input" placeholder="Ex: Poivre noir, Ail..." list="spices-list" onkeypress="if(event.key===\'Enter\'){event.preventDefault();addSpiceItem(\'em-spice-input\', \'em-spices-container\', \'em-spices\');}">' +
    '<button type="button" class="btn btn-ghost" onclick="addSpiceItem(\'em-spice-input\', \'em-spices-container\', \'em-spices\')">Add</button>' +
    '</div>' +
    '<div id="em-spices-container" style="display:flex; flex-wrap:wrap; gap:0.4rem;"></div>' +
    '<input type="hidden" id="em-spices" value="' + (meat.spices || '') + '">' +
    '</div>' +
    '<div class="form-row">' +
    '<div class="fg"><label>Notes</label><input type="text" id="em-notes" value="' + (meat.notes || '') + '" placeholder="Observations…"></div>' +
    '<label class="toggle-fg" style="margin-top:.5rem;">' +
    '<input type="checkbox" id="em-smoked"' + (meat.smoked ? ' checked' : '') + '>' +
    '<span class="toggle-switch"></span>' +
    '<span class="toggle-label">Pièce fumée / à fumer 💨</span>' +
    '</label>' +
    '</div>' +
    '<button onclick="saveEditMeat(\'' + meat.id + '\')" class="btn btn-primary btn-full">Enregistrer →</button>' +
    '</div>';

  setTimeout(function () {
    renderSpices('em-spices-container', 'em-spices');
  }, 50);
}

async function saveEditMeat(meatId) {
  var emSalt = document.getElementById('em-salt');
  var emSugar = document.getElementById('em-sugar');
  var emSpices = document.getElementById('em-spices');
  var emNotes = document.getElementById('em-notes');
  var emPrice = document.getElementById('em-price');
  var body = {
    name: document.getElementById('em-name').value.trim(),
    type: document.getElementById('em-type').value,
    initialWeight: parseFloat(document.getElementById('em-weight').value),
    startDate: document.getElementById('em-date').value,
    targetDays: parseInt(document.getElementById('em-days').value) || 60,
    targetLoss: parseFloat(document.getElementById('em-loss').value) || 30,
    salt: emSalt && emSalt.value ? parseFloat(emSalt.value) : null,
    sugar: emSugar && emSugar.value ? parseFloat(emSugar.value) : null,
    spices: emSpices && emSpices.value ? emSpices.value.trim() : null,
    notes: emNotes && emNotes.value ? emNotes.value.trim() : null,
    price: emPrice && emPrice.value ? parseFloat(emPrice.value) : null,
    smoked: document.getElementById('em-smoked').checked ? 1 : 0,
    archived: currentMeat.archived ? 1 : 0,
  };
  if (!body.name || !body.initialWeight || !body.startDate) return;
  try {
    var updated = await apiFetch('/api/meats/' + meatId, { method: 'PUT', body: body });
    meats = meats.map(function (m) { return m.id === updated.id ? updated : m; });
    currentMeat = updated;
    showMeatDetail(meatId);
    showToast('Pièce mise à jour ✓');
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

// ══════════════════════════════════════════════════════
// DELETE MEAT
// ══════════════════════════════════════════════════════
async function deleteMeat(meatId) {
  if (!confirm('Supprimer cette pièce ?')) return;
  try {
    await apiFetch('/api/meats/' + meatId, { method: 'DELETE' });
    meats = meats.filter(function (m) { return m.id !== meatId; });
    renderList();
    showView('list');
    showToast('Pièce supprimée');
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

// ══════════════════════════════════════════════════════
// QR
// ══════════════════════════════════════════════════════
function generateQR(id) {
  var c = document.getElementById('qrcode-holder');
  if (!c) return;
  c.innerHTML = '';
  new QRCode(c, { text: id, width: 180, height: 180, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H });
}

function printLabels(ids, type) {
  if (!Array.isArray(ids)) ids = [ids];
  type = type || 'tracking';
  var selectedMeats = meats.filter(function (m) { return ids.indexOf(m.id) >= 0; });
  if (!selectedMeats.length) { showToast('Aucune pièce à imprimer', 'error'); return; }

  // Temporairement générer les QRs si besoin
  var qrContainer = document.getElementById('qr-gen-hidden');
  if (!qrContainer && type === 'tracking') {
    qrContainer = document.createElement('div');
    qrContainer.id = 'qr-gen-hidden';
    qrContainer.style.display = 'none';
    document.body.appendChild(qrContainer);
  }

  var labelsHTML = '';
  selectedMeats.forEach(function (meat) {
    var qrSrc = '';
    if (type === 'tracking') {
      qrContainer.innerHTML = '';
      new QRCode(qrContainer, { text: meat.id, width: 256, height: 256, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H });
      var canvas = qrContainer.querySelector('canvas');
      var img = qrContainer.querySelector('img');
      qrSrc = canvas ? canvas.toDataURL('image/png') : (img ? img.src : '');
    }

    var lastW = meat.weights[meat.weights.length - 1];
    var loss = ((meat.initialWeight - lastW.weight) / meat.initialWeight * 100).toFixed(1);
    var startFmt = new Date(meat.startDate).toLocaleDateString('fr-FR');
    var durationDays = Math.round((new Date(lastW.date) - new Date(meat.startDate)) / (24 * 3600 * 1000));
    var meatIcon = typeIcon(meat.type);

    if (type === 'final') {
      labelsHTML +=
        '<div class="label label-final">' +
        '<div class="final-badge">' + meatIcon + '</div>' +
        '<div class="label-header">' +
        '<div class="label-name">' + meat.name + '</div>' +
        '<div class="label-type">' + meat.type + '</div>' +
        '</div>' +
        '<div class="final-content">' +
        '<div class="f-row"><span>Fait le</span><b>' + startFmt + '</b></div>' +
        '<div class="f-row"><span>Durée</span><b>' + durationDays + ' jours</b></div>' +
        '<div class="f-row"><span>Poids final</span><b>' + lastW.weight + ' g</b></div>' +
        '<div class="f-row"><span>Perte de poids</span><b>' + loss + ' %</b></div>' +
        (meat.smoked ? '<div class="f-row"><span>Traitement</span><b>Fumé 💨</b></div>' : '') +
        '</div>' +
        '<div class="final-details">' +
        (meat.salt || meat.sugar ? '<div class="f-section-title">Assaisonnement</div>' : '') +
        '<div class="f-p">' +
        (meat.salt ? 'Sel (' + meat.salt + 'g) ' : '') +
        (meat.sugar ? 'Sucre (' + meat.sugar + 'g)' : '') +
        '</div>' +
        (meat.spices ? '<div class="f-section-title">Ingrédients</div><div class="f-p">' + meat.spices + '</div>' : '') +
        '</div>' +
        '<div class="label-footer">' +
        '<div class="footer-line"></div>' +
        '<span>' + (appSettings.producer_name || 'Produit Artisanal') + ' • Cave d\'Affinage</span>' +
        '<div class="footer-line"></div>' +
        '</div>' +
        '</div>';
    } else {
      labelsHTML +=
        '<div class="label">' +
        '<div class="label-header">' +
        '<div class="label-name"><span style="margin-right:6px;">' + meatIcon + '</span>' + meat.name + '</div>' +
        '<div class="label-type">' + meat.type + '</div>' +
        '</div>' +
        '<div class="label-main">' +
        '<img class="label-qr" src="' + qrSrc + '" alt="QR">' +
        '<table class="info">' +
        '<tr><td>Début</td><td>' + startFmt + '</td></tr>' +
        '<tr><td>Initial</td><td>' + meat.initialWeight + '&nbsp;g</td></tr>' +
        '<tr><td>Actuel</td><td>' + lastW.weight + '&nbsp;g</td></tr>' +
        '<tr><td>Perte</td><td>' + loss + '&nbsp;%</td></tr>' +
        '<tr><td>Objectif</td><td>' + meat.targetLoss + '% / ' + meat.targetDays + 'j</td></tr>' +
        '</table>' +
        '</div>' +
        '<div class="label-id">ID : ' + meat.id + '</div>' +
        '<div class="sep"></div>' +
        '<div class="seasoning">' +
        (meat.salt ? '<div class="s-item"><b>Sel :</b> ' + meat.salt + 'g (' + (meat.salt / meat.initialWeight * 100).toFixed(1) + '%)</div>' : '') +
        (meat.sugar ? '<div class="s-item"><b>Sucre :</b> ' + meat.sugar + 'g (' + (meat.sugar / meat.initialWeight * 100).toFixed(1) + '%)</div>' : '') +
        (meat.smoked ? '<div class="s-item"><b>Traitement :</b> Fumé 💨</div>' : '') +
        (meat.price ? '<div class="s-item"><b>Prix :</b> ' + meat.price.toFixed(2) + '€</div>' : '') +
        '</div>' +
        (meat.spices ? '<div class="label-spices"><b>Épices :</b> ' + meat.spices + '</div>' : '') +
        '<div class="lines">' +
        '<div class="line"><span>Pesée :</span><div class="line-rule"></div></div>' +
        '<div class="line"><span>Pesée :</span><div class="line-rule"></div></div>' +
        '</div>' +
        '</div>';
    }
  });

  var html = '<!DOCTYPE html><html lang="fr"><head>' +
    '<meta charset="UTF-8">' +
    '<title>Étiquettes — ' + (selectedMeats.length === 1 ? selectedMeats[0].name : selectedMeats.length + ' pièces') + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&display=swap" rel="stylesheet">' +
    '<style>' +
    '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }' +
    '@page { size: A4 portrait; margin: 10mm; }' +
    'body { font-family: "Outfit", sans-serif; background: white; color: #1a1a1a; padding: 0; }' +
    '.labels-container { display: flex; flex-wrap: wrap; gap: 8mm; justify-content: flex-start; }' +
    '.label {' +
    '  width: 90mm; height: 130mm;' +
    '  border: 0.2mm solid #e0e0e0; border-radius: 2mm; padding: 8mm;' +
    '  display: flex; flex-direction: column; page-break-inside: avoid;' +
    '  background: #fff; position: relative;' +
    '}' +
    '.label-final { border: 0.5mm solid #333; }' +
    '.final-badge { position: absolute; top: 8mm; right: 8mm; font-size: 28pt; opacity: 0.9; }' +
    '.label-header { margin-bottom: 8mm; padding-top: 2mm; }' +
    '.label-name { font-size: 18pt; font-weight: 600; color: #000; letter-spacing: -0.02em; line-height: 1.2; }' +
    '.label-type { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.2em; color: #888; margin-top: 2mm; font-weight: 400; }' +
    '.final-content { display: flex; flex-direction: column; gap: 3mm; margin-bottom: 8mm; background: #f9f9f9; padding: 4mm; border-radius: 2mm; }' +
    '.f-row { display: flex; justify-content: space-between; font-size: 10pt; align-items: baseline; }' +
    '.f-row span { color: #666; font-weight: 400; }' +
    '.f-row b { font-weight: 600; color: #000; }' +
    '.final-details { flex: 1; }' +
    '.f-section-title { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.1em; color: #aaa; margin-bottom: 2mm; font-weight: 600; }' +
    '.f-p { font-size: 9.5pt; color: #333; margin-bottom: 5mm; line-height: 1.4; }' +
    '.label-footer { margin-top: auto; display: flex; align-items: center; gap: 3mm; }' +
    '.footer-line { flex: 1; height: 0.2mm; background: #eee; }' +
    '.label-footer span { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.15em; color: #bbb; white-space: nowrap; font-weight: 400; }' +
    '.label-main { display: flex; align-items: flex-start; gap: 4mm; margin-bottom: 3mm; }' +
    '.label-qr { width: 38mm; height: 38mm; display: block; border: 1px solid #eee; }' +
    '.info { flex: 1; font-size: 8.5pt; line-height: 1.5; border-collapse: collapse; }' +
    '.info td { padding: 1mm 0; border-bottom: 0.1mm solid #f0f0f0; }' +
    '.info td:first-child { color: #888; padding-right: 2mm; }' +
    '.info td:last-child { font-weight: 600; text-align: right; }' +
    '.label-id { font-family: monospace; font-size: 6.5pt; color: #ccc; text-align: center; margin-top: 2mm; margin-bottom: 4mm; }' +
    '.sep { border-top: 0.4mm solid #eee; margin-bottom: 4mm; }' +
    '.seasoning { display: flex; flex-wrap: wrap; gap: 3mm; font-size: 8.5pt; margin-bottom: 3mm; }' +
    '.s-item b { font-weight: 600; color: #666; }' +
    '.label-spices { font-size: 8.5pt; color: #444; font-style: italic; margin-bottom: 5mm; line-height: 1.4; }' +
    '.lines { margin-top: auto; border-top: 0.2mm dashed #ddd; padding-top: 4mm; }' +
    '.line { display: flex; align-items: flex-end; gap: 2mm; margin-bottom: 4mm; font-size: 8pt; color: #aaa; }' +
    '.line-rule { flex: 1; border-bottom: 0.2mm solid #eee; }' +
    '</style>' +
    '</head><body>' +
    '<div class="labels-container">' + labelsHTML + '</div>' +
    '</body></html>';

  var w = window.open('', '_blank');
  if (!w) { showToast('Autorisez les popups pour imprimer', 'error'); return; }
  w.document.open(); w.document.write(html); w.document.close();
  w.onload = function () { setTimeout(function () { w.focus(); w.print(); }, 200); };
}

function printAllLabels() {
  var isArchive = currentListView === 'archive';
  var displayMeats = meats.filter(function (m) { return !!m.archived === isArchive; });
  if (!displayMeats.length) return;
  printLabels(displayMeats.map(function (m) { return m.id; }));
}

// ══════════════════════════════════════════════════════
// SCAN
// ══════════════════════════════════════════════════════
function scanManual() {
  var v = document.getElementById('scan-input').value.trim();
  var meat = meats.find(function (m) { return m.id === v; });
  if (meat) { document.getElementById('scan-input').value = ''; showMeatDetail(meat.id); }
  else showScanMsg('Aucune pièce trouvée avec cet ID', 'error');
}

function showScanMsg(html, type) {
  var el = document.getElementById('scan-result');
  var bg = type === 'error' ? 'rgba(184,64,42,.12)' : type === 'ok' ? 'rgba(90,138,106,.12)' : 'rgba(184,114,42,.12)';
  var bc = type === 'error' ? 'rgba(184,64,42,.35)' : type === 'ok' ? 'rgba(90,138,106,.35)' : 'rgba(184,114,42,.35)';
  var col = type === 'error' ? '#e06050' : type === 'ok' ? 'var(--sage2)' : 'var(--copper2)';
  el.innerHTML = '<div style="padding:.875rem 1rem;background:' + bg + ';border:1px solid ' + bc + ';border-radius:var(--r3);color:' + col + ';font-size:.8rem;line-height:1.65;">' + html + '</div>';
  el.style.display = 'block';
}

async function startCamera() {
  var isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!isSecure) {
    showScanMsg('<strong>⚠ HTTPS requis</strong><br>La caméra nécessite HTTPS. Relancez le serveur avec <code style="background:rgba(255,255,255,.08);padding:.1em .3em;border-radius:3px;">HTTPS=true node server.js</code> puis accédez via <code style="background:rgba(255,255,255,.08);padding:.1em .3em;border-radius:3px;">https://&lt;IP&gt;:3000</code>.', 'warn');
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showScanMsg('Caméra non supportée par ce navigateur.', 'error'); return;
  }
  try {
    var stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    cameraStream = stream;
    var vid = document.getElementById('camera-video');
    vid.srcObject = stream;
    document.getElementById('camera-container').style.display = 'block';
    document.getElementById('start-camera-btn').style.display = 'none';
    document.getElementById('stop-camera-btn').style.display = 'flex';
    scanningInterval = setInterval(scanQRCode, 300);
  } catch (e) {
    if (e.name === 'NotAllowedError') showScanMsg('Permission caméra refusée. Autorisez l\'accès dans les paramètres du navigateur.', 'error');
    else if (e.name === 'NotFoundError') showScanMsg('Aucune caméra détectée.', 'error');
    else showScanMsg('Erreur caméra : ' + e.message, 'error');
  }
}

function stopCamera() {
  if (cameraStream) { cameraStream.getTracks().forEach(function (t) { t.stop(); }); cameraStream = null; }
  if (scanningInterval) { clearInterval(scanningInterval); scanningInterval = null; }
  var cc = document.getElementById('camera-container'),
    sb = document.getElementById('start-camera-btn'),
    st = document.getElementById('stop-camera-btn'),
    sr = document.getElementById('scan-result');
  if (cc) cc.style.display = 'none';
  if (sb) sb.style.display = 'flex';
  if (st) st.style.display = 'none';
  if (sr) sr.style.display = 'none';
}

function scanQRCode() {
  var vid = document.getElementById('camera-video');
  var canvas = document.getElementById('camera-canvas');
  // readyState >= 2 (HAVE_CURRENT_DATA) suffit — évite le blocage sur mobile
  if (!vid || !canvas || vid.readyState < 2 || vid.videoWidth === 0) return;
  canvas.width = vid.videoWidth;
  canvas.height = vid.videoHeight;
  var ctx = canvas.getContext('2d');
  ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
  var imageData;
  try {
    imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch (e) { return; } // sécurité cross-origin
  var code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'dontInvert', // plus rapide, le QR est noir sur blanc
  });
  if (code && code.data) {
    var meat = meats.find(function (m) { return m.id === code.data; });
    if (meat) {
      showScanMsg('✓ Détecté : ' + meat.name, 'ok');
      clearInterval(scanningInterval);
      scanningInterval = null;
      setTimeout(function () { stopCamera(); showMeatDetail(meat.id); }, 600);
    } else {
      // QR détecté mais ID inconnu — afficher sans bloquer le scan
      showScanMsg('QR détecté mais pièce introuvable (ID : ' + code.data + ')', 'warn');
    }
  }
}

// ══════════════════════════════════════════════════════
// CHART
// ══════════════════════════════════════════════════════
var weightChartInstance = null;

// Rythme sain : 0.2 – 1.5 %/jour. En dessous = plateau, au-dessus = trop rapide.
var RATE_PLATEAU  = 0.2;
var RATE_TOO_FAST = 1.5;

function renderChart(meat) {
  var canvas = document.getElementById('weight-chart');
  if (!canvas || !window.Chart) return;

  if (weightChartInstance) { weightChartInstance.destroy(); weightChartInstance = null; }

  var sorted = meat.weights.slice().sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
  if (!sorted.length) return;

  var tLoss   = meat.targetLoss || 30;
  var tDays   = meat.targetDays || 60;
  var tWeight = parseFloat((meat.initialWeight * (1 - tLoss / 100)).toFixed(0));
  var tDate   = new Date(meat.startDate);
  tDate.setDate(tDate.getDate() + tDays);
  var tLabel  = tDate.toLocaleDateString('fr-FR');

  var rLabels  = sorted.map(function (w) { return new Date(w.date).toLocaleDateString('fr-FR'); });
  var hasExtra = rLabels.indexOf(tLabel) < 0;
  var allLabels = hasExtra ? rLabels.concat([tLabel]) : rLabels;

  var rWeights = sorted.map(function (w) { return w.weight; });
  var rLosses  = sorted.map(function (w) {
    return parseFloat(((meat.initialWeight - w.weight) / meat.initialWeight * 100).toFixed(2));
  });

  // Rythme (%/jour) entre chaque pesée consécutive
  var rates = sorted.map(function (w, i) {
    if (i === 0) return null;
    var days = (new Date(w.date) - new Date(sorted[i - 1].date)) / 86400000;
    if (days <= 0) return null;
    var stepLoss = (sorted[i - 1].weight - w.weight) / meat.initialWeight * 100;
    return parseFloat((stepLoss / days).toFixed(2));
  });

  // Couleur des points selon le rythme
  var C_NEUTRAL = '#818cf8'; // indigo
  var C_GOOD    = '#5a8a6a'; // vert
  var C_PLATEAU = '#f59e0b'; // ambre
  var C_FAST    = '#ef4444'; // rouge
  var pointColors = sorted.map(function (_, i) {
    var r = rates[i];
    if (r === null) return C_NEUTRAL;
    if (r < RATE_PLATEAU)  return C_PLATEAU;
    if (r > RATE_TOO_FAST) return C_FAST;
    return C_GOOD;
  });

  // Dernier rythme connu
  var currentRate = null;
  for (var i = rates.length - 1; i >= 0; i--) {
    if (rates[i] !== null) { currentRate = rates[i]; break; }
  }

  var lw = rWeights[rWeights.length - 1];
  var ll = rLosses[rLosses.length - 1];

  // Datasets avec ou sans point cible projeté
  var wData  = hasExtra ? rWeights.concat([null]) : rWeights;
  var lData  = hasExtra ? rLosses.concat([null])  : rLosses;
  var projW  = allLabels.map(function (_, i) {
    if (i === rWeights.length - 1) return lw;
    if (hasExtra && i === allLabels.length - 1) return tWeight;
    return null;
  });
  var projL  = allLabels.map(function (_, i) {
    if (i === rLosses.length - 1) return ll;
    if (hasExtra && i === allLabels.length - 1) return tLoss;
    return null;
  });
  var tLine  = allLabels.map(function () { return tLoss; });
  var tMin   = allLabels.map(function () { return Math.max(0, tLoss - 2); });
  var tMax   = allLabels.map(function () { return tLoss + 2; });
  var rateData = rates.concat(hasExtra ? [null] : []);

  // Couleur des barres de rythme
  var barColors = rateData.map(function (r) {
    if (r === null) return 'transparent';
    if (r < RATE_PLATEAU)  return 'rgba(245,158,11,0.5)';
    if (r > RATE_TOO_FAST) return 'rgba(239,68,68,0.5)';
    return 'rgba(90,138,106,0.45)';
  });

  var lossAxisMax = Math.max(55, tLoss + 12);

  weightChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels: allLabels,
      datasets: [
        // Courbe de poids
        {
          label: 'Poids (g)', data: wData,
          borderColor: '#818cf8', backgroundColor: 'rgba(129,140,248,0.08)',
          borderWidth: 2.5, tension: 0.3, fill: false, yAxisID: 'yW', spanGaps: false, order: 2,
          pointBackgroundColor: pointColors, pointBorderColor: pointColors,
          pointRadius: 5, pointHoverRadius: 7,
        },
        // Projection poids
        {
          label: 'Proj. → ' + tWeight + 'g', data: projW,
          borderColor: 'rgba(129,140,248,0.35)', backgroundColor: 'transparent',
          borderWidth: 1.5, borderDash: [5, 4], tension: 0.2, fill: false, yAxisID: 'yW', spanGaps: true, order: 3,
          pointBackgroundColor: '#818cf8', pointBorderColor: '#818cf8',
          pointRadius: function (c) { return hasExtra && c.dataIndex === allLabels.length - 1 ? 5 : 0; },
        },
        // Courbe de perte
        {
          label: 'Perte (%)', data: lData,
          borderColor: '#5a8a6a', backgroundColor: 'rgba(90,138,106,0.07)',
          borderWidth: 2, tension: 0.3, fill: false, yAxisID: 'yL', spanGaps: false, order: 2,
          pointBackgroundColor: pointColors, pointBorderColor: pointColors,
          pointRadius: 5, pointHoverRadius: 7,
        },
        // Ligne objectif
        {
          label: 'Objectif ' + tLoss + '%', data: tLine,
          borderColor: 'rgba(90,138,106,0.6)', backgroundColor: 'transparent',
          borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, fill: false, yAxisID: 'yL', order: 4,
        },
        // Zone objectif ±2 %
        {
          label: '_zone_min', data: tMin,
          borderColor: 'transparent', backgroundColor: 'rgba(90,138,106,0.1)',
          borderWidth: 0, pointRadius: 0, fill: '+1', yAxisID: 'yL', order: 5,
        },
        {
          label: '_zone_max', data: tMax,
          borderColor: 'transparent', backgroundColor: 'transparent',
          borderWidth: 0, pointRadius: 0, fill: false, yAxisID: 'yL', order: 5,
        },
        // Barres de rythme (%/jour)
        {
          label: 'Rythme (%/j)', type: 'bar', data: rateData,
          backgroundColor: barColors, borderColor: 'transparent', borderRadius: 3,
          yAxisID: 'yR', order: 1,
        },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: {
            color: '#7a8a9a', font: { size: 11 }, boxWidth: 14,
            filter: function (item) { return !item.text.startsWith('_') && !item.text.startsWith('Proj.'); }
          }
        },
        tooltip: {
          backgroundColor: 'rgba(2,6,23,0.95)', titleColor: '#818cf8',
          bodyColor: '#e2e8f0', borderColor: 'rgba(129,140,248,0.25)', borderWidth: 1,
          callbacks: {
            label: function (c) {
              if (c.dataset.label.startsWith('_')) return null;
              var v = c.parsed.y;
              if (v === null || v === undefined) return null;
              var unit = c.dataset.yAxisID === 'yW' ? 'g' : '%' + (c.dataset.yAxisID === 'yR' ? '/j' : '');
              return '  ' + c.dataset.label + ' : ' + v + unit;
            }
          }
        }
      },
      scales: {
        x: { ticks: { color: '#4a5a6a', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
        yW: {
          position: 'left',
          ticks: { color: '#818cf8', font: { size: 10 }, callback: function (v) { return v + 'g'; } },
          grid: { color: 'rgba(255,255,255,0.04)' }
        },
        yL: {
          position: 'right', min: 0, max: lossAxisMax,
          ticks: { color: '#5a8a6a', font: { size: 10 }, callback: function (v) { return v + '%'; } },
          grid: { drawOnChartArea: false }
        },
        yR: {
          position: 'right', min: 0, max: 4, display: false,
          grid: { drawOnChartArea: false }
        }
      }
    }
  });

  renderChartInfo(meat, sorted, currentRate, tWeight, tLoss);
}

function renderChartInfo(meat, sorted, currentRate, tWeight, tLoss) {
  var el = document.getElementById('chart-info');
  if (!el) return;

  var lastW       = sorted[sorted.length - 1];
  var currentLoss = (meat.initialWeight - lastW.weight) / meat.initialWeight * 100;
  var remaining   = tLoss - currentLoss;

  // Statut du rythme actuel
  var rateLabel = '—';
  var rateColor = '#7a8a9a';
  if (currentRate !== null) {
    var rateText = currentRate.toFixed(2) + ' %/j';
    if (currentRate < RATE_PLATEAU)       { rateLabel = rateText + ' · Plateau'; rateColor = '#f59e0b'; }
    else if (currentRate > RATE_TOO_FAST) { rateLabel = rateText + ' · Trop rapide'; rateColor = '#ef4444'; }
    else                                  { rateLabel = rateText + ' · Bon rythme'; rateColor = '#5a8a6a'; }
  }

  // Estimation de fin selon rythme actuel
  var etaHtml = '';
  if (currentRate && currentRate > 0 && remaining > 0) {
    var daysLeft = Math.round(remaining / currentRate);
    var etaDate  = new Date(lastW.date);
    etaDate.setDate(etaDate.getDate() + daysLeft);
    etaHtml =
      '<div class="chart-info-item">' +
      '<div class="chart-info-k">Estimation fin</div>' +
      '<div class="chart-info-v" style="color:#818cf8;">' + etaDate.toLocaleDateString('fr-FR') + ' <span style="color:#4a5a6a;">+' + daysLeft + 'j</span></div>' +
      '</div>';
  } else if (remaining <= 0) {
    etaHtml =
      '<div class="chart-info-item">' +
      '<div class="chart-info-k">Objectif</div>' +
      '<div class="chart-info-v" style="color:#5a8a6a;">✓ Atteint</div>' +
      '</div>';
  }

  // Reste à perdre
  var restHtml = remaining > 0
    ? remaining.toFixed(1) + '% · ' + Math.max(0, lastW.weight - tWeight).toFixed(0) + 'g'
    : '— objectif dépassé';

  el.innerHTML =
    '<div class="chart-info-item">' +
    '<div class="chart-info-k">Rythme actuel</div>' +
    '<div class="chart-info-v" style="color:' + rateColor + ';">' + rateLabel + '</div>' +
    '</div>' +
    etaHtml +
    '<div class="chart-info-item">' +
    '<div class="chart-info-k">Reste à perdre</div>' +
    '<div class="chart-info-v">' + restHtml + '</div>' +
    '</div>';
}

var envChartInstance = null;
function refreshEnvChart() {
  var days = document.getElementById('history-days').value || 7;
  fetch('/api/sensors/history?days=' + days)
    .then(function (res) { return res.json(); })
    .then(function (history) {
      renderEnvChart(history);
    });
}

function renderEnvChart(history) {
  var canvas = document.getElementById('env-chart');
  if (!canvas || !window.Chart) return;

  if (envChartInstance) {
    envChartInstance.destroy();
  }

  var labels = history.map(function (h) {
    var d = new Date(h.timestamp);
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  });
  var temps = history.map(function (h) { return h.temperature; });
  var hums = history.map(function (h) { return h.humidity; });

  envChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Température (°C)',
          data: temps,
          borderColor: '#e06050',
          backgroundColor: 'rgba(224,96,80,0.1)',
          yAxisID: 'yTemp',
          tension: 0.3,
          pointRadius: history.length > 50 ? 0 : 2
        },
        {
          label: 'Humidité (%)',
          data: hums,
          borderColor: '#7aaaca',
          backgroundColor: 'rgba(122,170,202,0.1)',
          yAxisID: 'yHum',
          tension: 0.3,
          pointRadius: history.length > 50 ? 0 : 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#6a5a4a', font: { size: 11 } } }
      },
      scales: {
        x: {
          ticks: {
            color: '#6a5a4a',
            font: { size: 10 },
            maxRotation: 45,
            minRotation: 45,
            autoSkip: true,
            maxTicksLimit: 12
          },
          grid: { color: 'rgba(255,255,255,.04)' }
        },
        yTemp: {
          position: 'left',
          title: { display: true, text: 'Température (°C)', color: '#e06050' },
          ticks: { color: '#e06050' },
          grid: { color: 'rgba(255,255,255,.04)' }
        },
        yHum: {
          position: 'right',
          title: { display: true, text: 'Humidité (%)', color: '#7aaaca' },
          ticks: { color: '#7aaaca' },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}


// ══════════════════════════════════════════════════════
// HELP MODAL
// ══════════════════════════════════════════════════════
function openHelp() {
  document.getElementById('help-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeHelp() {
  document.getElementById('help-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeHelp();
});

// ══════════════════════════════════════════════════════
// ARCHIVE
// ══════════════════════════════════════════════════════
async function toggleArchiveMeat(meatId, state) {
  var actionStr = state ? 'Archiver cette pièce ? (Elle sera déplacée dans l\'historique)' : 'Restaurer cette pièce ? (Elle reviendra dans la cave)';
  if (!confirm(actionStr)) return;
  try {
    var meat = meats.find(function (m) { return m.id === meatId; });
    var body = Object.assign({}, meat, { archived: state });
    var updated = await apiFetch('/api/meats/' + meatId, { method: 'PUT', body: body });
    meats = meats.map(function (m) { return m.id === updated.id ? updated : m; });
    currentMeat = updated;
    showMeatDetail(meatId);
    showToast(state ? 'Pièce archivée ✓' : 'Pièce restaurée ✓');
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

// ══════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════
function refreshDashboard() {
  fetch('/api/sensors')
    .then(function (res) { return res.json(); })
    .then(function (data) { _dashSensorData = data; renderDashboard(); })
    .catch(function () { _dashSensorData = null; renderDashboard(); });
}

function renderDashboard() {
  var el = document.getElementById('dashboard-view');
  if (!el) return;

  var active = meats.filter(function (m) { return !m.archived; });
  var ready  = active.filter(function (m) { return calcMat(m).status === 'ready'; });
  var over   = active.filter(function (m) { return calcMat(m).status === 'over'; });
  var totalW = active.reduce(function (sum, m) { return sum + m.weights[m.weights.length - 1].weight; }, 0);

  var alerts = buildDashboardAlerts(active);

  var toWeigh = active.slice()
    .map(function (m) {
      var lastW = m.weights[m.weights.length - 1];
      return { m: m, daysSince: Math.floor((new Date() - new Date(lastW.date)) / 86400000) };
    })
    .sort(function (a, b) { return b.daysSince - a.daysSince; })
    .slice(0, 6);

  // ── Page header ──────────────────────────────────────
  var producerName = (function () {
    var el = document.getElementById('setting-producer-name');
    return el && el.value ? el.value : "Cave d'Affinage";
  }());

  var html =
    '<div class="page-head">' +
      '<div class="page-head-left">' +
        '<div class="eyebrow">' + producerName + '</div>' +
        '<h2>Tableau de bord</h2>' +
      '</div>' +
      '<button class="btn btn-ghost btn-sm" onclick="refreshDashboard()" title="Actualiser" style="font-size:1rem;">↻</button>' +
    '</div>';

  // ── KPI strip ────────────────────────────────────────
  html += '<div class="db-kpis">' +
    dbKpi(active.length, 'Pièces actives',   'var(--copper2)',                                  "showView('list')") +
    dbKpi(ready.length,  'Prêtes',           ready.length  ? 'var(--sage2)'   : 'var(--muted)', "showView('list')") +
    dbKpi(over.length,   'Trop sèches',      over.length   ? 'var(--danger)'  : 'var(--muted)', "showView('list')") +
    dbKpi(formatWeight(totalW), 'Poids cave','var(--ivory2)',                                    null) +
    dbKpi(alerts.length, 'Alertes',          alerts.length ? 'var(--warn)'    : 'var(--muted)', null) +
  '</div>';

  // ── Two-column section ───────────────────────────────
  html += '<div class="db-grid">';

  // Alertes
  html += '<div class="dcard"><div class="dcard-title">Alertes actives</div>';
  if (!alerts.length) {
    html += '<div class="db-empty-s" style="color:var(--sage2);">✓ Tout va bien</div>';
  } else {
    alerts.forEach(function (a) {
      var dot = a.level === 'danger' ? '#ef4444' : '#f59e0b';
      var onclick = a.onclick ? ' onclick="' + a.onclick + '"' : '';
      html += '<div class="db-alert"' + onclick + (a.onclick ? ' style="cursor:pointer;"' : '') + '>' +
        '<span class="db-alert-dot" style="background:' + dot + ';box-shadow:0 0 5px ' + dot + '55;"></span>' +
        '<span>' + a.msg + '</span>' +
      '</div>';
    });
  }
  html += '</div>';

  // Prochaines pesées
  html += '<div class="dcard"><div class="dcard-title">Prochaines pesées</div>';
  if (!toWeigh.length) {
    html += '<div class="db-empty-s">Aucune pièce active</div>';
  } else {
    var threshold = weighInterval > 0 ? weighInterval : 7;
    toWeigh.forEach(function (item) {
      var d = item.daysSince;
      var c = d >= threshold ? '#ef4444' : d >= Math.floor(threshold * 0.65) ? '#f59e0b' : '#5a8a6a';
      var dayTxt = d === 0 ? "Auj." : d + 'j';
      html += '<div class="db-weigh-row" onclick="showMeatDetail(\'' + item.m.id + '\')">' +
        '<span style="font-size:1.1rem;flex-shrink:0;">' + typeIcon(item.m.type) + '</span>' +
        '<span class="db-weigh-name">' + item.m.name + '</span>' +
        '<span class="db-days-badge" style="background:' + c + '18;color:' + c + ';border:1px solid ' + c + '44;">' + dayTxt + '</span>' +
        '<button class="card-weigh-btn" style="width:26px;height:26px;font-size:1rem;" onclick="quickWeigh(\'' + item.m.id + '\', event)" title="Pesée rapide">+</button>' +
      '</div>';
    });
  }
  html += '</div>';

  html += '</div>'; // end db-grid

  // ── Prêtes à déguster ────────────────────────────────
  if (ready.length) {
    html += '<div class="dcard" style="margin-top:1rem;">' +
      '<div class="dcard-title">Prêtes à déguster · ' + ready.length + '</div>' +
      '<div class="db-ready-grid">';
    ready.forEach(function (m) {
      var mat = calcMat(m);
      html += '<div class="db-ready-card" onclick="showMeatDetail(\'' + m.id + '\')">' +
        '<div style="font-size:1.6rem;margin-bottom:.35rem;">' + typeIcon(m.type) + '</div>' +
        '<div class="db-ready-name">' + m.name + '</div>' +
        '<div style="font-family:\'Fira Code\',monospace;font-size:.75rem;color:var(--sage2);margin-top:.2rem;">−' + mat.loss.toFixed(1) + '%</div>' +
      '</div>';
    });
    html += '</div></div>';
  }

  el.innerHTML = html;
}

function dbKpi(value, label, color, onclick) {
  var attr = onclick ? ' onclick="' + onclick + '"' : '';
  var cls  = onclick ? ' db-kpi-clickable' : '';
  return '<div class="db-kpi' + cls + '"' + attr + '>' +
    '<div class="db-kpi-n" style="color:' + color + ';">' + value + '</div>' +
    '<div class="db-kpi-l">' + label + '</div>' +
  '</div>';
}

function buildDashboardAlerts(active) {
  var alerts = [];

  if (_dashSensorData && _dashSensorData.current && _dashSensorData.current.temperature !== null) {
    var cur  = _dashSensorData.current;
    var set  = _dashSensorData.settings;
    var staleMin = Math.floor((new Date() - new Date(cur.updatedAt)) / 60000);
    if (staleMin > 30) {
      alerts.push({ level: 'warn', msg: '📡 Capteur obsolète (' + staleMin + ' min)', onclick: "showView('history')" });
    } else if (set) {
      if (cur.temperature < set.temp_min)
        alerts.push({ level: 'danger', msg: '🌡 Temp. trop basse : ' + cur.temperature.toFixed(1) + '°C (min ' + set.temp_min + '°C)', onclick: "showView('history')" });
      else if (cur.temperature > set.temp_max)
        alerts.push({ level: 'danger', msg: '🌡 Temp. trop haute : ' + cur.temperature.toFixed(1) + '°C (max ' + set.temp_max + '°C)', onclick: "showView('history')" });
      if (cur.humidity < set.hum_min)
        alerts.push({ level: 'warn', msg: '💧 Humidité trop basse : ' + cur.humidity.toFixed(1) + '% (min ' + set.hum_min + '%)', onclick: "showView('history')" });
      else if (cur.humidity > set.hum_max)
        alerts.push({ level: 'warn', msg: '💧 Humidité trop haute : ' + cur.humidity.toFixed(1) + '% (max ' + set.hum_max + '%)', onclick: "showView('history')" });
    }
  }

  active.filter(function (m) { return calcMat(m).status === 'over'; })
    .forEach(function (m) {
      alerts.push({ level: 'danger', msg: '⚠ ' + m.name + ' · Peut-être trop sec', onclick: "showMeatDetail('" + m.id + "')" });
    });

  return alerts;
}

// ══════════════════════════════════════════════════════
// RECIPES
// ══════════════════════════════════════════════════════
async function loadRecipes() {
  try {
    recipes = await apiFetch('/api/recipes');
    populateRecipeSelector();
  } catch (e) { console.error('loadRecipes:', e); }
}

function populateRecipeSelector() {
  var sel = document.getElementById('recipe-selector');
  if (!sel) return;
  var typeEl = document.getElementById('meat-type');
  var currentType = typeEl ? typeEl.value : '';
  var filtered = recipes.filter(function (r) { return !r.type || r.type === currentType; });
  sel.innerHTML = '<option value="">— Appliquer une recette —</option>' +
    filtered.map(function (r) {
      return '<option value="' + r.id + '">' + (r.type ? typeIcon(r.type) + ' ' : '') + r.name + '</option>';
    }).join('');
  // Populate sr-type in save modal if open
  var srType = document.getElementById('sr-type');
  if (srType && srType.options.length <= 1) {
    srType.innerHTML = '<option value="">Toutes viandes</option>' + buildTypeOptions('');
  }
}

function applyRecipe(rid) {
  if (!rid) return;
  var r = recipes.find(function (x) { return String(x.id) === String(rid); });
  if (!r) return;
  var wEl = document.getElementById('meat-weight');
  var w = wEl ? parseFloat(wEl.value) : 0;
  if (w > 0) {
    var saltEl = document.getElementById('meat-salt');
    var sugarEl = document.getElementById('meat-sugar');
    if (saltEl && r.salt_pct != null) {
      saltEl.value = (r.salt_pct / 100 * w).toFixed(1);
      saltEl.dataset.autoVal = '';
    }
    if (sugarEl && r.sugar_pct != null) {
      sugarEl.value = (r.sugar_pct / 100 * w).toFixed(1);
      sugarEl.dataset.autoVal = '';
    }
  }
  if (r.spices) {
    var hiddenSpices = document.getElementById('meat-spices');
    if (hiddenSpices) {
      hiddenSpices.value = r.spices;
      renderSpices('spices-container', 'meat-spices');
    }
  }
  if (r.notes) {
    var notesEl = document.getElementById('meat-notes');
    if (notesEl && !notesEl.value) notesEl.value = r.notes;
  }
  updateSeasoningHints();
  var sel = document.getElementById('recipe-selector');
  if (sel) sel.value = '';
  showToast('Recette "' + r.name + '" appliquée');
}

function saveCurrentAsRecipe() {
  var wEl = document.getElementById('meat-weight');
  var w = wEl ? parseFloat(wEl.value) : 0;
  var saltEl  = document.getElementById('meat-salt');
  var sugarEl = document.getElementById('meat-sugar');
  var spicesEl = document.getElementById('meat-spices');
  var typeEl  = document.getElementById('meat-type');

  var saltPct  = (saltEl  && saltEl.value  && w > 0) ? parseFloat(saltEl.value)  / w * 100 : null;
  var sugarPct = (sugarEl && sugarEl.value && w > 0) ? parseFloat(sugarEl.value) / w * 100 : null;
  var spices   = spicesEl ? spicesEl.value : '';
  var type     = typeEl ? typeEl.value : '';

  var overlay = document.getElementById('save-recipe-overlay');
  if (!overlay) return;
  // Populate sr-type options
  var srType = document.getElementById('sr-type');
  if (srType) srType.innerHTML = '<option value="">Toutes viandes</option>' + buildTypeOptions(type);
  document.getElementById('sr-name').value = '';
  document.getElementById('sr-salt-pct').value  = saltPct  != null ? saltPct.toFixed(2)  : '';
  document.getElementById('sr-sugar-pct').value = sugarPct != null ? sugarPct.toFixed(2) : '';
  document.getElementById('sr-spices').value = spices;
  overlay.classList.add('open');
  setTimeout(function () { var n = document.getElementById('sr-name'); if (n) n.focus(); }, 80);
}

function closeSaveRecipeModal() {
  var overlay = document.getElementById('save-recipe-overlay');
  if (overlay) overlay.classList.remove('open');
}

async function submitSaveRecipe() {
  var name = (document.getElementById('sr-name').value || '').trim();
  if (!name) { showToast('Nom requis', 'error'); return; }
  var saltVal  = document.getElementById('sr-salt-pct').value;
  var sugarVal = document.getElementById('sr-sugar-pct').value;
  var body = {
    name:      name,
    type:      document.getElementById('sr-type').value || null,
    salt_pct:  saltVal  ? parseFloat(saltVal)  : null,
    sugar_pct: sugarVal ? parseFloat(sugarVal) : null,
    spices:    document.getElementById('sr-spices').value.trim() || null,
    notes:     null,
  };
  try {
    await apiFetch('/api/recipes', { method: 'POST', body: body });
    await loadRecipes();
    closeSaveRecipeModal();
    showToast('Recette "' + name + '" sauvegardée ✓');
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

function renderRecipes() {
  var el = document.getElementById('recipes-view');
  if (!el) return;

  var byType = {};
  var untyped = [];
  recipes.forEach(function (r) {
    if (r.type) { if (!byType[r.type]) byType[r.type] = []; byType[r.type].push(r); }
    else untyped.push(r);
  });

  var groups = '';
  TYPE_ORDER.forEach(function (t) {
    if (!byType[t]) return;
    groups += '<div class="recipe-group">' +
      '<div class="recipe-group-title">' + typeIcon(t) + ' ' + typeLabel(t) + '</div>' +
      '<div class="recipe-grid">' + byType[t].map(buildRecipeCard).join('') + '</div></div>';
  });
  if (untyped.length) {
    groups += '<div class="recipe-group">' +
      '<div class="recipe-group-title">🥩 Toutes viandes</div>' +
      '<div class="recipe-grid">' + untyped.map(buildRecipeCard).join('') + '</div></div>';
  }

  el.innerHTML =
    '<div class="page-head">' +
    '<div class="page-head-left"><div class="eyebrow">Assaisonnements</div><h2>Recettes</h2></div>' +
    '<div style="display:flex;gap:.5rem;">' +
    '<button class="btn btn-ghost btn-sm" onclick="importRecipes()" title="Importer un fichier JSON">⬆ Importer</button>' +
    '<button class="btn btn-primary btn-sm" onclick="openNewRecipeForm()">+ Nouvelle</button>' +
    '</div></div>' +
    (recipes.length === 0
      ? '<div class="empty-state"><div class="empty-icon">📋</div><div>Aucune recette enregistrée.</div>' +
        '<div style="margin-top:.5rem;font-size:.8rem;color:var(--muted);">Créez vos mélanges via "Nouvelle" ou depuis le formulaire "Nouvelle pièce".</div></div>'
      : groups) +
    '<div id="recipe-form-panel" class="recipe-form-panel" style="display:none;"></div>';
}

function buildRecipeCard(r) {
  var spicesList = r.spices ? r.spices.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
  var spicesPreview = spicesList.length
    ? spicesList.slice(0, 4).map(function (s) { return '<span class="spice-tag">' + s + '</span>'; }).join('') +
      (spicesList.length > 4 ? '<span class="spice-tag" style="color:var(--muted);">+' + (spicesList.length - 4) + '</span>' : '')
    : '<span style="color:var(--muted);font-size:.7rem;">—</span>';

  return '<div class="recipe-card" id="rc-' + r.id + '">' +
    '<div class="recipe-card-type">' + (r.type ? typeIcon(r.type) + ' ' + typeLabel(r.type) : '<span style="color:var(--muted);">Toutes viandes</span>') + '</div>' +
    '<div class="recipe-card-name">' + r.name + '</div>' +
    '<div class="recipe-ratios">' +
    (r.salt_pct  != null ? '<div class="recipe-ratio"><div class="ratio-k">Sel</div><div class="ratio-v">' + r.salt_pct.toFixed(1)  + '%</div></div>' : '') +
    (r.sugar_pct != null ? '<div class="recipe-ratio"><div class="ratio-k">Sucre</div><div class="ratio-v">' + r.sugar_pct.toFixed(1) + '%</div></div>' : '') +
    '</div>' +
    '<div class="recipe-spices">' + spicesPreview + '</div>' +
    (r.notes ? '<div class="recipe-notes">' + r.notes + '</div>' : '') +
    '<div class="recipe-actions">' +
    '<button class="btn btn-ghost btn-sm" onclick="editRecipe(' + r.id + ')">✎ Modifier</button>' +
    '<button class="btn btn-ghost btn-sm" onclick="exportRecipe(' + r.id + ')" title="Exporter JSON">↓</button>' +
    '<button class="btn btn-ghost btn-sm" style="color:var(--danger);" onclick="deleteRecipe(' + r.id + ')">✕</button>' +
    '</div>' +
    '</div>';
}

function openNewRecipeForm() {
  showRecipeForm(null);
}

function editRecipe(rid) {
  var r = recipes.find(function (x) { return x.id === rid; });
  if (r) showRecipeForm(r);
}

function showRecipeForm(r) {
  var panel = document.getElementById('recipe-form-panel');
  if (!panel) return;
  var isNew = !r;
  panel.style.display = 'block';
  panel.innerHTML =
    '<div class="dcard-title">' + (isNew ? 'Nouvelle recette' : 'Modifier · ' + r.name) + '</div>' +
    '<div class="fg"><label>Nom</label><input type="text" id="rf-name" value="' + (r ? r.name : '') + '" placeholder="Ex : Coppa traditionnelle"></div>' +
    '<div class="fg"><label>Type de viande (optionnel)</label><select id="rf-type"><option value="">Toutes viandes</option>' + buildTypeOptions(r ? (r.type || '') : '') + '</select></div>' +
    '<div class="form-row">' +
    '<div class="fg"><label>Sel (%)</label><input type="number" id="rf-salt" value="' + (r && r.salt_pct != null ? r.salt_pct : '') + '" step="0.1" min="0" placeholder="4.5"></div>' +
    '<div class="fg"><label>Sucre (%)</label><input type="number" id="rf-sugar" value="' + (r && r.sugar_pct != null ? r.sugar_pct : '') + '" step="0.1" min="0" placeholder="2.0"></div>' +
    '</div>' +
    '<div class="fg"><label>Épices (séparées par virgule)</label><input type="text" id="rf-spices" value="' + (r && r.spices ? r.spices : '') + '" placeholder="Poivre noir, Ail, Thym..."></div>' +
    '<div class="fg"><label>Notes</label><textarea id="rf-notes" rows="2" placeholder="Méthode, variantes, durée de saumurage...">' + (r && r.notes ? r.notes : '') + '</textarea></div>' +
    '<div style="display:flex;gap:.5rem;margin-top:.5rem;">' +
    '<button class="btn btn-primary" onclick="submitRecipeForm(' + (r ? r.id : 'null') + ')">' + (isNew ? 'Créer la recette' : 'Enregistrer') + '</button>' +
    '<button class="btn btn-ghost" onclick="closeRecipeForm()">Annuler</button>' +
    '</div>';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setTimeout(function () { var n = document.getElementById('rf-name'); if (n) n.focus(); }, 80);
}

function closeRecipeForm() {
  var panel = document.getElementById('recipe-form-panel');
  if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
}

async function submitRecipeForm(rid) {
  var name = (document.getElementById('rf-name').value || '').trim();
  if (!name) { showToast('Nom requis', 'error'); return; }
  var saltVal  = document.getElementById('rf-salt').value;
  var sugarVal = document.getElementById('rf-sugar').value;
  var body = {
    name:      name,
    type:      document.getElementById('rf-type').value || null,
    salt_pct:  saltVal  ? parseFloat(saltVal)  : null,
    sugar_pct: sugarVal ? parseFloat(sugarVal) : null,
    spices:    document.getElementById('rf-spices').value.trim() || null,
    notes:     document.getElementById('rf-notes').value.trim() || null,
  };
  try {
    if (rid) {
      await apiFetch('/api/recipes/' + rid, { method: 'PUT', body: body });
    } else {
      await apiFetch('/api/recipes', { method: 'POST', body: body });
    }
    await loadRecipes();
    renderRecipes();
    showToast((rid ? 'Recette modifiée' : 'Recette créée') + ' ✓');
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

async function deleteRecipe(rid) {
  if (!confirm('Supprimer cette recette ?')) return;
  try {
    await apiFetch('/api/recipes/' + rid, { method: 'DELETE' });
    await loadRecipes();
    renderRecipes();
    showToast('Recette supprimée');
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

function exportRecipe(rid) {
  var r = recipes.find(function (x) { return x.id === rid; });
  if (!r) return;
  var blob = new Blob([JSON.stringify({ recipe: r }, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'recette-' + r.name.replace(/[^a-z0-9]/gi, '-').toLowerCase() + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importRecipes() {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async function (e) {
    var file = e.target.files[0];
    if (!file) return;
    try {
      var text = await file.text();
      var data = JSON.parse(text);
      var list = Array.isArray(data) ? data : (data.recipes ? data.recipes : (data.recipe ? [data.recipe] : []));
      if (!list.length) { showToast('Aucune recette trouvée dans le fichier', 'error'); return; }
      var count = 0;
      for (var r of list) {
        if (!r.name) continue;
        await apiFetch('/api/recipes', { method: 'POST', body: {
          name: r.name, type: r.type || null,
          salt_pct: r.salt_pct || null, sugar_pct: r.sugar_pct || null,
          spices: r.spices || null, notes: r.notes || null,
        }});
        count++;
      }
      await loadRecipes();
      renderRecipes();
      showToast(count + ' recette(s) importée(s) ✓');
    } catch (e) { showToast('Erreur import : ' + e.message, 'error'); }
  };
  input.click();
}

// ══════════════════════════════════════════════════════
// SORT & FILTER
// ══════════════════════════════════════════════════════
function setListSort(val) {
  listSort = val;
  renderList();
}

function setListFilter(key, val) {
  if (key === 'type') listFilterType = val;
  else listFilterStatus = val;
  renderList();
}

function clearListFilters() {
  listSort = 'status'; listFilterType = ''; listFilterStatus = '';
  var s = document.getElementById('list-sort');
  var ft = document.getElementById('list-filter-type');
  var fs = document.getElementById('list-filter-status');
  if (s)  s.value  = 'status';
  if (ft) ft.value = '';
  if (fs) fs.value = '';
  renderList();
}

// ══════════════════════════════════════════════════════
// TOUR MODE
// ══════════════════════════════════════════════════════
function startTour() {
  tourList = meats
    .filter(function (m) { return !m.archived; })
    .slice()
    .sort(function (a, b) {
      var la = new Date(a.weights[a.weights.length - 1].date);
      var lb = new Date(b.weights[b.weights.length - 1].date);
      return la - lb; // most overdue first
    });
  if (!tourList.length) { showToast('Aucune pièce active', 'info'); return; }
  tourIdx = 0;
  document.getElementById('tour-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  renderTour();
}

function closeTour() {
  document.getElementById('tour-overlay').classList.remove('open');
  document.body.style.overflow = '';
  tourList = []; tourIdx = 0;
}

function tourNav(delta) {
  tourIdx = Math.max(0, Math.min(tourList.length - 1, tourIdx + delta));
  renderTour();
}

function renderTour() {
  var overlay = document.getElementById('tour-overlay');
  if (!overlay || !tourList.length) return;
  var m = tourList[tourIdx];
  var mat = calcMat(m);
  var lastW = m.weights[m.weights.length - 1];
  var daysSince = Math.floor((new Date() - new Date(lastW.date)) / 86400000);
  var eta = calcEta(m);
  var c = mat.status === 'ready' ? 'var(--sage)' : mat.status === 'almost' ? 'var(--warn)' : mat.status === 'over' ? 'var(--danger)' : 'var(--blue)';
  var pct = Math.round((tourIdx / tourList.length) * 100);
  var etaStr = eta && eta.daysLeft > 0 ? eta.eta.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : (eta && eta.daysLeft === 0 ? 'Prêt ✓' : '');
  var dColor = daysSince >= (weighInterval || 7) ? 'var(--danger)' : daysSince >= Math.floor((weighInterval || 7) * 0.65) ? 'var(--warn)' : 'var(--muted)';
  var isLast = tourIdx === tourList.length - 1;

  overlay.innerHTML =
    '<div class="tour-header">' +
    '<button class="qw-close" onclick="closeTour()">✕</button>' +
    '<div class="tour-progress-bar"><div class="tour-progress-fill" style="width:' + pct + '%;"></div></div>' +
    '<span style="font-family:\'Fira Code\',monospace;font-size:.75rem;color:var(--muted);flex-shrink:0;">' + (tourIdx + 1) + '&thinsp;/&thinsp;' + tourList.length + '</span>' +
    '</div>' +

    '<div class="tour-body">' +
    '<div class="tour-meat-info">' +
    '<div class="tour-meat-icon">' + typeIcon(m.type) + '</div>' +
    '<div class="tour-meat-name">' + m.name + '</div>' +
    '<div class="tour-meat-type">' + typeLabel(m.type) + '</div>' +
    '</div>' +

    '<div class="tour-stats">' +
    '<div class="tour-stat"><div class="tour-stat-v" style="color:' + c + ';">' + mat.loss.toFixed(1) + '%</div><div class="tour-stat-k">Perte&thinsp;/&thinsp;' + mat.tLoss + '%</div></div>' +
    '<div class="tour-stat"><div class="tour-stat-v">' + lastW.weight + 'g</div><div class="tour-stat-k">Dernier poids</div></div>' +
    '<div class="tour-stat"><div class="tour-stat-v" style="color:' + dColor + ';">' + (daysSince === 0 ? 'Auj.' : daysSince + 'j') + '</div><div class="tour-stat-k">Depuis pesée</div></div>' +
    '</div>' +

    (etaStr ? '<div style="text-align:center;"><span class="pill" style="background:var(--glow);color:var(--copper2);border:1px solid var(--border2);font-size:.75rem;">Fin estimée : ' + etaStr + '</span></div>' : '') +

    '<div>' +
    '<div style="font-size:.62rem;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:.5rem;">Nouveau poids (g)</div>' +
    '<input id="tour-w" class="tour-weight-input" type="number" min="1" inputmode="decimal" placeholder="' + lastW.weight + '" onkeydown="if(event.key===\'Enter\')submitTourWeight()">' +
    '</div>' +
    '<div class="fg"><label>Date de pesée</label><input id="tour-d" type="date"></div>' +
    '</div>' + // tour-body

    '<div class="tour-actions">' +
    (tourIdx > 0 ? '<button class="btn btn-ghost tour-btn-skip" onclick="tourNav(-1)">← Préc.</button>' : '') +
    '<button id="tour-save-btn" class="btn btn-primary tour-btn-save" onclick="submitTourWeight()">' + (isLast ? 'Peser + Terminer ✓' : 'Peser + Suivant →') + '</button>' +
    (!isLast ? '<button class="btn btn-ghost tour-btn-skip" onclick="tourNav(1)">Passer →</button>' : '') +
    '</div>';

  var di = document.getElementById('tour-d');
  if (di) di.valueAsDate = new Date();
  setTimeout(function () { var wi = document.getElementById('tour-w'); if (wi) wi.focus(); }, 80);
}

async function submitTourWeight() {
  var w = parseFloat((document.getElementById('tour-w') || {}).value);
  var d = (document.getElementById('tour-d') || {}).value || new Date().toISOString().split('T')[0];
  if (!w || w <= 0) { tourNav(1); return; }
  var m = tourList[tourIdx];
  var btn = document.getElementById('tour-save-btn');
  if (btn) btn.disabled = true;
  try {
    var updated = await apiFetch('/api/meats/' + m.id + '/weights', { method: 'POST', body: { weight: w, date: d } });
    meats = meats.map(function (x) { return x.id === updated.id ? updated : x; });
    tourList[tourIdx] = updated;
    showToast(m.name + ' · pesée enregistrée ✓');
    if (tourIdx < tourList.length - 1) { tourIdx++; renderTour(); }
    else { closeTour(); renderList(); showToast('Tournée terminée ✓'); }
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
  finally { if (btn) btn.disabled = false; }
}

var VIEW_LABELS = { dashboard: 'Tableau de bord', list: 'Mes pièces', archive: 'Archives', add: 'Nouvelle pièce', scan: 'Scanner QR', history: 'Historique', recipes: 'Recettes', settings: 'Paramètres', detail: 'Détail' };

function showView(name) {
  if (name !== 'scan') stopCamera();
  document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(function (b) { b.classList.remove('active'); });

  var viewId = name === 'archive' ? 'list' : name;
  var el = document.getElementById(viewId + '-view');
  if (el) el.classList.add('active');

  var idx = ['dashboard', 'list', 'archive', 'add', 'scan', 'history', 'recipes', 'settings'].indexOf(name);
  if (idx >= 0) {
    var navItems = document.querySelectorAll('.nav-item');
    if (navItems[idx]) navItems[idx].classList.add('active');
  }

  var crumb = document.getElementById('topbar-crumb');
  if (crumb) crumb.innerHTML = '<span>' + (VIEW_LABELS[name] || '') + '</span>';
  closeSidebar();

  if (name === 'dashboard') {
    refreshDashboard();
  }
  else if (name === 'list' || name === 'archive') {
    currentListView = name;
    if (meats.length === 0 && !document.querySelector('.empty')) loadMeats();
    else renderList();

    var isArchive = name === 'archive';
    var displayMeats = meats.filter(function (m) { return !!m.archived === isArchive; });
    var pBtn = document.getElementById('print-all-btn');
    if (pBtn) pBtn.style.display = displayMeats.length > 0 ? 'inline-flex' : 'none';
  }
  else if (name === 'settings') {
    fillIntegrationSnippets();
    if (meats.length === 0) loadMeats().then(function () { updateSettingsStats(); loadGitHubSettings(); loadTelegramSettings(); loadAppSettings(); });
    else { updateSettingsStats(); loadGitHubSettings(); loadTelegramSettings(); loadAppSettings(); }
  }
  else if (name === 'history') {
    refreshEnvChart();
  }
  else if (name === 'recipes') {
    renderRecipes();
  }
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('overlay').style.display = 'block';
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').style.display = 'none';
}

// ══════════════════════════════════════════════════════
// INTEGRATION SNIPPETS (Homepage / Home Assistant)
// ══════════════════════════════════════════════════════
function fillIntegrationSnippets() {
  var origin = window.location.origin; // e.g. http://192.168.1.10:3000

  var snippets = {
    'snippet-hp-api': [
      '# services.yaml (Homepage)',
      '- Cave d\'Affinage:',
      '    - Maturation:',
      '        icon: mdi-food-steak',
      '        href: ' + origin,
      '        description: Suivi de séchage & affinage',
      '        widget:',
      '          type: customapi',
      '          url: ' + origin + '/api/homepage',
      '          mappings:',
      '            - field: en_cours',
      '              label: En cours',
      '              format: number',
      '            - field: pretes',
      '              label: Prêtes',
      '              format: number',
      '            - field: temperature',
      '              label: Température',
      '              format: float',
      '              suffix: "°C"',
      '            - field: humidity',
      '              label: Humidité',
      '              format: float',
      '              suffix: "%"',
    ].join('\n'),

    'snippet-hp-iframe': [
      '# services.yaml (Homepage)',
      '- Cave d\'Affinage:',
      '    - Maturation:',
      '        description: Cave d\'affinage',
      '        widget:',
      '          type: iframe',
      '          src: ' + origin,
      '          classes: h-96',
      '          referrerPolicy: same-origin',
      '          allowPolicy: autoplay; fullscreen',
    ].join('\n'),

    'snippet-ha-rest': [
      '# configuration.yaml (Home Assistant)',
      'rest_command:',
      '  update_cave_sensors:',
      '    url: "' + origin + '/api/sensors"',
      '    method: post',
      '    verify_ssl: false',
      '    content_type: "application/json"',
      '    payload: \'{"temperature": {{ states("sensor.votre_temp") }},',
      '               "humidity": {{ states("sensor.votre_hum") }}}\'',
    ].join('\n'),

    'snippet-ha-auto': [
      '# automations.yaml (Home Assistant)',
      '- alias: "Envoi capteurs → Cave d\'Affinage"',
      '  trigger:',
      '    - platform: time_pattern',
      '      minutes: "/15"',
      '  condition: []',
      '  action:',
      '    - service: rest_command.update_cave_sensors',
    ].join('\n'),
  };

  Object.keys(snippets).forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.textContent = snippets[id];
  });
}

function copySnippet(id) {
  var el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(function () {
    showToast('Snippet copié ✓');
  }).catch(function () {
    // Fallback for non-HTTPS contexts
    var ta = document.createElement('textarea');
    ta.value = el.textContent;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Snippet copié ✓');
  });
}

function switchTab(group, tab, btn) {
  // Hide all tabs in group
  document.querySelectorAll('[id^="' + group + '-tab-"]').forEach(function (el) { el.style.display = 'none'; });
  document.querySelectorAll('#' + group + '-tabs .itab').forEach(function (b) { b.classList.remove('active'); });
  // Show selected
  var target = document.getElementById(group + '-tab-' + tab);
  if (target) target.style.display = '';
  if (btn) btn.classList.add('active');
}

// ══════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════
function updateSettingsStats() {
  var t = meats.length, r = meats.filter(function (m) { return calcMat(m).status === 'ready'; }).length;
  var totalW = meats.reduce(function (sum, m) {
    return sum + m.weights[m.weights.length - 1].weight;
  }, 0);

  var et = document.getElementById('stats-total'),
    er = document.getElementById('stats-ready'),
    ew = document.getElementById('stats-weight'),
    es = document.getElementById('storage-size');

  if (et) et.textContent = t;
  if (er) er.textContent = r;
  if (ew) ew.textContent = formatWeight(totalW);
  if (es) es.textContent = (JSON.stringify(meats).length / 1024).toFixed(1) + ' KB';
  var bi = document.getElementById('last-backup-info');
  if (bi) bi.textContent = 'Données stockées sur le serveur (SQLite)';
}

async function exportData() {
  try {
    var res = await fetch('/api/meats/export/all'), blob = await res.blob();
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'cave-affinage-' + new Date().toISOString().split('T')[0] + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Sauvegarde téléchargée ✓');
  } catch (e) { showToast('Erreur export', 'error'); }
}

function importData(ev) {
  var file = ev.target.files[0];
  if (!file) return;
  if (!confirm('⚠ Remplacera toutes les données actuelles. Continuer ?')) { ev.target.value = ''; return; }
  var r = new FileReader();
  r.onload = async function (e) {
    try {
      var data = JSON.parse(e.target.result);
      if (!data.meats || !Array.isArray(data.meats)) throw new Error('Format invalide');
      var res = await apiFetch('/api/meats/import/all', { method: 'POST', body: data });
      await loadMeats();
      showToast(res.count + ' pièce(s) importée(s) ✓');
      showView('list');
    } catch (err) { showToast('Erreur import : ' + err.message, 'error'); }
    ev.target.value = '';
  };
  r.readAsText(file);
}

async function clearAllData() {
  if (!confirm('⚠ Supprimer toutes les données ? Cette action est irréversible.')) return;
  if (!confirm('Confirmez la suppression définitive.')) return;
  try {
    for (var i = 0; i < meats.length; i++) await apiFetch('/api/meats/' + meats[i].id, { method: 'DELETE' });
    meats = [];
    renderList();
    showView('list');
    showToast('Données supprimées');
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

// GitHub Sync
function loadGitHubSettings() {
  fetch('/api/github/settings')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (!data || data.id === undefined) return;
      var t = document.getElementById('gh-token');
      var r = document.getElementById('gh-repo');
      var p = document.getElementById('gh-path');
      var autoEl = document.getElementById('gh-auto-enabled');
      var hourEl = document.getElementById('gh-auto-hour');
      if (t) t.value = data.token || '';
      if (r) r.value = data.repo || '';
      if (p) p.value = data.path || 'backup.json';
      var autoOn = !!data.auto_backup_enabled;
      if (autoEl) autoEl.checked = autoOn;
      if (hourEl) hourEl.value = data.auto_backup_hour != null ? data.auto_backup_hour : 2;
      toggleGhAutoHour(autoOn);
      _renderGhLastBackup(data.last_backup_at);
    });
}

function toggleGhAutoHour(on) {
  var row = document.getElementById('gh-auto-hour-row');
  if (row) row.style.display = on ? '' : 'none';
}

function _renderGhLastBackup(isoStr) {
  var el = document.getElementById('gh-last-backup');
  var dateEl = document.getElementById('gh-last-backup-date');
  if (!el || !dateEl) return;
  if (!isoStr) { el.style.display = 'none'; return; }
  try {
    var d = new Date(isoStr);
    dateEl.textContent = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) +
      ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    el.style.display = '';
  } catch (e) { el.style.display = 'none'; }
}

async function saveGitHubSettings() {
  var tokenVal = document.getElementById('gh-token').value.trim();
  var repoVal  = document.getElementById('gh-repo').value.trim();
  var autoEl   = document.getElementById('gh-auto-enabled');
  var hourEl   = document.getElementById('gh-auto-hour');
  var body = {
    token: tokenVal,
    repo:  repoVal,
    path:  document.getElementById('gh-path').value.trim() || 'backup.json',
    enabled: (tokenVal && repoVal) ? 1 : 0,
    auto_backup_enabled: (autoEl && autoEl.checked) ? 1 : 0,
    auto_backup_hour: hourEl ? parseInt(hourEl.value) : 2,
  };
  if (!body.token || !body.repo) { showToast('Token et dépôt requis', 'error'); return; }
  try {
    await apiFetch('/api/github/settings', { method: 'PUT', body: body });
    showToast('Configuration GitHub enregistrée ✓');
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

async function backupToGitHub() {
  showToast('Sauvegarde GitHub en cours…', 'info');
  try {
    var res = await apiFetch('/api/github/backup', { method: 'POST' });
    if (res.success) {
      _renderGhLastBackup(res.last_backup_at);
      showToast('Sauvegarde GitHub réussie ✓');
    } else {
      showToast('Erreur GitHub : ' + (res.error || 'inconnue'), 'error');
    }
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

// Telegram
function loadTelegramSettings() {
  fetch('/api/telegram/settings')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (!data || data.id === undefined) return;
      var t = document.getElementById('tg-token'), c = document.getElementById('tg-chatid'), i = document.getElementById('tg-interval'), e = document.getElementById('tg-enabled'), f = document.getElementById('tg-report-freq');
      if (t) t.value = data.token || '';
      if (c) c.value = data.chat_id || '';
      if (f) f.value = data.report_frequency || 'off';
      if (i) i.value = (data.interval_days !== undefined) ? data.interval_days : 7;
      if (e) e.checked = !!data.enabled;
      if (data.interval_days !== undefined) weighInterval = data.interval_days;
    });
}

async function saveTelegramSettings() {
  var body = {
    token: document.getElementById('tg-token').value.trim(),
    chat_id: document.getElementById('tg-chatid').value.trim(),
    report_frequency: document.getElementById('tg-report-freq').value,
    interval_days: document.getElementById('tg-interval').value === "" ? 7 : parseInt(document.getElementById('tg-interval').value),
    enabled: document.getElementById('tg-enabled').checked ? 1 : 0
  };
  try {
    await apiFetch('/api/telegram/settings', { method: 'PUT', body: body });
    showToast('Configuration Telegram enregistrée ✓');
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

async function testTelegram() {
  showToast('Envoi du message de test...', 'info');
  try {
    var res = await apiFetch('/api/telegram/test', { method: 'POST' });
    if (res.success) showToast('Message envoyé ! Vérifiez Telegram ✓');
    else showToast('Erreur Telegram : ' + (res.error || 'échec'), 'error');
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

async function triggerTelegramCheck() {
  showToast('Vérification des notifications en cours...', 'info');
  try {
    var res = await apiFetch('/api/telegram/check', { method: 'POST' });
    if (res.success) {
      if (res.notifications_sent > 0) showToast(res.notifications_sent + ' notification(s) envoyée(s) ✓');
      else showToast('Aucune pièce ne nécessite de rappel.');
    } else {
      showToast('Erreur lors de la vérification : ' + (res.error || 'échec'), 'error');
    }
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

async function triggerTelegramReport() {
  showToast('Génération du rapport en cours...', 'info');
  try {
    var res = await apiFetch('/api/telegram/report', { method: 'POST' });
    if (res.success) showToast('Rapport envoyé ! Vérifiez Telegram 📊');
    else showToast('Erreur rapport : ' + (res.error || 'échec'), 'error');
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}
var appSettings = { producer_name: '' };
function loadAppSettings() {
  fetch('/api/settings').then(function (res) { return res.json(); }).then(function (data) {
    if (!data) return;
    appSettings = data;
    var p = document.getElementById('setting-producer-name');
    if (p) p.value = data.producer_name || '';
  });
}
async function saveAppSettings() {
  var b = { producer_name: document.getElementById('setting-producer-name').value.trim() };
  try {
    await apiFetch('/api/settings', { method: 'PUT', body: b });
    appSettings.producer_name = b.producer_name;
    showToast('Paramètres enregistrés ✓');
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}
