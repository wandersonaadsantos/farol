#!/usr/bin/env node
// Simulador de política: o que mudaria nas postagens automáticas já feitas com a política
// atual de cada conta e com uma alternativa. Só leitura, só linha de comando: sem rede, sem
// gravar nada, sem postar. Não viaja no pacote (fora da lista de tools do make-package).
//
//   node tools/simular-politica.js
//   node tools/simular-politica.js --politica '{"onClean":"wait"}'
//   node tools/simular-politica.js --politica '{"conta-a":{"onReject":"wait"}}' --json
//
// O QUE É FIEL, E POR QUÊ SÓ ISSO. A decisão gravada não guarda o envelope da sessão: faltam
// `findings`, `coverage`, `diffMedido`, `checksVerifiedHead`, `checksObrigatorios` e `alcance`,
// e o histórico perde os `payloads`. Reaplicar os portões ao registro cru pararia sempre em
// `nao_aprovavel` ou `prova_tecnica_incompleta`, o que seria resultado inventado. O motivo que
// segurou uma pendência também não é gravado, só um texto que muda de versão para versão.
//
// Sobra um caso provado: a decisão de status `auto_approved` ou `auto_rejected` POSTOU, então
// tudo o que os portões conferem antes da política tinha passado naquele momento. Para ela o
// simulador monta uma testemunha que passa nessas etapas, chama os portões REAIS e confere
// primeiro, com a política mais aberta, que eles aceitam a testemunha; recusa vira "fora da
// conta", com o motivo. A partir daí só a política varia.
//
// FICA DE FORA, e a saída diz: (1) o sentido contrário, o que a alternativa passaria a postar
// entre as decisões que ficaram para a pessoa; (2) revisão, comentário de PR próprio e clique
// do dono; (3) reprovação que saiu de veredito de aprovar, pelo caminho do defeito, que não
// passa por shouldAutoReject; (4) travas que mudaram desde a decisão: a testemunha prova que
// passou na época, não que passaria hoje.
import path from 'node:path';
import { shouldAutoApprove, shouldAutoReject } from '../lib/engine/approval-policy.js';
import { acaoAoAprovar, acaoAoReprovar } from '../lib/engine/contas-config.js';
import { avisoDoCi } from '../lib/engine/gate-espera.js';
import { CONFIG_FILE, STATE_DIR, executadoDireto } from '../lib/paths.js';
import { readRegularFile } from '../lib/bounded-file.js';
import { parseJson, safeStringify } from '../lib/io.js';

// o decisions.json mede dezenas de MB em aparelho antigo (82 MB em 03/11/2026)
const TETO_DO_ARQUIVO = 256 * 1024 ** 2;
const VALORES = Object.freeze({
  onClean: ['approve', 'wait'],
  onCaveats: ['approve', 'wait'],
  onReject: ['request_changes', 'wait'],
});
const MAIS_ABERTA = Object.freeze({ onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' });
const HEAD = 'a'.repeat(40);
const minusculo = v => String(v || '').trim().toLowerCase();

// Aviso de CI entra em `attention` sem contar para "limpo" (postarAprovacao soma os dois depois
// da decisão). O começo do texto sai da função real, para não copiar a frase aqui.
const INICIOS_DO_AVISO_DE_CI = ['vermelho', 'rodando'].map(estado => avisoDoCi({ checksObrigatorios: [{ nome: 'x', estado }] })[0].text.split('(')[0]);

function ressalvasDoRegistro(decisao) {
  if (!Array.isArray(decisao.attention)) return null;
  const texto = p => (typeof p === 'string' ? p : String(p?.text || ''));
  return decisao.attention.filter(p => !INICIOS_DO_AVISO_DE_CI.some(inicio => texto(p).startsWith(inicio)));
}

// O que os portões leem antes da política, no estado de quem passou. Nada aqui vem da decisão,
// e nada daqui é apresentado como dado dela: serve só para a política ser a variável.
function testemunhaComum() {
  return {
    analysisStatus: 'complete', headSha: HEAD, checksVerifiedHead: HEAD, checksObrigatorios: [],
    inventarioDiff: { status: 'complete', files: [] }, coverage: { total: 1, reviewed: ['a'], missing: [] }, diffMedido: ['a'],
    verificationCheckpoint: { entries: [] }, technicalReview: { semDeclaracao: true }, protocolo: { prReviewer: 'rodou' },
    findings: [], reviewMarkdown: 'testemunha',
  };
}
const TESTEMUNHAS = {
  auto_approved: () => ({ ...testemunhaComum(), verdict: 'approve', payloads: { approve: { event: 'APPROVE', body: 'testemunha' } } }),
  // a parte do card não entregue é o que torna coerente uma reprovação sem achado listado
  auto_rejected: () => ({ ...testemunhaComum(), verdict: 'request_changes', cardParteDestePr: false, payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'testemunha' } } }),
};

