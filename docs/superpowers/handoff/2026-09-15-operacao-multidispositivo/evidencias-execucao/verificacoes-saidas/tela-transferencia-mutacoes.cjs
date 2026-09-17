// Contraprova por mutação da transferência e tomada pela tela: cada garantia é quebrada na
// cópia de trabalho, os testes que a guardam têm de reprovar (tempo limite de 4 minutos), e
// o arquivo volta byte a byte (conferido por sha256).
// Uso: node tela-transferencia-mutacoes.cjs <raiz do worktree> [filtro de nome]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const RAIZ = process.argv[2];
const FILTRO = process.argv[3] || '';
const AND = 'lib/sync/andamento.js';
const PUB = 'lib/engine/sync-publicacao.js';
const ANDE = 'lib/engine/sync-andamento.js';
const TRE = 'lib/engine/sync-transferencia.js';
const TRP = 'lib/sync/transferencia.js';
const CMD = 'lib/engine/sync-comandos.js';
const TEL = 'lib/engine/sync-telas.js';
const DIS = 'lib/engine/sync-distribuicao.js';
const PURO = 'ui/pure/compartilhado.js';
const POSSE = 'ui/pure/compartilhado-posse.js';
const TELA = 'ui/telas/radar-compartilhado.js';
const T_E2E = 'test/sync-transferencia-tela.test.js';
const T_AND = 'test/sync-andamento.test.js';
const T_DIS = 'test/sync-distribuicao.test.js';
const T_TR = 'test/sync-transferencia.test.js';
const T_POS = 'test/ui-pure-compartilhado-posse.test.js';
const T_PUR = 'test/ui-pure-compartilhado.test.js';
const T_RAD = 'test/ui-radar-compartilhado.test.js';

