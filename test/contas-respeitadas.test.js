// As configurações de conta precisam ser respeitadas (25/09/2026).
//
// Pedido do Wanderson, ao ver quatro PRs aprováveis sem ressalva esperando clique numa conta
// que estava em "aprova sozinho": "Essas configurações precisam serem respeitadas". A
// investigação achou a classe do defeito e dois casos dela:
//
// - A tela salvava a LISTA INTEIRA de contas a cada edição, com o que ela tinha na memória, e
//   o servidor gravava a lista como veio. Qualquer campo que a tela não soubesse, ou soubesse
//   velho, era apagado ou ressuscitado em TODAS as contas por uma edição de cor.
// - O peso na cota do perfil (`budgetWeight`) nunca chegava à tela nem ao cálculo da cota:
//   `accountList()` e a projeção não o copiavam. O engine lia `undefined`, a tela mostrava
//   "igual as outras", e qualquer edição apagava o peso gravado.
//
// E a janela em que a política virou "aguardar" não deixou rastro nenhum, então ninguém
// conseguiu dizer quem a mudou. Estes casos travam as três coisas.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-contas-'));
fs.writeFileSync(path.join(process.env.FAROL_HOME, 'config.json'), JSON.stringify({
  port: 47198, autoReview: false, autoApproveAll: true,
  accounts: [
    { user: 'trabalho', owners: ['org1'], onReject: 'request_changes', budgetWeight: 2 },
    { user: 'pessoal', owners: ['org2'], onClean: 'approve', onCaveats: 'approve', claudeProfileId: 'p1' },
  ],
  claudeProfiles: [{ id: 'p1', label: 'Um', dir: path.join(os.tmpdir(), 'perfil-um') }],
}));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const C = (await import('../lib/engine/contas-config.js')).default;
const { Engine } = await import('../server.js');
const { POLITICA_HISTORICO_FILE } = await import('../lib/paths.js');
const P = await import('../ui/pure.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const RAIZ = path.join(import.meta.dirname, '..');
const BASE = [
  { user: 'trabalho', owners: ['org1'], onReject: 'request_changes', budgetWeight: 2 },
  { user: 'pessoal', owners: ['org2'], onClean: 'approve' },
];

/* ---------- o peso na cota chega ao engine e à tela ---------- */

test('o peso na cota gravado na config chega ao cálculo da cota e à tela', () => {
  const e = new Engine();
  assert.equal(e.accountList().find((a) => a.user === 'trabalho').budgetWeight, 2, 'o rateio da cota lê accountList()');
  assert.equal(e.snapshot().accounts.find((a) => a.user === 'trabalho').budgetWeight, 2, 'sem isto a tela mostra "igual as outras"');
});

/* ---------- o que a tela de Contas mostra é o que o engine faz ---------- */

// Cada linha é uma combinação dos seletores de Sistema > Contas e de Automação, e o que o
// Farol precisa fazer com ela. É a matriz das telas do relato: conta que herda tudo, com o
// geral aprovando também com ressalvas, aprova sozinha nos dois casos.
const MATRIZ = [
  // conta,                                      geral (autoApproveAll), limpo, com ressalvas
  [{}, true, 'approve', 'approve'],
  [{}, false, 'approve', 'wait'],
  [{ onClean: 'approve', onCaveats: 'approve' }, false, 'approve', 'approve'],
  [{ onClean: 'wait' }, true, 'wait', 'wait'],
  [{ onCaveats: 'wait' }, true, 'approve', 'wait'],
  [{ onClean: 'wait', onCaveats: 'approve' }, true, 'wait', 'approve'],
];

test('a política efetiva de aprovação segue a matriz das telas, e ressalva nunca é mais permissiva que o limpo sem escolha própria', () => {
  for (const [conta, geral, limpo, ressalva] of MATRIZ) {
    const e = { config: { autoApproveAll: geral, autoReview: true }, accountList: () => [{ user: 'x', owners: [], ...conta }] };
    const rotulo = `${JSON.stringify(conta)} com geral ${geral}`;
    assert.equal(C.acaoAoAprovar(e, 'X', true), limpo, `${rotulo}, sem ressalvas`);
    assert.equal(C.acaoAoAprovar(e, 'X', false), ressalva, `${rotulo}, com ressalvas`);
  }
});

test('revisar sozinho e reprovar sozinho seguem a conta, e herdam o geral quando ela não escolhe', () => {
  const e = (conta, autoReview) => ({ config: { autoReview }, accountList: () => [{ user: 'x', owners: [], ...conta }] });
  assert.equal(C.revisaSozinho(e({}, true), 'x'), true);
  assert.equal(C.revisaSozinho(e({}, false), 'x'), false);
  assert.equal(C.revisaSozinho(e({ autoReview: false }, true), 'x'), false, 'false da conta é escolha');
  assert.equal(C.acaoAoReprovar(e({ onReject: 'request_changes' }, true), 'x'), 'request_changes');
  assert.equal(C.acaoAoReprovar(e({}, true), 'x'), 'wait', 'reprovar sozinho não tem padrão geral');
  assert.equal(C.acaoAoAprovar(e({}, true), 'conta-que-nao-existe', true), 'approve', 'conta desconhecida herda');
});

/* ---------- editar é por campo, e o servidor mescla ---------- */

test('editar um campo muda só aquele campo daquela conta', () => {
  const r = C.aplicarEdicao(BASE, { tipo: 'editar', user: 'pessoal', campos: { color: '#123456' } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.contas[0], BASE[0], 'a outra conta fica byte a byte igual');
  assert.equal(r.contas[1].color, '#123456');
  assert.equal(r.contas[1].onClean, 'approve', 'a política que a tela não mandou continua gravada');
});

test('tela com estado velho não apaga nem ressuscita campo que ela não editou', () => {
  // o caso da lista inteira: a tela não sabia do peso (a projeção não o trazia) e, ao mudar a
  // cor de OUTRA conta, gravava a lista sem ele. Por operação, o peso nem entra na conversa.
  const r = C.aplicarEdicao(BASE, { tipo: 'editar', user: 'pessoal', campos: { label: 'Casa' } });
  assert.equal(r.contas[0].budgetWeight, 2);
  assert.equal(r.contas[0].onReject, 'request_changes');
});

test('valor vazio volta a herdar o padrão geral, removendo o campo', () => {
  const r = C.aplicarEdicao(BASE, { tipo: 'editar', user: 'pessoal', campos: { onClean: '' } });
  assert.equal('onClean' in r.contas[1], false);
  const r2 = C.aplicarEdicao(BASE, { tipo: 'editar', user: 'trabalho', campos: { budgetWeight: null } });
  assert.equal('budgetWeight' in r2.contas[0], false);
});

test('campo fora da lista é recusado e devolvido, nunca gravado calado', () => {
  const r = C.aplicarEdicao(BASE, { tipo: 'editar', user: 'pessoal', campos: { user: 'outro', token: 'x', color: '#000' } });
  assert.deepEqual(r.ignorados.sort(), ['token', 'user']);
  assert.equal(r.contas[1].user, 'pessoal');
  assert.equal(r.contas[1].token, undefined);
});

test('conta que não existe, conta repetida e remover a última são recusados', () => {
  assert.equal(C.aplicarEdicao(BASE, { tipo: 'editar', user: 'ninguem', campos: { color: '#000' } }).ok, false);
  assert.equal(C.aplicarEdicao(BASE, { tipo: 'adicionar', user: 'PESSOAL', owners: [] }).ok, false);
  assert.equal(C.aplicarEdicao([BASE[0]], { tipo: 'remover', user: 'trabalho' }).ok, false);
  assert.equal(C.aplicarEdicao(BASE, { tipo: 'desconhecido', user: 'trabalho' }).ok, false);
});

test('adicionar e remover mexem só na conta pedida', () => {
  const add = C.aplicarEdicao(BASE, { tipo: 'adicionar', user: 'nova', owners: ['org3'], label: 'Nova' });
  assert.deepEqual(add.contas.slice(0, 2), BASE);
  assert.deepEqual(add.contas[2], { user: 'nova', owners: ['org3'], label: 'Nova' });
  const rem = C.aplicarEdicao(BASE, { tipo: 'remover', user: 'pessoal' });
  assert.deepEqual(rem.contas, [BASE[0]]);
});

test('perfil de IA apagado deixa de ser apontado pelas contas, no servidor', () => {
  const contas = [{ user: 'a', owners: [], claudeProfileId: 'vivo' }, { user: 'b', owners: [], claudeProfileId: 'morto' }];
  const r = C.semPerfisOrfaos(contas, [{ id: 'vivo' }]);
  assert.equal(r[0].claudeProfileId, 'vivo');
  assert.equal('claudeProfileId' in r[1], false);
});

/* ---------- o rastro: toda mudança de política tem data e origem ---------- */

test('a diferença de política considera conta e padrão geral, e ignora o que não é política', () => {
  const antes = C.retratoDaPolitica({ autoApproveAll: true, accounts: BASE });
  const depois = C.retratoDaPolitica({
    autoApproveAll: false,
    accounts: [{ ...BASE[0], color: '#fff', onClean: 'wait' }, BASE[1]],
  });
  assert.deepEqual(C.mudancasDePolitica(antes, depois), [
    { conta: null, campo: 'autoApproveAll', de: true, para: false },
    { conta: 'trabalho', campo: 'onClean', de: null, para: 'wait' },
  ]);
});

test('a origem da mudança diz se veio da janela do Farol ou de um navegador', () => {
  assert.equal(C.origemDaRequisicao('Mozilla/5.0 Chrome/140 Electron/38.0.0 Safari/537'), 'janela do Farol');
  assert.equal(C.origemDaRequisicao('Mozilla/5.0 (Linux; Android 14) Chrome/140 Mobile'), 'navegador');
  assert.equal(C.origemDaRequisicao(''), 'desconhecida');
});

test('editar pelo engine grava a config, registra o rastro e o motivo do gate diz quando', () => {
  const e = new Engine();
  const r = e.editarConta({ tipo: 'editar', user: 'trabalho', campos: { onClean: 'wait', color: '#abcdef' } }, 'navegador');
  assert.equal(r.ok, true);
  const salva = JSON.parse(fs.readFileSync(path.join(process.env.FAROL_HOME, 'config.json'), 'utf8'));
  const conta = salva.accounts.find((a) => a.user === 'trabalho');
  assert.equal(conta.onClean, 'wait');
  assert.equal(conta.budgetWeight, 2, 'a edição não apagou o peso');
  const hist = JSON.parse(fs.readFileSync(POLITICA_HISTORICO_FILE, 'utf8'));
  const ultima = hist[hist.length - 1];
  assert.equal(ultima.conta, 'trabalho');
  assert.equal(ultima.campo, 'onClean');
  assert.equal(ultima.para, 'wait');
  assert.equal(ultima.origem, 'navegador');
  assert.ok(Number(ultima.at) > 0);
  assert.equal(hist.filter((h) => h.campo === 'color').length, 0, 'cor não é política');
  const motivo = C.motivoDaPolitica(e, 'trabalho', true);
  assert.match(motivo, /manda aguardar/);
  assert.match(motivo, /definido em \d{2}\/\d{2} \d{2}:\d{2}, pelo navegador/, 'quem vê o card sabe quando e de onde veio');
});

test('o servidor é quem decide o que é valor válido: escolha fica, valor torto não entra', () => {
  // era o serializador da tela (accountSaveArray) que filtrava; a tela não manda mais a
  // lista, então a fronteira é o parseAccounts do servidor, que saneia toda gravação
  const e = new Engine();
  e.editarConta({ tipo: 'editar', user: 'pessoal', campos: { autoReview: false, onReject: 'merge' } }, 'navegador');
  const conta = e.config.accounts.find((a) => a.user === 'pessoal');
  assert.equal(conta.autoReview, false, 'false é escolha, não ausência');
  assert.equal('onReject' in conta, false, 'valor fora do domínio não é gravado');
});

test('o padrão geral mudado pela tela de Automação também entra no rastro', () => {
  const e = new Engine();
  e.updateSettings({ autoApproveAll: false }, 'janela do Farol');
  const hist = JSON.parse(fs.readFileSync(POLITICA_HISTORICO_FILE, 'utf8'));
  const ultima = hist[hist.length - 1];
  assert.deepEqual([ultima.conta, ultima.campo, ultima.de, ultima.para, ultima.origem], [null, 'autoApproveAll', true, false, 'janela do Farol']);
});

test('o Diagnóstico mostra as mudanças recentes de política', () => {
  const e = new Engine();
  assert.match(e.diagnosticoMarkdown(), /Mudanças na política de automação/);
  assert.match(e.diagnosticoMarkdown(), /onClean/);
});

test('o rastro tem teto e não cresce para sempre', () => {
  const lista = Array.from({ length: C.TETO_DO_HISTORICO + 30 }, (_, i) => ({ at: i, conta: null, campo: 'autoReview', de: true, para: false }));
  assert.equal(C.aparar(lista).length, C.TETO_DO_HISTORICO);
  assert.equal(C.aparar(lista)[0].at, 30, 'sai o mais antigo');
});

test('apagar um perfil de IA limpa, no servidor, a conta que apontava para ele', () => {
  const e = new Engine();
  e.updateSettings({ claudeProfiles: [] }, 'janela do Farol');
  assert.equal('claudeProfileId' in e.config.accounts.find((a) => a.user === 'pessoal'), false);
});

/* ---------- a tela não salva mais a lista inteira ---------- */

test('voltar a herdar viaja como null, porque undefined some do JSON', () => {
  const campos = P.camposDaEdicao({ onClean: undefined, color: '#fff' });
  assert.deepEqual(JSON.parse(JSON.stringify(campos)), { onClean: null, color: '#fff' });
  assert.deepEqual(P.camposDaEdicao(null), {});
});

test('a tela edita conta por operação, e a exclusão de perfil não regrava as contas', () => {
  const contas = fs.readFileSync(path.join(RAIZ, 'ui', 'telas', 'sistema-contas.js'), 'utf8');
  assert.doesNotMatch(contas, /\/api\/settings/, 'editar conta mandando a lista inteira volta o defeito');
  assert.match(contas, /\/api\/accounts\/edit/);
  const perfis = fs.readFileSync(path.join(RAIZ, 'ui', 'telas', 'sistema-perfis.js'), 'utf8');
  assert.doesNotMatch(perfis, /patch\.accounts\s*=/, 'o servidor limpa o perfil órfão; a tela não manda contas');
});
