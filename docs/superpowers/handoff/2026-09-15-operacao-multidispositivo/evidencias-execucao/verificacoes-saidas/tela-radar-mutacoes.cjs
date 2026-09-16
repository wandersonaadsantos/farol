// Contraprova por mutação: cada garantia é quebrada numa cópia de trabalho, o teste que a
// guarda tem de reprovar, e o arquivo volta byte a byte (conferido por sha256).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const RAIZ = process.argv[2];
const PURO = 'ui/pure/compartilhado.js';
const HIST = 'ui/pure/compartilhado-historico.js';
const TELA = 'ui/telas/radar-compartilhado.js';
const T_PURO = 'test/ui-pure-compartilhado.test.js';
const T_TELA = 'test/ui-radar-compartilhado.test.js';

const MUTACOES = [
  ['M1 bloqueada vira ligada', PURO, "if (s.bloqueioCompartilhamento) return 'bloqueada';", "if (false) return 'bloqueada';", [T_PURO, T_TELA]],
  ['M2 sem recibo vira aplicado', PURO, "return { estado: 'enviado', classe: 'info', rotulo: 'enviado'", "return { estado: 'aplicado', classe: 'ok', rotulo: 'aplicado'", [T_PURO]],
  ['M3 vencido some', PURO, 'if (c.vence && Number(agora) > Number(c.vence)) {', 'if (false) {', [T_PURO]],
  ['M4 falha da lista vira vazio', HIST, "if (e.estado === 'falha')", 'if (false)', [T_PURO]],
  ['M5 tomar sem confirmação', TELA, 'if (!await perguntar(dialogo) || !dialogo.pode) return false;', 'if (!dialogo.pode) return false;', [T_TELA]],
  ['M6 tomar ignora o aviso', TELA, 'if (!await perguntar(dialogo) || !dialogo.pode) return false;', 'if (!await perguntar(dialogo)) return false;', [T_TELA]],
  ['M7 bootstrap não repassa sync-live', 'ui/app.js', '    aoAndamentoRemoto(d);', '    void d;', [T_TELA]],
  ['M8 tela usa shared cru', TELA, "const ligada = visaoCompartilhada(s) === 'ligada';", 'const ligada = s.shared === true;', [T_TELA]],
  ['M9 lote vazio gira para sempre', HIST, 'if (!(Number(r.enviados) > 0))', 'if (false)', [T_PURO]],
  ['M10 tomar sem commit', PURO, 'tomar: { pode: !semAdmin && !falta,', 'tomar: { pode: !semAdmin,', [T_PURO, T_TELA]],
  ['M11 admin sem sinal comanda', PURO, "if (admin.fresca !== true) return { pode: false", "if (false) return { pode: false", [T_PURO, T_TELA]],
  ['M12 prazo do comando some', 'lib/engine/sync-telas.js', 'vence: Number(r.vence) || 0', 'vence: 0', ['test/contrato-telas.test.js']],
  ['M13 faixa sem o interruptor', PURO, 'if (!(cfg.distribution && cfg.distribution.enabled === true)) return', 'if (false) return', [T_PURO]],
  ['M14 cancelar sem confirmação', TELA, "if (!await perguntar(aparelho)) return false;\n  return emitirComando({ alvo: op.dev, tipo: 'cancelar'", "return emitirComando({ alvo: op.dev, tipo: 'cancelar'", [T_TELA]],
  ['M15 tomada sofrida fora da nota', 'ui/pure/sync.js', '${notaDistribuicaoHtml(key, s, agora)}${notaTomadaSofridaHtml(key, s)}', '${notaDistribuicaoHtml(key, s, agora)}', [T_PURO]],
  ['M16 decidir aceita qualquer ação', TELA, "if (acao !== 'approve' && acao !== 'reject') return false;", 'if (!acao) return false;', [T_TELA]],
  ['M17 enviar sem medida', TELA, 'if (!medida || !medida.impressao) return ENVIO;', 'if (!medida) return ENVIO;', [T_TELA]],
  ['M18 leitura nunca atrasa', PURO, 'if (!at || agora - at <= ANDAMENTO_FRESCO_MS)', 'if (true)', [T_PURO]],
  ['M19 decidir sem permissão', PURO, 'const acoes = ctx.podeComandar\n', 'const acoes = true\n', [T_PURO, T_TELA]],
  ['M20 bootstrap não repassa sync-pending', 'ui/app.js', '    aoPendenciasRemotas(d);', '    void d;', [T_TELA]],
  ['M21 visto que falha finge marcar', TELA, "  if (!r || r.ok !== true) {\n    toast('error', `Não deu para registrar o visto", "  if (false) {\n    toast('error', `Não deu para registrar o visto", [T_TELA]],
];

function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

const linhas = [];
let problemas = 0;
for (const [nome, arq, de, para, testes] of MUTACOES) {
  const alvo = path.join(RAIZ, arq);
  const original = fs.readFileSync(alvo);
  const hash = sha(original);
  const texto = original.toString('utf8');
  if (!texto.includes(de)) { linhas.push(`${nome}: TRECHO NÃO ENCONTRADO`); problemas++; continue; }
  fs.writeFileSync(alvo, texto.replace(de, para));
  const r = spawnSync(process.execPath, ['--test', '--test-force-exit', ...testes], { cwd: RAIZ, encoding: 'utf8' });
  fs.writeFileSync(alvo, original);
  const voltou = sha(fs.readFileSync(alvo)) === hash;
  const falhas = (r.stdout.match(/ℹ fail (\d+)/) || [])[1] || '?';
  const pegou = r.status !== 0;
  if (!pegou || !voltou) problemas++;
  linhas.push(`${nome}: ${pegou ? 'REPROVOU' : 'INERTE'} (código ${r.status}, ${falhas} caso(s) vermelhos em ${testes.join(', ')}); restaurado byte a byte: ${voltou ? 'sim' : 'NÃO'}`);
}
console.log(linhas.join('\n'));
console.log(problemas ? `\n${problemas} problema(s)` : '\ntodas as mutações reprovaram e foram restauradas');
process.exit(problemas ? 1 : 0);
