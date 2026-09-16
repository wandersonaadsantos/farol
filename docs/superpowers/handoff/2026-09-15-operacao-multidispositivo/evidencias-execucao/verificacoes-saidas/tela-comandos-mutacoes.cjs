// Contraprova por mutação de repetir, iniciar, designar admin e do motivo da espera: cada
// garantia é quebrada na cópia de trabalho, os testes que a guardam têm de reprovar (tempo
// limite de 4 minutos), e o arquivo volta byte a byte (conferido por sha256).
// Uso: node tela-comandos-mutacoes.cjs <raiz do worktree> [filtro de nome]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const RAIZ = process.argv[2];
const FILTRO = process.argv[3] || '';

const CMD = 'lib/engine/sync-comandos.js';
const HIS = 'lib/sync/historico.js';
const CAN = 'lib/engine/sync-candidatos.js';
const ESP = 'lib/engine/sync-espera.js';
const DIS = 'lib/engine/sync-distribuicao.js';
const ESC = 'lib/engine/escolha.js';
const TEL = 'lib/engine/sync-telas.js';
const TRE = 'lib/engine/sync-transferencia.js';
const TRP = 'lib/sync/transferencia.js';
const HTTP = 'lib/http-server.js';
const REGRAS = 'firebase/database.rules.json';
const PURO = 'ui/pure/compartilhado.js';
const HISU = 'ui/pure/compartilhado-historico.js';
const POSSE = 'ui/pure/compartilhado-posse.js';
const APAR = 'ui/pure/aparelhos.js';
const TELA = 'ui/telas/radar-compartilhado.js';
const TAPAR = 'ui/telas/sistema-aparelhos.js';

const T_E2E = 'test/sync-comandos-tela.test.js';
const T_CMD = 'test/sync-comandos-remoto.test.js';
const T_ESP = 'test/sync-espera.test.js';
const T_UPC = 'test/ui-pure-comandos-tela.test.js';
const T_HIS = 'test/sync-historico.test.js';
const T_CAN = 'test/sync-candidato.test.js';
const T_RUL = 'test/sync-rules-contrato.test.js';
const T_DIS = 'test/sync-distribuicao.test.js';
const T_CON = 'test/contrato-telas.test.js';

