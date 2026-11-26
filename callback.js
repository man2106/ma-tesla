// Page de retour après la connexion au compte Tesla.
// Cette connexion n'est pas branchée dans l'application : on n'enregistre rien (aucun code dans le stockage du téléphone).
(function () {
  var p = new URLSearchParams(location.search);
  var code = p.get('code'), err = p.get('error');
  var el = function (id) { return document.getElementById(id); };
  // on ne laisse jamais le code dans l'adresse ni dans l'historique du navigateur
  if (code || err) history.replaceState(null, '', location.pathname);
  el('ic').textContent = '⚠️';
  el('t').textContent = 'Connexion non terminée';
  el('m').textContent = err === 'access_denied' ? 'Vous avez refusé l\'accès sur la page Tesla. Rien n\'a été enregistré.'
    : 'La connexion directe au compte Tesla n\'est pas active dans Ma Tesla : rien n\'a été enregistré. Utilisez le code d\'accès Tessie dans les Réglages.';
})();
