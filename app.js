// Ma Tesla — version connectée à Tessie (mode démo si aucun code d'accès)
const $ = s => document.querySelector(s);
const API = 'https://api.tessie.com';
const store = {
  get(k, d) { try { const v = localStorage.getItem('mt_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('mt_' + k, JSON.stringify(v)); } catch (e) {} }
};

let TOKEN = store.get('token', '');
let VIN = store.get('vin', '');
const live = () => !!(TOKEN && VIN);

const S = { verrou: true, sentinelle: false, coffre: false, frunk: false, trappe: false, aerer: false,
  clim: false, temp: 21, lim: 80, pct: 72, autoKm: 364, inside: 14, lat: null, lon: null, gear: null, nom: 'Ma Tesla' };

function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('show'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('show'), 2200); }
const fr = (n, d = 1) => (Number.isFinite(+n) ? Number(n) : 0).toFixed(d).replace('.', ',');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- Appels Tessie ----------
async function api(path, method = 'GET') {
  const r = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + TOKEN } });
  if (r.status === 401 || r.status === 403) throw new Error('Code d\'accès refusé');
  if (!r.ok) throw new Error('Erreur ' + r.status);
  return r.json();
}
async function cmd(name, params = '') {
  if (!live()) return true;
  const q = 'wait_for_completion=true' + (params ? '&' + params : '');
  const res = await api(`/${VIN}/command/${name}?${q}`, 'POST');
  if (res && res.result === false) throw new Error(res.reason || 'Commande refusée');
  return true;
}

// ---------- Lecture de l'état ----------
async function charger() {
  if (!live()) return;
  try {
    const d = await api(`/${VIN}/state?use_cache=true`);
    const c = d.charge_state || {}, cl = d.climate_state || {}, v = d.vehicle_state || {}, dr = d.drive_state || {};
    S.nom = d.display_name || (d.vehicle_state && d.vehicle_state.vehicle_name) || 'Ma Tesla';
    if (c.battery_level != null) S.pct = c.battery_level;
    if (c.battery_range != null) S.autoKm = Math.round(c.battery_range * 1.609);
    if (c.charge_limit_soc != null) S.lim = c.charge_limit_soc;
    S.trappe = !!c.charge_port_door_open;
    S.charge = c.charging_state || '';
    S.puissance = c.charger_power || 0;
    S.verrou = !!v.locked; S.sentinelle = !!v.sentry_mode;
    S.coffre = !!v.rt; S.frunk = !!v.ft;
    S.aerer = !!(v.fd_window || v.fp_window || v.rd_window || v.rp_window);
    S.clim = !!cl.is_climate_on;
    if (cl.driver_temp_setting != null) S.temp = cl.driver_temp_setting;
    if (cl.inside_temp != null) S.inside = cl.inside_temp;
    S.lat = dr.latitude; S.lon = dr.longitude; S.gear = dr.shift_state;
    S.etatCar = d.state;
    toutAfficher();
    automatismes();
    $('#cxEtat').textContent = 'Connectée à ' + S.nom + ' · mise à jour ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    $('#cxEtat').textContent = 'Impossible de lire la voiture : ' + msgErreur(e);
  }
}
async function chargerMeteo() {
  if (!live()) return;
  try {
    const w = await api(`/${VIN}/weather`);
    const t = w.temperature ?? w.temp;
    if (t != null) $('#wxT').textContent = Math.round(t) + '°';
    const cond = w.condition || w.description || '';
    $('#wxI').textContent = /rain|pluie|drizzle/i.test(cond) ? '🌧️' : /snow|neige/i.test(cond) ? '❄️' : /clear|sun|soleil/i.test(cond) ? '☀️' : '⛅';
    const lo = w.min_temperature ?? w.temp_min, hi = w.max_temperature ?? w.temp_max;
    $('#wxD').innerHTML = (traduire(cond) || 'Météo actuelle') + (lo != null && hi != null ? `<br>Min ${Math.round(lo)}° · Max ${Math.round(hi)}°` : '') + (w.location ? `<br>${esc(w.location)}` : '');
  } catch (e) {}
}
function traduire(c) {
  const m = { Clear: 'Dégagé', Clouds: 'Nuageux', Rain: 'Pluie', Drizzle: 'Bruine', Snow: 'Neige', Thunderstorm: 'Orage', Mist: 'Brume', Fog: 'Brouillard' };
  return m[c] || c;
}
async function chargerHistorique() {
  if (!live()) return;
  try {
    const now = Math.floor(Date.now() / 1000);
    const d = await api(`/${VIN}/charges?from=${now - 60 * 86400}&to=${now}&distance_format=km&format=json&superchargers_only=false`);
    const list = (d.results || d || []).slice(0, 15);
    if (!Array.isArray(list) || !list.length) { $('#hist').innerHTML = '<div class="mut">Aucune recharge sur les 60 derniers jours.</div>'; return; }
    const debutMois = new Date(); debutMois.setDate(1); debutMois.setHours(0, 0, 0, 0);
    let e = 0, cost = 0;
    $('#hist').innerHTML = list.map(h => {
      const t = new Date((h.started_at || h.start_date || 0) * 1000);
      const kwh = h.energy_added ?? h.energy_used ?? 0;
      const dom = estDomicile(h), hh = t.getHours();
      const prix = h.cost > 0 ? h.cost : dom ? kwh * (hh >= 9 && hh < 16 ? P.solaire : P.reseau) : kwh * P.superc;
      if (t >= debutMois) { e += kwh; cost += prix; }
      const lieu = (dom ? '🏠 ' : '⚡ ') + (h.saved_location || h.location || (h.is_supercharger ? 'Superchargeur' : 'Recharge'));
      return `<div class="row"><div><div>${esc(lieu)}</div><div class="mut">${t.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} · ${fr(kwh, 0)} kWh</div></div><b>${fr(prix, 2)} €</b></div>`;
    }).join('');
    $('#mE').textContent = fr(e, 0) + ' kWh'; $('#mC').textContent = fr(cost, 2) + ' €';
  } catch (er) { $('#hist').innerHTML = '<div class="mut">Historique indisponible : ' + msgErreur(er) + '</div>'; }
}
function msgErreur(e) {
  return (e && e.message === 'Failed to fetch') ? 'connexion bloquée ou pas d\'internet' : (e && e.message) || 'erreur inconnue';
}

// ---------- Tuiles ----------
const ico = {
  verrou: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  sentinelle: '<circle cx="12" cy="12" r="3"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/>',
  coffre: '<path d="M3 15h18v4H3z"/><path d="M5 15l2-6h10l2 6"/>',
  frunk: '<path d="M3 13h18v5H3z"/><path d="M6 13l3-5h6l3 5"/>',
  trappe: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  aerer: '<path d="M4 8h12a3 3 0 1 0-3-3"/><path d="M4 12h16"/><path d="M4 16h10a3 3 0 1 1-3 3"/>'
};
const T = [
  ['verrou', () => S.verrou ? 'Verrouillée' : 'Déverrouillée', () => S.verrou ? 'unlock' : 'lock', () => S.verrou = !S.verrou, () => S.verrou ? 'Voiture verrouillée' : 'Voiture déverrouillée'],
  ['sentinelle', () => 'Sentinelle', () => S.sentinelle ? 'disable_sentry' : 'enable_sentry', () => S.sentinelle = !S.sentinelle, () => S.sentinelle ? 'Sentinelle activée' : 'Sentinelle désactivée'],
  ['coffre', () => 'Coffre', () => 'activate_rear_trunk', () => S.coffre = !S.coffre, () => S.coffre ? 'Coffre ouvert' : 'Coffre fermé'],
  ['frunk', () => 'Frunk', () => 'activate_front_trunk', () => S.frunk = true, () => 'Frunk ouvert'],
  ['trappe', () => 'Trappe', () => S.trappe ? 'close_charge_port' : 'open_charge_port', () => S.trappe = !S.trappe, () => S.trappe ? 'Trappe ouverte' : 'Trappe fermée'],
  ['aerer', () => 'Aérer', () => S.aerer ? 'close_windows' : 'vent_windows', () => S.aerer = !S.aerer, () => S.aerer ? 'Fenêtres entrouvertes' : 'Fenêtres fermées']
];
const sensibles = { unlock: 'Déverrouiller la voiture ?', activate_front_trunk: 'Ouvrir le frunk ?', activate_rear_trunk: 'Ouvrir/fermer le coffre ?', vent_windows: 'Entrouvrir les fenêtres ?' };
function tuiles() {
  $('#tuiles').innerHTML = T.map(([k, l], i) => `<div class="tile ${S[k] ? 'on' : ''}" data-i="${i}"><svg viewBox="0 0 24 24">${ico[k]}</svg>${l()}</div>`).join('');
}
let attente = null;
$('#tuiles').onclick = async e => {
  const t = e.target.closest('.tile'); if (!t || t.classList.contains('busy')) return;
  const [, , c, act, msg] = T[t.dataset.i]; const nom = c();
  if (sensibles[nom] && attente !== nom) { attente = nom; toast(sensibles[nom] + ' Touchez encore pour confirmer'); setTimeout(() => { if (attente === nom) attente = null; }, 3000); return; }
  attente = null;
  t.classList.add('busy');
  try { await cmd(nom); act(); toast(msg()); } catch (er) { toast('Échec : ' + msgErreur(er)); }
  tuiles(); etat();
};
function etat() {
  const st = [S.gear && S.gear !== 'P' ? 'En route' : 'Garée', S.verrou ? 'Verrouillée' : 'Déverrouillée'];
  if (S.sentinelle) st.push('Sentinelle');
  if (S.charge === 'Charging') st.push('En charge');
  $('#etat').textContent = st.join(' · ');
  $('#nom').textContent = S.nom;
}

