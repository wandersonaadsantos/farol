// Quem exige autenticação na API local (A4, spec 7.A4). PURO: os sinais chegam por
// parâmetro, lidos em lib/paths.js (sinaisDoModoCelular). O modo é propriedade do
// processo que serve a API, então nada que o cliente escreve entra aqui.
const PREFIXO_TERMUX = '/data/data/com.termux';

function prefixoDoTermux(prefix) {
  const p = String(prefix || '');
  return p === PREFIXO_TERMUX || p.startsWith(PREFIXO_TERMUX + '/');
}

// Um sinal basta (spec 7.A4, item 1).
function detectarModoCelular({ platform = '', env = {}, osrelease = '' } = {}) {
  if (platform === 'android') return true;
  const e = env || {};
  if (String(e.TERMUX_VERSION || '').trim()) return true;
  if (prefixoDoTermux(e.PREFIX)) return true;
  return /android/i.test(String(osrelease || ''));
}

// localAuth 'exigir' liga em qualquer ambiente. No modo celular a exigência depende SÓ da
// ativação automática: não existe ramo que leia a config para devolver false ali, e é
// isso que impede uma config de desligar a proteção do celular.
function exigeAutenticacao({ modoCelular = false, config = {}, ativacaoAutomatica = false } = {}) {
  if (config && config.localAuth === 'exigir') return true;
  return modoCelular === true && ativacaoAutomatica === true;
}

// A visão compartilhada (C3) só liga no celular quando a autenticação exigida está valendo.
// Sem porteiro, qualquer página servida em outra porta do mesmo aparelho leria pela API o
// conteúdo que outros aparelhos compartilharam. No desktop nada muda.
function compartilhamentoPermitido({ modoCelular = false, config = {}, ativacaoAutomatica = false } = {}) {
  if (modoCelular !== true) return true;
  return exigeAutenticacao({ modoCelular, config, ativacaoAutomatica });
}

export default { detectarModoCelular, exigeAutenticacao, compartilhamentoPermitido };
export { detectarModoCelular, exigeAutenticacao, compartilhamentoPermitido };