const MUTACOES = [
  ['N1 andamento sem commit', AND, 'matTag: materialDe(kId, s, pr),', "matTag: '',", [T_AND, T_E2E]],
  ['N2 commit só do PR', AND, 'tagOuVazio(matTag, kId, s.headSha || pr.headSha)', 'tagOuVazio(matTag, kId, pr.headSha)', [T_AND, T_E2E]],
  ['N3 herança fora do vocabulário', AND, "return HERANCAS.includes(s.heranca) ? s.heranca : '';", "return String(s.heranca || '');", [T_AND]],
  ['N4 catálogo sem conferir a tag', PUB, " || prTag(kek.bufferDe(rt.material.id), linha.key) !== chave) return null;", ') return null;', [T_E2E]],
  ['N5 leitura sem PR', ANDE, 'pr: await publicacao.prDaTag(engine, cfg, op.prTag) });', 'pr: null });', [T_E2E]],
  ['N6 relógio lê cru', ANDE, 'await lerEAplicar(engine, cfg, arvore, { agora });', 'aplicarLeitura(engine, arvore, { agora });', [T_E2E]],
  ['N7 catálogo sem sessões vivas', ANDE, '...fila, ...distribuindo, ...vivas]', '...fila, ...distribuindo]', [T_E2E]],
  ['N8 catálogo repete a chave', ANDE, "if (!objeto(pr) || !pr.key || vistos.has(pr.key)) return false;", 'if (!objeto(pr) || !pr.key) return false;', [T_E2E]],
  ['N9 transferir lê head do PR', TRE, 'return String(s.headSha || (objeto(s.pr) && s.pr.headSha) ||', "return String((objeto(s.pr) && s.pr.headSha) ||", [T_E2E, T_TR]],
  ['N10 candidato sem head', TRE, 'publicarCandidato(engine, cfg, { ...pr, headSha: head }, {', 'publicarCandidato(engine, cfg, pr, {', [T_E2E, T_TR]],
  ['N11 destino sem consentimento apto', TRP, "  if (c.aceitarAdmin === false) return { apto: false, motivo: 'sem-consentimento' };\n", '', [T_E2E]],
  ['N12 dono atual vira destino', TRP, "  if (String(id) === String(dono)) return 'dono-atual';\n", '', [T_E2E]],
  ['N13 versão antiga vira destino', TRP, "  if (d.contract !== frota.CONTRATO) return 'versao-antiga';\n", '', [T_E2E]],
  ['N14 memória desconhecida vira destino', TRP, "  if (resumo.ramLivre === 'desconhecida') return 'memoria-desconhecida';\n", '', [T_E2E]],
  ['N15 sem sinal vira destino', TRP, "return apto.motivo === 'sem-resumo' ? 'sem-sinal' : apto.motivo;", 'return apto.motivo;', [T_E2E]],
  ['N16 origem sempre apta', TRP, "return c.aceitarAdmin === true ? '' : 'sem-consentimento';", "return '';", [T_E2E]],
  ['N17 destinos sem ordem', TRE, '.sort(porAptidaoENome);', ';', [T_E2E]],
  ['N18 tomar não pergunta o head', CMD, "  if (typeof engine.headSha !== 'function') return '';", "  if (true) return '';", [T_E2E]],
  ['N19 tomar aceita head desconhecido', CMD, 'if (!head || matTag(kId, head) !== args.matTag)', 'if (head && matTag(kId, head) !== args.matTag)', [T_E2E]],
  ['N20 emitido sem prKey', TEL, "prKey: pr ? pr.key : '',", "prKey: '',", [T_E2E]],
  ['N21 emitido sem destino', TEL, "destino: String(limpo.args.destino || '')", "destino: ''", [T_E2E]],
  ['N22 agendador não anota', DIS, '  for (const a of avaliados) anotarEspera(rt, a.itemId, motivoDoAvaliado(a), agora);\n', '', [T_DIS]],
  ['N23 recusa não anota', DIS, '    anotarEspera(rt, r.itemId, r.code, agora);\n', '', [T_DIS]],
  ['N24 anota item alheio', DIS, '  if (!meusCandidatos(rt).has(itemId)) return;\n', '', [T_DIS]],
  ['N25 atribuído sem motivo', DIS, "a.desfecho === 'atribuido' || a.motivo === 'atribuicao-viva'", "a.motivo === 'atribuicao-viva'", [T_DIS]],
  ['N26 motivo nunca chega', DIS, "  return melhor ? melhor.motivo : '';", "  return '';", [T_DIS]],
  ['N27 review não grava herança', 'lib/engine/review.js', 'if (doConjunto.ok && engine.activeReviews.get(id)) engine.activeReviews.get(id).heranca = doConjunto.desfecho;', 'void doConjunto;', ['test/sync-checkpoint-remoto.test.js']],
  ['N28 rota de destinos some', 'lib/http-server.js', "if (p === '/api/sync/transfer-targets')", "if (p === '/api/sync/transfer-targets-x')", ['test/local-auth-inventario.test.js', T_E2E]],
  ['N29 tomar sem PR em claro', PURO, "return pr.key && pr.account ? '' : 'o nome do PR", "return pr ? '' : 'o nome do PR", [T_POS, T_PUR, T_RAD]],
  ['N30 transferir sem commit', PURO, "return op.matTag ? '' : 'o andamento não traz o commit, que a transferência exige';", "return '';", [T_POS, T_RAD]],
  ['N31 PR nunca nomeado', PURO, "if (!pr || !pr.key) return 'Um PR seu", "if (true) return 'Um PR seu", [T_POS, T_E2E]],
  ['N32 motivo da espera some', PURO, 'Esperando distribuição${ha}: nenhum aparelho recebeu este PR ainda. ${textoDaEspera(item.motivo)}', 'Esperando distribuição${ha}: nenhum aparelho recebeu este PR ainda. ${textoDaEspera(\'\')}', [T_POS]],
  ['N33 herança escondida', PURO, "const heranca = HERANCA[op.heranca] || '';", "const heranca = '';", [T_POS]],
  ['N34 linha do comando sem destino', PURO, 'para ${esc(onde)}${detalheDoComando(cmd, ctx)},', 'para ${esc(onde)},', [T_POS, T_RAD, T_E2E]],
  ['N35 inaptos viram opção', POSSE, 'opcoes: aptos.map((d) =>', 'opcoes: r.destinos.map((d) =>', [T_POS]],
  ['N36 origem inapta ignorada', POSSE, 'if (origem) {', 'if (false) {', [T_POS, T_E2E]],
  ['N37 comando em qualquer card', POSSE, '(c) => c && c.prKey && c.prKey === key)', '(c) => c)', [T_POS]],
  ['N38 card sem nota do comando', 'ui/pure/sync.js', '${notaTomadaSofridaHtml(key, s)}${notaComandoHtml(key, s)}', '${notaTomadaSofridaHtml(key, s)}', [T_POS]],
  ['N39 tomadas nunca listadas', POSSE, "  if (!lista.length) return '';\n  return `<div class=\"card md-lista\">${lista.map((t) => tomadaHtml", "  if (lista.length >= 0) return '';\n  return `<div class=\"card md-lista\">${lista.map((t) => tomadaHtml", [T_POS, T_RAD]],
  ['N40 tela aceita escolha forjada', TELA, 'if (!dialogo.pode || !dialogo.aptos.includes(destino)) return false;', 'if (!destino) return false;', [T_RAD, T_E2E]],
  ['N41 tela sem confirmação', TELA, 'if (!await confirmar(transferenciaConfirmacao(', 'if (false && !await confirmar(transferenciaConfirmacao(', [T_RAD, T_E2E]],
  ['N42 tela sem lista de tomadas', TELA, '  renderTomadas(s);\n', '', [T_RAD]],
  ['N43 aviso sem conta', TELA, "{ prKey: op.pr.key, account: op.pr.account }", "{ prKey: op.pr.key, account: '' }", [T_RAD, T_E2E]],
  ['N44 recibo não força o piso', TELA, 'if (!forcar && Date.now() - RECIBOS.at < RECIBO_MIN_MS) return;', 'if (Date.now() - RECIBOS.at < RECIBO_MIN_MS) return;', [T_E2E]],
  ['N45 tela não pede destinos', TELA, "const resposta = await api('/api/sync/transfer-targets', { dono: op.dev, acctTag: op.acctTag || '' });", 'const resposta = { ok: true, destinos: [{ deviceId: destinoForjado(), apto: true }] };\n  function destinoForjado() { return \'dEu\'; }', [T_RAD, T_E2E]],
];

