// A política de revisão e de aprovação mora SÓ na conta (30/09/2026). PURO: sem estado,
// sem IO, sem rede.
//
// Pedido do dono: "Preciso que não exista mais sobreposição de configurações". Até aqui a
// mesma decisão tinha dois endereços: as chaves gerais `autoReview` e `autoApproveAll`
// (Sistema > Automação) eram o padrão, cada conta podia ter valor próprio, e ainda havia
// uma regra implícita (conta cujo limpo espera você não seguia a chave das ressalvas).
// Para saber o que uma conta fazia era preciso ler duas telas e lembrar da regra.
//
// Este módulo é o ÚNICO lugar que conhece as chaves gerais antigas. Ele escreve em cada
// conta, por extenso, o que ela já fazia (`autoReview`, `onClean`, `onCaveats`,
// `onReject`) e descarta as chaves gerais. Roda na carga da config e depois de toda
// gravação de contas, então conta nova também nasce com os quatro campos escritos.
//
// IDEMPOTENTE: config já migrada sai idêntica, e `mudou` volta falso.
//
// AS CHAVES ANTIGAS SÃO ENTRADA DA MIGRAÇÃO, e só isso. Enquanto não existe conta nenhuma
// (config sem `accounts` e sem `ghUser`, o caso do `{"port": 47180, "autoReview": false}`
// das instâncias de teste), elas ficam onde estão, esperando: quando a conta é detectada,
// a migração roda de novo e a conta nasce com o que o arquivo pedia. Descartar antes
// faria a instância de teste revisar sozinha na conta real de quem a abriu.
//
// O MODO SIMPLES VIRA CONTA. Config sem `accounts` valia pela conta única `ghUser` +
// `owners`, que não tinha onde guardar política (e que a tela de Contas nunca conseguiu
// editar). A migração escreve essa conta na lista, com o mesmo login e as mesmas orgs.
//
// A ÚNICA DIFERENÇA DE COMPORTAMENTO, e ela só restringe: conta com "sem ressalvas"
// esperando você E "com ressalvas" aprovando por escolha própria. Antes ela aprovava
// sozinha o PR com ressalvas e segurava o limpo; agora o com ressalvas nunca é mais
// permissivo que o limpo, sem exceção, e ela passa a esperar você nos dois.
const CHAVES_GERAIS_ANTIGAS = Object.freeze(['autoReview', 'autoApproveAll']);
const CAMPOS_DA_POLITICA = Object.freeze(['autoReview', 'onClean', 'onCaveats', 'onReject']);
const PADRAO = Object.freeze({ autoReview: true, onClean: 'approve', onCaveats: 'wait', onReject: 'wait' });

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function texto(v) {
  return String(v === null || v === undefined ? '' : v).trim();
}

// O que as chaves gerais valiam, lido como o engine lia: a config em memória era
// `{ ...padrões, ...arquivo }` com `autoReview: true` e `autoApproveAll: false` nos
// padrões, e as duas leituras eram `!== false`. Chave ausente do arquivo cai no padrão.
function geralAntigo(config) {
  const c = objeto(config) ? config : {};
  return {
    autoReview: c.autoReview !== false,
    aprovaComRessalva: Object.hasOwn(c, 'autoApproveAll') && c.autoApproveAll !== false,
  };
}

// Os quatro campos por extenso. Valor da conta vale; ausente recebe o que ela herdava.
function politicaExplicita(conta, geral) {
  const a = objeto(conta) ? conta : {};
  const g = geral || { autoReview: PADRAO.autoReview, aprovaComRessalva: false };
  const onClean = a.onClean === 'wait' ? 'wait' : 'approve';
  let onCaveats = g.aprovaComRessalva ? 'approve' : 'wait';
  if (a.onCaveats === 'approve' || a.onCaveats === 'wait') onCaveats = a.onCaveats;
  // o com ressalvas nunca é mais permissivo que o limpo
  if (onClean === 'wait') onCaveats = 'wait';
  const escolheuRevisao = a.autoReview === true || a.autoReview === false;
  const autoReview = escolheuRevisao ? a.autoReview : g.autoReview;
  const onReject = a.onReject === 'request_changes' ? 'request_changes' : 'wait';
  return { autoReview, onClean, onCaveats, onReject };
}

function contasDaConfig(c) {
  const lista = (Array.isArray(c.accounts) ? c.accounts : []).filter((a) => objeto(a) && texto(a.user));
  if (lista.length || !texto(c.ghUser)) return lista;
  // modo simples: a conta única legada entra na lista com a mesma identidade
  const owners = (Array.isArray(c.owners) ? c.owners : []).map(texto).filter(Boolean);
  return [{ user: texto(c.ghUser), owners }];
}

function valorOuNulo(v) {
  return v === undefined ? null : v;
}

function diferencasDaConta(antes, depois) {
  return CAMPOS_DA_POLITICA
    .filter((campo) => antes[campo] !== depois[campo])
    .map((campo) => ({ conta: depois.user, campo, de: valorOuNulo(antes[campo]), para: depois[campo] }));
}

// Devolve as contas com a política por extenso, as chaves gerais a descartar e o que mudou
// (para o rastro em state/politica-historico.json). Não toca na config recebida.
function migrarPolitica(config) {
  const c = objeto(config) ? config : {};
  const base = contasDaConfig(c);
  const jaEraLista = Array.isArray(c.accounts) && c.accounts.length === base.length;
  if (!base.length) return { mudou: false, contas: Array.isArray(c.accounts) ? c.accounts : [], descartar: [], mudancas: [] };
  const geral = geralAntigo(c);
  const contas = base.map((a) => ({ ...a, ...politicaExplicita(a, geral) }));
  const descartar = CHAVES_GERAIS_ANTIGAS.filter((k) => Object.hasOwn(c, k));
  const mudancas = [
    ...descartar.map((campo) => ({ conta: null, campo, de: valorOuNulo(c[campo]), para: null })),
    ...contas.flatMap((depois, i) => diferencasDaConta(base[i], depois)),
  ];
  return { mudou: mudancas.length > 0 || !jaEraLista, contas, descartar, mudancas };
}

export default { CHAVES_GERAIS_ANTIGAS, CAMPOS_DA_POLITICA, PADRAO, politicaExplicita, migrarPolitica };
export { CHAVES_GERAIS_ANTIGAS, CAMPOS_DA_POLITICA, PADRAO, politicaExplicita, migrarPolitica };
