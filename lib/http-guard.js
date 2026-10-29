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
const BINDS_LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];
const PORTA_MAXIMA = 65535;

function portaValida(porta) {
  return Number.isInteger(porta) && porta >= 1 && porta <= PORTA_MAXIMA;
}

// O bind (config.bind, já saneado) está no loopback? Ausente ou vazio conta como loopback:
// é o padrão, e bind que ninguém configurou nunca pode ligar a exigência de autenticação.
function loopback(bind) {
  if (bind === undefined || bind === null || bind === '') return true;
  return BINDS_LOOPBACK.includes(bind);
}

// Os dois nomes com a porta, comparados por igualdade exata: sem curinga, sem sufixo e
// sem variação de caixa. É o que o Electron (main.js carrega http://127.0.0.1:<porta>),
// o navegador do próprio aparelho e o curl das sessões mandam. Com o bind fora do
// loopback (implantação web), ou no [::1] (o socket só escuta ali), o nome dele entra também;
// os dois nomes locais continuam valendo.
function hostsPermitidos(porta, bind) {
  const nomes = bind && !HOSTS_LOCAIS.includes(bind) ? [...HOSTS_LOCAIS, bind] : HOSTS_LOCAIS;
  return nomes.map(nome => `${nome}:${porta}`);
}

// O proxy com TLS fica na 443, então a origem https do bind vem sem porta.
function origensPermitidas(permitidos, bind) {
  const origens = permitidos.map(h => `http://${h}`);
  if (!loopback(bind)) origens.push(`https://${bind}`);
  return origens;
}

function validarHostEOrigem({ host, origin, porta, bind } = {}) {
  if (!portaValida(porta)) return { ok: false, motivo: 'host' };
  const permitidos = hostsPermitidos(porta, bind);
  if (typeof host !== 'string' || !permitidos.includes(host)) return { ok: false, motivo: 'host' };
  // Origin AUSENTE é aceito: navegação direta, GET da própria página e curl local não
  // mandam. Presente e vazio não é ausente: o cabeçalho veio, e veio fora da lista.
  if (origin === undefined) return { ok: true };
  if (typeof origin !== 'string' || !origensPermitidas(permitidos, bind).includes(origin)) return { ok: false, motivo: 'origin' };
  return { ok: true };
}

export default { validarHostEOrigem, loopback };
export { validarHostEOrigem, loopback };