function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

const linhas = [];
let problemas = 0;
for (const [nome, arq, de, para, testes] of MUTACOES) {
  if (FILTRO && !nome.startsWith(`${FILTRO} `)) continue;
  const alvo = path.join(RAIZ, arq);
  const original = fs.readFileSync(alvo);
  const hash = sha(original);
  const texto = original.toString('utf8');
  if (!texto.includes(de)) { linhas.push(`${nome}: TRECHO NÃO ENCONTRADO`); problemas++; continue; }
  fs.writeFileSync(alvo, texto.replace(de, para));
  let r;
  try {
    r = spawnSync(process.execPath, ['--test', '--test-force-exit', ...testes], { cwd: RAIZ, encoding: 'utf8', timeout: 240000 });
  } finally {
    fs.writeFileSync(alvo, original);
  }
  const voltou = sha(fs.readFileSync(alvo)) === hash;
  const falhas = ((r.stdout || '').match(/ℹ fail (\d+)/) || [])[1] || '?';
  const pegou = r.status !== 0;
  if (!pegou || !voltou) problemas++;
  linhas.push(`${nome}: ${pegou ? 'REPROVOU' : 'INERTE'} (código ${r.status}${r.error ? `, ${r.error.code}` : ''}, ${falhas} caso(s) vermelhos em ${testes.join(', ')}); restaurado byte a byte: ${voltou ? 'sim' : 'NÃO'}`);
  console.log(linhas[linhas.length - 1]);
}
console.log(problemas ? `\n${problemas} problema(s)` : '\ntodas as mutações reprovaram e foram restauradas');
process.exit(problemas ? 1 : 0);
