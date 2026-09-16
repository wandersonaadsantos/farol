// Contraprova por mutação da entrega tela-escopo-remoto. Roda a partir da raiz do repositório:
//   node docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/evidencias-execucao/verificacoes-saidas/tela-escopo-mutacoes.cjs [M1 M2 ...]
// Cada mutação troca UM trecho do código de produção, roda os testes que a guardam (limite de
// 4 minutos), confere que reprovaram e restaura o arquivo, conferindo o sha256 byte a byte.
const fs = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const E = 'test/sync-listas-remotas.test.js';
const P = 'test/ui-pure-listas-remotas.test.js';
const U = 'test/ui-listas-remotas.test.js';
const I = 'test/local-auth-inventario.test.js';
const H = 'test/sync-envio-historico.test.js';

const MUTACOES = [
  ['M1', 'lib/engine/sync-listas.js', 'if (!dono || dono === rt.deviceId) {', 'if (!dono) {', [E], 'escopo publicado aqui não vira remoto'],
  ['M2', 'lib/engine/sync-listas.js', 'if (rev === reg.rev) {', 'if (false) {', [E], 'ponteiro parado não relê as linhas'],
  ['M3', 'lib/engine/sync-listas.js', 'desdeU: reg.desdeU });', 'desdeU: 0 });', [E], 'leitura incremental a partir do maior u'],
  ['M4', 'lib/engine/sync-listas.js', "if (!r.ok) { Object.assign(reg, { estado: 'falhou', falhaEm: agora }); return; }", "if (!r.ok) { reg.linhas.clear(); Object.assign(reg, { estado: 'ok', lidoEm: agora }); return; }", [E], 'leitura que falha é falha e mantém a visão'],
  ['M5', 'lib/engine/sync-listas.js', 'for (const tag of r.saidas) {', 'for (const tag of []) {', [E], 'PR que saiu some'],
  ['M6', 'lib/engine/sync-listas.js', 'if (revs === null || metasLidas.includes(null)) {', 'if (revs === null && false) {', [E], 'falha do ponteiro marca os escopos'],
  ['M7', 'lib/engine/sync-listas.js', 'const batimento = agora - st.emitidoEm >= SYNC.LISTAS_BATIMENTO_MS;', 'const batimento = true;', [E], 'evento sem mudança não se repete'],
  ['M8', 'lib/engine/sync-escopo.js', 'if (cruas === null) return vazio;', 'if (cruas === null) return { ...vazio, ok: true };', [E], 'lerEscopo diz que falhou'],
  ['M9', 'lib/engine/sync-escopo.js', 'if (!linha) { r.naoAbriram.push(tag); continue; }', 'if (!linha) continue;', [E], 'linha que não abre é contada'],
  ['M10', 'lib/engine/sync-publicacao.js', 'if (!linha || !linha.key || prTag(kek.bufferDe(rt.material.id), linha.key) !== chave) return null;', 'if (!linha || !linha.key) return null;', [E], 'nunca o nome de outro PR (prDaTag)'],
  ['M11', 'lib/engine/sync-andamento.js', 'await pendencias.aplicarPendenciasIdentificadas(engine, cfg, abertas, vistos);', 'pendencias.aplicarPendencias(engine, abertas, vistos);', [E], 'o relógio entrega a pendência nomeada'],
  ['M12', 'lib/engine/sync-andamento.js', 'engine.decisions.pending.map(prDaPendencia) : [];', '[] : [];', [E], 'o catálogo inclui o PR das pendências'],
  ['M13', 'lib/engine/sync-andamento.js', '    if (!r || !r.ok) return null;\n    return objeto(r.data)', '    return objeto(r && r.data)', [E], 'leitura do andamento com ok:false não vira vazio'],
  ['M14', 'lib/engine/sync-andamento.js', 'if (arvore === null) avisarFalhaDaLeitura(engine, agora);', 'if (arvore === null) Math.abs(0);', [E], 'a falha do andamento chega à tela'],
  ['M15', 'lib/engine/sync-historico.js', '  if (!r || !r.ok) return null;\n  if (!objeto(r.data)) return [];', '  if (!r || !r.ok || !objeto(r.data)) return [];', [E], 'revisões: falha não vira lista vazia'],
  ['M16', 'lib/http-server.js', 'return Array.isArray(lista) ? { ok: true, revisoes: lista } :', 'return { ok: true, revisoes: lista || [] } || ', [E], 'rota das revisões diz a falha'],
  ['M17', 'lib/local-auth/inventario.js', "'/api/sync/reviews', '/api/sync/lists', ", "'/api/sync/reviews', ", [I], 'a rota nova tem classe na A4'],
  ['M18', 'lib/http-server.js', "engine.on('sync-lists', p => broadcast('sync-lists', p));", '', [E], 'o servidor repassa sync-lists'],
  ['M19', 'ui/pure/listas-remotas.js', 'if (!chave || vistas.has(chave) || !filtro(linha)) continue;', 'if (!chave || !filtro(linha)) continue;', [P, U], 'o PR daqui não conta dobrado'],
  ['M20', 'ui/pure/listas-remotas.js', 'if (!chave || vistas.has(chave) || !filtro(linha)) continue;', 'if (!chave || vistas.has(chave)) continue;', [P], 'o filtro da aba vale para as remotas'],
  ['M21', 'ui/pure/listas-remotas.js', "if (geral.estado !== 'ligada') return vazioMesclado(lista, geral);", '', [P, U], 'visão desligada não mostra linha guardada'],
  ['M22', 'ui/pure/listas-remotas.js', "return velhaLeitura || publicadorParado ? 'desatualizado' : 'ok';", "return 'ok';", [P, U], 'leitura velha é desatualizada'],
  ['M23', 'ui/pure/pr-compartilhado.js', 'if (!prIdentificado(pr)) return', 'if (!pr) return', [P], 'objeto sem chave válida é genérico'],
  ['M24', 'ui/pure/compartilhado.js', "${prIdentificadoHtml(op.pr, 'Um PR seu')}", 'Um PR seu', [P], 'a operação mostra o nome do PR'],
  ['M25', 'ui/pure/compartilhado.js', '  if (falhaEm) {\n    const desde', '  if (false) {\n    const desde', [P, U], 'a faixa afirma a falha do andamento'],
  ['M26', 'ui/pure/listas-remotas.js', 'Merge desabilitado aqui: dado vindo de outro aparelho nunca habilita merge.', 'Só leitura.', [P], 'o merge diz por que está desabilitado'],
  ['M27', 'ui/telas/listas-remotas.js', 'if (LISTAS.buscando || LISTAS.dados || ', 'if (', [U], 'a busca inicial é uma só'],
  ['M28', 'ui/telas/meus-prs.js', ' && !ocultosAgora.has(String(pr.key).toLowerCase())', '', [U], 'o PR oculto some da linha remota'],
  ['M29', 'ui/telas/radar.js', 'renderPanoramaRemoto(list, scopeVisible)', 'renderPanoramaRemoto(list, () => true)', [U], 'o escopo de conta filtra as remotas'],
  ['M30', 'ui/telas/radar-compartilhado.js', 'if (!LIVE.falhaEm) LIVE.at = Date.now();', 'LIVE.at = Date.now();', [U], 'a falha não passa por leitura boa'],
  ['M31', 'ui/app.js', "es.addEventListener('sync-lists', (e) => {", "es.addEventListener('sync-listas', (e) => {", [U], 'o bootstrap repassa sync-lists'],
  ['M32', 'lib/engine/sync-pendencias.js', '...aberto.valor.p, pr: null });', 'pr: null, ...aberto.valor.p });', [E], 'o nome nunca vem de dentro da pendência'],
  ['M33', 'lib/engine/sync-envio-historico.js', 'lote: Math.floor(feitos / LOTE) + 1,', 'lote: 1,', [H], 'a medida da retomada continua a contagem'],
  ['M34', 'lib/engine/sync-envio-historico.js', 'const lote = Math.ceil((todas.length - restantes) / LOTE);', 'const lote = Math.ceil(enviados / LOTE);', [H], 'o lote enviado conta o que já subiu antes'],
  ['M35', 'lib/engine/sync-envio-historico.js', 'function lotesDe(total) { return Math.ceil(total / LOTE); }', 'function lotesDe(total) { return Math.floor(total / LOTE); }', [H], 'o total de lotes inclui o lote incompleto'],
  ['M36', 'lib/http-server.js', 'impressao: r.impressao, lote: r.lote, lotes: r.lotes };', 'impressao: r.impressao };', [H], 'a rota de medir deixa o lote passar'],
  ['M37', 'lib/http-server.js', 'concluido: r.concluido, lote: r.lote, lotes: r.lotes };', 'concluido: r.concluido };', [H], 'a rota de enviar deixa o lote passar'],
  ['M38', 'ui/pure/compartilhado-historico.js', 'if (!parcial) return qualLote(medida) || ', 'if (!parcial) return ', [P], 'o primeiro lote diz 1 de M'],
  ['M39', 'ui/pure/compartilhado-historico.js', 'return n > 0 && total > 0 ?', 'return true ?', [P], 'sem número do engine a tela não inventa'],
];

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const filtro = process.argv.slice(2);
const linhas = [];
let inertes = 0;
for (const [id, arq, de, para, testes, garantia] of MUTACOES) {
  if (filtro.length && !filtro.includes(id)) continue;
  const original = fs.readFileSync(arq);
  const texto = original.toString('utf8');
  const n = texto.split(de).length - 1;
  if (n !== 1) { linhas.push(`${id} ERRO: trecho encontrado ${n} vezes em ${arq}`); continue; }
  fs.writeFileSync(arq, texto.replace(de, () => para));
  let r;
  try {
    r = spawnSync(process.execPath, ['--test', '--test-force-exit', ...testes], { encoding: 'utf8', timeout: 240000 });
  } finally {
    fs.writeFileSync(arq, original);
  }
  const volta = sha(fs.readFileSync(arq)) === sha(original);
  const falhas = ((r.stdout || '').match(/^ℹ fail (\d+)/m) || [])[1];
  const reprovou = r.status !== 0;
  if (!reprovou) inertes++;
  linhas.push(`${id} ${reprovou ? 'REPROVOU' : 'INERTE'} (saida ${r.status}, falhas ${falhas}) restaurado=${volta ? 'sim' : 'NAO'} sha=${sha(original).slice(0, 12)} ${arq}: ${garantia}`);
  if (!volta) { console.log(linhas.join('\n')); throw new Error(`${arq} não voltou byte a byte`); }
}
console.log(linhas.join('\n'));
console.log(`total ${linhas.length}, inertes ${inertes}`);
