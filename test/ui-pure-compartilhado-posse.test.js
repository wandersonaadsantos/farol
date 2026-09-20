// Transferência e tomada pela tela, parte pura (ui/pure/compartilhado-posse.js e o que
// mudou em ui/pure/compartilhado.js). Teste por SAÍDA: o que a tela afirma e o que ela
// deixa clicar.
//
// As garantias que este arquivo trava:
//   - a ação só fica utilizável quando o dado que ela exige chegou (commit, PR, destino);
//   - destino inapto aparece COM o motivo e nunca vira opção de envio;
//   - o nome do PR só aparece quando o catálogo abriu; sem ele, o rótulo é genérico;
//   - comando amarrado a um PR aparece no card daquele PR, e só nele.
process.env.TZ = 'America/Sao_Paulo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
const P = await import('../ui/pure.js');

const AGORA = Date.UTC(2026, 8, 16, 13, 0, 0);
const DEVICES = [{ deviceId: 'dEu', name: 'Notebook de teste', euMesmo: true }, { deviceId: 'dOutro', name: 'Desktop antigo' }, { deviceId: 'dCel', name: 'Celular de teste' }];
const PR = { key: 'acme-exemplo/app-web#41', account: 'alice', title: 'Ajusta o rodapé', author: 'bruno-exemplo' };
const OP = {
  opId: 'op1', dev: 'dOutro', aparelho: 'Desktop antigo', t0: AGORA, situacao: 'viva', etapa: 'leitura',
  msPorEtapa: { leitura: 60000 }, subagentes: [], modelo: 'opus', prTag: 'a'.repeat(32), acctTag: 'b'.repeat(32),
  matTag: 'c'.repeat(32), heranca: '', tipo: 'review', pr: PR,
};

function sync(extra = {}) {
  return { shared: true, deviceId: 'dEu', devices: DEVICES, distribuicao: { modo: 'distribuido', esperando: [] }, comandosEmitidos: [], ...extra };
}

/* ---------- ações da operação com o dado real ---------- */

test('acoesDaOperacao: com commit, tag e PR do catálogo, transferir e tomar ficam utilizáveis', () => {
  const a = P.acoesDaOperacao(OP, { podeComandar: true });
  assert.deepEqual(a.transferir, { pode: true, motivo: '' });
  assert.deepEqual(a.tomar, { pode: true, motivo: '' });
  const html = P.operacoesRemotasHtml([OP], { podeComandar: true });
  assert.match(html, /class="btn sm ghost md-transferir" data-op="op1" data-dev="dOutro"/);
  assert.match(html, /class="btn sm ghost md-tomar" data-op="op1" data-dev="dOutro"/);
});

test('acoesDaOperacao: transferir exige o commit, e tomar exige o commit e o PR em claro', () => {
  const semCommit = P.acoesDaOperacao({ ...OP, matTag: '' }, { podeComandar: true });
  assert.equal(semCommit.transferir.pode, false);
  assert.match(semCommit.transferir.motivo, /commit/);
  assert.equal(semCommit.tomar.pode, false);
  const semPr = P.acoesDaOperacao({ ...OP, pr: null }, { podeComandar: true });
  assert.equal(semPr.transferir.pode, true, 'transferir anda só com tags: o PR em claro não é exigido');
  assert.equal(semPr.tomar.pode, false);
  assert.match(semPr.tomar.motivo, /catálogo/);
  const semConta = P.acoesDaOperacao({ ...OP, pr: { ...PR, account: '' } }, { podeComandar: true });
  assert.equal(semConta.tomar.pode, false, 'o aviso da tomada precisa da conta');
  const semAdmin = P.acoesDaOperacao(OP, { podeComandar: false, motivoSemComando: 'este não é o admin' });
  assert.equal(semAdmin.transferir.pode, false);
  assert.equal(semAdmin.tomar.pode, false);
  assert.equal(semAdmin.transferir.motivo, 'este não é o admin');
});

