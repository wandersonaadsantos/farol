// Repetir, iniciar e designar admin pela tela: a parte PURA (quando cada ação existe, o
// motivo quando não existe, e o texto do diálogo). O caminho inteiro, com os dois engines,
// está em test/sync-comandos-tela.test.js.
process.env.TZ = 'America/Sao_Paulo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acoesDaRevisao, acoesDoCandidato, aparelhosDesignacaoPendente, aparelhosDesignarAcao,
  aparelhosDesignarConfirmacao, aparelhosListaHtml, candidatosDoConjuntoHtml, comandosEmitidosHtml,
  inicioConfirmacao, inicioDialogo, repetirConfirmacao, revisoesCompartilhadasHtml,
} from '../ui/pure.js';

const TAG_PR = 'a'.repeat(32);
const TAG_MAT = 'c'.repeat(32);
const SEM_ADMIN = 'só o aparelho admin emite comandos, e este não é o admin';

/* ---------- repetir ---------- */

const REV = { reviewId: 'r1', t: 1, dev: 'dOutro', aparelho: 'Desktop antigo', status: 'posted', veredito: 'approve', prTag: TAG_PR, matTag: TAG_MAT };

test('repetir: pode com admin fresco e com o PR e o commit no índice', () => {
  assert.deepEqual(acoesDaRevisao(REV, { podeComandar: true }).repetir, { pode: true, motivo: '' });
});

test('repetir: cada falta tem o seu motivo, e sem admin o motivo é o do admin', () => {
  assert.deepEqual(acoesDaRevisao(REV, { podeComandar: false, motivoSemComando: SEM_ADMIN }).repetir, { pode: false, motivo: SEM_ADMIN });
  assert.match(acoesDaRevisao({ ...REV, matTag: '' }, { podeComandar: true }).repetir.motivo, /antes de o commit entrar no índice/);
  assert.match(acoesDaRevisao({ ...REV, prTag: '' }, { podeComandar: true }).repetir.motivo, /não identifica o PR/);
  assert.match(acoesDaRevisao({ ...REV, dev: '' }, { podeComandar: true }).repetir.motivo, /de qual aparelho/);
  assert.equal(acoesDaRevisao(REV, {}).repetir.pode, false, 'sem contexto, nada é oferecido');
});

test('repetir: a linha da revisão leva o botão com as tags, ou a nota com o motivo', () => {
  const com = revisoesCompartilhadasHtml({ estado: 'lista', revisoes: [REV], podeComandar: true, deviceIdLocal: 'dEu' });
  assert.match(com, /class="btn sm ghost md-repetir" data-review="r1" data-dev="dOutro" data-prtag="a{32}" data-mattag="c{32}">Repetir</);
  const sem = revisoesCompartilhadasHtml({ estado: 'lista', revisoes: [{ ...REV, matTag: '' }], podeComandar: true });
  assert.doesNotMatch(sem, /md-repetir/);
  assert.match(sem, /Repetir: indisponível, esta revisão foi publicada antes/);
  const semAdmin = revisoesCompartilhadasHtml({ estado: 'lista', revisoes: [REV], podeComandar: false, motivoSemComando: SEM_ADMIN });
  assert.match(semAdmin, /Repetir: indisponível, só o aparelho admin emite comandos/);
});

test('repetir: a confirmação diz quem aplica, que o commit é o mesmo e que nada é postado pelo comando', () => {
  const c = repetirConfirmacao({ aparelho: 'Desktop antigo', pr: '' });
  assert.equal(c.title, 'Repetir a análise no Desktop antigo?');
  assert.match(c.body, /sobre o mesmo commit/);
  assert.match(c.body, /recusa o pedido/);
  assert.match(c.body, /Nada é postado por causa deste comando/);
});

/* ---------- iniciar ---------- */

const CAND = {
  itemId: `${TAG_PR}_${TAG_MAT}`, prTag: TAG_PR, matTag: TAG_MAT, owner: 'acme-exemplo', desde: 1000,
  publicadores: ['dOutro'], atribuido: null, pr: { key: 'acme-exemplo/app-web#51', account: 'alice', title: 'Corrige o cabeçalho', author: 'bruno' },
};
const DEVICES = [{ deviceId: 'dEu', name: 'Notebook de teste' }, { deviceId: 'dOutro', name: 'Desktop antigo' }];

test('iniciar: pode com admin fresco, tags e publicador, sem atribuição viva', () => {
  assert.deepEqual(acoesDoCandidato(CAND, { podeComandar: true }).iniciar, { pode: true, motivo: '' });
});

