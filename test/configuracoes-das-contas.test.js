// Revisão das configurações das contas (29/09/2026, pedido do dono: "não quero de maneira
// nenhuma habilitar um botão à toa"). A chave geral da Automação diz quantas contas ela
// alcança, o campo sem chave geral para de prometer que herda uma, e o nome do perfil diz
// que ele escolhe o login do Claude, não o modelo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const P = await import('../ui/pure.js');
const HTML = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'index.html'), 'utf8');

const BIUDER = { user: 'biuder', onReject: 'request_changes' };
const PESSOAL = { user: 'pessoal', autoReview: true, onClean: 'approve', onCaveats: 'approve' };
const MUDA = { user: 'antiga', muted: true };
const contasConfig = (await import('../lib/engine/contas-config.js')).default;

function engineCom(contas, geral = {}) {
  return { config: { autoReview: true, autoApproveAll: true, ...geral }, accountList: () => contas };
}

test('alcance vem do engine: ativas que seguem a chave e as que têm valor próprio', () => {
  const alc = contasConfig.alcanceDasChavesGerais(engineCom([BIUDER, PESSOAL, MUDA]));
  assert.deepEqual(alc.autoReview, { segue: ['biuder'], proprias: ['pessoal'] }, 'silenciada fica fora');
  const espera = { user: 'cautelosa', onClean: 'wait' };
  assert.deepEqual(contasConfig.alcanceDasChavesGerais(engineCom([BIUDER, espera])).autoApproveAll, { segue: ['biuder'], proprias: ['cautelosa'] }, 'o limpo esperando você tira a conta da chave das ressalvas');
});

// a prova de que os predicados são OS MESMOS que decidem: mexer na chave geral muda a
// decisão exatamente das contas que o alcance diz que seguem, e de nenhuma outra
test('o alcance bate com o que a revisão e a aprovação decidem de verdade', () => {
  const espera = { user: 'cautelosa', onClean: 'wait' };
  const contas = [BIUDER, PESSOAL, espera];
  const ligado = engineCom(contas, { autoReview: true, autoApproveAll: true });
  const desligado = engineCom(contas, { autoReview: false, autoApproveAll: false });
  const alc = contasConfig.alcanceDasChavesGerais(ligado);
  for (const u of ['biuder', 'pessoal', 'cautelosa']) {
    const mudaRevisao = contasConfig.revisaSozinho(ligado, u) !== contasConfig.revisaSozinho(desligado, u);
    assert.equal(mudaRevisao, alc.autoReview.segue.includes(u), `revisão de ${u}`);
    const mudaRessalva = contasConfig.acaoAoAprovar(ligado, u, false) !== contasConfig.acaoAoAprovar(desligado, u, false);
    assert.equal(mudaRessalva, alc.autoApproveAll.segue.includes(u), `ressalvas de ${u}`);
  }
});

test('a frase do alcance: quantas contas e quem tem valor próprio', () => {
  assert.equal(P.alcanceDaChaveGeral({ segue: ['biuder'], proprias: ['pessoal'] }), 'Vale para 1 de 2 contas ativas; @pessoal tem configuração própria em Contas.');
  assert.equal(P.alcanceDaChaveGeral({ segue: ['biuder'], proprias: [] }), 'Vale para a conta ativa.');
  assert.equal(P.alcanceDaChaveGeral({ segue: ['a', 'b'], proprias: [] }), 'Vale para as 2 contas ativas.');
  assert.equal(P.alcanceDaChaveGeral({ segue: [], proprias: ['pessoal'] }), 'Não vale para nenhuma conta agora: todas têm configuração própria em Contas.');
  assert.equal(P.alcanceDaChaveGeral({ segue: ['a'], proprias: ['b', 'c'] }), 'Vale para 1 de 3 contas ativas; @b, @c têm configuração própria em Contas.');
  assert.equal(P.alcanceDaChaveGeral(undefined), '');
});

