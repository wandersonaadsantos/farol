// Regras de início da revisão por organização e autor, dentro da conta revisora.
// Ausência de regra preserva a política já existente, inclusive a retomada por clique.
const MODOS = ['auto', 'manual'];
const objeto = v => !!v && typeof v === 'object' && !Array.isArray(v);
const nome = v => String(v || '').trim().replace(/^@/, '').toLowerCase();
const identificador = v => /^[a-z0-9][a-z0-9-]*(?:\[bot\])?$/.test(v) && v.length <= 100;

function normalizarRegras(valor) {
  if (!objeto(valor)) return {};
  const regras = new Map();
  for (const [org, regra] of Object.entries(valor)) {
    const chave = nome(org);
    if (!identificador(chave)) continue;
    const r = objeto(regra) ? regra : { mode: 'manual' };
    const autores = new Map();
    const entradaAutores = objeto(r.authors) ? r.authors : {};
    for (const [autor, modo] of Object.entries(entradaAutores)) {
      if (identificador(nome(autor))) autores.set(nome(autor), MODOS.includes(modo) ? modo : 'manual');
    }
    const item = { authors: Object.fromEntries(autores) };
    if (r.mode !== undefined) item.mode = MODOS.includes(r.mode) ? r.mode : 'manual';
    if (item.mode || autores.size) regras.set(chave, item);
  }
  return Object.fromEntries(regras);
}

// Operação pontual: uma edição nunca regrava as regras de outra organização ou pessoa.
function editarRegra(conta, op) {
  const org = nome(op.organization);
  const autor = nome(op.author);
  if (!identificador(org) || (autor && !identificador(autor))) return { ok: false, erro: 'Informe uma organização e um login de autor válidos.' };
  if (![...MODOS, 'inherit'].includes(op.mode)) return { ok: false, erro: 'Modo de review inválido.' };
  const regras = normalizarRegras(conta.reviewRules);
  const atual = Object.hasOwn(regras, org) ? regras[org] : { authors: {} };
  const autores = new Map(Object.entries(atual.authors));
  const regra = { ...atual };
  if (autor) {
    if (op.mode === 'inherit') autores.delete(autor);
    else autores.set(autor, op.mode);
  } else if (op.mode === 'inherit') delete regra.mode;
  else regra.mode = op.mode;
  regra.authors = Object.fromEntries(autores);
  if (regra.mode || autores.size) regras[org] = regra;
  else delete regras[org];
  const nova = { ...conta };
  if (Object.keys(regras).length) nova.reviewRules = regras;
  else delete nova.reviewRules;
  return { ok: true, conta: nova };
}

function regraDoPr(engine, pr) {
  const user = engine.accountForPr(pr);
  const contas = engine.config?.accounts || [];
  const conta = contas.find(a => nome(a.user) === nome(user)) || {};
  const regras = normalizarRegras(conta.reviewRules);
  const repo = String(pr.repo || String(pr.key || '').split('#')[0]);
  const org = nome(repo.split('/')[0]);
  if (!org && Object.keys(regras).length) return { mode: 'manual', source: 'escopo_desconhecido' };
  const regra = Object.hasOwn(regras, org) ? regras[org] : null;
  if (!regra) return null;
  const autor = nome(pr.author);
  if (!autor && Object.keys(regra.authors).length) return { mode: 'manual', source: 'autor_desconhecido' };
  if (Object.hasOwn(regra.authors, autor)) return { mode: regra.authors[autor], source: 'autor', organization: org, author: autor };
  if (regra.mode) return { mode: regra.mode, source: 'organizacao', organization: org };
  return null;
}

// A regra vale nos DOIS sentidos (12/11/2026): autor vence organização, organização vence conta. Até
// aqui, Automático não ligava nada com a conta em "só põe na fila", e uma conta do gh que atende duas
// empresas não conseguia revisar sozinha só uma delas (BIUD na fila, CNBB automática).
function politicaDeInicio(engine, pr, { retry = false } = {}) {
  const regra = regraDoPr(engine, pr);
  if (regra) return regra.mode === 'manual' ? { automatic: false, reason: 'review_manual', ...regra } : { automatic: true, ...regra };
  // Retentativa sem regra mantém o contrato anterior de retomar a sessão pedida
  // por clique, mesmo quando a conta está em "só põe na fila".
  if (!retry && !engine.autoReviewFor(engine.accountForPr(pr))) return { automatic: false, reason: 'auto_desligado' };
  return { automatic: true };
}

// A conta tem algo que revisa sozinho: ela mesma, ou uma organização ou autor marcado Automático.
// É o que decide se ela disputa a cota do perfil (contasDoPerfil).
function contaTemAutomatico(engine, user) {
  if (engine.autoReviewFor(user)) return true;
  const conta = (engine.config?.accounts || []).find(a => nome(a.user) === nome(user)) || {};
  return Object.values(normalizarRegras(conta.reviewRules))
    .some(r => r.mode === 'auto' || Object.values(r.authors).includes('auto'));
}

function bloqueioDeInicio(engine, pr) {
  if (pr.kind === 'self' || (pr.manual && !pr.automaticRetry)) return '';
  if (!regraDoPr(engine, pr)) return '';
  const p = politicaDeInicio(engine, pr, { retry: !!pr.automaticRetry });
  return p.automatic ? '' : p.reason;
}

export { normalizarRegras, editarRegra, regraDoPr, politicaDeInicio, bloqueioDeInicio, contaTemAutomatico };
