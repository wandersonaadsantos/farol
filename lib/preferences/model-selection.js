// A importação seletiva não pode modificar o modelo do provedor não selecionado.
import { sincronizarModelos } from '../model-selection.js';
import { modelosCompativeis } from '../modelos.js';

const CAMPOS = ['reviewModel', 'codexReviewModel'];
const SELECIONE_AMBOS = 'Esta escolha sincroniza o modelo do outro provedor. Selecione as duas diferenças de modelo, ou ajuste o arquivo para um par equivalente.';

function modelSelectionPatch(config, patch, incoming = {}) {
  const selecionados = CAMPOS.filter(key => Object.hasOwn(patch, key));
  if (!selecionados.length) return { patch };
  const candidato = { ...config, ...patch };
  sincronizarModelos(candidato, patch);
  if (selecionados.length === 2) {
    if (selecionados.some(key => candidato[key] !== patch[key])) return { error: 'Os modelos selecionados no arquivo não formam um par equivalente.' };
    return { patch };
  }
  const outro = CAMPOS.find(key => !Object.hasOwn(patch, key));
  if (candidato[outro] === config[outro]) return { patch };
  const preservando = { ...patch, [outro]: incoming[outro] };
  if (Object.hasOwn(incoming, outro) && incoming[outro] === config[outro] && modelosCompativeis(preservando.reviewModel, preservando.codexReviewModel)) return { patch: preservando };
  return { error: SELECIONE_AMBOS };
}

export { modelSelectionPatch, SELECIONE_AMBOS };