function motorDe(contas, ressalvas) {
  const engine = {
    config: { accounts: contas }, myPRs: [],
    accountList: () => contas,
    accountForPr: pr => pr.account,
    attentionPoints: () => ressalvas,
    approvePolicyFor: (conta, limpo) => acaoAoAprovar(engine, conta, limpo),
    rejectPolicyFor: conta => acaoAoReprovar(engine, conta),
  };
  return engine;
}

function portaoDeixa(status, contas, decisao, ressalvas) {
  const engine = motorDe(contas, ressalvas), pr = { ...decisao.pr, origemDono: true }, testemunha = TESTEMUNHAS[status]();
  if (status === 'auto_approved') {
    const r = shouldAutoApprove(engine, pr, testemunha);
    return { posta: r.ok === true, motivo: r.motivo || '' };
  }
  const posta = shouldAutoReject(engine, pr, testemunha);
  return { posta, motivo: posta ? '' : 'recusou' };
}

// O que tira a decisão da conta antes de chamar os portões. '' = ela entra.
function motivoDeFicarFora(decisao) {
  if (!Object.hasOwn(TESTEMUNHAS, String(decisao?.status))) return `status_${decisao?.status || 'desconhecido'}`;
  if (!decisao.pr?.account) return 'sem_conta_gravada';
  if (decisao.status === 'auto_rejected' && decisao.verdict !== 'request_changes') return 'reprovacao_pelo_caminho_do_defeito';
  if (decisao.status === 'auto_approved' && !Array.isArray(decisao.attention)) return 'sem_ressalvas_gravadas';
  return '';
}

// {"onClean":"wait"} vale para toda conta; {"conta":{"onClean":"wait"}} só para ela.
function lerAlternativa(texto) {
  const valor = parseJson(texto, null);
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error('--politica precisa ser um objeto JSON');
  const chaves = Object.keys(valor);
  if (chaves.length && chaves.every(c => Object.hasOwn(VALORES, c))) return { todas: conferirCampos(valor), porConta: {} };
  const porConta = {};
  for (const conta of chaves) porConta[minusculo(conta)] = conferirCampos(valor[conta], conta);
  return { todas: {}, porConta };
}

function conferirCampos(campos, conta = '') {
  const dono = conta ? ` da conta ${conta}` : '';
  if (!campos || typeof campos !== 'object' || Array.isArray(campos)) throw new Error(`política${dono} precisa ser um objeto`);
  for (const [campo, valor] of Object.entries(campos)) {
    if (!Object.hasOwn(VALORES, campo)) throw new Error(`campo desconhecido${dono}: ${campo} (aceitos: ${Object.keys(VALORES).join(', ')})`);
    if (!VALORES[campo].includes(valor)) throw new Error(`valor inválido${dono} em ${campo} (aceitos: ${VALORES[campo].join(', ')})`);
  }
  return campos;
}

function contasComAlternativa(contas, usuarios, alternativa) {
  const conhecidas = new Set(contas.map(c => minusculo(c.user)));
  const base = [...contas, ...usuarios.filter(u => !conhecidas.has(minusculo(u))).map(user => ({ user }))];
  return base.map(c => ({ ...c, ...alternativa.todas, ...alternativa.porConta[minusculo(c.user)] }));
}

function novaLinha(conta, naConfig) {
  const lado = () => ({ total: 0, postaAtual: 0, postaAlternativa: 0, deixaDeSair: 0, passaASair: 0 });
  return { conta, naConfig, aprovacoes: lado(), reprovacoes: lado() };
}

function somar(lado, atual, alternativa) {
  lado.total++;
  if (atual) lado.postaAtual++;
  if (alternativa) lado.postaAlternativa++;
  if (atual && !alternativa) lado.deixaDeSair++;
  if (!atual && alternativa) lado.passaASair++;
}

