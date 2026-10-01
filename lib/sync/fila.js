// A fila do aparelho, na linha do Panorama (controle do celular, 28/09/2026). Pura: sem
// estado, sem IO, sem engine. Quem lê o engine e monta os fatos é lib/engine/sync-fila.js.
//
// O QUE VIAJA É UM VOCABULÁRIO FECHADO: `estado` numa lista de onze, `motivo` numa lista
// por estado e dois instantes. Nada de relatório, motivo livre ou texto do modelo: a linha
// cifrada tem teto de 2048 no banco, e texto livre é justamente o que vaza e o que estoura.
//
// SÓ PARA O PR PEDIDO A MIM (`mine`): o Panorama mostra PRs de toda a organização, e o
// estado da fila só existe para o que o aparelho tem obrigação de revisar.
//
// A ORDEM DAS PERGUNTAS É A REGRA. Um PR pode estar em dois lugares ao mesmo tempo (visto
// e estacionado, na fila e em retry), e o que a tela precisa é o fato mais forte: primeiro
// o que está acontecendo agora (sessão viva), depois o que espera alguém (pendência), depois
// o que parou, e por último o que ainda vai acontecer sozinho.

const ESTADOS = Object.freeze([
  'esperando', 'sem-automatica', 'revisando', 'decidir', 'estacionado', 'retry',
  'saiu-de-cena', 'limite-plano', 'espera-grupo', 'visto', 'ignorado',
]);

// motivo por estado; estado fora desta tabela não leva motivo nenhum
//
// `decidir` + `espera-ci` (01/10/2026): a pendência é aprovável e o aparelho dono aprova
// sozinho quando o CI obrigatório fechar verde (lib/engine/espera-ci.js), então não precisa
// de ninguém. É MOTIVO e não estado novo por causa de quem lê em versão anterior: a allowlist
// de cada leitor é a dele, e na 2.66.3 um estado fora da lista devolve `null` (a linha perde
// a fila e o PR some da tela do admin), enquanto um motivo fora da lista vira vazio e o item
// continua aparecendo como `decidir`, que é exatamente o que ele mostrava antes.
const ESPERA_CI = 'espera-ci';
const MOTIVOS = Object.freeze({
  decidir: Object.freeze([ESPERA_CI]),
  'sem-automatica': Object.freeze(['conta', 'silenciada']),
  // os tipos do estacionamento (lib/engine/review.js, estacionar e parkedParaUi)
  estacionado: Object.freeze(['cancelado', 'esgotado', 'falha', 'orcamento', 'autenticacao', 'legado']),
});

// `ate` só existe onde a tabela da spec diz que existe
const COM_ATE = Object.freeze(['limite-plano']);

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function instante(v) {
  const n = Math.floor(Number(v) || 0);
  return n > 0 ? n : 0;
}

// Allowlist da fila: o que não é do vocabulário vira `null` (o estado) ou vazio (o motivo).
// Serve aos dois lados: quem publica e quem lê passam pela mesma porta.
function filaSaneada(bruto) {
  if (!objeto(bruto) || !ESTADOS.includes(bruto.estado)) return null;
  const permitidos = MOTIVOS[bruto.estado] || [];
  const motivo = permitidos.includes(bruto.motivo) ? bruto.motivo : '';
  const ate = COM_ATE.includes(bruto.estado) ? instante(bruto.ate) : 0;
  return { estado: bruto.estado, motivo, desde: instante(bruto.desde), ate };
}

function tem(colecao, chave) {
  if (colecao instanceof Set || colecao instanceof Map) return colecao.has(chave);
  return objeto(colecao) && Object.hasOwn(colecao, chave);
}

function valor(colecao, chave) {
  if (colecao instanceof Map) return colecao.get(chave);
  return objeto(colecao) ? colecao[chave] : undefined;
}

// O estado da fila de UM PR, a partir dos fatos já lidos do engine:
//   emCurso      Set   chaves com sessão viva ou na fila de execução
//   pendentes    Map   chave -> instante da pendência (revisão pronta, esperando decisão)
//   esperandoCi  Set   pendências que esperam o CI e aprovam sozinhas (não pedem ninguém)
//   ignorados    Set   marcado para não voltar
//   estacionados Map   chave -> { tipo, desde }
//   retry        Set   esperando nova tentativa depois de falha transitória
//   foraDeCena   Map   chave -> instante em que outra pessoa pegou o PR
//   vistos       Set   já revisado ou marcado visto
//   conta        obj   { silenciada, automatica, limiteAte, grupoSegura } da conta dona
function estadoDaFila(key, fatos) {
  const f = objeto(fatos) ? fatos : {};
  const conta = objeto(f.conta) ? f.conta : {};
  const k = String(key || '');
  if (tem(f.emCurso, k)) return filaSaneada({ estado: 'revisando' });
  if (tem(f.pendentes, k)) {
    const motivo = tem(f.esperandoCi, k) ? ESPERA_CI : '';
    return filaSaneada({ estado: 'decidir', motivo, desde: valor(f.pendentes, k) });
  }
  if (tem(f.ignorados, k)) return filaSaneada({ estado: 'ignorado' });
  if (tem(f.estacionados, k)) {
    const e = objeto(valor(f.estacionados, k)) ? valor(f.estacionados, k) : {};
    return filaSaneada({ estado: 'estacionado', motivo: e.tipo || 'legado', desde: e.desde });
  }
  if (tem(f.retry, k)) return filaSaneada({ estado: 'retry' });
  if (tem(f.foraDeCena, k)) return filaSaneada({ estado: 'saiu-de-cena', desde: valor(f.foraDeCena, k) });
  if (tem(f.vistos, k)) return filaSaneada({ estado: 'visto' });
  // daqui em diante o PR está na fila, e a pergunta é se a automática vai pegá-lo
  if (conta.silenciada === true) return filaSaneada({ estado: 'sem-automatica', motivo: 'silenciada' });
  if (conta.automatica === false) return filaSaneada({ estado: 'sem-automatica', motivo: 'conta' });
  if (instante(conta.limiteAte) > 0) return filaSaneada({ estado: 'limite-plano', ate: conta.limiteAte });
  if (conta.grupoSegura === true) return filaSaneada({ estado: 'espera-grupo' });
  return filaSaneada({ estado: 'esperando' });
}

export default { ESTADOS, MOTIVOS, ESPERA_CI, filaSaneada, estadoDaFila };
export { ESTADOS, MOTIVOS, ESPERA_CI, filaSaneada, estadoDaFila };