// ---------- Climatisation ----------
function clim() {
  $('#swClim').classList.toggle('on', S.clim);
  $('#climEtat').textContent = (S.clim ? 'En marche · vers ' + fr(S.temp) + ' °C' : 'Arrêtée') + ' · Intérieur ' + Math.round(S.inside) + ' °C';
  $('#temp').textContent = fr(S.temp) + ' °C';
}
$('#swClim').onclick = async () => {
  try { await cmd(S.clim ? 'stop_climate' : 'start_climate'); S.clim = !S.clim; clim(); toast(S.clim ? 'Climatisation lancée' : 'Climatisation arrêtée'); }
  catch (er) { toast('Échec : ' + msgErreur(er)); }
};
let tTemp;
document.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
  S.temp = Math.min(28, Math.max(15, S.temp + b.dataset.t * 0.5)); clim();
  clearTimeout(tTemp); tTemp = setTimeout(async () => {
    try { await cmd('set_temperatures', 'temperature=' + S.temp); toast('Température réglée à ' + fr(S.temp) + ' °C'); } catch (er) { toast('Échec : ' + msgErreur(er)); }
  }, 900);
});

// ---------- Charge ----------
function batterie() {
  $('#pct').textContent = S.pct; $('#barre').style.width = S.pct + '%'; $('#auto').textContent = '≈ ' + S.autoKm + ' km';
  const ce = $('#chargeEtat');
  const lib = { Charging: 'En charge' + (S.puissance ? ' · ' + S.puissance + ' kW' : ''), Complete: 'Charge terminée', Stopped: 'Branchée · en pause', Disconnected: 'Non branchée' };
  ce.textContent = lib[S.charge] || (live() ? 'Non branchée' : 'Non branchée');
  ce.classList.toggle('ok', S.charge === 'Charging');
}
function lim() { $('#limVal').textContent = S.lim + ' %'; $('#limTxt').textContent = 'Limite de charge : ' + S.lim + ' %'; $('#repere').style.left = S.lim + '%'; $('#limRange').value = S.lim; }
$('#limRange').oninput = e => { S.lim = +e.target.value; lim(); };
$('#limRange').onchange = async () => { try { await cmd('set_charge_limit', 'percent=' + S.lim); toast('Limite réglée à ' + S.lim + ' %'); } catch (er) { toast('Échec : ' + msgErreur(er)); } };

const L = store.get('lieux', live() ? [] : [['🏠', 'Domicile', 80, null, null], ['🏢', 'Travail', 100, null, null]]);
let lieuxOn = store.get('lieuxOn', true);
function lieux() {
  $('#swLieu').classList.toggle('on', lieuxOn);
  $('#lieux').innerHTML = L.length ? L.map((l, i) => `<div class="row"><span>${l[0]} <span contenteditable="true" data-n="${i}" style="outline:none;border-bottom:1px dashed var(--line)">${esc(l[1])}</span></span><span style="display:flex;gap:8px;align-items:center"><select data-l="${i}">${[50, 60, 70, 80, 90, 100].map(v => `<option ${v === l[2] ? 'selected' : ''}>${v}</option>`).join('')}</select><span data-x="${i}" style="color:var(--mut);cursor:pointer;padding:4px">✕</span></span></div>`).join('')
    : '<div class="mut" style="padding:10px 0">Garez la voiture à un endroit (maison, travail…), puis touchez le bouton ci-dessous.</div>';
}
function sauverLieux() { store.set('lieux', L); }
$('#lieux').onchange = e => { const i = e.target.dataset.l; if (i == null) return; L[i][2] = +e.target.value; sauverLieux(); toast(L[i][1] + ' : ' + L[i][2] + ' %'); };
$('#lieux').addEventListener('focusout', e => { const i = e.target.dataset.n; if (i == null) return; L[i][1] = e.target.textContent.trim() || 'Lieu'; sauverLieux(); });
$('#lieux').onclick = e => { const i = e.target.dataset.x; if (i == null) return; L.splice(i, 1); sauverLieux(); lieux(); };
$('#ajLieu').onclick = () => {
  if (live() && S.lat == null) { toast('Position de la voiture inconnue pour l\'instant'); return; }
  L.push(['📍', 'Nouveau lieu', S.lim, S.lat, S.lon]); sauverLieux(); lieux(); toast('Lieu ajouté : touchez le nom pour le changer');
};
$('#swLieu').onclick = () => { lieuxOn = !lieuxOn; store.set('lieuxOn', lieuxOn); lieux(); toast(lieuxOn ? 'Limite selon le lieu activée' : 'Limite selon le lieu désactivée'); };

