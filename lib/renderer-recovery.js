// A janela se recupera sem encerrar o motor. loadURL é assíncrono: a recusa
// precisa ser observada, senão a recuperação produz uma rejeição não tratada.
function quedaInesperada(details, encerrando) {
  return !encerrando && details?.reason !== 'clean-exit';
}

async function recarregarJanela(janela, url, aoFalhar) {
  if (!janela || janela.isDestroyed()) return false;
  try {
    await janela.loadURL(url);
    return true;
  } catch (err) {
    aoFalhar(`não foi possível recarregar a janela após a queda: ${err.message}`);
    return false;
  }
}

export { quedaInesperada, recarregarJanela };
