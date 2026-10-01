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

// Cada linha é uma combinação dos seletores de Sistema > Contas e o que o Farol precisa fazer
// com ela. Desde 30/09/2026 a conta é o ÚNICO endereço: as chaves gerais de Automação
// deixaram de existir, e o que está na config em memória com esses nomes não muda nada
// (as duas colunas do meio são essa prova: o resultado é o mesmo com elas em qualquer valor).
const MATRIZ = [
  // conta,                                      limpo, com ressalvas
  [{}, 'approve', 'wait'],
  [{ onClean: 'approve', onCaveats: 'approve' }, 'approve', 'approve'],
  [{ onClean: 'approve', onCaveats: 'wait' }, 'approve', 'wait'],
  [{ onClean: 'wait' }, 'wait', 'wait'],
  [{ onClean: 'wait', onCaveats: 'wait' }, 'wait', 'wait'],
  // até 30/09/2026 esta linha aprovava com ressalvas: a escolha própria passava por cima do
  // limpo. Agora o com ressalvas nunca é mais permissivo que o limpo, sem exceção.
  [{ onClean: 'wait', onCaveats: 'approve' }, 'wait', 'wait'],
];

test('a política de aprovação vem só da conta, e o com ressalvas nunca é mais permissivo que o limpo', () => {
  for (const [conta, limpo, ressalva] of MATRIZ) {
    for (const geral of [true, false, undefined]) {
      const e = { config: { autoApproveAll: geral, autoReview: geral }, accountList: () => [{ user: 'x', owners: [], ...conta }] };
      const rotulo = `${JSON.stringify(conta)} com a chave geral antiga em ${geral}`;
      assert.equal(C.acaoAoAprovar(e, 'X', true), limpo, `${rotulo}, sem ressalvas`);
      assert.equal(C.acaoAoAprovar(e, 'X', false), ressalva, `${rotulo}, com ressalvas`);
    }
  }
});

test('revisar sozinho e reprovar sozinho vêm só da conta, e nenhuma chave geral os alcança', () => {
  const e = (conta, autoReview) => ({ config: { autoReview }, accountList: () => [{ user: 'x', owners: [], ...conta }] });
  assert.equal(C.revisaSozinho(e({ autoReview: true }, false), 'x'), true, 'a chave geral antiga em false não desliga a conta');
  assert.equal(C.revisaSozinho(e({ autoReview: false }, true), 'x'), false, 'nem em true a liga');
  assert.equal(C.revisaSozinho(e({}, false), 'x'), true, 'campo ausente vale o padrão da conta nova, não a chave geral');
  assert.equal(C.acaoAoReprovar(e({ onReject: 'request_changes' }, true), 'x'), 'request_changes');
  assert.equal(C.acaoAoReprovar(e({}, true), 'x'), 'wait');
  assert.equal(C.acaoAoAprovar(e({}, true), 'conta-que-nao-existe', true), 'approve', 'conta desconhecida vale o padrão da conta nova');
  assert.equal(C.acaoAoAprovar(e({}, true), 'conta-que-nao-existe', false), 'wait');
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

test('valor vazio remove o campo; nos da política, a gravação o reescreve com o padrão', () => {
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

test('a diferença de política considera conta e chave geral, e ignora o que não é política', () => {
  const antes = C.retratoDaPolitica({ coAssinarReview: false, accounts: BASE });
  const depois = C.retratoDaPolitica({
    coAssinarReview: true,
    accounts: [{ ...BASE[0], color: '#fff', onClean: 'wait' }, BASE[1]],
  });
  assert.deepEqual(C.mudancasDePolitica(antes, depois), [
    { conta: null, campo: 'coAssinarReview', de: false, para: true },
    { conta: 'trabalho', campo: 'onClean', de: null, para: 'wait' },
  ]);
  // as chaves gerais que saíram em 30/09/2026 não são mais política geral
  const semChave = C.mudancasDePolitica(C.retratoDaPolitica({ autoReview: true, autoApproveAll: true, accounts: [] }), C.retratoDaPolitica({ autoReview: false, autoApproveAll: false, accounts: [] }));
  assert.deepEqual(semChave, []);
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
  const ultima = hist.filter((h) => h.campo === 'onClean').pop();
  assert.equal(ultima.conta, 'trabalho');
  assert.equal(ultima.campo, 'onClean');
  assert.equal(ultima.para, 'wait');
  assert.equal(ultima.origem, 'navegador');
  assert.ok(Number(ultima.at) > 0);
  // pôr o limpo em espera põe o com ressalvas junto, e isso também fica no rastro
  assert.equal(conta.onCaveats, 'wait');
  const ressalva = hist.filter((h) => h.campo === 'onCaveats' && h.conta === 'trabalho').pop();
  assert.deepEqual([ressalva.de, ressalva.para, ressalva.origem], ['approve', 'wait', 'navegador']);
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
  assert.equal(conta.onReject, 'wait', 'valor fora do domínio não é gravado: fica o padrão por extenso');
});

test('chave geral de Automação que continua sendo política também entra no rastro', () => {
  const e = new Engine();
  e.updateSettings({ coAssinarReview: true }, 'janela do Farol');
  const hist = JSON.parse(fs.readFileSync(POLITICA_HISTORICO_FILE, 'utf8'));
  const ultima = hist[hist.length - 1];
  assert.deepEqual([ultima.conta, ultima.campo, ultima.de, ultima.para, ultima.origem], [null, 'coAssinarReview', false, true, 'janela do Farol']);
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

test('tirar o valor de um campo viaja como null, porque undefined some do JSON', () => {
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