// PURA: nem disco, nem rede, nem relógio. `decisoes` é o conteúdo do decisions.json.
function simular(decisoes, config, alternativa = { todas: {}, porConta: {} }) {
  const lista = [...(decisoes?.pending || []), ...(decisoes?.resolved || [])];
  const contas = (Array.isArray(config?.accounts) ? config.accounts : []).filter(c => c && c.user);
  const fora = {}, linhas = new Map();
  const anotarFora = (motivo) => { fora[motivo] = (fora[motivo] || 0) + 1; };
  const entram = lista.filter((d) => {
    const motivo = motivoDeFicarFora(d);
    if (motivo) anotarFora(motivo);
    return !motivo;
  });
  const usuarios = [...new Set(entram.map(d => d.pr.account))];
  const abertas = contasComAlternativa(contas, usuarios, { todas: MAIS_ABERTA, porConta: {} });
  const atuais = contasComAlternativa(contas, usuarios, { todas: {}, porConta: {} });
  const alternativas = contasComAlternativa(contas, usuarios, alternativa);
  for (const d of entram) {
    const ressalvas = ressalvasDoRegistro(d) || [];
    const controle = portaoDeixa(d.status, abertas, d, ressalvas);
    if (!controle.posta) { anotarFora(`testemunha_recusada_${controle.motivo}`); continue; }
    const chave = minusculo(d.pr.account);
    if (!linhas.has(chave)) linhas.set(chave, novaLinha(d.pr.account, contas.some(c => minusculo(c.user) === chave)));
    const lado = linhas.get(chave)[d.status === 'auto_approved' ? 'aprovacoes' : 'reprovacoes'];
    somar(lado, portaoDeixa(d.status, atuais, d, ressalvas).posta, portaoDeixa(d.status, alternativas, d, ressalvas).posta);
  }
  const semDecisao = Object.keys(alternativa.porConta).filter(c => !linhas.has(c));
  return { lidas: lista.length, contas: [...linhas.values()], fora, contasDaAlternativaSemDecisao: semDecisao };
}

function textoDoLado(nome, l) {
  return `  ${nome}: ${l.total} registrada(s); com a política atual ${l.postaAtual} sairiam, com a alternativa ${l.postaAlternativa}; deixariam de sair ${l.deixaDeSair}, passariam a sair ${l.passaASair}`;
}

function relatorio(r) {
  const linhas = [`decisões lidas: ${r.lidas}`];
  for (const c of r.contas) {
    linhas.push(`${c.conta}${c.naConfig ? '' : ' (fora da config: política padrão de conta nova)'}`, textoDoLado('aprovações automáticas', c.aprovacoes), textoDoLado('reprovações automáticas', c.reprovacoes));
  }
  for (const conta of r.contasDaAlternativaSemDecisao) linhas.push(`aviso: a alternativa cita ${conta}, sem nenhuma decisão simulável`);
  linhas.push('fora da conta (sem resultado inventado):');
  for (const [motivo, n] of Object.entries(r.fora).sort((a, b) => b[1] - a[1])) linhas.push(`  ${motivo}: ${n}`);
  linhas.push('não medido: o que a alternativa passaria a postar entre as decisões que ficaram para a pessoa (o motivo da espera não é gravado).');
  return linhas.join('\n');
}

function lerJson(arquivo) {
  const valor = parseJson(readRegularFile(arquivo, TETO_DO_ARQUIVO).toString('utf8'), null);
  if (!valor || typeof valor !== 'object') throw new Error(`arquivo ilegível: ${path.basename(arquivo)}`);
  return valor;
}

function argumentos(argv) {
  const opcoes = { json: false, politica: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') opcoes.json = true;
    else if (argv[i] === '--politica' && i + 1 < argv.length) opcoes.politica = argv[++i];
    else throw new Error(`argumento não reconhecido: ${argv[i]}`);
  }
  return opcoes;
}

function principal(argv) {
  const opcoes = argumentos(argv);
  const alternativa = opcoes.politica === null ? undefined : lerAlternativa(opcoes.politica);
  const resultado = simular(lerJson(path.join(STATE_DIR, 'decisions.json')), lerJson(CONFIG_FILE), alternativa);
  console.log(opcoes.json ? safeStringify(resultado) : relatorio(resultado));
}

if (executadoDireto(import.meta.url)) {
  try { principal(process.argv.slice(2)); } catch (err) {
    console.error(`simular-politica: ${err.message}`);
    process.exitCode = 2;
  }
}

export { simular, lerAlternativa, relatorio };