test('operacoesRemotasHtml: o PR aparece pelo nome quando o catálogo abriu, e genérico quando não', () => {
  const com = P.operacoesRemotasHtml([OP], { podeComandar: true });
  assert.match(com, /href="https:\/\/github\.com\/acme-exemplo\/app-web\/pull\/41"/);
  assert.match(com, /Ajusta o rodapé/);
  const sem = P.operacoesRemotasHtml([{ ...OP, pr: null }], { podeComandar: true });
  assert.doesNotMatch(sem, /github\.com/);
  assert.match(sem, /Um PR seu, sem nome nesta tela/);
  // o autor sai com foto (menção navegável), então a prova do escape mira o título injetado
  const injetado = P.operacoesRemotasHtml([{ ...OP, pr: { ...PR, title: '<img src=x>' } }], {});
  assert.doesNotMatch(injetado, /<img src=x>/);
  assert.match(injetado, /&lt;img src=x&gt;/);
});

test('operacoesRemotasHtml: a herança da memória aparece quando o executor a decidiu', () => {
  assert.match(P.operacoesRemotasHtml([{ ...OP, heranca: 'integral' }], {}), /herdou a memória inteira/);
  assert.match(P.operacoesRemotasHtml([{ ...OP, heranca: 'parcial' }], {}), /herdou parte da memória/);
  assert.match(P.operacoesRemotasHtml([{ ...OP, heranca: 'reinicio' }], {}), /começou do zero/);
  assert.doesNotMatch(P.operacoesRemotasHtml([{ ...OP, heranca: '' }], {}), /herdou|começou do zero/);
  assert.doesNotMatch(P.operacoesRemotasHtml([{ ...OP, heranca: 'inventada' }], {}), /inventada/);
});

/* ---------- destinos da transferência ---------- */

const DESTINOS = {
  ok: true,
  origem: { deviceId: 'dOutro', motivo: '' },
  destinos: [
    { deviceId: 'dEu', nome: 'Notebook de teste', apto: true, motivo: '', souEu: true },
    { deviceId: 'dCel', nome: 'Celular de teste', apto: false, motivo: 'sem-credencial', souEu: false },
    { deviceId: 'dOutro', nome: 'Desktop antigo', apto: false, motivo: 'dono-atual', souEu: false },
    { deviceId: 'dVelho', nome: 'Tablet', apto: false, motivo: 'versao-antiga', souEu: false },
    { deviceId: 'dX', nome: 'Laptop', apto: false, motivo: 'motivo-novo', souEu: false },
  ],
};