test('as duas chaves gerais têm onde dizer o alcance, ao lado da descrição', () => {
  assert.match(HTML, /id="sys-row-autoreview"[\s\S]*?id="alcanceAutoReview"[\s\S]*?id="setAutoReview"/);
  assert.match(HTML, /id="sys-row-autoapprove"[\s\S]*?id="alcanceAutoApproveAll"[\s\S]*?id="setAutoApproveAll"/);
});

test('Contas: o sem ressalvas não promete herdar uma chave geral que não existe', () => {
  const html = P.accountsManagerHtml({ accounts: [BIUDER], acct: {}, config: { claudeProfiles: [] } });
  assert.match(html, /<option value="">padrão: aprova sozinho<\/option>/);
  assert.doesNotMatch(html, /herda o geral: aprova sozinho/);
});

test('Contas: o perfil diz que escolhe o login do Claude, e que o modelo vem da Automação', () => {
  const html = P.accountsManagerHtml({ accounts: [BIUDER], acct: {}, config: { claudeProfiles: [] } });
  assert.match(html, /login do Claude \(plano\)/);
  assert.match(html, /O modelo e o raciocínio vêm de Sistema &gt; Automação|O modelo e o raciocínio vêm de Sistema > Automação/);
  assert.doesNotMatch(html, /a-fieldlabel">perfil de IA</);
});

test('Automação: a co-assinatura avisa no app, não no PR, e respeita a conta', () => {
  const desc = HTML.slice(HTML.indexOf('id="sys-row-coassinar"'), HTML.indexOf('id="sys-row-reviewfast"'));
  assert.doesNotMatch(desc, /avisa no PR/);
  assert.match(desc, /sem postar nada no PR/);
  assert.match(desc, /espera você também não co-assina/);
});

// 30/09/2026: o "com ressalvas" herdado dizia "aprova e destaca as ressalvas" olhando só a
// chave geral, e o engine manda esperar quando o limpo da conta espera você. A tela tem de
// dizer, para cada conta, o que acontece de verdade: o mesmo que acaoAoAprovar devolve.
test('Contas: o com ressalvas herdado diz o que o engine faz, conta a conta', () => {
  const espera = { user: 'cautelosa', onClean: 'wait' };
  const segue = { user: 'segue' };
  const ligado = { claudeProfiles: [], autoApproveAll: true };
  const eng = engineCom([espera, segue], { autoApproveAll: true });
  const bloco = (html, u) => html.slice(html.indexOf(`class="acct-oncaveats" data-user="${u}"`)).split('</select>')[0];
  const alcance = contasConfig.alcanceDasChavesGerais(eng);
  assert.deepEqual(alcance.ressalvaHerdadaEspera, ['cautelosa'], 'a lista vem do mesmo predicado que decide');
  const html = P.accountsManagerHtml({ accounts: [espera, segue], acct: {}, config: ligado, alcance });
  assert.equal(contasConfig.acaoAoAprovar(eng, 'cautelosa', false), 'wait');
  assert.match(bloco(html, 'cautelosa'), /<option value="">herda o geral: espera você<\/option>/);
  assert.equal(contasConfig.acaoAoAprovar(eng, 'segue', false), 'approve');
  assert.match(bloco(html, 'segue'), /<option value="">herda o geral: aprova \(as ressalvas ficam no app\)<\/option>/);
  assert.doesNotMatch(html, /destaca as ressalvas/, 'o APPROVE não destaca ressalva nenhuma no PR');
});

test('Automação: nenhuma chave promete o que o engine não faz', () => {
  assert.doesNotMatch(HTML, /código do qual você é dono, por exemplo/, 'a co-assinatura nunca vale onde você é dono');
  assert.match(HTML, /Nunca co-assina onde você é dono do código pelo CODEOWNERS/);
  assert.match(HTML, /Não vale no modelo Auto/, 'o Auto fixa fast:false em toda faixa');
  assert.doesNotMatch(HTML, /org que está esperando há mais tempo/, 'o escalonador escolhe a org atendida há mais tempo');
  assert.doesNotMatch(HTML, /APPROVE destacando as ressalvas/);
});
