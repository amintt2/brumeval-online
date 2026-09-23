// French wording of electron-updater errors (pure, unit-tested).
'use strict';

/** Human French message for an updater error (the raw one goes to the log). */
function friendlyError(err) {
  const msg = String(err?.message || err || '');
  if (/code signature|not signed|ShipIt|SQRLCodeSignatureErrorDomain/i.test(msg)) {
    return 'Mise à jour automatique impossible sur cette version macOS non signée : téléchargez la nouvelle version sur GitHub.';
  }
  if (/ERR_UPDATER_NO_PUBLISHED_VERSIONS|No published versions|ERR_UPDATER_LATEST_VERSION_NOT_FOUND|ERR_UPDATER_CHANNEL_FILE_NOT_FOUND|404/i.test(msg)) {
    return 'Aucune mise à jour publiée pour le moment.';
  }
  if (/net::|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket|network/i.test(msg)) {
    return 'Vérification des mises à jour impossible (pas de connexion).';
  }
  if (/sha512|checksum/i.test(msg)) return 'Le fichier de mise à jour est corrompu, nouvel essai plus tard.';
  return 'La vérification des mises à jour a échoué.';
}

module.exports = { friendlyError };
