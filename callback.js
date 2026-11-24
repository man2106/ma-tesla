// Page de retour après la connexion au compte Tesla.
// Le code reçu n'est gardé (sur ce téléphone uniquement) que si la demande vient bien de l'application :
// le « state » renvoyé par Tesla doit être celui que Ma Tesla a enregistré avant d'ouvrir la page Tesla.
(function () {
  var p = new URLSearchParams(location.search);
  var code = p.get('code'), err = p.get('error'), state = p.get('state');
  var el = function (id) { return document.getElementById(id); };
  var attendu = null;
  try { attendu = JSON.parse(localStorage.getItem('mt_tesla_state')); } catch (e) {}
  // on ne laisse jamais le code dans l'adresse ni dans l'historique du navigateur
  if (code) history.replaceState(null, '', location.pathname);
  if (code && state && attendu && state === attendu) {
    try {
      localStorage.setItem('mt_tesla_code', JSON.stringify({ code: code, state: state, t: Date.now() }));
      localStorage.removeItem('mt_tesla_state');
    } catch (e) {}
    el('ic').textContent = '✅';
    el('t').textContent = 'Compte Tesla autorisé';
    el('m').textContent = 'Retour à l\'application…';
    setTimeout(function () { location.replace('./#reglages'); }, 1200);
  } else {
    el('ic').textContent = '⚠️';
    el('t').textContent = 'Connexion non terminée';
    el('m').textContent = err === 'access_denied' ? 'Vous avez refusé l\'accès sur la page Tesla.'
      : code ? 'Cette demande ne vient pas de Ma Tesla : rien n\'a été enregistré. Relancez la connexion depuis les Réglages.'
      : 'Aucun code reçu de Tesla. Réessayez depuis les Réglages de Ma Tesla.';
  }
})();
