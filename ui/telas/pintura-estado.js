import { telaVisivel, editandoFormulario, textoSelecionado } from './pintura.js';

// Dependências dos campos de topo do SSE. Uma aba suja continua lendo o estado mais novo ao entrar.
function gruposDaPintura(pintar) {
  const radar = () => telaVisivel('radar');
  const mim = () => telaVisivel('radar', 'mim') && !editandoFormulario() && !textoSelecionado('#rpane-mim');
  const sistema = () => telaVisivel('sistema') && !editandoFormulario() && !textoSelecionado('#tab-sistema');
  const grupo = (id, campos, visivel = () => true) => ({ id, campos, visivel, pintar: pintar[id] });
  return [
    grupo('plataforma', ['app']),
    grupo('contas', ['accounts', 'account', 'config', 'queue', 'decisions', 'panorama', 'activeSessions']),
    grupo('status', ['app', 'status', 'error', 'account', 'activeSessions', 'buscasPausadas']),
    grupo('sessoes', ['activeSessions', 'activity', 'headlessWaiting', 'headlessWaitingContas', 'panorama', 'accounts'], mim),
    grupo('decisoes', ['decisions', 'accounts', 'config', 'reRounds', 'pushbacks', 'chats', 'activeSessions', 'headlessWaiting', 'headlessWaitingContas'], mim),
    grupo('fila', ['queue', 'panorama', 'activeSessions', 'decisions', 'headlessWaiting', 'headlessDistributing', 'headlessWaitingDetails', 'accounts', 'config', 'parked', 'sync', 'usage', 'status', 'lastCheckAt'], mim),
    grupo('meus', ['myPRs', 'selfAnalyses', 'activeSessions', 'headlessWaiting', 'hiddenPRs', 'mergeStates', 'baseDosMeusPRs', 'config', 'accounts', 'chats', 'lastCheckAt', 'status', 'sync'], () => telaVisivel('radar', 'meus') && !editandoFormulario() && !textoSelecionado('#rpane-meus')),
    grupo('panorama', ['panorama', 'activeSessions', 'decisions', 'reviewActions', 'reviewStatesGh', 'staleStates', 'accounts', 'config', 'lastCheckAt', 'status', 'sync', 'chats'], () => telaVisivel('radar', 'pano') && !editandoFormulario() && !textoSelecionado('#rpane-pano')),
    grupo('silenciadas', ['accounts', 'panorama', 'config'], radar),
    grupo('navegacao', ['queue', 'panorama', 'myPRs', 'hiddenPRs', 'decisions', 'activeSessions', 'headlessWaiting', 'headlessDistributing', 'accounts', 'sync'], radar),
    grupo('operacoes', ['activeSessions', 'headlessWaiting', 'selfAnalyses', 'myPRs']),
    grupo('configuracoes', ['app', 'paths', 'config', 'accounts', 'account', 'contasGh', 'doctor', 'sync', 'jiraSites', 'cadeiaPerfis', 'provedores', 'modelos', 'update', 'capacidades', 'credits', 'myPRs', 'panorama'], sistema),
    grupo('ferramentas', ['toolRuns', 'config'], () => telaVisivel('sistema') || telaVisivel('destaques')),
    grupo('atualizacao', ['update', 'config'], () => telaVisivel('sistema')),
    grupo('relogio', ['lastCheckAt', 'nextCheckAt', 'status', 'activeSessions', 'activity']),
    grupo('consumo', ['usage', 'config', 'sync', 'filaJusta', 'accounts', 'activeSessions'], () => telaVisivel('consumo')),
    grupo('compartilhado', ['sync', 'config', 'accounts'], radar),
    grupo('aparelhos', ['sync', 'config', 'accounts'], radar),
  ];
}
export { gruposDaPintura };
