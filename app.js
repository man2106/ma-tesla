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
const fr = (n, d = 1) => Number(n).toFixed(d).replace('.', ',');

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
    $('#wxD').innerHTML = (traduire(cond) || 'Météo actuelle') + (lo != null && hi != null ? `<br>Min ${Math.round(lo)}° · Max ${Math.round(hi)}°` : '') + (w.location ? `<br>${w.location}` : '');
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
      const prix = h.cost ?? 0;
      if (t >= debutMois) { e += kwh; cost += prix; }
      const lieu = h.location || h.saved_location || (h.is_supercharger ? 'Superchargeur' : 'Recharge');
      return `<div class="row"><div><div>${lieu}</div><div class="mut">${t.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} · ${fr(kwh, 0)} kWh</div></div><b>${fr(prix, 2)} €</b></div>`;
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
  $('#lieux').innerHTML = L.length ? L.map((l, i) => `<div class="row"><span>${l[0]} <span contenteditable="true" data-n="${i}" style="outline:none;border-bottom:1px dashed var(--line)">${l[1]}</span></span><span style="display:flex;gap:8px;align-items:center"><select data-l="${i}">${[50, 60, 70, 80, 90, 100].map(v => `<option ${v === l[2] ? 'selected' : ''}>${v}</option>`).join('')}</select><span data-x="${i}" style="color:var(--mut);cursor:pointer;padding:4px">✕</span></span></div>`).join('')
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
  const sentAuto = store.get('sentAuto', true), sentMaison = store.get('sentMaison', true);
  const maison = ici && /domicile|maison/i.test(ici[1]);
  if (sentAuto && garee && !S.sentinelle && !(sentMaison && maison) && dejaFait.sent !== 'on') {
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
[['#swSentAuto', 'sentAuto'], ['#swSentMaison', 'sentMaison']].forEach(([id, k]) => {
  $(id).classList.toggle('on', store.get(k, true));
  $(id).onclick = e => { const v = !store.get(k, true); store.set(k, v); e.currentTarget.classList.toggle('on', v); };
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
    sel.innerHTML = '<option value="">Choisissez la voiture</option>' + list.map(v => `<option value="${v.vin}">${v.nom}</option>`).join('');
    sel.onchange = () => sel.value && choisir(sel.value);
    $('#cxEtat').textContent = 'Choisissez votre voiture';
  } catch (e) { TOKEN = ''; $('#cxEtat').textContent = 'Échec de la connexion : ' + msgErreur(e); }
};
function choisir(vin) {
  VIN = vin; store.set('vin', vin); $('#vins').style.display = 'none'; $('#tok').value = '';
  if (!store.get('lieux', null)) L.length = 0;
  sauverLieux(); lieux(); connexionUI(); toast('Voiture connectée'); toutCharger();
}
$('#dx').onclick = () => { TOKEN = ''; VIN = ''; store.set('token', ''); store.set('vin', ''); connexionUI(); toast('Déconnectée'); };


// ---------- Gains et rentabilité ----------
const P_DEF = { essence: 1.905, conso: 7, solaire: 0.20, reseau: 0.43, wh: 175, achat: '', surcout: 0, entretien: 300 };
const P = Object.assign({}, P_DEF, store.get('prix', {}));
const PL = [
  ['essence', 'Prix de l\'essence (€/L)', 0.001], ['conso', 'Conso. voiture essence (L/100 km)', 0.1],
  ['solaire', 'kWh solaire (€)', 0.01], ['reseau', 'kWh réseau, tout compris (€)', 0.01],
  ['wh', 'Conso. Tesla si inconnue (Wh/km)', 1], ['achat', 'Date d\'achat de la Tesla', 'date'],
  ['surcout', 'Surcoût à l\'achat vs essence (€)', 1], ['entretien', 'Entretien économisé par an (€)', 1]];
function paramsUI() {
  $('#gParams').innerHTML = PL.map(([k, l, st]) => `<div class="row"><span style="font-size:14px">${l}</span><input data-p="${k}" type="${st === 'date' ? 'date' : 'number'}" ${st !== 'date' ? 'step="' + st + '" inputmode="decimal"' : ''} value="${P[k]}" style="width:${st === 'date' ? 140 : 90}px;text-align:right;background:var(--card2);color:var(--txt);border:1px solid var(--line);border-radius:10px;padding:8px;font:15px Inter,sans-serif"></div>`).join('');
  $('#gParams').onchange = e => { const k = e.target.dataset.p; if (!k) return; P[k] = e.target.type === 'date' ? e.target.value : +String(e.target.value).replace(',', '.'); store.set('prix', P); gains(); };
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
  return /home|domicile|maison/i.test((c.saved_location || '') + ' ' + (c.location || ''));
}
function analyser(charges, drives) {
  let solKwh = 0, resKwh = 0, autreKwh = 0, autreEur = 0, km = 0;
  charges.forEach(c => {
    const kwh = c.energy_used ?? c.energy_added ?? 0;
    if (estDomicile(c)) {
      const h = new Date((c.started_at || 0) * 1000).getHours();
      if (h >= 9 && h < 16) solKwh += kwh; else resKwh += kwh;
    } else { autreKwh += kwh; autreEur += c.cost ?? 0; }
  });
  drives.forEach(d => { km += d.odometer_distance ?? d.distance ?? 0; });
  const elec = solKwh * P.solaire + resKwh * P.reseau + autreEur;
  const kwhTot = solKwh + resKwh + autreKwh;
  if (!km && kwhTot) km = kwhTot * 1000 / P.wh;
  const ess = km * P.conso / 100 * P.essence;
  return { solKwh, resKwh, autreKwh, autreEur, km, elec, ess, kwhTot };
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
    if (live()) {
      $('#gTotal').textContent = '…';
      const [a, b] = bornes();
      const [c, d] = await Promise.all([
        api(`/${VIN}/charges?from=${a}&to=${b}&distance_format=km&format=json&superchargers_only=false`),
        api(`/${VIN}/drives?from=${a}&to=${b}&distance_format=km&format=json`)]);
      r = analyser(c.results || [], d.results || []);
    } else r = demoDonnees();
  } catch (e) { $('#gTotal').textContent = '—'; $('#gKm').textContent = 'Données indisponibles : ' + msgErreur(e); gEnCours = false; return; }
  gEnCours = false;
  const gain = r.ess - r.elec;
  $('#gTotal').textContent = eur(gain);
  $('#gKm').textContent = fr(r.km, 0) + ' km parcourus' + (live() ? '' : ' (exemple)');
  $('#gElec').textContent = eur(r.elec); $('#gEss').textContent = eur(r.ess);
  $('#g100').textContent = r.km ? fr(r.elec / r.km * 100, 2) + ' €' : '—';
  $('#gSol').textContent = r.kwhTot ? Math.round(r.solKwh / r.kwhTot * 100) + ' %' : '—';
  const lig = (t, k, e, col) => `<div class="row"><div><div>${t}</div><div class="mut">${fr(k, 0)} kWh</div></div><b style="color:${col}">${eur(e)}</b></div>`;
  $('#gRep').innerHTML = lig('☀️ Soleil (domicile, journée)', r.solKwh, r.solKwh * P.solaire, 'var(--ok)')
    + lig('🌙 Réseau (domicile, soir/nuit)', r.resKwh, r.resKwh * P.reseau, 'var(--warn)')
    + lig('⚡ Superchargeurs et bornes', r.autreKwh, r.autreEur, 'var(--txt)');
  // rentabilité
  const [a, b] = bornes(); const jours = Math.max(1, (b - a) / 86400);
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
$('#periode').onchange = gains;

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
addEventListener('hashchange', () => { go(); if (location.hash === '#gains') gains(); });

function toutAfficher() { tuiles(); etat(); clim(); lim(); batterie(); carte(); }
function toutCharger() { charger(); chargerMeteo(); chargerHistorique(); }

toutAfficher(); lieux(); connexionUI(); paramsUI(); go(); if (location.hash === '#gains') gains();
if (live()) toutCharger(); else histoDemo();
setInterval(() => { if (live() && !document.hidden) charger(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && live()) charger(); });
