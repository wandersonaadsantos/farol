// O Claude Code atrasado deixa o Farol rodando num modelo legado, em silencio (24/09/2026).
//
// Caso medido neste aparelho: o CLI estava na 2.1.268 desde 10/09. O Farol pede `--model
// opus`, e quem decide o que `opus` significa e o CLI: a 2.1.280 (22/09) trouxe o Opus 5.5
// como "o Opus padrao", mas aqui o apelido seguia apontando para o Opus 5, que a pagina
// oficial de modelos ja lista como LEGADO. As 1001 sessoes registradas rodaram no Opus 5.
// Nada falhou, nenhum check ficou vermelho, e o doctor mostrava "Claude Code 2.1.268" em
// verde. Pior: fixar `claude-opus-5-5` na config teria quebrado tudo, porque a 2.1.268
// responde `unrecognized_model` para o ID novo (medido).
//
// A alavanca e manter o CLI atual, entao o check pergunta exatamente isso. O CLI sai com
// versao nova quase todo dia (2.1.278 em 19/09, .280 em 22/09, .281 em 23/09, .282 em
// 24/09), e um check que ficasse vermelho a cada patch viveria vermelho. Por isso a regra
// conta desde QUANDO voce esta atras: a data de publicacao da primeira versao depois da
// sua. Vermelho so quando isso passa de 3 dias.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-versao-claude-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const versao = (await import('../lib/engine/versao-claude.js')).default;
const P = await import('../ui/pure.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

// datas REAIS do registro do npm, medidas em 24/09/2026
const DATAS = {
  '2.1.268': '2026-09-10T18:41:11.770Z',
  '2.1.269': '2026-09-11T18:12:49.253Z',
  '2.1.280': '2026-09-22T15:44:39.443Z',
  '2.1.281': '2026-09-23T10:00:00.000Z',
  '2.1.282': '2026-09-24T15:56:22.706Z',
  '2.2.0-beta.1': '2026-09-24T20:00:00.000Z',
};
const AGORA = Date.parse('2026-09-24T18:00:00Z');
const DIA = 24 * 3600 * 1000;

/* ---------- a avaliação, pura ---------- */

test('o caso deste aparelho: 2.1.268, atrás desde 11/09, é atrasado', () => {
  const v = versao.avaliarVersao({ instalada: '2.1.268 (Claude Code)', maisRecente: '2.1.282', datas: DATAS, agora: AGORA });
  assert.equal(v.instalada, '2.1.268', 'a versão sai limpa do texto do --version');
  assert.equal(v.atualizada, false);
  assert.equal(v.atrasadaDesde, Date.parse(DATAS['2.1.269']), 'atrás desde a PRIMEIRA versão depois da sua, não desde a última');
  assert.equal(v.atrasada, true, '13 dias atrás');
});

test('na mais recente: atualizada, sem atraso', () => {
  const v = versao.avaliarVersao({ instalada: '2.1.282 (Claude Code)', maisRecente: '2.1.282', datas: DATAS, agora: AGORA });
  assert.equal(v.atualizada, true);
  assert.equal(v.atrasada, false);
});

test('um patch saiu há poucas horas: atrás, mas dentro da tolerância, então NÃO é atrasado', () => {
  const v = versao.avaliarVersao({ instalada: '2.1.281', maisRecente: '2.1.282', datas: DATAS, agora: AGORA });
  assert.equal(v.atualizada, false, 'a tela pode dizer que há versão nova');
  assert.equal(v.atrasada, false, 'mas um patch de hoje não é motivo para vermelho');
});

test('a tolerância é de 3 dias: um minuto antes não pesa, um minuto depois pesa', () => {
  const desde = Date.parse(DATAS['2.1.282']);
  const antes = versao.avaliarVersao({ instalada: '2.1.281', maisRecente: '2.1.282', datas: DATAS, agora: desde + 3 * DIA - 60000 });
  const depois = versao.avaliarVersao({ instalada: '2.1.281', maisRecente: '2.1.282', datas: DATAS, agora: desde + 3 * DIA + 60000 });
  assert.equal(antes.atrasada, false);
  assert.equal(depois.atrasada, true);
});

test('versão de pré-lançamento não conta como "a seguinte à sua"', () => {
  const v = versao.avaliarVersao({ instalada: '2.1.282', maisRecente: '2.1.282', datas: DATAS, agora: AGORA + 10 * DIA });
  assert.equal(v.atualizada, true, 'o beta publicado depois não deixa a estável atrasada');
  assert.equal(v.atrasada, false);
});

test('beta da próxima versão publicado ANTES da estável não antecipa o atraso', () => {
  // quem está na 2.1.281 não está "atrás" porque saiu um beta: está atrás quando sai a
  // estável seguinte. Sem o filtro, o beta de 5 dias atrás viraria o "atrás desde"
  const datas = { '2.1.281': '2026-09-10T00:00:00Z', '2.1.282-beta.0': '2026-09-19T00:00:00Z', '2.1.282': '2026-09-24T15:56:22Z' };
  const v = versao.avaliarVersao({ instalada: '2.1.281', maisRecente: '2.1.282', datas, agora: AGORA });
  assert.equal(v.atrasadaDesde, Date.parse('2026-09-24T15:56:22Z'), 'conta da estável, não do beta');
  assert.equal(v.atrasada, false, 'a estável saiu hoje: dentro da tolerância');
});

test('falta de dado NUNCA vira alarme', () => {
  assert.equal(versao.avaliarVersao({ instalada: '', maisRecente: '2.1.282', datas: DATAS, agora: AGORA }), null,
    'CLI ausente é outro check (o de presença), não este');
  assert.equal(versao.avaliarVersao({ instalada: '2.1.268', maisRecente: '', datas: DATAS, agora: AGORA }), null,
    'registro indisponível: não se sabe se está atrás');
  const semData = versao.avaliarVersao({ instalada: '2.1.268', maisRecente: '2.1.282', datas: {}, agora: AGORA });
  assert.equal(semData.atualizada, false, 'sabe-se que há versão nova');
  assert.equal(semData.atrasada, false, 'mas sem data não dá para dizer há quanto tempo, e o lado seguro é não acusar');
});

/* ---------- a atualização periódica ---------- */

function motor() {
  return { log: () => { }, pushState() { this.empurrou = (this.empurrou || 0) + 1; } };
}
const registroOk = async () => ({ maisRecente: '2.1.282', datas: DATAS });

test('lê o CLI e o registro, e guarda o resultado para a tela', async () => {
  const e = motor();
  await versao.atualizarVersaoClaude(e, { agora: AGORA, lerVersao: async () => '2.1.268 (Claude Code)', lerRegistro: registroOk });
  assert.equal(e.claudeVersao.instalada, '2.1.268');
  assert.equal(e.claudeVersao.atrasada, true);
  assert.ok(e.empurrou >= 1, 'a tela fica sabendo');
});

test('relê o CLI de tempos em tempos: um claude update aparece sem reiniciar o Farol', async () => {
  const e = motor();
  let instalada = '2.1.268';
  const lerVersao = async () => instalada;
  await versao.atualizarVersaoClaude(e, { agora: AGORA, lerVersao, lerRegistro: registroOk });
  instalada = '2.1.282';
  await versao.atualizarVersaoClaude(e, { agora: AGORA + 60000, lerVersao, lerRegistro: registroOk });
  assert.equal(e.claudeVersao.instalada, '2.1.268', 'dentro do intervalo não relê: nada de gh e npm a cada ciclo');
  await versao.atualizarVersaoClaude(e, { agora: AGORA + 7 * 3600 * 1000, lerVersao, lerRegistro: registroOk });
  assert.equal(e.claudeVersao.instalada, '2.1.282', 'passado o intervalo, a atualização aparece');
  assert.equal(e.claudeVersao.atrasada, false);
});

test('registro fora do ar preserva a última leitura boa, em vez de apagar o aviso', async () => {
  const e = motor();
  await versao.atualizarVersaoClaude(e, { agora: AGORA, lerVersao: async () => '2.1.268', lerRegistro: registroOk });
  await versao.atualizarVersaoClaude(e, { agora: AGORA + 7 * 3600 * 1000, lerVersao: async () => '2.1.268', lerRegistro: async () => null });
  assert.equal(e.claudeVersao.atrasada, true, 'uma queda de rede não pode apagar um aviso verdadeiro');
});

test('erro inesperado na leitura não derruba o ciclo', async () => {
  const e = motor();
  await versao.atualizarVersaoClaude(e, { agora: AGORA, lerVersao: async () => { throw new Error('spawn falhou'); }, lerRegistro: registroOk });
  assert.equal(e.claudeVersao, undefined);
});

/* ---------- o check da tela ---------- */

test('sem leitura, o check não aparece: nunca um verde que ninguém conferiu', () => {
  assert.deepEqual(P.versaoClaudeCheck(null), []);
  assert.deepEqual(P.versaoClaudeCheck(undefined), []);
});

test('atrasado: vermelho, com a versão, desde quando, e o comando que resolve', () => {
  const v = versao.avaliarVersao({ instalada: '2.1.268', maisRecente: '2.1.282', datas: DATAS, agora: AGORA });
  const [c] = P.versaoClaudeCheck(v);
  assert.equal(c.ok, false);
  assert.match(c.detail, /2\.1\.268/);
  assert.match(c.detail, /2\.1\.282/);
  assert.match(c.detail, /11\/09/, 'desde quando, que é o que diz se é descuido de ontem ou de semanas');
  assert.match(c.detail, /claude update/);
  assert.match(c.detail, /modelo/, 'e por que isso importa para o Farol');
});

test('atualizado: verde', () => {
  const v = versao.avaliarVersao({ instalada: '2.1.282', maisRecente: '2.1.282', datas: DATAS, agora: AGORA });
  const [c] = P.versaoClaudeCheck(v);
  assert.equal(c.ok, true);
  assert.match(c.detail, /mais recente/);
});

test('patch recente: verde, mas dizendo que há versão nova', () => {
  const v = versao.avaliarVersao({ instalada: '2.1.281', maisRecente: '2.1.282', datas: DATAS, agora: AGORA });
  const [c] = P.versaoClaudeCheck(v);
  assert.equal(c.ok, true);
  assert.match(c.detail, /2\.1\.282/);
});

test('o rótulo nomeia a DIMENSÃO: não repete o "Claude Code" do check de presença', () => {
  const v = versao.avaliarVersao({ instalada: '2.1.282', maisRecente: '2.1.282', datas: DATAS, agora: AGORA });
  const [c] = P.versaoClaudeCheck(v);
  assert.notEqual(c.label, 'Claude Code');
  assert.match(c.label, /vers[aã]o/i);
  assert.equal(c.goto, undefined, 'nenhuma tela do app atualiza o CLI: clique que não leva a nada é pior que texto');
});