function distance(a, b, c, d) { const R = 6371e3, r = x => x * Math.PI / 180; const x = r(c - a), y = r(d - b); const h = Math.sin(x / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(y / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
function lieuActuel() {
  if (S.lat == null) return null;
  return L.find(l => l[3] != null && distance(S.lat, S.lon, l[3], l[4]) < 250) || null;
}

// ---------- Automatismes (quand l'application est ouverte) ----------
let dejaFait = {};
async function automatismes() {
  const ici = lieuActuel();
  const garee = !S.gear || S.gear === 'P';
  if (lieuxOn && ici && ici[2] !== S.lim && dejaFait.lim !== ici[1] + ici[2]) {
    dejaFait.lim = ici[1] + ici[2];
    try { await cmd('set_charge_limit', 'percent=' + ici[2]); S.lim = ici[2]; lim(); toast(ici[1] + ' : limite passée à ' + ici[2] + ' %'); } catch (e) {}
  }
  const sentAuto = store.get('sentAuto', false), sentMaison = store.get('sentMaison', true);
  const maison = ici && /domicile|maison/i.test(ici[1]);
  const maisonConnue = L.some(l => l[3] != null && /domicile|maison/i.test(l[1]));
  if (sentAuto && garee && S.lat != null && !S.sentinelle && !(sentMaison && (maison || !maisonConnue)) && dejaFait.sent !== 'on') {
    dejaFait.sent = 'on';
    try { await cmd('enable_sentry'); S.sentinelle = true; tuiles(); etat(); toast('Sentinelle activée automatiquement'); } catch (e) {}
  }
  if (!garee) dejaFait.sent = null;
}

// ---------- Carte ----------
function carte() {
  if (S.lat != null) {
    $('#plans').href = `https://maps.apple.com/?ll=${S.lat},${S.lon}&q=${encodeURIComponent(S.nom)}`;
    const ici = lieuActuel();
    $('#posTxt').textContent = (S.gear && S.gear !== 'P' ? 'En route' : 'Garée') + (ici ? ' · ' + ici[1] : ' · ' + fr(S.lat, 4) + ', ' + fr(S.lon, 4));
  }
}
$('#phares').onclick = async () => { try { await cmd('flash'); toast('Phares allumés'); } catch (er) { toast('Échec : ' + msgErreur(er)); } };
$('#klax').onclick = async () => { try { await cmd('honk'); toast('Coup de klaxon envoyé'); } catch (er) { toast('Échec : ' + msgErreur(er)); } };

// ---------- Réglages ----------
[['#swSentAuto', 'sentAuto', false], ['#swSentMaison', 'sentMaison', true]].forEach(([id, k, def]) => {
  $(id).classList.toggle('on', store.get(k, def));
  $(id).onclick = e => {
    const v = !store.get(k, def); store.set(k, v); e.currentTarget.classList.toggle('on', v);
    if (k === 'sentAuto' && v && !L.some(l => l[3] != null && /domicile|maison/i.test(l[1]))) toast('Ajoutez d\'abord votre « Domicile » dans Charge → Limite selon le lieu');
  };
});
function connexionUI() {
  $('#badge').style.display = live() ? 'none' : '';
  $('#cx').style.display = live() ? 'none' : '';
  $('#tok').style.display = live() ? 'none' : '';
  $('#dx').style.display = live() ? '' : 'none';
  if (!live()) $('#cxEtat').textContent = 'Non connectée — mode démo';
}
$('#cx').onclick = async () => {
  const t = $('#tok').value.trim();
  if (!t) { toast('Collez d\'abord votre code d\'accès'); return; }
  TOKEN = t; $('#cxEtat').textContent = 'Connexion…';
  try {
    const d = await api('/vehicles?only_active=false');
    const list = (d.results || []).map(v => ({ vin: v.vin, nom: (v.last_state && v.last_state.display_name) || v.vin }));
    if (!list.length) throw new Error('aucune voiture trouvée sur ce compte');
    store.set('token', TOKEN);
    if (list.length === 1) { choisir(list[0].vin); return; }
    const sel = $('#vins'); sel.style.display = '';
    sel.innerHTML = '<option value="">Choisissez la voiture</option>' + list.map(v => `<option value="${esc(v.vin)}">${esc(v.nom)}</option>`).join('');
    sel.onchange = () => sel.value && choisir(sel.value);
    $('#cxEtat').textContent = 'Choisissez votre voiture';
  } catch (e) { TOKEN = ''; $('#cxEtat').textContent = 'Échec de la connexion : ' + msgErreur(e); }
};
function choisir(vin) {
  VIN = vin; store.set('vin', vin); TR = null; $('#vins').style.display = 'none'; $('#tok').value = '';
  if (!store.get('lieux', null)) L.length = 0;
  sauverLieux(); lieux(); connexionUI(); toast('Voiture connectée'); toutCharger();
}
$('#dx').onclick = () => { TOKEN = ''; VIN = ''; TR = null; store.set('token', ''); store.set('vin', ''); connexionUI(); toast('Déconnectée'); };



// ---------- Compteur HomeWizard (import CSV) ----------
// Stockage compact : [minutes depuis 1970, import cumulé kWh, export cumulé kWh]
let HW = store.get('hw', []);
function lireCSV(txt) {
  const lignes = txt.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (lignes.length < 3) throw new Error('fichier vide ou trop court');
  const sep = (lignes[0].match(/;/g) || []).length > (lignes[0].match(/,/g) || []).length ? ';' : ',';
  const tete = lignes[0].split(sep).map(h => h.trim().replace(/"/g, ''));
  const iT = tete.findIndex(h => /^(time|date|tijd|datum)/i.test(h));
  const iImp = tete.map((h, i) => /import/i.test(h) && /kwh/i.test(h) ? i : -1).filter(i => i >= 0);
  const iExp = tete.map((h, i) => /export/i.test(h) && /kwh/i.test(h) ? i : -1).filter(i => i >= 0);
  if (iT < 0 || !iImp.length) throw new Error('ce n\'est pas un export HomeWizard d\'électricité');
  const num = v => { v = (v || '').trim().replace(/"/g, ''); if (sep === ';') v = v.replace(',', '.'); const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const out = [];
  for (const l of lignes.slice(1)) {
    const c = l.split(sep);
    const t = new Date((c[iT] || '').trim().replace(/"/g, '').replace(' ', 'T'));
    if (isNaN(t)) continue;
    out.push([Math.round(t / 60000), iImp.reduce((a, i) => a + num(c[i]), 0), iExp.reduce((a, i) => a + num(c[i]), 0)]);
  }
  if (out.length < 2) throw new Error('aucune ligne lisible');
  return out;
}
function fusionner(nouv) {
  const m = new Map(HW.map(r => [r[0], r])); nouv.forEach(r => m.set(r[0], r));
  HW = [...m.values()].sort((a, b) => a[0] - b[0]);
  try { store.set('hw', HW); localStorage.getItem('mt_hw'); } catch (e) {}
}
// Intervalles : {a, b (ms), imp, exp}
function intervalles() {
  const r = [];
  for (let i = 0; i < HW.length - 1; i++) {
    const di = HW[i + 1][1] - HW[i][1], de = HW[i + 1][2] - HW[i][2];
    if (di < 0 || de < 0) continue;
    r.push({ a: HW[i][0] * 60000, b: HW[i + 1][0] * 60000, imp: di, exp: de });
  }
  return r;
}
function resolutionMin() {
  if (HW.length < 2) return Infinity;
  const d = []; for (let i = 1; i < Math.min(HW.length, 50); i++) d.push(HW[i][0] - HW[i - 1][0]);
  d.sort((x, y) => x - y); return d[Math.floor(d.length / 2)];
}
// Part réseau d'une recharge : ce que la maison a pris au réseau pendant la charge (prudent)
function partReseau(debut, fin, kwh) {
  if (!fin || fin <= debut || HW.length < 2) return null;
  const iv = intervalles(); let imp = 0, couvert = 0;
  for (const x of iv) {
    const o = Math.min(fin, x.b) - Math.max(debut, x.a); if (o <= 0) continue;
    if (x.b - x.a > 61 * 60000) return null;
    const f = o / (x.b - x.a); imp += x.imp * f; couvert += o;
  }
  if (couvert < (fin - debut) * 0.8) return null;
  return Math.min(kwh, imp);
}
function hwAfficher() {
  const has = HW.length > 1;
  $('#hwSuppr').style.display = has ? '' : 'none';
  if (!has) { $('#hwStats').innerHTML = ''; $('#hwGraph').innerHTML = ''; return; }
  const iv = intervalles();
  const d0 = new Date(HW[0][0] * 60000), d1 = new Date(HW[HW.length - 1][0] * 60000);
  const res = resolutionMin();
  const resTxt = res <= 15 ? 'par quart d\'heure' : res <= 60 ? 'par heure' : res <= 1440 ? 'par jour' : 'grossier';
  const f = d => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  $('#hwInfo').innerHTML = `Données du ${f(d0)} au ${f(d1)} · détail ${resTxt}` + (res > 60 ? '<br><span style="color:var(--warn)">Pour calculer la part solaire de chaque recharge, importez aussi un export par heure ou par quart d\'heure.</span>' : '<br><span style="color:var(--ok)">Part solaire calculée recharge par recharge.</span>');
  let imp = 0, exp = 0; const mois = {};
  iv.forEach(x => { imp += x.imp; exp += x.exp; const dt = new Date(x.a), k = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0'); (mois[k] = mois[k] || { imp: 0, exp: 0 }); mois[k].imp += x.imp; mois[k].exp += x.exp; });
  const gainMax = exp * (P.reseau - P.solaire);
  $('#hwStats').innerHTML = `<div class="stat" style="margin-top:12px">
    <div class="card" style="background:var(--card2)"><span class="mut">Pris au réseau</span><b>${fr(imp, 0)} kWh</b></div>
    <div class="card" style="background:var(--card2)"><span class="mut">Renvoyé au réseau</span><b style="color:var(--warn)">${fr(exp, 0)} kWh</b></div></div>
    <div class="row" style="margin-top:8px"><span style="font-size:14px">Bilan sur la période</span><b>${imp >= exp ? 'vous consommez ' + fr(imp - exp, 0) + ' kWh de plus' : 'vous produisez ' + fr(exp - imp, 0) + ' kWh de trop'}</b></div>
    <div class="row"><span style="font-size:14px">Soleil renvoyé = km possibles</span><b>≈ ${fr(exp * 1000 / P.wh, 0)} km</b></div>
    <div class="row"><span style="font-size:14px">Gain si ce soleil allait dans la Tesla</span><b style="color:var(--ok)">jusqu'à ${eur(gainMax)}</b></div>`;
  hwGraphe();
}

// ---------- Graphique interactif : mois → jours → heures ----------
const VUE = { niveau: 'mois', mois: null, jour: null, sel: null };
const pad = n => String(n).padStart(2, '0');
const cleJour = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const cleMois = d => d.getFullYear() + '-' + pad(d.getMonth() + 1);
function grouper(iv, cle) {
  const g = {}; iv.forEach(x => { const k = cle(new Date(x.a)); (g[k] = g[k] || { imp: 0, exp: 0 }); g[k].imp += x.imp; g[k].exp += x.exp; }); return g;
}
function barres(g, ks, lib, sel) {
  const max = Math.max(...ks.map(k => Math.max(g[k].imp, g[k].exp)), 0.001);
  const etroit = ks.length > 16;
  return `<div style="display:flex;align-items:flex-end;gap:${etroit ? 1 : 5}px;height:140px;touch-action:pan-y">${ks.map(k => `
    <div data-k="${k}" style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end;cursor:pointer;border-radius:6px;padding:2px 0;${k === sel ? 'background:#ffffff14' : ''}">
      <div style="display:flex;gap:1px;align-items:flex-end;height:100%;width:100%;justify-content:center;pointer-events:none">
        <div style="width:46%;background:var(--acc);border-radius:2px 2px 0 0;height:${g[k].imp / max * 100}%;opacity:${sel && k !== sel ? .45 : 1}"></div>
        <div style="width:46%;background:var(--warn);border-radius:2px 2px 0 0;height:${g[k].exp / max * 100}%;opacity:${sel && k !== sel ? .45 : 1}"></div></div>
      <span class="mut" style="font-size:${etroit ? 8 : 10}px;pointer-events:none;white-space:nowrap">${lib(k)}</span></div>`).join('')}</div>`;
}
function detail(titre, d, extra = '') {
  const net = d.imp - d.exp;
  return `<div class="card" style="background:var(--card2);margin-top:12px">
    <div style="font-weight:600;margin-bottom:6px">${titre}</div>
    <div class="row"><span>🔵 Pris au réseau (in)</span><b>${fr(d.imp, d.imp < 10 ? 2 : 1)} kWh</b></div>
    <div class="row"><span>🟠 Renvoyé au réseau (out)</span><b style="color:var(--warn)">${fr(d.exp, d.exp < 10 ? 2 : 1)} kWh</b></div>
    <div class="row"><span>Bilan</span><b>${net >= 0 ? '+' : '−'}${fr(Math.abs(net), 1)} kWh ${net >= 0 ? 'pris' : 'renvoyé'}</b></div>
    <div class="row"><span>Soleil renvoyé = km possibles</span><b>≈ ${fr(d.exp * 1000 / P.wh, 0)} km</b></div>${extra}</div>`;
}
function hwGraphe() {
  const iv = intervalles(); if (!iv.length) return;
  const res = resolutionMin();
  const fin = new Date(iv[iv.length - 1].a);
  let h = `<div style="display:flex;gap:12px;font-size:12px;margin-bottom:8px;align-items:center" class="mut">
    <span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--acc)"></i> Pris (in)</span>
    <span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--warn)"></i> Renvoyé (out)</span>
    <input type="date" id="hwDate" min="${cleJour(new Date(iv[0].a))}" max="${cleJour(fin)}" value="${VUE.jour || ''}" style="margin-left:auto;background:var(--card2);color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:5px;font:13px Inter,sans-serif;max-width:140px"></div>`;
  let nav = '';
  if (VUE.niveau === 'mois') {
    const g = grouper(iv, cleMois), ks = Object.keys(g).sort().slice(-12);
    h += barres(g, ks, k => new Date(k + '-01T12:00').toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''), VUE.sel);
    h += VUE.sel && g[VUE.sel] ? detail(new Date(VUE.sel + '-01T12:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }), g[VUE.sel], `<button class="btn sec" data-go="jours">Voir les jours de ce mois →</button>`)
      : '<div class="mut" style="font-size:13px;margin-top:8px">Touchez un mois pour voir le détail, ou choisissez une date.</div>';
  } else if (VUE.niveau === 'jours') {
    const ivm = iv.filter(x => cleMois(new Date(x.a)) === VUE.mois);
    const g = grouper(ivm, cleJour), ks = Object.keys(g).sort();
    nav = `<button class="btn sec" data-go="mois" style="margin:0 0 10px;padding:9px">← Tous les mois · ${new Date(VUE.mois + '-01T12:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</button>`;
    h += barres(g, ks, k => +k.slice(8) % (ks.length > 16 ? 5 : 1) === 0 || k.slice(8) === '01' ? String(+k.slice(8)) : '', VUE.jour);
    if (VUE.jour && g[VUE.jour]) {
      const dj = new Date(VUE.jour + 'T12:00');
      let extra = '';
      if (res <= 60) extra += '<div style="margin-top:10px" class="mut">Heure par heure</div>' + heures(iv, VUE.jour);
      extra += '<div id="hwCharges" style="margin-top:10px"></div>';
      h += detail(dj.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }), g[VUE.jour], extra);
    } else h += '<div class="mut" style="font-size:13px;margin-top:8px">Touchez un jour pour voir le détail.</div>';
  }
  $('#hwGraph').innerHTML = nav + h;
  $('#hwGraph').querySelectorAll('[data-k]').forEach(el => el.onclick = () => {
    const k = el.dataset.k;
    if (VUE.niveau === 'mois') VUE.sel = VUE.sel === k ? null : k; else VUE.jour = k;
    hwGraphe();
  });
  $('#hwGraph').querySelectorAll('[data-go]').forEach(el => el.onclick = () => {
    if (el.dataset.go === 'jours') { VUE.niveau = 'jours'; VUE.mois = VUE.sel; VUE.jour = null; }
    else { VUE.niveau = 'mois'; VUE.sel = VUE.mois; VUE.jour = null; }
    hwGraphe();
  });
  $('#hwDate').onchange = e => { const v = e.target.value; if (!v) return; VUE.niveau = 'jours'; VUE.mois = v.slice(0, 7); VUE.jour = v; VUE.sel = VUE.mois; hwGraphe(); };
  if (VUE.niveau === 'jours' && VUE.jour) chargesDuJour(VUE.jour);
}
function heures(iv, jour) {
  const g = {}; for (let i = 0; i < 24; i++) g[pad(i)] = { imp: 0, exp: 0 };
  iv.filter(x => cleJour(new Date(x.a)) === jour).forEach(x => { const k = pad(new Date(x.a).getHours()); g[k].imp += x.imp; g[k].exp += x.exp; });
  return barres(g, Object.keys(g), k => +k % 6 === 0 ? k + 'h' : '', null).replace('height:140px', 'height:90px');
}
const cacheCh = {};
async function chargesDuJour(jour) {
  const box = $('#hwCharges'); if (!box) return;
  if (!live()) { box.innerHTML = '<div class="mut" style="font-size:13px">Connectez Tessie pour voir les recharges de ce jour.</div>'; return; }
  box.innerHTML = '<div class="mut" style="font-size:13px">Recharges de la Tesla…</div>';
  try {
    if (!cacheCh[jour]) {
      const a = Math.floor(new Date(jour + 'T00:00') / 1000), b = a + 86400;
      const d = await api(`/${VIN}/charges?from=${a}&to=${b}&distance_format=km&format=json&superchargers_only=false`);
      cacheCh[jour] = fusion(d.results, HIST.charges, a, b);
    }
    const list = cacheCh[jour];
    if ($('#hwCharges') !== box) return;
    box.innerHTML = list.length ? '<div class="mut" style="margin-bottom:4px">Recharges de la Tesla ce jour-là</div>' + list.map(c => {
      const deb = new Date(c.started_at * 1000), fin = c.ended_at ? new Date(c.ended_at * 1000) : null;
      const kwh = c.energy_used ?? c.energy_added ?? 0, dom = estDomicile(c);
      const res = dom ? partReseau(deb.getTime(), fin && fin.getTime(), kwh) : null;
      const hh = d => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const info = !dom ? 'hors domicile' : res != null ? `☀️ ${Math.round((kwh - res) / Math.max(kwh, 0.01) * 100)} % solaire (mesuré)` : (deb.getHours() >= 9 && deb.getHours() < 16 ? '☀️ journée (estimé)' : '🌙 soir/nuit (estimé)');
      return `<div class="row"><div><div>${hh(deb)}${fin ? ' → ' + hh(fin) : ''}</div><div class="mut">${info}</div></div><b>${fr(kwh, 1)} kWh</b></div>`;
    }).join('') : '<div class="mut" style="font-size:13px">Pas de recharge de la Tesla ce jour-là.</div>';
  } catch (e) { box.innerHTML = '<div class="mut" style="font-size:13px">Recharges indisponibles : ' + msgErreur(e) + '</div>'; }
}
$('#hwFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const n = lireCSV(await f.text()); fusionner(n); hwAfficher(); gains(); toast(n.length + ' lignes importées'); }
  catch (er) { toast('Import impossible : ' + er.message); }
  e.target.value = '';
};
$('#hwSuppr').onclick = e => {
  if (e.currentTarget.dataset.ok !== '1') { e.currentTarget.dataset.ok = '1'; e.currentTarget.textContent = 'Touchez encore pour confirmer'; setTimeout(() => { $('#hwSuppr').dataset.ok = ''; $('#hwSuppr').textContent = 'Effacer les données du compteur'; }, 3000); return; }
  HW = []; store.set('hw', []); hwAfficher(); gains(); toast('Données du compteur effacées');
};


// ---------- Historique importé (TeslaFi compilé, sans GPS) ----------
let HIST = store.get('hist', { drives: [], charges: [], idles: [], sources: [] });
const aHist = () => HIST.drives.length + HIST.charges.length + HIST.idles.length > 0;
function dansPeriode(l, a, b) { return l.filter(x => x.started_at >= a && x.started_at < b); }
// ajoute les éléments importés qui ne chevauchent aucun élément Tessie
function fusion(tessie, hist, a, b) {
  const t = tessie || [], h = dansPeriode(hist || [], a, b);
  const libre = x => !t.some(y => x.started_at < (y.ended_at || y.started_at) + 300 && (x.ended_at || x.started_at) > y.started_at - 300);
  return t.concat(h.filter(libre)).sort((x, y) => x.started_at - y.started_at);
}
function histAfficher() {
  const box = $('#histInfo'); if (!box) return;
  if (!aHist()) { box.innerHTML = 'Aucun historique importé.'; $('#histSuppr').style.display = 'none'; return; }
  const all = [...HIST.drives, ...HIST.charges, ...HIST.idles].map(x => x.started_at);
  const f = t => new Date(t * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  box.innerHTML = `<b style="color:var(--txt)">${esc((HIST.sources || []).join(', ') || 'Historique')}</b> · du ${f(Math.min(...all))} au ${f(Math.max(...all))}<br>${HIST.drives.length} trajets · ${HIST.charges.length} recharges · ${HIST.idles.length} périodes à l'arrêt<br><span style="font-size:12px">Fusionné avec Tessie : quand les deux ont la même recharge ou le même trajet, celui de Tessie est gardé.</span>`;
  $('#histSuppr').style.display = '';
}
function rafraichirTout() { TR = null; for (const k in cacheCh) delete cacheCh[k]; histAfficher(); gains(); temperature(); pertes(); }
$('#histFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const o = JSON.parse(await f.text());
    if (!o || !Array.isArray(o.drives) || !Array.isArray(o.charges)) throw new Error('fichier non reconnu');
    const mix = (a, b) => { const m = new Map(a.map(x => [x.started_at, x])); (b || []).forEach(x => m.set(x.started_at, x)); return [...m.values()].sort((x, y) => x.started_at - y.started_at); };
    HIST = { drives: mix(HIST.drives, o.drives), charges: mix(HIST.charges, o.charges), idles: mix(HIST.idles, o.idles), sources: [...new Set([...(HIST.sources || []), o.source || 'Import'])] };
    store.set('hist', HIST); rafraichirTout(); toast('Historique importé : ' + o.drives.length + ' trajets, ' + o.charges.length + ' recharges');
  } catch (er) { toast('Import impossible : ' + er.message); }
  e.target.value = '';
};
$('#histSuppr').onclick = e => {
  if (e.currentTarget.dataset.ok !== '1') { e.currentTarget.dataset.ok = '1'; e.currentTarget.textContent = 'Touchez encore pour confirmer'; setTimeout(() => { $('#histSuppr').dataset.ok = ''; $('#histSuppr').textContent = 'Effacer l\'historique importé'; }, 3000); return; }
  HIST = { drives: [], charges: [], idles: [], sources: [] }; store.set('hist', HIST); rafraichirTout(); toast('Historique importé effacé');
};

// ---------- Gains et rentabilité ----------
const P_DEF = { essence: 1.905, conso: 7, solaire: 0.20, reseau: 0.43, wh: 175, achat: '', surcout: 0, entretien: 300, kwc: 5, incl: 35, maison: 0.4, prise: 2.8, batt: 57.5, superc: 0.52 };
const P = Object.assign({}, P_DEF, store.get('prix', {}));
const PL = [
  ['essence', 'Prix de l\'essence (€/L)', 0.001], ['conso', 'Conso. voiture essence (L/100 km)', 0.1],
  ['solaire', 'kWh solaire (€)', 0.01], ['reseau', 'kWh réseau, tout compris (€)', 0.01],
  ['wh', 'Conso. Tesla si inconnue (Wh/km)', 1], ['achat', 'Date d\'achat de la Tesla', 'date'],
  ['surcout', 'Surcoût à l\'achat vs essence (€)', 1], ['entretien', 'Entretien économisé par an (€)', 1],
  ['kwc', 'Puissance des panneaux (kWc)', 0.1], ['incl', 'Inclinaison du toit (°)', 1],
  ['maison', 'Conso. de la maison en journée (kW)', 0.1], ['prise', 'Puissance de charge sur la prise (kW)', 0.1], ['batt', 'Capacité utile de la batterie (kWh)', 0.5], ['superc', 'Prix Superchargeur si inconnu (€/kWh)', 0.01]];
function paramsUI() {
  $('#gParams').innerHTML = PL.map(([k, l, st]) => `<div class="row"><span style="font-size:14px">${l}</span><input data-p="${k}" type="${st === 'date' ? 'date' : 'number'}" ${st !== 'date' ? 'step="' + st + '" inputmode="decimal"' : ''} value="${P[k]}" style="width:${st === 'date' ? 140 : 90}px;text-align:right;background:var(--card2);color:var(--txt);border:1px solid var(--line);border-radius:10px;padding:8px;font:15px Inter,sans-serif"></div>`).join('');
  $('#gParams').onchange = e => { const k = e.target.dataset.p; if (!k) return; P[k] = e.target.type === 'date' ? e.target.value : +String(e.target.value).replace(',', '.'); store.set('prix', P); gains(); if (typeof hwAfficher === 'function') hwAfficher(); if (['kwc', 'incl'].includes(k)) store.set('meteo', null); prevision(); };
}
const eur = n => fr(n, n >= 1000 ? 0 : 2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €';
function bornes() {
  const now = new Date(), to = Math.floor(now / 1000);
  const v = $('#periode').value;
  if (v === 'mois') return [Math.floor(new Date(now.getFullYear(), now.getMonth(), 1) / 1000), to];
  if (v === '12m') return [to - 365 * 86400, to];
  const d = P.achat ? Math.floor(new Date(P.achat) / 1000) : to - 3 * 365 * 86400;
  return [d, to];
}
function estDomicile(c) {
  if (c.is_supercharger || /supercharg/i.test(c.location || '')) return false;
  if (c.is_fast_charger) return false;
  const ici = L.find(l => l[3] != null && c.latitude != null && distance(c.latitude, c.longitude, l[3], l[4]) < 250);
  if (ici) return /domicile|maison/i.test(ici[1]);
  if (/home|domicile|maison|thuis/i.test((c.saved_location || '') + ' ' + (c.location || ''))) return true;
  // Sinon : une charge lente (simple prise, 3,7 kW au plus) est considérée comme faite à la maison
  const h = ((c.ended_at || 0) - (c.started_at || 0)) / 3600;
  const kwh = c.energy_used ?? c.energy_added ?? 0;
  return h > 0 && kwh / h <= 3.7;
}
function analyser(charges, drives) {
  let solKwh = 0, resKwh = 0, autreKwh = 0, autreEur = 0, km = 0, mesure = 0;
  charges.forEach(c => {
    const kwh = c.energy_used ?? c.energy_added ?? 0;
    if (estDomicile(c)) {
      const deb = (c.started_at || 0) * 1000, fin = (c.ended_at || 0) * 1000;
      const res = partReseau(deb, fin, kwh);
      if (res != null) { resKwh += res; solKwh += kwh - res; mesure++; }
      else { const h = new Date(deb).getHours(); if (h >= 9 && h < 16) solKwh += kwh; else resKwh += kwh; }
    } else { autreKwh += kwh; autreEur += c.cost > 0 ? c.cost : (c.energy_added ?? kwh) * P.superc; }
  });
  drives.forEach(d => { km += d.odometer_distance ?? d.distance ?? 0; });
  const tous = charges.concat(drives); const t0 = tous.length ? Math.min(...tous.map(x => x.started_at)) : null, t1 = tous.length ? Math.max(...tous.map(x => x.ended_at || x.started_at)) : null;
  const elec = solKwh * P.solaire + resKwh * P.reseau + autreEur;
  const kwhTot = solKwh + resKwh + autreKwh;
  if (!km && kwhTot) km = kwhTot * 1000 / P.wh;
  const ess = km * P.conso / 100 * P.essence;
  return { solKwh, resKwh, autreKwh, autreEur, km, elec, ess, kwhTot, mesure, t0, t1 };
}
function demoDonnees() {
  const r = { solKwh: 96, resKwh: 58, autreKwh: 52, autreEur: 33.68, km: 1180 };
  r.kwhTot = r.solKwh + r.resKwh + r.autreKwh;
  r.elec = r.solKwh * P.solaire + r.resKwh * P.reseau + r.autreEur;
  r.ess = r.km * P.conso / 100 * P.essence; return r;
}
let gEnCours = false;
async function gains() {
  if (gEnCours) return; gEnCours = true;
  let r;
  try {
    const [a, b] = bornes();
    if (live()) {
      $('#gTotal').textContent = '…';
      const [c, d] = await Promise.all([
        api(`/${VIN}/charges?from=${a}&to=${b}&distance_format=km&format=json&superchargers_only=false`),
        api(`/${VIN}/drives?from=${a}&to=${b}&distance_format=km&format=json`)]);
      r = analyser(fusion(c.results, HIST.charges, a, b), fusion(d.results, HIST.drives, a, b));
    } else if (aHist()) r = analyser(dansPeriode(HIST.charges, a, b), dansPeriode(HIST.drives, a, b));
    else r = demoDonnees();
  } catch (e) { $('#gTotal').textContent = '—'; $('#gKm').textContent = 'Données indisponibles : ' + msgErreur(e); gEnCours = false; return; }
  gEnCours = false;
  const gain = r.ess - r.elec;
  $('#gTotal').textContent = eur(gain);
  $('#gKm').textContent = fr(r.km, 0) + ' km parcourus' + (live() || aHist() ? '' : ' (exemple)');
  $('#gElec').textContent = eur(r.elec); $('#gEss').textContent = eur(r.ess);
  $('#g100').textContent = r.km ? fr(r.elec / r.km * 100, 2) + ' €' : '—';
  $('#gSol').textContent = r.kwhTot ? Math.round(r.solKwh / r.kwhTot * 100) + ' %' + (r.mesure ? ' ✓' : '') : '—';
  const lig = (t, k, e, col) => `<div class="row"><div><div>${t}</div><div class="mut">${fr(k, 0)} kWh</div></div><b style="color:${col}">${eur(e)}</b></div>`;
  $('#gRep').innerHTML = lig('☀️ Soleil (domicile, journée)', r.solKwh, r.solKwh * P.solaire, 'var(--ok)')
    + lig('🌙 Réseau (domicile, soir/nuit)', r.resKwh, r.resKwh * P.reseau, 'var(--warn)')
    + lig('⚡ Superchargeurs et bornes', r.autreKwh, r.autreEur, 'var(--txt)');
  // rentabilité
  const [a, b] = bornes(); const jours = !r.t0 ? Math.max(1, (b - a) / 86400) : Math.max(1, (Math.min(b, r.t1) - Math.max(a, r.t0)) / 86400);
  const parAn = gain / jours * 365 + (+P.entretien || 0);
  let rent = `<div class="row"><span>Économie estimée par an</span><b style="color:var(--ok)">${eur(parAn)}</b></div>`;
  if (+P.surcout > 0 && parAn > 0) {
    const ans = P.surcout / parAn;
    const debut = P.achat ? new Date(P.achat) : null;
    const fin = debut ? new Date(debut.getTime() + ans * 365 * 86400000) : null;
    rent += `<div class="row"><span>Surcoût remboursé en</span><b>${fr(ans, 1)} ans</b></div>`;
    if (fin) rent += `<div class="row"><span>Rentable à partir de</span><b>${fin.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</b></div>`;
  } else rent += '<div class="mut" style="padding-top:8px">Indiquez le surcoût à l\'achat dans « Mes prix » pour voir quand la Tesla sera rentable.</div>';
  $('#gRent').innerHTML = rent;
  // conseil
  const gainPossible = r.resKwh * (P.reseau - P.solaire);
  $('#gConseil').innerHTML = r.resKwh > 0
    ? `En chargeant au soleil ce que vous avez chargé le soir sur cette période, vous auriez économisé <b>${eur(gainPossible)}</b> de plus. Branchez la voiture en journée dès que vous êtes à la maison et que le soleil brille.`
    : 'Bravo : toutes vos recharges à domicile se font déjà au soleil.';
}

// ---------- Prévision solaire (Open-Meteo, panneaux plein sud) ----------
let SOL = null, solJour = 0, solHeure = null;
function posMaison() {
  const m = L.find(l => l[3] != null && /domicile|maison/i.test(l[1]));
  if (m) return [m[3], m[4]];
  if (S.lat != null) return [S.lat, S.lon];
  return [50.41, 4.44]; // Hainaut (Charleroi) par défaut
}
async function prevision() {
  try {
    const [la, lo] = posMaison();
    let c = store.get('meteo', null);
    if (!c || Date.now() - c.t > 30 * 60000 || Math.abs(c.la - la) > 0.05) {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${la.toFixed(3)}&longitude=${lo.toFixed(3)}&hourly=global_tilted_irradiance,cloud_cover,temperature_2m&tilt=${P.incl}&azimuth=0&timezone=Europe%2FBrussels&forecast_days=3`;
      const r = await fetch(u); if (!r.ok) throw new Error('météo indisponible');
      const d = await r.json(); c = { t: Date.now(), la, h: d.hourly }; store.set('meteo', c);
    }
    SOL = calculerSoleil(c.h); solAfficher();
  } catch (e) { $('#solResume').innerHTML = '<div class="mut">Prévision indisponible : ' + msgErreur(e) + '</div>'; }
}
function calculerSoleil(h) {
  const jours = {};
  h.time.forEach((t, i) => {
    // valeur moyenne sur l'heure précédente : 12:00 = de 11 h à 12 h
    const fin = new Date(t), deb = new Date(fin.getTime() - 3600000), k = cleJour(deb);
    const prod = Math.max(0, (h.global_tilted_irradiance[i] || 0) / 1000 * P.kwc * 0.8);
    const surplus = Math.max(0, prod - P.maison);
    const bon = surplus >= P.prise * 0.6;
    const voiture = bon ? Math.min(surplus, P.prise) : 0;
    (jours[k] = jours[k] || []).push({ h: deb.getHours(), prod, surplus, bon, voiture, nuage: h.cloud_cover[i], temp: h.temperature_2m[i] });
  });
  const auj = cleJour(new Date());
  return Object.keys(jours).sort().filter(k => k >= auj && jours[k].length >= 20).slice(0, 3).map(k => {
    const hs = jours[k];
    let best = null, cur = null;
    hs.forEach(x => { if (x.bon) { if (!cur) cur = { a: x.h, b: x.h + 1, kwh: 0 }; cur.b = x.h + 1; cur.kwh += x.voiture; if (!best || cur.kwh > best.kwh) best = { ...cur }; } else cur = null; });
    const s = f => hs.reduce((a, x) => a + x[f], 0);
    return { k, hs, prod: s('prod'), surplus: s('surplus'), voiture: s('voiture'), best };
  });
}
function nomJour(i, k) { return i === 0 && k === cleJour(new Date()) ? 'Aujourd\'hui' : i <= 1 && k === cleJour(new Date(Date.now() + 86400000)) ? 'Demain' : new Date(k + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long' }); }
function solAfficher() {
  if (!SOL || !SOL.length) return;
  const J = SOL[Math.min(solJour, SOL.length - 1)];
  $('#solJours').innerHTML = SOL.map((d, i) => `<button data-j="${i}" class="pill" style="border:0;padding:7px 12px;font:13px Inter,sans-serif;cursor:pointer;${i === solJour ? 'background:var(--acc);color:#fff' : ''}">${nomJour(i, d.k)}</button>`).join('');
  $('#solJours').querySelectorAll('[data-j]').forEach(b => b.onclick = () => { solJour = +b.dataset.j; solHeure = null; solAfficher(); });
  const km = J.voiture * 1000 / P.wh, gain = J.voiture * (P.reseau - P.solaire);
  const conseil = J.best ? `Branchez la Tesla de <b>${J.best.a} h à ${J.best.b} h</b>` : J.surplus > 1 ? 'Un peu de soleil, mais pas assez pour charger sur la prise sans prendre au réseau' : 'Pas assez de soleil pour charger : préférez une autre journée';
  $('#solResume').innerHTML = `<div style="font-size:16px;line-height:1.4">${conseil}</div>
    <div class="stat" style="margin-top:10px">
      <div class="card" style="background:var(--card2)"><span class="mut">Production prévue</span><b>${fr(J.prod, 1)} kWh</b></div>
      <div class="card" style="background:var(--card2)"><span class="mut">Soleil pour la Tesla</span><b style="color:var(--ok)">${fr(J.voiture, 1)} kWh</b></div>
      <div class="card" style="background:var(--card2)"><span class="mut">Soit environ</span><b>${fr(km, 0)} km</b></div>
      <div class="card" style="background:var(--card2)"><span class="mut">Gain vs charge le soir</span><b style="color:var(--ok)">${eur(gain)}</b></div></div>`;
  const hs = J.hs.filter(x => x.h >= 6 && x.h <= 20);
  const max = Math.max(...hs.map(x => x.prod), P.prise + P.maison, 0.5);
  const lig = (P.maison + P.prise * 0.6) / max * 100;
  $('#solGraph').innerHTML = `<div style="position:relative;height:120px;display:flex;align-items:flex-end;gap:3px">
    <div style="position:absolute;left:0;right:0;bottom:${16 + lig}px;border-top:1px dashed var(--mut);opacity:.6;pointer-events:none"></div>
    ${hs.map(x => `<div data-h="${x.h}" style="flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:3px;cursor:pointer;border-radius:5px;${solHeure === x.h ? 'background:#ffffff14' : ''}">
      <div style="width:80%;border-radius:3px 3px 0 0;pointer-events:none;height:${x.prod / max * 100}px;min-height:1px;background:${x.bon ? 'var(--ok)' : x.prod > P.maison ? '#c9a227' : '#3a3f47'}"></div>
      <span class="mut" style="font-size:9px;height:13px;pointer-events:none">${x.h % 3 === 0 ? x.h + 'h' : ''}</span></div>`).join('')}</div>
    <div class="mut" style="font-size:11px;margin-top:6px;display:flex;gap:10px;flex-wrap:wrap"><span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:var(--ok)"></i> idéal pour charger</span><span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#c9a227"></i> surplus faible</span><span>- - - seuil prise + maison</span></div>`;
  $('#solGraph').querySelectorAll('[data-h]').forEach(el => el.onclick = () => {
    solHeure = +el.dataset.h; const x = J.hs.find(y => y.h === solHeure); solAfficher();
    $('#solDetail').innerHTML = `<b style="color:var(--txt)">${x.h} h – ${x.h + 1} h</b> · production ${fr(x.prod, 2)} kWh · surplus ${fr(x.surplus, 2)} kWh · nuages ${Math.round(x.nuage)} % · ${Math.round(x.temp)} °C<br>${x.bon ? '✅ Bonne heure pour charger sur la prise' : x.surplus > 0 ? '⚠️ Surplus trop faible : la prise prendrait aussi du réseau' : '❌ Pas de surplus'}`;
  });
  if (solHeure == null) $('#solDetail').textContent = 'Touchez une heure pour le détail. Estimation pour des panneaux plein sud de ' + fr(P.kwc, 1) + ' kWc (modifiable dans « Mes prix »).';
  // carte de l'accueil : aujourd'hui si la fenêtre n'est pas passée, sinon demain
  const now = new Date().getHours();
  const A = SOL[0] && SOL[0].best && SOL[0].best.b > now ? [SOL[0], 'Aujourd\'hui'] : SOL[1] ? [SOL[1], 'Demain'] : null;
  const box = $('#solAccueil');
  if (A) {
    box.style.display = '';
    box.innerHTML = A[0].best ? `<div style="display:flex;gap:12px;align-items:center"><span style="font-size:30px">☀️</span><div><div style="font-weight:600">${A[1]} : branchez de ${A[0].best.a} h à ${A[0].best.b} h</div><div class="mut">≈ ${fr(A[0].voiture, 1)} kWh de soleil · ${fr(A[0].voiture * 1000 / P.wh, 0)} km · ${eur(A[0].voiture * (P.reseau - P.solaire))} gagnés</div></div></div>`
      : `<div style="display:flex;gap:12px;align-items:center"><span style="font-size:30px">☁️</span><div><div style="font-weight:600">${A[1]} : peu de soleil</div><div class="mut">Pas de bon moment pour charger au soleil</div></div></div>`;
  }
}
prevision();
setInterval(prevision, 30 * 60000);

// ---------- Consommation selon la température ----------
let TR = null, tSel = null;
async function tempsHoraires() {
  // températures heure par heure des 92 derniers jours à la maison (secours si Tessie ne donne pas la température)
  let c = store.get('tempsPasse', null);
  if (c && Date.now() - c.t < 6 * 3600000) return c.m;
  const [la, lo] = posMaison();
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la.toFixed(3)}&longitude=${lo.toFixed(3)}&hourly=temperature_2m&past_days=92&forecast_days=1&timezone=Europe%2FBrussels`);
  const d = await r.json(); const m = {};
  d.hourly.time.forEach((t, i) => { m[t.slice(0, 13)] = d.hourly.temperature_2m[i]; });
  store.set('tempsPasse', { t: Date.now(), m }); return m;
}
function trajetsDemo() {
  const r = [];
  for (let i = 0; i < 70; i++) {
    const temp = -3 + Math.random() * 30, km = 5 + Math.random() * 60;
    const wh = 150 + Math.max(0, 15 - temp) * 4.2 + (km < 12 ? 35 : 0) + (Math.random() - .5) * 30;
    r.push({ date: new Date(Date.now() - i * 2.5 * 86400000), km, wh, temp, de: 'Exemple', a: 'Exemple' });
  }
  return r;
}
async function chargerTrajets() {
  const to = Math.floor(Date.now() / 1000), from = to - 365 * 86400;
  if (!live() && !aHist()) { TR = trajetsDemo(); return; }
  const d = live() ? await api(`/${VIN}/drives?from=${from}&to=${to}&distance_format=km&temperature_format=c&format=json`) : { results: [] };
  d.results = fusion(d.results, HIST.drives, from, to);
  let temps = null;
  try { temps = await tempsHoraires(); } catch (e) {}
  TR = (d.results || []).map(x => {
    const km = x.odometer_distance ?? x.distance ?? 0;
    let kwh = x.energy_used ?? null;
    if (kwh == null && x.starting_battery != null && x.ending_battery != null) kwh = (x.starting_battery - x.ending_battery) / 100 * P.batt;
    const date = new Date((x.started_at || 0) * 1000);
    let temp = x.average_outside_temperature ?? x.outside_temperature ?? null;
    if (temp == null && temps) { const k = cleJour(date) + 'T' + pad(date.getHours()); temp = temps[k] ?? null; }
    return { date, km, wh: km > 0 && kwh != null ? kwh * 1000 / km : null, temp, de: x.starting_saved_location || x.starting_location || '', a: x.ending_saved_location || x.ending_location || '' };
  }).filter(x => x.km >= 3 && x.wh != null && x.wh > 60 && x.wh < 450 && x.temp != null);
}
function moyenne(arr) { const km = arr.reduce((a, x) => a + x.km, 0); return km ? arr.reduce((a, x) => a + x.wh * x.km, 0) / km : null; }
async function temperature() {
  try { if (!TR) await chargerTrajets(); }
  catch (e) { $('#tResume').textContent = 'Trajets indisponibles : ' + msgErreur(e); return; }
  if (!TR.length) { $('#tResume').textContent = 'Pas encore assez de trajets avec température.'; return; }
  const froid = TR.filter(x => x.temp < 8), doux = TR.filter(x => x.temp >= 15);
  const mf = moyenne(froid), md = moyenne(doux), mt = moyenne(TR);
  const prix100 = w => w / 1000 * 100 * P.reseau;
  let res = `<div class="stat">
    <div class="card" style="background:var(--card2)"><span class="mut">Par froid (&lt; 8 °C)</span><b style="color:#6fb6ff">${mf ? Math.round(mf) + ' Wh/km' : '—'}</b></div>
    <div class="card" style="background:var(--card2)"><span class="mut">Par temps doux (≥ 15 °C)</span><b style="color:var(--ok)">${md ? Math.round(md) + ' Wh/km' : '—'}</b></div></div>`;
  if (mf && md) res += `<div style="margin-top:10px;font-size:15px;line-height:1.45;color:var(--txt)">Le froid augmente votre consommation de <b>${Math.round((mf / md - 1) * 100)} %</b>. Sur le réseau, 100 km coûtent environ <b>${eur(prix100(mf))}</b> en hiver contre <b>${eur(prix100(md))}</b> par temps doux.</div>`;
  res += `<div class="mut" style="font-size:13px;margin-top:6px">Moyenne sur ${TR.length} trajets : ${Math.round(mt)} Wh/km${live() || aHist() ? '' : ' (exemple)'}.</div>`;
  $('#tResume').innerHTML = res;
  // nuage de points : température (x) / consommation (y)
  const W = 340, H = 210, g = { l: 34, r: 8, t: 20, b: 26 };
  const tmin = Math.floor(Math.min(...TR.map(x => x.temp), 0) / 5) * 5, tmax = Math.ceil(Math.max(...TR.map(x => x.temp), 25) / 5) * 5;
  const wmin = 100, wmax = Math.max(300, Math.ceil(Math.max(...TR.map(x => x.wh)) / 50) * 50);
  const X = v => g.l + (v - tmin) / (tmax - tmin) * (W - g.l - g.r), Y = v => H - g.b - (v - wmin) / (wmax - wmin) * (H - g.t - g.b);
  const col = t => t < 5 ? '#6fb6ff' : t < 12 ? '#9cc3ff' : t < 20 ? '#2ecc71' : '#ff9f43';
  // moyenne par tranche de 5 °C
  const tr = []; for (let a = tmin; a < tmax; a += 5) { const m = moyenne(TR.filter(x => x.temp >= a && x.temp < a + 5)); if (m) tr.push([a + 2.5, m]); }
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;touch-action:manipulation">`;
  for (let w = wmin; w <= wmax; w += 50) svg += `<line x1="${g.l}" x2="${W - g.r}" y1="${Y(w)}" y2="${Y(w)}" stroke="#2a2e35"/><text x="${g.l - 4}" y="${Y(w) + 3}" text-anchor="end" font-size="9" fill="#8b929c">${w}</text>`;
  for (let t = tmin; t <= tmax; t += 5) svg += `<text x="${X(t)}" y="${H - 10}" text-anchor="middle" font-size="9" fill="#8b929c">${t}°</text>`;
  svg += `<text x="${W - g.r}" y="${H - 1}" text-anchor="end" font-size="9" fill="#8b929c">température extérieure</text><text x="2" y="9" font-size="9" fill="#8b929c">Wh/km</text>`;
  TR.forEach((x, i) => { svg += `<circle data-t="${i}" cx="${X(x.temp).toFixed(1)}" cy="${Y(Math.min(x.wh, wmax)).toFixed(1)}" r="${Math.min(9, 2.5 + Math.sqrt(x.km) / 1.6).toFixed(1)}" fill="${col(x.temp)}" fill-opacity="${tSel === i ? 1 : .55}" stroke="${tSel === i ? '#fff' : 'none'}" stroke-width="2" style="cursor:pointer"/>`; });
  if (tr.length > 1) svg += `<polyline points="${tr.map(p => X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' ')}" fill="none" stroke="#fff" stroke-width="2.5" stroke-linejoin="round" opacity=".9"/>` + tr.map(p => `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="3" fill="#fff"/>`).join('');
  svg += '</svg>';
  $('#tGraph').innerHTML = svg + '<div class="mut" style="font-size:11px;margin-top:4px">Chaque point = un trajet (plus il est gros, plus le trajet est long). La ligne blanche = moyenne par tranche de 5 °C.</div>';
  $('#tGraph').querySelectorAll('[data-t]').forEach(c => c.onclick = () => { tSel = +c.dataset.t; temperature(); });
  if (tSel != null && TR[tSel]) {
    const x = TR[tSel];
    $('#tDetail').innerHTML = `<b style="color:var(--txt)">${x.date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} à ${x.date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</b> · ${fr(x.km, 0)} km · <b style="color:var(--txt)">${Math.round(x.wh)} Wh/km</b> · ${fr(x.temp, 0)} °C · coût ≈ ${eur(x.km * x.wh / 1000 * P.reseau)} (réseau)${x.de || x.a ? '<br>' + esc(x.de || '?') + ' → ' + esc(x.a || '?') : ''}${x.km < 12 ? '<br>💡 Les petits trajets consomment plus : le chauffage de l\'habitacle pèse lourd.' : ''}`;
  } else $('#tDetail').textContent = 'Touchez un point pour voir le trajet.';
}

// ---------- Pertes à l'arrêt (veille, Sentinelle, climatisation) ----------
let pSel = null;
function idlesDemo(a, b) {
  const r = [];
  for (let t = a; t < b; t += 86400) {
    const sent = Math.random() < .5 ? .3 + Math.random() * .6 : 0, clim = Math.random() < .15 ? .2 : 0;
    r.push({ started_at: t + 3600 * 19, ended_at: t + 3600 * 31, energy_used: .25 + sent * 2.6 + clim * 3 + Math.random() * .3, sentry_fraction: sent, climate_fraction: clim });
  }
  return r;
}
async function pertes() {
  const [a, b] = bornes();
  let list;
  try { list = live() ? fusion((await api(`/${VIN}/idles?from=${a}&to=${b}&format=json`)).results, HIST.idles, a, b) : aHist() ? dansPeriode(HIST.idles, a, b) : idlesDemo(a, b); }
  catch (e) { $('#pResume').textContent = 'Données indisponibles : ' + msgErreur(e); return; }
  let tot = 0, sen = 0, cli = 0, h = 0;
  const parJour = {};
  list.forEach(x => {
    let e = x.energy_used ?? ((x.starting_battery - x.ending_battery) / 100 * P.batt); e = Number.isFinite(e) ? Math.max(0, e) : 0;
    const fs = Math.min(1, x.sentry_fraction || 0), fc = Math.min(1 - fs, x.climate_fraction || 0);
    // part de l'énergie : on répartit en supposant ~2,5 kW·h/jour de Sentinelle contre ~0,3 en veille
    const ps = fs ? Math.min(e, e * fs * 8 / (fs * 8 + fc * 10 + (1 - fs - fc))) : 0;
    const pc = fc ? Math.min(e - ps, e * fc * 10 / (fs * 8 + fc * 10 + (1 - fs - fc))) : 0;
    tot += e; sen += ps; cli += pc; h += ((x.ended_at || 0) - (x.started_at || 0)) / 3600;
    const k = cleJour(new Date((x.started_at || 0) * 1000));
    (parJour[k] = parJour[k] || { e: 0, s: 0, c: 0, h: 0 }); parJour[k].e += e; parJour[k].s += ps; parJour[k].c += pc; parJour[k].h += ((x.ended_at || 0) - (x.started_at || 0)) / 3600;
  });
  const debL = list.length ? Math.max(a, Math.min(...list.map(x => x.started_at))) : a, finL = list.length ? Math.min(b, Math.max(...list.map(x => x.ended_at || x.started_at))) : b;
  const veille = Math.max(0, tot - sen - cli), jours = Math.max(1, (finL - debL) / 86400);
  const prix = P.reseau, an = tot / jours * 365;
  if (!list.length) { $('#pResume').textContent = 'Aucune période à l\'arrêt enregistrée sur cette période.'; $('#pGraph').innerHTML = ''; return; }
  const ligne = (ic, t, k, c) => `<div class="row"><span>${ic} ${t}</span><span><b style="color:${c}">${fr(k, 1)} kWh</b> <span class="mut">· ${eur(k * prix)}</span></span></div>`;
  let html = `<div class="stat">
    <div class="card" style="background:var(--card2)"><span class="mut">Perdu garée</span><b>${fr(tot, 1)} kWh</b></div>
    <div class="card" style="background:var(--card2)"><span class="mut">Soit</span><b>${eur(tot * prix)}</b></div>
    <div class="card" style="background:var(--card2)"><span class="mut">Par jour</span><b>${fr(tot / jours, 2)} kWh</b></div>
    <div class="card" style="background:var(--card2)"><span class="mut">Sur un an</span><b>≈ ${eur(an * prix)}</b></div></div>
    <div style="margin-top:8px">${ligne('🛡️', 'Sentinelle', sen, '#ff5b5b')}${ligne('❄️', 'Climatisation à l\'arrêt', cli, '#6fb6ff')}${ligne('💤', 'Veille normale', veille, 'var(--mut)')}</div>`;
  const pct = tot ? sen / tot : 0;
  html += `<div style="margin-top:10px;font-size:14px;line-height:1.45;color:var(--txt)">${pct > .35 ? `💡 La Sentinelle représente <b>${Math.round(pct * 100)} %</b> des pertes. La couper à la maison ferait gagner environ <b>${eur(sen / jours * 365 * prix * .6)}</b> par an. L'option « Sauf à la maison » des Réglages le fait déjà quand l'application est ouverte.` : tot / jours > 1 ? '💡 Les pertes sont élevées : vérifiez qu\'aucune application ne réveille la voiture trop souvent (par exemple TeslaFi et Tessie en même temps).' : '👍 Vos pertes à l\'arrêt sont faibles.'}</div>`;
  html += `<div class="mut" style="font-size:12px;margin-top:6px">Prix compté : ${fr(prix, 2)} €/kWh (réseau). ${live() || aHist() ? '' : 'Données d\'exemple.'} Le partage entre Sentinelle, climatisation et veille est estimé.</div>`;
  $('#pResume').innerHTML = html;
  // graphique empilé par jour (ou par semaine si la période est longue)
  let ks = Object.keys(parJour).sort(), G = parJour, lib = k => +k.slice(8) % 5 === 0 || k.slice(8) === '01' ? String(+k.slice(8)) : '';
  if (ks.length > 45) {
    G = {}; ks.forEach(k => { const d = new Date(k + 'T12:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const w = cleJour(d); (G[w] = G[w] || { e: 0, s: 0, c: 0, h: 0 }); ['e', 's', 'c', 'h'].forEach(f => G[w][f] += parJour[k][f]); });
    ks = Object.keys(G).sort(); lib = k => +k.slice(8) <= 7 ? new Date(k + 'T12:00').toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '') : '';
  }
  const max = Math.max(...ks.map(k => G[k].e), .1);
  $('#pGraph').innerHTML = `<div style="display:flex;align-items:flex-end;gap:${ks.length > 20 ? 1 : 4}px;height:120px">${ks.map(k => {
    const x = G[k], z = v => (v / max * 100).toFixed(1) + 'px';
    return `<div data-p="${k}" style="flex:1;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:3px;cursor:pointer;border-radius:4px;${pSel === k ? 'background:#ffffff14' : ''}">
      <div style="width:80%;display:flex;flex-direction:column;pointer-events:none"><div style="height:${z(x.s)};background:#ff5b5b;border-radius:2px 2px 0 0"></div><div style="height:${z(x.c)};background:#6fb6ff"></div><div style="height:${z(Math.max(0, x.e - x.s - x.c))};background:#5c636e"></div></div>
      <span class="mut" style="font-size:9px;height:12px;white-space:nowrap;pointer-events:none">${lib(k)}</span></div>`; }).join('')}</div>
    <div class="mut" style="font-size:11px;margin-top:6px;display:flex;gap:10px"><span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#ff5b5b"></i> Sentinelle</span><span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#6fb6ff"></i> Climatisation</span><span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#5c636e"></i> Veille</span></div>`;
  $('#pGraph').querySelectorAll('[data-p]').forEach(el => el.onclick = () => { pSel = el.dataset.p; pertes(); });
  if (pSel && G[pSel]) {
    const x = G[pSel], d = new Date(pSel + 'T12:00');
    $('#pDetail').innerHTML = `<b style="color:var(--txt)">${ks.length && G !== parJour ? 'Semaine du ' : ''}${d.toLocaleDateString('fr-FR', { weekday: G === parJour ? 'long' : undefined, day: 'numeric', month: 'long' })}</b> · ${fr(x.h, 0)} h garée · ${fr(x.e, 2)} kWh perdus (${eur(x.e * prix)}) · Sentinelle ${fr(x.s, 2)} kWh · climatisation ${fr(x.c, 2)} kWh`;
  } else $('#pDetail').textContent = 'Touchez une barre pour le détail.';
}

$('#periode').onchange = () => { gains(); pertes(); };
histAfficher();
hwAfficher();

// ---------- Démo : historique fictif ----------
function histoDemo() {
  const H = [['Domicile', '11 nov.', '38', '6,84'], ['Superchargeur Lyon', '8 nov.', '52', '21,32'], ['Domicile', '5 nov.', '41', '7,38'], ['Travail', '3 nov.', '30', '0,00'], ['Superchargeur Mâcon', '1 nov.', '25', '12,36']];
  $('#hist').innerHTML = H.map(h => `<div class="row"><div><div>${h[0]}</div><div class="mut">${h[1]} · ${h[2]} kWh</div></div><b>${h[3]} €</b></div>`).join('');
}

// ---------- Navigation ----------
function go() {
  const v = (location.hash || '#accueil').slice(1);
  const ok = ['accueil', 'charge', 'gains', 'carte', 'reglages'].includes(v) ? v : 'accueil';
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('act', s.id === 'v-' + ok));
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('act', a.dataset.v === ok));
  window.scrollTo(0, 0);
}
addEventListener('hashchange', () => { go(); if (location.hash === '#gains') { gains(); temperature(); pertes(); } });

function toutAfficher() { tuiles(); etat(); clim(); lim(); batterie(); carte(); }
function toutCharger() { charger(); chargerMeteo(); chargerHistorique(); }

toutAfficher(); lieux(); connexionUI(); paramsUI(); go(); if (location.hash === '#gains') { gains(); temperature(); pertes(); }
if (live()) toutCharger(); else histoDemo();
setInterval(() => { if (live() && !document.hidden) charger(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && live()) charger(); });

$('#maj').onclick = () => { location.replace(location.pathname + '?maj=' + Date.now() + (location.hash || '')); };
