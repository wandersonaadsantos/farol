// Allowlist de Host e Origin da API local (C1a da operação multidispositivo).
// Função PURA: nenhum IO, nenhum estado, nenhuma leitura de config. Quem chama passa
// a porta EFETIVA do servidor (server.address().port), nunca a da config: com a
// config em 0 (porta efêmera, usada pelos testes) as duas divergem, e a regra tem que
// valer para a porta em que o socket de fato escuta.
//
// Host permitido não é autenticação: qualquer processo local fala com 127.0.0.1. O que
// isto fecha é o DNS rebinding (o navegador manda o Host do domínio do atacante) e a
// página de outra origem (o navegador manda o Origin dela). Autenticação é a A4.

const HOSTS_LOCAIS = ['127.0.0.1', 'localhost'];
const PORTA_MAXIMA = 65535;

function portaValida(porta) {
  return Number.isInteger(porta) && porta >= 1 && porta <= PORTA_MAXIMA;
}

// Os dois nomes com a porta, comparados por igualdade exata: sem curinga, sem sufixo e
// sem variação de caixa. É o que o Electron (main.js carrega http://127.0.0.1:<porta>),
// o navegador do próprio aparelho e o curl das sessões mandam.
function hostsPermitidos(porta) {
  return HOSTS_LOCAIS.map(nome => `${nome}:${porta}`);
}

function validarHostEOrigem({ host, origin, porta } = {}) {
  if (!portaValida(porta)) return { ok: false, motivo: 'host' };
  const permitidos = hostsPermitidos(porta);
  if (typeof host !== 'string' || !permitidos.includes(host)) return { ok: false, motivo: 'host' };
  // Origin AUSENTE é aceito: navegação direta, GET da própria página e curl local não
  // mandam. Presente e vazio não é ausente: o cabeçalho veio, e veio fora da lista.
  if (origin === undefined) return { ok: true };
  const origensPermitidas = permitidos.map(h => `http://${h}`);
  if (typeof origin !== 'string' || !origensPermitidas.includes(origin)) return { ok: false, motivo: 'origin' };
  return { ok: true };
}

export default { validarHostEOrigem };
export { validarHostEOrigem };