const MUTACOES = [
  // --- o defeito corrigido no executor
  ['M1 repetir volta a ler o head do objeto', CMD, "const head = await headAtual(engine, pr);\n  if (!head || matTag(kId, head) !== args.matTag) return { estado: 'recusado', code: 'head_mudou' };\n  const r =", "const head = String(pr.headSha || '');\n  if (!head || matTag(kId, head) !== args.matTag) return { estado: 'recusado', code: 'head_mudou' };\n  const r =", [T_CMD, T_E2E]],
  ['M2 repetir aceita head desconhecido', CMD, "if (!head || matTag(kId, head) !== args.matTag) return { estado: 'recusado', code: 'head_mudou' };\n  const r =", "if (head && matTag(kId, head) !== args.matTag) return { estado: 'recusado', code: 'head_mudou' };\n  const r =", [T_CMD]],
  ['M3 iniciar confia no head guardado', CMD, "const head = await headAtual(engine, { ...meu.pr, headSha: '' });", 'const head = await headAtual(engine, meu.pr);', [T_CMD, T_E2E]],
  ['M4 repetir enfileira como clique', CMD, 'const r = engine.enqueueHeadless(comando.prDoComando(pr));', 'const r = engine.enqueueHeadless({ ...pr, manual: true });', [T_CMD, T_E2E]],
  // --- o dado que faltava
  ['M5 índice sem o commit', HIS, 'matTag: tagSeHouver(x.headSha, (v) => matTag(kId, v)),', "matTag: '',", [T_HIS, T_E2E]],
  ['M6 fila do conjunto sem nome', CAN, 'pr: nomeDoPr(pr),', 'pr: null,', [T_E2E]],
  ['M7 fila do conjunto ignora a atribuição', CAN, 'atribuido: atribuicaoDe(atribuicoes, item.itemId, agora),', 'atribuido: null,', [T_E2E]],
  ['M8 executor com publicação vencida', CAN, '|| !candidato.vivo(no, agora)) continue;', ') continue;', [T_E2E]],
  ['M9 atribuição recém-feita fora da fila', DIS, '...mapaDe(atribuicoes.valor), ...recemAtribuido }', '...mapaDe(atribuicoes.valor) }', [T_E2E]],
  ['M10 projeção sem a fila do conjunto', TEL, 'candidatos: candidatosParaTela(rt),', 'candidatos: [],', [T_E2E, T_CON]],
  ['M11 projeção sem o motivo por aparelho', TEL, 'aparelhos: aparelhosDaEspera(registro),', 'aparelhos: [],', [T_ESP, T_E2E]],
  ['M12 lista de destinos sem o item', TEL, 'acctTag: d.acctTag, itemId: d.itemId }', 'acctTag: d.acctTag }', [T_E2E]],
  ['M13 rota sem o item', HTTP, "itemId: String(body.itemId || '')", "itemId: ''", [T_E2E]],
  ['M14 executores sem a conta do item', TRE, ': alvo.acctTagDoItem;', ": '';", [T_E2E]],
  ['M15 quem não publicou vira executor', TRE, 'publicadores: c.publicadores', 'publicadores: null', [T_E2E]],
  ['M16 não publicou deixa de ser motivo', TRP, "  if (naoPublicou(id, publicadores)) return 'nao-publicou';\n", '', [T_E2E]],
  // --- o motivo da espera
  ['M17 escolha sem motivo por aparelho', ESC, 'aparelhos: motivosPorAparelho(item, aparelhos, ctx)', 'aparelhos: []', [T_CAN, T_ESP, T_E2E]],
  ['M18 pausado vira sem sinal', ESC, "  if (a.pausado === true) return 'pausado';\n", '', [T_ESP]],
  ['M19 sem vaga não é dito', ESC, "  if (!(folga(a) > 0)) return 'sem-vaga';\n", '', [T_ESP, T_E2E]],
  ['M20 recusa recente não é dita', ESC, "  if (!aptoNaEspera(recusas, item.itemId, dev, agora)) return 'recusou';\n", '', [T_ESP]],
  ['M21 admin não publica o veredito', DIS, '  await espera.publicarEsperas(engine, avaliados, { agora });\n', '', [T_ESP, T_E2E]],
  ['M22 veredito reescrito a cada giro', ESP, '    if (mapa.get(a.itemId) === impressao) continue;\n', '', [T_ESP]],
  ['M23 veredito vencido vale', ESP, "if (!objeto(a.espera) || !(Number(a.espera.ttl) > Number(agora))) return null;", 'if (!objeto(a.espera)) return null;', [T_ESP]],
  ['M24 veredito sem amarra do item (leitura)', ESP, "campo: CAMPO, esquema: ESQUEMA, extras: [itemId],\n  });", 'campo: CAMPO, esquema: ESQUEMA,\n  });', [T_ESP]],
  ['M25 a fonte mais nova não vale', ESP, 'return vivas.sort((a, b) => b.at - a.at)[0];', 'return vivas[0];', [T_ESP]],
  ['M26 recusa vencida vale', ESP, '  if (ate && ate <= Number(agora)) return null;\n', '', [T_ESP]],
  ['M27 lê recusas sem candidato próprio', ESP, 'if (!meus.length || !rt.client) return new Map();', 'if (!rt.client) return new Map();', [T_ESP]],
  ['M28 atribuição viva sem o aparelho', ESP, "return { motivo: 'atribuicao-viva', dev: String(a.dev), aparelhos: [],", "return { motivo: 'atribuicao-viva', dev: '', aparelhos: [],", [T_ESP]],
  ['M29 quem publicou não lê o conjunto', DIS, 'for (const [itemId, e] of await espera.lerEsperas(engine, { atribuicoes: atribuicoes.valor, agora })) {', 'for (const [itemId, e] of new Map()) {', [T_ESP, T_E2E]],
  ['M30 detalhe da recusa sem allowlist', DIS, 'detalhe: daLista(DETALHES, detalhe),', 'detalhe: String(detalhe || ()=>{}),', [T_ESP]],
  ['M31 recusa local sem detalhe', DIS, "detalhe: r.problema || '',", "detalhe: '',", [T_ESP]],
  ['M32 regra do veredito some', REGRAS, '"espera": {', '"esperaX": {', [T_RUL]],
  ['M33 regra volta a exigir rev anterior', REGRAS, "!data.child('rev').exists() || ", '', [T_RUL]],
  // --- a tela
  ['M34 repetir sem exigir o commit', HISU, "return i.matTag ? '' : 'esta revisão foi publicada antes de o commit entrar no índice';", "return '';", [T_UPC, T_E2E]],
  ['M35 repetir sem exigir o admin', HISU, "const semAdmin = c.podeComandar === true ? '' : (c.motivoSemComando || 'só o aparelho admin, com sinal fresco, emite comandos');", "const semAdmin = '';", [T_UPC, T_E2E]],
  ['M36 revisão sem o botão repetir', HISU, '    ${repetirBotaoHtml(item, ctx)}\n', '', [T_UPC]],
  ['M37 iniciar com atribuição viva', POSSE, "return atribuido ? `o distribuidor já escolheu o ${atribuido} e espera ele aceitar` : '';", "return '';", [T_UPC, T_E2E]],
  ['M38 iniciar sem publicador', POSSE, "  if (!publicadores.length) return 'nenhum aparelho publicou este candidato agora';\n", '', [T_UPC]],
  ['M39 iniciar sem exigir o admin', POSSE, "  const semAdmin = x.podeComandar === true ? '' : (x.motivoSemComando || 'só o aparelho admin, com sinal fresco, emite comandos');\n  const publicadores", "  const semAdmin = '';\n  const publicadores", [T_UPC, T_E2E]],
  ['M40 inaptos viram opção de início', POSSE, 'opcoes: aptos.map((d) => ({ valor: d.deviceId, rotulo: `Começar no', 'opcoes: r.destinos.map((d) => ({ valor: d.deviceId, rotulo: `Começar no', [T_UPC]],
  ['M41 designar sem ser admin', APAR, "  if (x.souAdmin !== true) return { pode: false, motivo: 'só o aparelho admin, com sinal fresco, designa outro admin' };\n", '', [T_UPC, T_E2E]],
  ['M42 designar aparelho aposentado', APAR, "  if (Number(a.retiredAt) > 0) return { pode: false, motivo: 'aparelho aposentado' };\n", '', [T_UPC, T_E2E]],
  ['M43 designar aparelho sem presença', APAR, "  if (a.semPresenca === true) return { pode: false, motivo: 'sem presença recente, e o pedido venceria antes de ele ler' };\n", '', [T_UPC]],
  ['M44 designar o próprio aparelho', APAR, "  if (a.euMesmo === true) return { pode: false, motivo: 'este aparelho já decide a própria autoridade em \"Tornar este aparelho admin\"' };\n", '', [T_UPC, T_E2E]],
  ['M45 pedido pendente invisível', APAR, "  return chip('info', 'designação pendente');", "  return '';", [T_UPC, T_E2E]],
  ['M46 recusa aparece como pendente', APAR, "  if (recibo && recibo.estado === 'recusado') return chip('bad', 'recusou ser admin');\n", '', [T_UPC, T_E2E]],
  ['M47 nota da espera sem o detalhe', PURO, '${detalheDaEspera(item, sync)}', '', [T_ESP]],
  ['M48 nota sem o aviso do peso', PURO, "const peso = motivo === 'sem-aparelho-apto' || motivo === 'sem_vaga' ? PESO_NAO_ATIVO : '';", "const peso = '';", [T_ESP]],
  ['M49 código novo sem texto', PURO, "  nao_publiquei: 'aquele aparelho não publicou este item',\n", '', [T_UPC]],
  ['M50 repetir sem confirmação', TELA, 'if (!await confirmar(repetirConfirmacao({ aparelho, pr: \'\' }))) return false;', 'if (false) return false;', [T_E2E]],
  ['M51 repetir sem guarda', TELA, 'if (!item || !acoesDaRevisao(item, { podeComandar: permissao.pode, motivoSemComando: permissao.motivo }).repetir.pode) return false;', 'if (!item) return false;', [T_E2E]],
  ['M52 iniciar aceita escolha forjada', TELA, 'if (!dialogo.pode || !dialogo.aptos.includes(destino)) return false;\n  const nome', 'if (!destino) return false;\n  const nome', [T_E2E]],
  ['M53 iniciar sem confirmação', TELA, "if (!await confirmar(inicioConfirmacao({ destino: nome, pr: (c.pr && c.pr.key) || '' }))) return false;", 'if (false) return false;', [T_E2E]],
  ['M54 iniciar sem guarda', TELA, 'if (!c || !acoesDoCandidato(c, contexto).iniciar.pode) return false;', 'if (!c) return false;', [T_E2E]],
  ['M55 fila do conjunto nunca desenhada', TELA, '  renderCandidatos(s);\n', '', [T_E2E]],
  ['M56 designar sem guarda', TAPAR, 'if (!alvo || !aparelhosDesignarAcao(alvo, { souAdmin: aparelhosSouAdmin(s.admin) }).pode) return false;', 'if (!alvo) return false;', [T_E2E]],
  ['M57 designar sem confirmação', TAPAR, "  if (!resp.ok) return false;\n  const r = await d.api('/api/sync/command'", "  if (false) return false;\n  const r = await d.api('/api/sync/command'", [T_E2E]],
  ['M58 recibo forçado desiste com leitura em curso', TAPAR, 'if (RECIBOS.emCurso) await RECIBOS.emCurso;', 'if (RECIBOS.emCurso) return false;', [T_E2E]],
  ['M59 recibo sem piso de tempo', TAPAR, '  if (!forcar && Date.now() - RECIBOS.at < RECIBO_MIN_MS) return false;\n', '', [T_E2E]],
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
  if (!texto.includes(de)) { linhas.push(`${nome}: TRECHO NÃO ENCONTRADO`); problemas++; console.log(linhas[linhas.length - 1]); continue; }
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