test('iniciar: sem admin, sem tags, sem publicador ou com atribuição viva não é oferecido, com o motivo', () => {
  assert.equal(acoesDoCandidato(CAND, { podeComandar: false, motivoSemComando: SEM_ADMIN }).iniciar.motivo, SEM_ADMIN);
  assert.match(acoesDoCandidato({ ...CAND, matTag: '' }, { podeComandar: true }).iniciar.motivo, /não identifica o PR e o commit/);
  assert.match(acoesDoCandidato({ ...CAND, publicadores: [] }, { podeComandar: true }).iniciar.motivo, /nenhum aparelho publicou/);
  const viva = acoesDoCandidato({ ...CAND, atribuido: { dev: 'dOutro', ate: 9 } }, { podeComandar: true, devices: DEVICES }).iniciar;
  assert.deepEqual(viva, { pode: false, motivo: 'o distribuidor já escolheu Desktop antigo e espera ele aceitar' });
});

test('iniciar: a lista do conjunto nomeia o PR pelo catálogo, ou o owner sem inventar endereço', () => {
  const html = candidatosDoConjuntoHtml([CAND], { podeComandar: true, devices: DEVICES, agora: 61000 });
  assert.match(html, /md-iniciar" data-item="a{32}_c{32}"/);
  assert.match(html, /acme-exemplo\/app-web#51/);
  assert.match(html, /Corrige o cabeçalho/);
  assert.match(html, /esperando há 1m</);
  assert.match(html, /1 aparelho pode executar/);
  const semNome = candidatosDoConjuntoHtml([{ ...CAND, pr: null }], { podeComandar: true });
  assert.match(semNome, /Um PR de acme-exemplo, sem nome nesta tela/);
  assert.doesNotMatch(semNome, /app-web#51/);
  assert.equal(candidatosDoConjuntoHtml([], {}), '', 'fila vazia não desenha nada');
  assert.equal(candidatosDoConjuntoHtml(undefined, {}), '');
  const semAdmin = candidatosDoConjuntoHtml([CAND], { podeComandar: false, motivoSemComando: SEM_ADMIN });
  assert.doesNotMatch(semAdmin, /md-iniciar/);
  assert.match(semAdmin, /Começar agora: indisponível, só o aparelho admin/);
});

const DESTINOS = {
  ok: true, itemId: CAND.itemId,
  destinos: [
    { deviceId: 'dOutro', nome: 'Desktop antigo', apto: true, motivo: '', souEu: false },
    { deviceId: 'dEu', nome: 'Notebook de teste', apto: false, motivo: 'nao-publicou', souEu: true },
    { deviceId: 'dVelho', nome: 'Celular antigo', apto: false, motivo: 'versao-antiga', souEu: false },
  ],
};

test('iniciar: o diálogo oferece só quem publicou e está apto, e explica os outros', () => {
  const d = inicioDialogo(DESTINOS, CAND);
  assert.equal(d.pode, true);
  assert.deepEqual(d.aptos, ['dOutro']);
  assert.deepEqual(d.opcoes.map((o) => o.valor), ['dOutro']);
  assert.equal(d.titulo, 'Começar acme-exemplo/app-web#51 agora');
  assert.match(d.corpo, /este aparelho \(Notebook de teste\).*não publicou este candidato/s);
  assert.match(d.corpo, /Celular antigo.*versão antiga/s);
  assert.match(d.corpo, /se ele mudou desde esta tela, o pedido é recusado/);
});

test('iniciar: leitura que falhou e nenhum apto fecham o diálogo, com o motivo', () => {
  assert.equal(inicioDialogo(null, CAND).pode, false);
  assert.equal(inicioDialogo({ ok: false, code: 'indisponivel' }, CAND).titulo, 'Aparelhos indisponíveis');
  const nenhum = inicioDialogo({ ok: true, destinos: [{ ...DESTINOS.destinos[0], apto: false, motivo: 'sem-vaga' }] }, CAND);
  assert.equal(nenhum.pode, false);
  assert.deepEqual(nenhum.aptos, []);
  assert.match(nenhum.corpo, /Desktop antigo.*sem vaga/s);
});

test('iniciar: a confirmação diz para onde, que fura o rodízio e que o desfecho é o recibo', () => {
  const c = inicioConfirmacao({ destino: 'Desktop antigo', pr: 'acme-exemplo/app-web#51' });
  assert.equal(c.title, 'Começar no Desktop antigo?');
  assert.match(c.body, /acme-exemplo\/app-web#51 sai da espera/);
  assert.match(c.body, /sem esperar a vez do rodízio/);
  assert.match(c.body, /recibo/);
});

/* ---------- designar admin ---------- */

const OUTRO = { deviceId: 'dOutro', name: 'Desktop antigo', contract: 2, keyReady: true, lastSeenAt: 1, retiredAt: 0, semPresenca: false, euMesmo: false };

test('designar: só o admin fresco, só para outro aparelho vivo, não aposentado e na versão atual', () => {
  assert.deepEqual(aparelhosDesignarAcao(OUTRO, { souAdmin: true }), { pode: true, motivo: '' });
  assert.match(aparelhosDesignarAcao(OUTRO, { souAdmin: false }).motivo, /só o aparelho admin, com sinal fresco/);
  assert.equal(aparelhosDesignarAcao({ ...OUTRO, euMesmo: true }, { souAdmin: true }).pode, false);
  assert.equal(aparelhosDesignarAcao({ ...OUTRO, retiredAt: 5 }, { souAdmin: true }).motivo, 'aparelho aposentado');
  assert.match(aparelhosDesignarAcao({ ...OUTRO, semPresenca: true }, { souAdmin: true }).motivo, /sem presença recente/);
  assert.match(aparelhosDesignarAcao({ ...OUTRO, contract: 1 }, { souAdmin: true }).motivo, /versão antiga/);
  assert.match(aparelhosDesignarAcao({ ...OUTRO, keyReady: false }, { souAdmin: true }).motivo, /sem a chave/);
});

test('designar: o botão aparece na linha só para o admin, e o motivo aparece quando não cabe', () => {
  const lista = [{ ...OUTRO }, { ...OUTRO, deviceId: 'dAposentado', name: 'Tablet', retiredAt: 5 }, { deviceId: 'dEu', name: 'Notebook', euMesmo: true, contract: 2, keyReady: true }];
  const admin = aparelhosListaHtml(lista, { souAdmin: true, agora: 10 });
  assert.match(admin, /data-apar-designar="dOutro">Designar como admin</);
  assert.doesNotMatch(admin, /data-apar-designar="dAposentado"/);
  assert.match(admin, /designar: aparelho aposentado/);
  assert.doesNotMatch(admin, /data-apar-designar="dEu"/);
  const secundario = aparelhosListaHtml(lista, { souAdmin: false, agora: 10 });
  assert.doesNotMatch(secundario, /data-apar-designar/);
  assert.doesNotMatch(secundario, /designar:/, 'quem não é admin não lê motivo de um ato que não é dele');
});

test('designar: a confirmação diz que a senha é digitada lá, e o que não acontece aqui', () => {
  const c = aparelhosDesignarConfirmacao('Desktop antigo');
  assert.equal(c.title, 'Designar o Desktop antigo como admin?');
  assert.match(c.body, /só quando alguém digitar a senha da sincronização lá/);
  assert.match(c.body, /nenhuma geração nova é criada daqui/);
  assert.match(c.body, /nenhuma senha é pedida neste aparelho/);
});

test('designar: pendente até o recibo; recusado e ignorado aparecem; aplicado some', () => {
  const cmd = { cmdId: 'f'.repeat(32), tipo: 'designar-admin', alvo: 'dOutro', at: 1, vence: 2 };
  assert.match(aparelhosDesignacaoPendente([cmd], {}, 'dOutro'), /designação pendente/);
  assert.equal(aparelhosDesignacaoPendente([cmd], {}, 'dEu'), '', 'o pedido é do aparelho alvo');
  assert.match(aparelhosDesignacaoPendente([cmd], { [cmd.cmdId]: { estado: 'recusado', code: 'recusado_no_aparelho' } }, 'dOutro'), /recusou ser admin/);
  assert.match(aparelhosDesignacaoPendente([cmd], { [cmd.cmdId]: { estado: 'ignorado', code: 'autoridade' } }, 'dOutro'), /ignorou a designação/);
  assert.equal(aparelhosDesignacaoPendente([cmd], { [cmd.cmdId]: { estado: 'aplicado' } }, 'dOutro'), '');
  assert.equal(aparelhosDesignacaoPendente([{ ...cmd, tipo: 'cancelar' }], {}, 'dOutro'), '');
  const html = aparelhosListaHtml([OUTRO], { souAdmin: true, comandosEmitidos: [cmd], recibos: {} });
  assert.match(html, /designação pendente/);
});

test('os códigos novos dos recibos têm texto: nada vira "código x" na lista de comandos', () => {
  const lista = ['nao_publiquei', 'nao_enfileirou', 'duplicado', 'saida-de-cena', 'recusado_no_aparelho'].map((code, i) => ({ cmdId: String(i).repeat(32), tipo: 'repetir', alvo: 'dOutro', at: 1 }));
  const recibos = Object.fromEntries(lista.map((c, i) => [c.cmdId, { estado: 'recusado', code: ['nao_publiquei', 'nao_enfileirou', 'duplicado', 'saida-de-cena', 'recusado_no_aparelho'][i], at: 1 }]));
  const html = comandosEmitidosHtml(lista, recibos, { devices: DEVICES, agora: 5 });
  assert.doesNotMatch(html, /código /);
  assert.match(html, /não publicou este item/);
  assert.match(html, /já havia uma análise deste PR/);
  assert.match(html, /recusado por quem está naquele aparelho/);
});