test('transferenciaDialogo: só os aptos viram opção, e os inaptos aparecem desabilitados com o motivo', () => {
  const d = P.transferenciaDialogo(DESTINOS, OP);
  assert.equal(d.pode, true);
  assert.match(d.titulo, /Transferir acme-exemplo\/app-web#41/);
  assert.deepEqual(d.opcoes, [{ valor: 'dEu', rotulo: 'Transferir para este aparelho (Notebook de teste)', classe: 'primary' }]);
  assert.deepEqual(d.aptos, ['dEu']);
  assert.match(d.corpo, /md-destino md-inapto" aria-disabled="true"[^>]*>.*Celular de teste.*sem credencial desta conta/s);
  assert.match(d.corpo, /Desktop antigo.*é o aparelho que roda a análise agora/s);
  assert.match(d.corpo, /Tablet.*versão antiga/s);
  assert.match(d.corpo, /Laptop.*motivo registrado: motivo-novo/s);
  assert.match(d.corpo, /encerra a sessão/);
  assert.match(d.corpo, /Nenhuma sessão migra/);
});

test('transferenciaDialogo: sem apto, sem leitura ou com a origem inapta, nada é oferecido', () => {
  const nenhum = P.transferenciaDialogo({ ...DESTINOS, destinos: DESTINOS.destinos.filter((x) => !x.apto) }, OP);
  assert.equal(nenhum.pode, false);
  assert.deepEqual(nenhum.opcoes, []);
  assert.match(nenhum.titulo, /Nenhum aparelho apto/);
  assert.match(nenhum.corpo, /Celular de teste/);
  const falha = P.transferenciaDialogo({ ok: false, code: 'indisponivel', motivo: 'não deu' }, OP);
  assert.equal(falha.pode, false);
  assert.match(falha.corpo, /Não deu para ler/);
  assert.equal(P.transferenciaDialogo(null, OP).pode, false);
  const origem = P.transferenciaDialogo({ ...DESTINOS, origem: { deviceId: 'dOutro', motivo: 'sem-consentimento' } }, OP);
  assert.equal(origem.pode, false, 'a origem que não aceita comando nunca aplicaria a transferência');
  assert.match(origem.corpo, /Desktop antigo não aceita comandos do admin/);
  const semPr = P.transferenciaDialogo(DESTINOS, { ...OP, pr: null });
  assert.match(semPr.titulo, /Transferir esta análise/);
});

test('transferenciaDialogo: nome vindo de fora é escapado', () => {
  const d = P.transferenciaDialogo({ ...DESTINOS, destinos: [{ deviceId: 'dZ', nome: '<img src=x>', apto: false, motivo: 'pausado' }] }, OP);
  assert.doesNotMatch(d.corpo, /<img/);
});

test('transferenciaConfirmacao: nomeia origem e destino e diz que o desfecho vem do recibo', () => {
  const c = P.transferenciaConfirmacao({ origem: 'Desktop antigo', destino: 'Notebook de teste' });
  assert.match(c.title, /Transferir para Notebook de teste\?/);
  assert.match(c.body, /Desktop antigo/);
  assert.match(c.body, /recibo/);
});

/* ---------- divergência 4: o comando no card do PR ---------- */

test('notaComandoHtml: comando amarrado ao PR aparece no card dele, e só nele', () => {
  const cmd = { cmdId: '1'.repeat(32), tipo: 'transferir', alvo: 'dOutro', at: AGORA, vence: AGORA + 60000, prTag: 'a'.repeat(32), prKey: PR.key, destino: 'dEu' };
  const s = sync({ comandosEmitidos: [cmd] });
  const html = P.notaComandoHtml(PR.key, s);
  assert.match(html, /pr-coord/);
  assert.match(html, /Comando enviado ao Desktop antigo: transferir para este aparelho/);
  assert.match(html, /data-goto="aba:radar:#mdComandosWrap" role="button" tabindex="0"/);
  assert.equal(P.notaComandoHtml('acme-exemplo/app-web#1', s), '');
  assert.equal(P.notaComandoHtml(PR.key, sync({ comandosEmitidos: [{ ...cmd, prKey: '' }] })), '', 'sem o PR resolvido, nada de palpite');
  assert.match(P.prCoordNoteHtml(PR.key, s, AGORA), /Comando enviado ao Desktop antigo/, 'a boca única do card soma a nota');
});

/* ---------- divergência 5: o motivo da espera ---------- */

test('notaDistribuicaoHtml: o motivo da espera aparece quando o engine o conhece', () => {
  const com = (motivo) => sync({ distribuicao: { modo: 'distribuido', esperando: [{ key: PR.key, desde: AGORA - 60000, motivo }] } });
  assert.match(P.notaDistribuicaoHtml(PR.key, com('sem-aparelho-apto'), AGORA), /nenhum aparelho apto agora/);
  assert.match(P.notaDistribuicaoHtml(PR.key, com('atribuicao-viva'), AGORA), /espera ele aceitar/);
  assert.match(P.notaDistribuicaoHtml(PR.key, com('sem_vaga'), AGORA), /sem vaga/);
  assert.match(P.notaDistribuicaoHtml(PR.key, com('head_mudou'), AGORA), /commit mudou/);
  assert.match(P.notaDistribuicaoHtml(PR.key, com(''), AGORA), /o motivo da espera não chega a esta tela/);
  assert.match(P.notaDistribuicaoHtml(PR.key, com('codigo-novo'), AGORA), /motivo registrado: codigo-novo/);
});

/* ---------- divergência 10: histórico de tomadas ---------- */

test('tomadasFeitasHtml: de quem, para quem, risco e quando; vazio não desenha', () => {
  assert.equal(P.tomadasFeitasHtml([], DEVICES, 'dEu'), '');
  assert.equal(P.tomadasFeitasHtml(null, DEVICES, 'dEu'), '');
  const html = P.tomadasFeitasHtml([
    { prKey: PR.key, de: 'dOutro', para: 'dEu', geracao: 2, risco: 'provavel', at: AGORA },
    { prKey: 'acme-exemplo/api#98', de: 'dSumido', para: 'dEu', geracao: 3, risco: 'possivel', at: AGORA - 3600000 },
  ], DEVICES, 'dEu');
  assert.match(html, /href="https:\/\/github\.com\/acme-exemplo\/app-web\/pull\/41"/);
  assert.match(html, /Desktop antigo para este aparelho/);
  assert.match(html, /sync-chip warn">duplicidade provável</);
  assert.match(html, /sync-chip mute">duplicidade possível</);
  assert.match(html, /dSumido para este aparelho/, 'aparelho desconhecido aparece pelo id, sem inventar nome');
  assert.match(html, /geração 2/);
  assert.match(html, /10:00/);
});

/* ---------- comandos enviados com destino e PR ---------- */

test('comandosEmitidosHtml: transferir nomeia o destino, e o PR aparece quando resolvido', () => {
  const cmd = { cmdId: '2'.repeat(32), tipo: 'transferir', alvo: 'dOutro', at: AGORA, vence: AGORA + 60000, prKey: PR.key, destino: 'dCel' };
  const html = P.comandosEmitidosHtml([cmd], {}, { devices: DEVICES, agora: AGORA });
  assert.match(html, /<b>transferir<\/b> para Desktop antigo, destino Celular de teste/);
  assert.match(html, /acme-exemplo\/app-web#41/);
  const recusado = P.comandosEmitidosHtml([cmd], { [cmd.cmdId]: { estado: 'recusado', code: 'destino_inapto', at: AGORA } }, { devices: DEVICES, agora: AGORA });
  assert.match(recusado, /sync-chip bad">recusado</);
  assert.match(recusado, /o destino não estava apto/);
});

/* ---------- 20/09/2026: "o este aparelho" ----------
   `nomeNaLista` devolve a frase pronta "este aparelho" para o aparelho local, e o único
   chamador que punha "o " na frente montava "o distribuidor já escolheu o este aparelho e
   espera ele aceitar". Os outros chamadores (o histórico de tomadas) usam a mesma função
   sem artigo, e ficavam corretos. */

const AGORA_POSSE = Date.UTC(2026, 8, 20, 16, 0, 0);

function candidato(atribuido) {
  return {
    itemId: 'i1', prTag: 'a'.repeat(32), matTag: 'b'.repeat(32), desde: AGORA_POSSE - 11000,
    publicadores: ['dEu'], pr: { key: 'acme/app#53' }, atribuido,
  };
}

function ctxPosse() {
  return {
    podeComandar: true, devices: [{ deviceId: 'dEu', name: 'Notebook' }, { deviceId: 'dB', name: 'Celular' }],
    deviceIdLocal: 'dEu', agora: AGORA_POSSE,
  };
}

test('o aparelho LOCAL escolhido não vira "o este aparelho"', () => {
  const html = P.candidatosDoConjuntoHtml([candidato({ dev: 'dEu', ttl: AGORA_POSSE + 60000 })], ctxPosse());
  assert.match(html, /o distribuidor já escolheu este aparelho e espera ele aceitar/);
  assert.equal(html.includes('o este aparelho'), false);
});

test('o aparelho REMOTO escolhido é nomeado, e a frase segue legível', () => {
  const html = P.candidatosDoConjuntoHtml([candidato({ dev: 'dB', ttl: AGORA_POSSE + 60000 })], ctxPosse());
  assert.match(html, /o distribuidor já escolheu Celular e espera ele aceitar/);
});

test('aparelho escolhido sem nome recebe o id curto, o mesmo das outras telas', () => {
  const ctx = { ...ctxPosse(), devices: [{ deviceId: 'dEu', name: 'Notebook' }] };
  const html = P.candidatosDoConjuntoHtml([candidato({ dev: 'a1b2c3d4e5f6', ttl: AGORA_POSSE + 60000 })], ctx);
  assert.match(html, /escolheu aparelho a1b2c3d4 e espera/);
});
