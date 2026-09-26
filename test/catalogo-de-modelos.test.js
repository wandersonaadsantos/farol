// Selecao de modelo centralizada: cada selecao definida UMA vez (24/09/2026).
//
// Pedido do Wanderson: "essa parte de selecao de modelo precisa estar bem centralizada pra
// que sempre que eu selecionar algum modo isso seja bem definido e equalizado no farol".
// Ate aqui a mesma decisao estava escrita em quatro lugares (allowlist, seletor da tela,
// roteador do Auto e a regra de esforco em tres copias). Estes casos travam que ela mora
// num lugar so (lib/modelos.js) e que todo mundo le de la, e o ultimo caso impede que a
// dispersao volte: literal de modelo fora do catalogo reprova.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-catalogo-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const M = (await import('../lib/modelos.js')).default;
const { sanitizeClaudeModel, effortForModel, MODEL_ALIASES } = await import('../lib/parse.js');
const { escolheModelo } = (await import('../lib/engine/model-router.js')).default;
const { buildModelFlags } = await import('../lib/engine/session.js');
const { modelLabel } = await import('../lib/format.js');
const P = await import('../ui/pure.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const PEQUENO = { lines: 50, changedFiles: 2 };
const MEDIO = { lines: 500, changedFiles: 8 };
const GRANDE = { lines: 5000, changedFiles: 40 };

/* ---------- a allowlist sai do catálogo ---------- */

test('a config aceita exatamente as seleções do catálogo', () => {
  assert.deepEqual([...MODEL_ALIASES].sort(), [...M.APELIDOS_CLAUDE].sort(), 'uma lista só, não duas que concordam por acaso');
  for (const v of M.APELIDOS_CLAUDE) assert.equal(sanitizeClaudeModel(v), v, v);
});

/* ---------- o Auto usa as seleções, não modelos próprios ---------- */

test('cada faixa do Auto, e o contexto, apontam para uma seleção que existe', () => {
  for (const [faixa, f] of Object.entries({ ...M.AUTO_POR_FAIXA, contexto: M.AUTO_POR_CONTEXTO })) {
    assert.ok(M.selecaoClaude(f.selecao), `faixa ${faixa} aponta para "${f.selecao}", que não é seleção`);
  }
});

test('o roteador devolve o modelo DA SELEÇÃO de cada faixa, e do contexto', () => {
  // gatilhos desligados: aqui se prova a tabela de tamanho; o contexto tem a linha dele
  const cfg = { reviewModel: 'auto', autoOpus: { reposCriticos: [], caminhosSensiveis: [], prMuitoGrande: false } };
  assert.equal(escolheModelo(PEQUENO, cfg).model, M.selecaoClaude(M.AUTO_POR_FAIXA.pequeno.selecao).modelo);
  assert.equal(escolheModelo(MEDIO, cfg).model, M.selecaoClaude(M.AUTO_POR_FAIXA.medio.selecao).modelo);
  assert.equal(escolheModelo(GRANDE, cfg).model, M.selecaoClaude(M.AUTO_POR_FAIXA.grande.selecao).modelo);
  assert.equal(escolheModelo(null, cfg).model, M.selecaoClaude(M.AUTO_POR_FAIXA.semMetrica.selecao).modelo);
  assert.equal(escolheModelo(GRANDE, { reviewModel: 'auto' }).model, M.selecaoClaude(M.AUTO_POR_CONTEXTO.selecao).modelo, 'PR muito grande, no padrão');
});

test('o rótulo do Auto nomeia os modelos que o Auto usa de fato', () => {
  const usados = new Set([M.AUTO_POR_CONTEXTO, ...Object.values(M.AUTO_POR_FAIXA)].map((f) => M.selecaoClaude(f.selecao).nome));
  const rotulo = M.rotuloDoAuto();
  for (const nome of usados) assert.match(rotulo, new RegExp(nome), `o Auto usa ${nome} e o rótulo não diz`);
  assert.equal(rotulo, 'Auto (qualidade primeiro: Opus em todo PR, com raciocínio extra quando o contexto pede)', 'qualidade primeiro (26/09/2026)');
});

/* ---------- o esforço, numa regra só ---------- */

test('quem não aceita esforço está no catálogo, e a regra do engine lê de lá', () => {
  for (const s of M.SELECOES_CLAUDE.filter((x) => x.modelo)) {
    assert.equal(effortForModel(s.modelo, 'high'), s.aceitaEsforco ? 'high' : '', s.valor);
  }
});

test('modelo fixado pelo NOME COMPLETO segue a regra da família (o Haiku fixado não recebe esforço)', () => {
  // antes, a regra comparava só o apelido: `claude-haiku-4-5` fixado na config passava
  // `--effort`, que o Haiku 4.5 não aceita
  assert.equal(M.aceitaEsforco('claude-haiku-4-5'), false);
  assert.equal(buildModelFlags({ reviewModel: 'claude-haiku-4-5', reviewEffort: 'high' }), ' --model claude-haiku-4-5');
  assert.equal(M.aceitaEsforco('claude-opus-5-5'), true);
  assert.equal(M.aceitaEsforco('claude-algo-novo-9'), true, 'família desconhecida: quem decide é o CLI');
});

test('o rótulo de um modelo cru usa as famílias do catálogo', () => {
  assert.equal(modelLabel('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelLabel('claude-sonnet-5'), 'Sonnet 5');
  assert.equal(modelLabel('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(modelLabel('claude-fable-5-1'), 'Fable 5.1');
});

/* ---------- a tela recebe o catálogo pronto ---------- */

test('o catálogo da tela é só dado, sem regex, e traz o esforço de cada seleção', () => {
  const c = M.catalogoParaTela();
  assert.deepEqual(JSON.parse(JSON.stringify(c)), c, 'atravessa o snapshot sem perder nada');
  assert.deepEqual(c.claude.map((s) => s.valor), M.SELECOES_CLAUDE.map((s) => s.valor));
  assert.equal(c.claude.find((s) => s.valor === 'haiku').aceitaEsforco, false);
  assert.equal(c.claude.find((s) => s.valor === 'auto').rotulo, M.rotuloDoAuto());
  assert.ok(c.codex.length > 1);
});

test('as opções do seletor saem do catálogo, escapadas', () => {
  const html = P.opcoesDeModeloHtml([{ valor: 'opus', rotulo: 'Opus <5>' }, { valor: '', rotulo: 'Padrão' }]);
  assert.match(html, /<option value="opus">Opus &lt;5&gt;<\/option>/);
  assert.match(html, /<option value="">Padrão<\/option>/);
  assert.equal(P.opcoesDeModeloHtml(null), '', 'sem catálogo, nenhuma opção inventada');
});

test('a tela sabe se a seleção aceita esforço pelo catálogo, e valor fora dele aceita', () => {
  const lista = M.catalogoParaTela().claude;
  assert.equal(P.selecaoAceitaEsforco(lista, 'haiku'), false);
  assert.equal(P.selecaoAceitaEsforco(lista, 'auto'), false);
  assert.equal(P.selecaoAceitaEsforco(lista, 'opus'), true);
  assert.equal(P.selecaoAceitaEsforco(lista, 'claude-opus-5-5'), true, 'fixado à mão: o engine é quem tem a palavra final');
});

/* ---------- o snapshot: chave própria, e o `app` continua sendo só identidade ---------- */

test('o snapshot leva o catálogo e a versão do CLI em `modelos`, e deixa `app` intacto', async () => {
  // a primeira versão desta entrega pendurou o catálogo dentro de `app`, e o smoke do
  // Electron (tools/electron-smoke-lib.js) reprovou nos três sistemas: ele confere `app`
  // inteiro contra { name, version, platform }, porque `app` é a IDENTIDADE do app. O
  // smoke só roda no CI, com desktop; este caso pega a mesma quebra aqui, sem Electron.
  const { Engine } = await import('../server.js');
  const e = new Engine();
  e.claudeVersao = { instalada: '2.1.282', maisRecente: '2.1.282', atualizada: true, atrasadaDesde: 0, atrasada: false };
  const snap = e.snapshot();
  assert.deepEqual(Object.keys(snap.app).sort(), ['name', 'platform', 'version'], '`app` é identidade, e o smoke confere o objeto inteiro');
  assert.deepEqual(snap.modelos.claude.map((s) => s.valor), M.SELECOES_CLAUDE.map((s) => s.valor));
  assert.equal(snap.modelos.cli.instalada, '2.1.282', 'a versão do CLI viaja junto do catálogo que ela resolve');
});

test('sem leitura do CLI, `cli` vai nulo, e o check da tela simplesmente não aparece', () => {
  const c = M.catalogoParaTela(null);
  assert.equal(c.cli, null);
  assert.deepEqual(P.versaoClaudeCheck(c.cli), []);
});

/* ---------- a trava: a dispersão não volta ---------- */

const RAIZ = path.join(import.meta.dirname, '..');
function arquivos(dir, fora = []) {
  const out = [];
  for (const nome of fs.readdirSync(path.join(RAIZ, dir))) {
    const rel = path.join(dir, nome);
    const st = fs.statSync(path.join(RAIZ, rel));
    if (st.isDirectory()) out.push(...arquivos(rel, fora));
    else if (/\.(js|html)$/.test(nome) && !fora.includes(rel.replace(/\\/g, '/'))) out.push(rel);
  }
  return out;
}
// tira comentário de linha e de bloco antes de procurar: história no comentário é permitida.
// A remoção repete até estabilizar: uma passada só deixaria `<!<!---->--` virar `<!--` (o
// CodeQL acusou isso na primeira versão), e o mesmo vale para os comentários de bloco.
function semComentario(src) {
  let antes;
  let s = src;
  do {
    antes = s;
    s = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  } while (s !== antes);
  return s.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('nenhum modelo é escrito à mão fora do catálogo', () => {
  const alvos = [...arquivos('lib', ['lib/modelos.js']), ...arquivos('ui'), 'server.js'];
  const LITERAL = /(['"`])(opus|sonnet|haiku|fable|best|gpt-\d[\w.-]*)\1/;
  const achados = [];
  for (const rel of alvos) {
    const src = semComentario(fs.readFileSync(path.join(RAIZ, rel), 'utf8'));
    src.split('\n').forEach((linha, i) => { if (LITERAL.test(linha)) achados.push(`${rel.replace(/\\/g, '/')}:${i + 1}: ${linha.trim().slice(0, 90)}`); });
  }
  assert.deepEqual(achados, [], 'modelo escrito à mão fora de lib/modelos.js; leia do catálogo');
});

test('o seletor da tela não tem opção fixa no HTML: todas vêm do catálogo', () => {
  const html = fs.readFileSync(path.join(RAIZ, 'ui', 'index.html'), 'utf8');
  for (const id of ['setReviewModel', 'setCodexReviewModel']) {
    const m = new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
    assert.ok(m, `#${id} existe`);
    assert.doesNotMatch(m[1], /<option/, `#${id} com opção fixa no HTML volta a ser uma segunda lista`);
  }
});
