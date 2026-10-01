// A política de revisar e de aprovar mora SÓ na conta (30/09/2026).
//
// Pedido do dono: "Preciso que não exista mais sobreposição de configurações". As chaves
// gerais `autoReview` e `autoApproveAll` eram o padrão que cada conta podia sobrescrever, e
// para saber o que uma conta fazia era preciso ler Automação, Contas e lembrar de uma regra
// implícita. A migração escreve em cada conta o que ela JÁ fazia e descarta as chaves.
//
// O que estes casos travam: a migração não muda o que nenhuma conta faz (com UMA exceção
// declarada, que só restringe), é idempotente, não perde o `autoReview: false` de uma
// instância de teste que ainda não tem conta, e fica registrada uma vez só.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-migracao-'));
const CONFIG = path.join(process.env.FAROL_HOME, 'config.json');
fs.writeFileSync(CONFIG, JSON.stringify({
  port: 47197, autoReview: false, autoApproveAll: true, updateRepo: '',
  accounts: [
    { user: 'herda', owners: ['org1'] },
    { user: 'propria', owners: ['org2'], autoReview: true, onClean: 'approve', onCaveats: 'wait', onReject: 'request_changes' },
    { user: 'cautelosa', owners: ['org3'], onClean: 'wait' },
  ],
}));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const M = (await import('../lib/engine/contas-migracao.js')).default;
const C = (await import('../lib/engine/contas-config.js')).default;
const { EDITAVEIS, SETTINGS } = await import('../lib/settings.js');
const { Engine } = await import('../server.js');
const { POLITICA_HISTORICO_FILE } = await import('../lib/paths.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const lerJson = (arquivo) => JSON.parse(fs.readFileSync(arquivo, 'utf8'));

/* ---------- a tabela: o que cada conta fazia antes é o que ela faz depois ---------- */

// A regra ANTIGA, escrita aqui como era em lib/engine/contas-config.js até 30/09/2026
// (revisaSozinho, acaoAoAprovar e acaoAoReprovar com SEGUE_A_CHAVE_GERAL). A config em
// memória era `{ ...padrões, ...arquivo }`, com `autoReview: true` e `autoApproveAll: false`.
function antes(geral, conta) {
  const cfg = { autoReview: true, autoApproveAll: false, ...geral };
  const escolheuRevisao = conta.autoReview === true || conta.autoReview === false;
  const segueRessalva = !conta.onCaveats && conta.onClean !== 'wait';
  let ressalva = conta.onCaveats || 'wait';
  if (segueRessalva) ressalva = cfg.autoApproveAll !== false ? 'approve' : 'wait';
  return {
    revisa: escolheuRevisao ? conta.autoReview : cfg.autoReview !== false,
    limpo: conta.onClean || 'approve',
    ressalva,
    reprova: conta.onReject === 'request_changes' ? 'request_changes' : 'wait',
  };
}

// O que o engine responde hoje, com a config que a migração devolveu.
function depois(geral, conta) {
  const r = M.migrarPolitica({ ...geral, accounts: [{ user: 'x', owners: [], ...conta }] });
  const e = { config: {}, accountList: () => r.contas };
  return {
    revisa: C.revisaSozinho(e, 'x'), limpo: C.acaoAoAprovar(e, 'x', true),
    ressalva: C.acaoAoAprovar(e, 'x', false), reprova: C.acaoAoReprovar(e, 'x'),
  };
}

function combinacoes(eixos) {
  return eixos.reduce((acc, [chave, valores]) => acc.flatMap((o) => valores.map((v) => (v === undefined ? o : { ...o, [chave]: v }))), [{}]);
}

const GERAIS = combinacoes([['autoReview', [undefined, true, false]], ['autoApproveAll', [undefined, true, false]]]);
const CONTAS = combinacoes([
  ['autoReview', [undefined, true, false]], ['onClean', [undefined, 'approve', 'wait']],
  ['onCaveats', [undefined, 'approve', 'wait']], ['onReject', [undefined, 'wait', 'request_changes']],
]);

test('a tabela inteira: 729 combinações de chave geral e de conta fazem depois o que faziam antes', () => {
  assert.equal(GERAIS.length * CONTAS.length, 729);
  const divergentes = [];
  for (const geral of GERAIS) {
    for (const conta of CONTAS) {
      const a = antes(geral, conta);
      const d = depois(geral, conta);
      if (JSON.stringify(a) !== JSON.stringify(d)) divergentes.push({ geral, conta, a, d });
    }
  }
  // A ÚNICA diferença, declarada em lib/engine/contas-migracao.js: conta com o limpo
  // esperando você e o com ressalvas aprovando por escolha própria. Ela passa a esperar nos
  // dois, porque o com ressalvas nunca é mais permissivo que o limpo.
  for (const { geral, conta, a, d } of divergentes) {
    const rotulo = `${JSON.stringify(conta)} com geral ${JSON.stringify(geral)}`;
    assert.equal(conta.onClean, 'wait', rotulo);
    assert.equal(conta.onCaveats, 'approve', rotulo);
    assert.deepEqual({ ...a, ressalva: 'wait' }, d, `${rotulo}: só o com ressalvas muda, e para o lado que espera`);
    assert.equal(a.ressalva, 'approve', rotulo);
  }
  const daExcecao = GERAIS.length * CONTAS.filter((c) => c.onClean === 'wait' && c.onCaveats === 'approve').length;
  assert.equal(divergentes.length, daExcecao, 'toda combinação da exceção diverge, e nenhuma outra');
  assert.equal(daExcecao, 81);
});

test('nenhuma combinação fica mais permissiva depois da migração', () => {
  for (const geral of GERAIS) {
    for (const conta of CONTAS) {
      const a = antes(geral, conta);
      const d = depois(geral, conta);
      const rotulo = `${JSON.stringify(conta)} com geral ${JSON.stringify(geral)}`;
      assert.ok(a.revisa || !d.revisa, `${rotulo}: não passa a revisar sozinha`);
      assert.ok(a.limpo === 'approve' || d.limpo === 'wait', `${rotulo}: não passa a aprovar o limpo`);
      assert.ok(a.ressalva === 'approve' || d.ressalva === 'wait', `${rotulo}: não passa a aprovar com ressalvas`);
      assert.ok(a.reprova === 'request_changes' || d.reprova === 'wait', `${rotulo}: não passa a reprovar sozinha`);
    }
  }
});

test('a chave geral torta é lida como o engine lia: só `false` desligava', () => {
  // `autoApproveAll: null` no arquivo sobrescrevia o padrão e `null !== false` aprovava
  assert.equal(depois({ autoApproveAll: null }, {}).ressalva, 'approve');
  assert.equal(depois({ autoApproveAll: 0 }, {}).ressalva, 'approve');
  assert.equal(depois({}, {}).ressalva, 'wait', 'ausente cai no padrão, que era desligado');
  assert.equal(depois({ autoReview: null }, {}).revisa, true);
  assert.equal(depois({ autoReview: false }, {}).revisa, false);
});

/* ---------- o que a migração grava ---------- */

test('cada conta sai com os quatro campos por extenso, e as chaves gerais são descartadas', () => {
  const r = M.migrarPolitica({
    autoReview: false, autoApproveAll: true,
    accounts: [{ user: 'a', owners: ['o'], label: 'A', budgetWeight: 2 }, { user: 'b', owners: [], onClean: 'wait' }],
  });
  assert.equal(r.mudou, true);
  assert.deepEqual(r.descartar, ['autoReview', 'autoApproveAll']);
  assert.deepEqual(r.contas, [
    { user: 'a', owners: ['o'], label: 'A', budgetWeight: 2, autoReview: false, onClean: 'approve', onCaveats: 'approve', onReject: 'wait' },
    { user: 'b', owners: [], onClean: 'wait', autoReview: false, onCaveats: 'wait', onReject: 'wait' },
  ]);
});

test('conta nova, sem chave geral nenhuma, nasce com o padrão estrito', () => {
  const r = M.migrarPolitica({ accounts: [{ user: 'nova', owners: [] }] });
  assert.deepEqual(r.contas[0], { user: 'nova', owners: [], autoReview: true, onClean: 'approve', onCaveats: 'wait', onReject: 'wait' });
  assert.deepEqual(M.PADRAO, { autoReview: true, onClean: 'approve', onCaveats: 'wait', onReject: 'wait' });
});

test('idempotente: config já migrada sai idêntica e diz que não mudou', () => {
  for (const geral of GERAIS) {
    const original = { port: 1, ...geral, accounts: CONTAS.slice(0, 40).map((c, i) => ({ user: `u${i}`, owners: [], ...c })) };
    const um = M.migrarPolitica(original);
    const migrada = { port: 1, accounts: um.contas };
    const dois = M.migrarPolitica(migrada);
    assert.equal(dois.mudou, false);
    assert.deepEqual(dois.contas, um.contas);
    assert.deepEqual(dois.descartar, []);
    assert.deepEqual(dois.mudancas, []);
  }
});

test('a migração não toca na config recebida', () => {
  const config = { autoReview: false, accounts: [{ user: 'a', owners: [] }] };
  const copia = JSON.parse(JSON.stringify(config));
  M.migrarPolitica(config);
  assert.deepEqual(config, copia);
});

test('o rastro diz, campo a campo, o que deixou de ser herdado', () => {
  const r = M.migrarPolitica({ autoApproveAll: true, accounts: [{ user: 'a', owners: [], onClean: 'approve' }] });
  assert.deepEqual(r.mudancas, [
    { conta: null, campo: 'autoApproveAll', de: true, para: null },
    { conta: 'a', campo: 'autoReview', de: null, para: true },
    { conta: 'a', campo: 'onCaveats', de: null, para: 'approve' },
    { conta: 'a', campo: 'onReject', de: null, para: 'wait' },
  ]);
});

/* ---------- modo simples e instância de teste sem conta ---------- */

test('o modo simples (ghUser + owners) vira conta na lista, com a mesma identidade', () => {
  const r = M.migrarPolitica({ ghUser: ' eu ', owners: ['org', ' '], autoReview: false });
  assert.equal(r.mudou, true);
  assert.deepEqual(r.contas, [{ user: 'eu', owners: ['org'], autoReview: false, onClean: 'approve', onCaveats: 'wait', onReject: 'wait' }]);
  assert.deepEqual(r.descartar, ['autoReview']);
});

// O `{"port": 47180, "autoReview": false}` das instâncias de teste: descartar a chave antes
// de existir conta faria a instância revisar sozinha na conta real de quem a abriu.
test('sem conta nenhuma, as chaves antigas ficam esperando a conta ser detectada', () => {
  const semConta = { port: 47180, autoReview: false };
  const r = M.migrarPolitica(semConta);
  assert.equal(r.mudou, false);
  assert.deepEqual(r.descartar, [], 'a chave não é descartada antes de valer para alguém');
  const comConta = M.migrarPolitica({ ...semConta, ghUser: 'detectada', owners: ['biudtech'] });
  assert.equal(comConta.contas[0].autoReview, false);
  assert.deepEqual(comConta.descartar, ['autoReview']);
});

/* ---------- no engine: carga da config, gravação e rastro ---------- */

test('a carga da config migra, grava o arquivo sem as chaves gerais e registra uma vez', () => {
  const e = new Engine();
  assert.equal('autoReview' in e.config, false);
  assert.equal('autoApproveAll' in e.config, false);
  const salva = lerJson(CONFIG);
  assert.equal('autoReview' in salva, false, 'a chave geral sai do arquivo');
  assert.equal('autoApproveAll' in salva, false);
  const porConta = Object.fromEntries(salva.accounts.map((a) => [a.user, [a.autoReview, a.onClean, a.onCaveats, a.onReject]]));
  assert.deepEqual(porConta, {
    herda: [false, 'approve', 'approve', 'wait'],
    propria: [true, 'approve', 'wait', 'request_changes'],
    cautelosa: [false, 'wait', 'wait', 'wait'],
  });
  // o que o engine decide é o que a conta fazia: `herda` seguia as duas chaves gerais
  assert.equal(e.autoReviewFor('herda'), false);
  assert.equal(e.approvePolicyFor('herda', false), 'approve');
  assert.equal(e.autoReviewFor('propria'), true);
  assert.equal(e.approvePolicyFor('cautelosa', false), 'wait');
  const hist = lerJson(POLITICA_HISTORICO_FILE);
  assert.ok(hist.length > 0);
  assert.ok(hist.every((h) => h.origem === 'migração'));
  assert.deepEqual(hist.filter((h) => h.conta === null).map((h) => [h.campo, h.de, h.para]), [['autoReview', false, null], ['autoApproveAll', true, null]]);
  assert.equal(hist.filter((h) => h.conta === 'propria').length, 0, 'conta que já tinha tudo escrito não muda');

  // segundo boot: nada a migrar, nada a registrar, arquivo igual
  const antesDoSegundo = fs.readFileSync(CONFIG, 'utf8');
  const e2 = new Engine();
  assert.equal(lerJson(POLITICA_HISTORICO_FILE).length, hist.length, 'a migração fica registrada uma vez só');
  assert.equal(fs.readFileSync(CONFIG, 'utf8'), antesDoSegundo);
  assert.equal(e2.autoReviewFor('herda'), false);
});

test('o motivo do gate diz que o valor veio da migração, com a data', () => {
  const e = new Engine();
  assert.match(C.motivoDaPolitica(e, 'cautelosa', false), /o "sem ressalvas" da conta .* espera você, então o com ressalvas também espera/);
  e.editarConta({ tipo: 'editar', user: 'herda', campos: { onCaveats: 'wait' } }, 'navegador');
  e.politicaHistorico = [{ at: Date.now(), conta: 'herda', campo: 'onCaveats', de: null, para: 'wait', origem: 'migração' }];
  assert.match(C.motivoDaPolitica(e, 'herda', false), /definido em \d{2}\/\d{2} \d{2}:\d{2}, quando a política passou das chaves gerais para a conta/);
});

test('as chaves gerais deixaram de ser preferência: a tabela não as tem e a rota as devolve como ignoradas', () => {
  for (const chave of M.CHAVES_GERAIS_ANTIGAS) {
    assert.equal(EDITAVEIS.has(chave), false, chave);
    assert.equal(SETTINGS.some((s) => s.key === chave), false, `${chave} não tem padrão`);
  }
  const e = new Engine();
  const r = e.updateSettings({ autoReview: true, autoApproveAll: true }, 'navegador');
  assert.deepEqual(r.ignoradas.sort(), ['autoApproveAll', 'autoReview']);
  assert.equal(e.autoReviewFor('herda'), false, 'a chave geral não alcança mais conta nenhuma');
  assert.equal('autoReview' in e.config, false);
});

test('conta adicionada depois nasce com a política por extenso, e o rastro leva a origem da tela', () => {
  const e = new Engine();
  const r = e.editarConta({ tipo: 'adicionar', user: 'recente', owners: ['org9'] }, 'janela do Farol');
  assert.equal(r.ok, true);
  const conta = lerJson(CONFIG).accounts.find((a) => a.user === 'recente');
  assert.deepEqual([conta.autoReview, conta.onClean, conta.onCaveats, conta.onReject], [true, 'approve', 'wait', 'wait']);
  const hist = lerJson(POLITICA_HISTORICO_FILE).filter((h) => h.conta === 'recente');
  assert.ok(hist.length > 0);
  assert.ok(hist.every((h) => h.origem === 'janela do Farol'));
  e.editarConta({ tipo: 'remover', user: 'recente' }, 'janela do Farol');
});

test('lista de contas gravada por outro caminho também sai com a política por extenso', () => {
  const e = new Engine();
  const atuais = e.config.accounts;
  e.updateSettings({ accounts: [...atuais, { user: 'crua', owners: [] }] }, 'navegador');
  const crua = e.config.accounts.find((a) => a.user === 'crua');
  assert.deepEqual([crua.autoReview, crua.onClean, crua.onCaveats, crua.onReject], [true, 'approve', 'wait', 'wait']);
  e.updateSettings({ accounts: atuais }, 'navegador');
});

/* ---------- o com ressalvas nunca é mais permissivo que o limpo, na escrita ---------- */

const BASE = [{ user: 'a', owners: [], autoReview: true, onClean: 'approve', onCaveats: 'approve', onReject: 'wait' }];

test('pôr o sem ressalvas em espera põe o com ressalvas em espera junto', () => {
  const r = C.aplicarEdicao(BASE, { tipo: 'editar', user: 'a', campos: { onClean: 'wait' } });
  assert.equal(r.ok, true);
  assert.equal(r.contas[0].onClean, 'wait');
  assert.equal(r.contas[0].onCaveats, 'wait');
});

test('pedir aprovação com ressalvas em conta cujo limpo espera é recusado, com o motivo', () => {
  const espera = [{ ...BASE[0], onClean: 'wait', onCaveats: 'wait' }];
  const r = C.aplicarEdicao(espera, { tipo: 'editar', user: 'a', campos: { onCaveats: 'approve' } });
  assert.equal(r.ok, false);
  assert.match(r.erro, /o "sem ressalvas" de @a espera você/);
  // as duas juntas, voltando o limpo a aprovar, é escolha válida
  const junto = C.aplicarEdicao(espera, { tipo: 'editar', user: 'a', campos: { onClean: 'approve', onCaveats: 'approve' } });
  assert.equal(junto.ok, true);
  assert.equal(junto.contas[0].onCaveats, 'approve');
});

test('leitura de conta com o par proibido gravado à mão ainda espera', () => {
  const e = { config: {}, accountList: () => [{ user: 'a', owners: [], onClean: 'wait', onCaveats: 'approve' }] };
  assert.equal(C.acaoAoAprovar(e, 'a', false), 'wait');
  assert.equal(C.acaoAoAprovar(e, 'a', true), 'wait');
});

/* ---------- Conexões continua editando a conta única ---------- */

test('com uma conta só, os campos de Conexões (conta e organizações) editam essa conta', () => {
  const politica = { autoReview: false, onClean: 'approve', onCaveats: 'wait', onReject: 'wait' };
  const e = { config: { ghUser: 'eu', owners: ['org', 'outra'], accounts: [{ user: 'eu', owners: ['org'], ...politica }] }, politicaHistorico: [], log() {} };
  C.depoisDeAplicar(e, C.retratoDaPolitica(e.config), { owners: ['org', 'outra'] }, 'navegador');
  assert.deepEqual(e.config.accounts[0].owners, ['org', 'outra']);
  assert.equal(e.config.accounts[0].autoReview, false, 'a política fica na conta');
  e.config.ghUser = 'outro-login';
  C.depoisDeAplicar(e, C.retratoDaPolitica(e.config), { ghUser: 'outro-login' }, 'navegador');
  assert.equal(e.config.accounts[0].user, 'outro-login');
  // com duas contas, Conexões não é de nenhuma delas
  e.config.accounts = [...e.config.accounts, { user: 'b', owners: ['b-org'], ...politica }];
  e.config.owners = ['x'];
  C.depoisDeAplicar(e, C.retratoDaPolitica(e.config), { owners: ['x'] }, 'navegador');
  assert.deepEqual(e.config.accounts.map((a) => a.owners), [['org', 'outra'], ['b-org']]);
});
