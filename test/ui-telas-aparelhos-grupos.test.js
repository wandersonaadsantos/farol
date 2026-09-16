// A fiação das seções Sistema > Aparelhos e Sistema > Grupos de consumo
// (ui/telas/sistema-aparelhos.js e ui/telas/sistema-grupos.js).
//
// As ações recebem as dependências por parâmetro, então o que se prova aqui é
// COMPORTAMENTO, com rede e modal de mentira: qual rota é chamada, com que corpo, e o que
// acontece na recusa. O que se prova:
//   - ato destrutivo nunca chega à rota sem a confirmação, e sem senha não sai;
//   - revogar o próprio navegador recarrega a página, revogar outro não;
//   - leitura que falha vira "falha com motivo", nunca lista vazia;
//   - salvar consentimento manda o objeto de sync INTEIRO;
//   - republicar grupo em edição preserva o ativo, e grupo novo nasce com id sorteado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { instalarDom } from './helpers/dom-stub.js';

instalarDom();
const { definirEstado } = await import('../ui/telas/estado.js');
const AP = await import('../ui/telas/sistema-aparelhos.js');
const GR = await import('../ui/telas/sistema-grupos.js');

const RAIZ = path.join(import.meta.dirname, '..');
const ID = 'b'.repeat(32);

// rede e modal de mentira: grava cada chamada, responde o que o teste mandar
function deps({ respostas = {}, confirma = true, valor = '', status = null } = {}) {
  const chamadas = [];
  const avisos = [];
  const d = {
    chamadas, avisos, recarregou: false, confirmacoes: 0,
    api: async (rota, corpo) => { chamadas.push({ rota, corpo }); return Object.hasOwn(respostas, rota) ? respostas[rota] : { ok: true }; },
    get: async (rota) => { chamadas.push({ rota }); return status; },
    toast: (tipo, texto) => avisos.push({ tipo, texto }),
    confirmarComCampo: async () => { d.confirmacoes++; return { ok: confirma, valor: confirma ? valor : '' }; },
    confirmModal: async () => { d.confirmacoes++; return confirma; },
    recarregar: () => { d.recarregou = true; },
    idSorteado: () => ID,
  };
  return d;
}

function estadoCom(sync = {}, cfgSync = {}) {
  definirEstado({
    config: { sync: { enabled: true, apiKey: 'chave-exemplo', databaseUrl: 'https://exemplo.firebaseio.com', aceitarAdmin: false, ...cfgSync }, claudeProfiles: [{ id: 'pLab', label: 'Laboratório', kind: 'apikey' }] },
    sync: { enabled: true, shared: true, devices: [], coberturaPostagem: [], gruposDeConsumo: [], ...sync },
  });
}

/* ---------- leituras ---------- */

test('lerNavegadores: sem exigência não pede sessão nenhuma', async () => {
  const d = deps({ status: { exigida: false, autenticado: false } });
  assert.deepEqual(await AP.lerNavegadores(d), { estado: 'nao-exigida' });
  assert.ok(!d.chamadas.some((c) => c.rota === '/api/auth/sessions'));
});

test('lerNavegadores: status que não responde é falha, e sessões que falham também', async () => {
  assert.equal((await AP.lerNavegadores(deps({ status: null }))).estado, 'falha');
  const d = deps({ status: { exigida: true }, respostas: { '/api/auth/sessions': null } });
  const r = await AP.lerNavegadores(d);
  assert.equal(r.estado, 'falha');
  assert.ok(r.motivo);
  const ok = await AP.lerNavegadores(deps({ status: { exigida: true }, respostas: { '/api/auth/sessions': { ok: true, sessoes: [{ id: 'x' }] } } }));
  assert.deepEqual(ok, { estado: 'ok', sessoes: [{ id: 'x' }] });
});

test('lerLimpeza: a recusa vira falha com o motivo do engine, nunca "desligada"', async () => {
  const falha = await AP.lerLimpeza(deps({ respostas: { '/api/sync/cleanup-state': { ok: false, code: 'indisponivel', motivo: 'não deu para ler a chave de limpeza agora' } } }));
  assert.deepEqual(falha, { estado: 'falha', motivo: 'não deu para ler a chave de limpeza agora' });
  const ligada = await AP.lerLimpeza(deps({ respostas: { '/api/sync/cleanup-state': { ok: true, estado: 'ligada' } } }));
  assert.deepEqual(ligada, { estado: 'ligada' });
});

/* ---------- navegadores ---------- */

test('revogarSessao: revogar a própria recarrega a página; revogar outra não', async () => {
  const propria = deps({ respostas: { '/api/auth/revoke': { ok: true, eraAtual: true } } });
  await AP.revogarSessao('abc', propria);
  assert.equal(propria.recarregou, true);
  assert.deepEqual(propria.chamadas.at(-1), { rota: '/api/auth/revoke', corpo: { id: 'abc' } });
  const outra = deps({ respostas: { '/api/auth/revoke': { ok: true, eraAtual: false } } });
  await AP.revogarSessao('def', outra);
  assert.equal(outra.recarregou, false);
});

test('revogarSessao: sem confirmação, a rota não é chamada', async () => {
  const d = deps({ confirma: false });
  assert.equal(await AP.revogarSessao('abc', d), false);
  assert.equal(d.chamadas.length, 0);
});

/* ---------- limpeza e revogação ---------- */

test('limparDados: confirma, exige senha e manda a senha, sem categoria inventada pela tela', async () => {
  const negado = deps({ confirma: false });
  assert.equal(await AP.limparDados(negado), false);
  assert.equal(negado.chamadas.length, 0);
  const semSenha = deps({ valor: '' });
  assert.equal(await AP.limparDados(semSenha), false);
  assert.equal(semSenha.chamadas.length, 0, 'sem senha nada sai');
  const d = deps({ valor: 'segredo-de-teste' });
  assert.equal(await AP.limparDados(d), true);
  assert.equal(d.confirmacoes, 1);
  assert.deepEqual(d.chamadas, [{ rota: '/api/sync/cleanup', corpo: { password: 'segredo-de-teste' } }]);
});

test('limparDados: a recusa do servidor aparece com o motivo', async () => {
  const d = deps({ valor: 's', respostas: { '/api/sync/cleanup': { ok: false, code: 'limpeza-desligada', motivo: 'a chave de limpeza de dados sincronizados está desligada' } } });
  assert.equal(await AP.limparDados(d), false);
  assert.match(d.avisos.at(-1).texto, /a chave de limpeza de dados sincronizados está desligada/);
});

test('revogarConjunto: confirma, exige senha e só então chama a rota', async () => {
  const negado = deps({ confirma: false });
  await AP.revogarConjunto(negado);
  assert.equal(negado.chamadas.length, 0);
  const semSenha = deps({ valor: '' });
  await AP.revogarConjunto(semSenha);
  assert.equal(semSenha.chamadas.length, 0);
  const d = deps({ valor: 'segredo-de-teste' });
  assert.equal(await AP.revogarConjunto(d), true);
  assert.deepEqual(d.chamadas, [{ rota: '/api/sync/revoke', corpo: { password: 'segredo-de-teste' } }]);
});

test('mudarChaveDeLimpeza: o corpo é o booleano literal', async () => {
  const d = deps();
  await AP.mudarChaveDeLimpeza(true, d);
  await AP.mudarChaveDeLimpeza(false, d);
  assert.deepEqual(d.chamadas.map((c) => c.corpo), [{ ligada: true }, { ligada: false }]);
});

/* ---------- aparelhos, admin, consentimento, política ---------- */

test('aposentarAparelho: aposentar confirma; reativar não precisa', async () => {
  const negado = deps({ confirma: false });
  assert.equal(await AP.aposentarAparelho('dX', true, negado), false);
  assert.equal(negado.chamadas.length, 0);
  const d = deps();
  await AP.aposentarAparelho('dX', true, d);
  assert.deepEqual(d.chamadas.at(-1), { rota: '/api/sync/device', corpo: { deviceId: 'dX', aposentar: true } });
  const r = deps({ confirma: false });
  await AP.aposentarAparelho('dX', false, r);
  assert.deepEqual(r.chamadas, [{ rota: '/api/sync/device', corpo: { deviceId: 'dX', aposentar: false } }], 'reativar tem volta e não pede confirmação');
});

test('renomearAparelho: nome vazio não chama a rota', async () => {
  estadoCom({ devices: [{ deviceId: 'dX', name: 'Antigo' }] });
  const vazio = deps({ valor: '   ' });
  assert.equal(await AP.renomearAparelho('dX', vazio), false);
  assert.equal(vazio.chamadas.length, 0);
  const d = deps({ valor: ' Notebook de teste ' });
  await AP.renomearAparelho('dX', d);
  assert.deepEqual(d.chamadas, [{ rota: '/api/sync/device', corpo: { deviceId: 'dX', nome: 'Notebook de teste' } }]);
});

test('tornarAdmin: sem senha não chama; com senha, só a senha vai no corpo', async () => {
  const semSenha = deps();
  assert.equal(await AP.tornarAdmin('', semSenha), false);
  assert.equal(semSenha.chamadas.length, 0);
  const d = deps();
  await AP.tornarAdmin('segredo-de-teste', d);
  assert.deepEqual(d.chamadas, [{ rota: '/api/sync/admin', corpo: { password: 'segredo-de-teste' } }]);
});

test('salvarConsentimento: manda o objeto de sync inteiro, e a chave ignorada vira recusa', async () => {
  estadoCom({}, { deviceName: 'Notebook de teste' });
  const d = deps({ respostas: { '/api/settings': { ignoradas: [] } } });
  assert.equal(await AP.salvarConsentimento(true, d), true);
  const corpo = d.chamadas[0].corpo.sync;
  assert.equal(corpo.aceitarAdmin, true);
  assert.equal(corpo.deviceName, 'Notebook de teste', 'o resto da config de sync vai junto');
  assert.equal(corpo.databaseUrl, 'https://exemplo.firebaseio.com');
  const recusa = deps({ respostas: { '/api/settings': { ignoradas: ['sync'] } } });
  assert.equal(await AP.salvarConsentimento(false, recusa), false);
  const semResposta = deps({ respostas: { '/api/settings': null } });
  assert.equal(await AP.salvarConsentimento(false, semResposta), false);
});

test('publicarPolitica: devolve o motivo da recusa, e vazio no sucesso', async () => {
  const pol = { pausado: true, tetoParalelismo: 2, tiposDeOperacao: ['review'] };
  const d = deps();
  assert.equal(await AP.publicarPolitica('dX', pol, d), '');
  assert.deepEqual(d.chamadas, [{ rota: '/api/sync/policy', corpo: { deviceId: 'dX', politica: pol } }]);
  const recusa = deps({ respostas: { '/api/sync/policy': { ok: false, code: 'nao-e-admin', motivo: 'este aparelho não é o admin da geração vigente' } } });
  assert.equal(await AP.publicarPolitica('dX', pol, recusa), 'este aparelho não é o admin da geração vigente');
});

/* ---------- grupos ---------- */

test('salvarGrupo: grupo novo nasce com id sorteado, e sem ativo', async () => {
  const d = deps();
  assert.equal(await GR.salvarGrupo({ nome: 'Time', periodo: 'mes', teto: '' }, null, d), true);
  assert.deepEqual(d.chamadas, [{ rota: '/api/sync/group', corpo: { grupo: { id: ID, nome: 'Time', periodo: 'mes' } } }]);
});

test('salvarGrupo: editar um grupo ativo preserva o ativo e o id', async () => {
  const d = deps();
  const atual = { id: 'c'.repeat(32), nome: 'Antigo', periodo: 'dia', tetoUsd: 5, ativo: true };
  await GR.salvarGrupo({ nome: 'Novo', periodo: 'semana', teto: '8' }, atual, d);
  assert.deepEqual(d.chamadas[0].corpo.grupo, { id: 'c'.repeat(32), nome: 'Novo', periodo: 'semana', tetoUsd: 8, ativo: true });
});

test('salvarGrupo: sem nome ou sem período não publica, e sem id também não', async () => {
  const d = deps();
  assert.equal(await GR.salvarGrupo({ nome: '', periodo: 'mes' }, null, d), false);
  assert.equal(d.chamadas.length, 0);
  const semId = deps();
  semId.idSorteado = () => '';
  assert.equal(await GR.salvarGrupo({ nome: 'Time', periodo: 'mes' }, null, semId), false);
  assert.equal(semId.chamadas.length, 0);
});

test('mudarAtivacao: ativar confirma antes; a recusa mostra a lista do que falta', async () => {
  const g = { id: ID, nome: 'Time', periodo: 'mes', tetoUsd: 10, ativo: false };
  const negado = deps({ confirma: false });
  assert.equal(await GR.mudarAtivacao(g, true, negado), false);
  assert.equal(negado.chamadas.length, 0);
  const motivo = 'não dá para ativar o teto: falta a medição do atraso do consumo entre dois aparelhos reais';
  const d = deps({ respostas: { '/api/sync/group': { ok: false, code: 'ativacao-bloqueada', motivo } } });
  assert.equal(await GR.mudarAtivacao(g, true, d), false);
  assert.deepEqual(d.chamadas[0].corpo.grupo, { id: ID, nome: 'Time', periodo: 'mes', tetoUsd: 10, ativo: true });
  assert.ok(d.avisos.at(-1).texto.includes(motivo));
  const desligar = deps({ confirma: false });
  assert.equal(await GR.mudarAtivacao({ ...g, ativo: true }, false, desligar), true, 'desativar só afrouxa e não precisa de confirmação');
});

test('vincularPerfil: o tipo sai do kind do perfil; kind desconhecido não vincula', async () => {
  const d = deps();
  await GR.vincularPerfil({ id: 'pLab', kind: 'apikey' }, ID, d);
  assert.deepEqual(d.chamadas, [{ rota: '/api/sync/link', corpo: { perfilId: 'pLab', grupo: ID, tipo: 'api' } }]);
  const estranho = deps();
  assert.equal(await GR.vincularPerfil({ id: 'pX', kind: 'inventado' }, ID, estranho), false);
  assert.equal(estranho.chamadas.length, 0);
});

test('desvincularPerfil: confirma e manda o desvincular literal', async () => {
  const negado = deps({ confirma: false });
  await GR.desvincularPerfil('pLab', negado);
  assert.equal(negado.chamadas.length, 0);
  const d = deps();
  await GR.desvincularPerfil('pLab', d);
  assert.deepEqual(d.chamadas, [{ rota: '/api/sync/link', corpo: { perfilId: 'pLab', desvincular: true } }]);
});

/* ---------- desenho com o DOM de mentira ---------- */

test('as duas seções desenham com um estado plausível sem explodir', () => {
  estadoCom({ admin: { deviceId: 'dEu', generation: 1, souEu: true, fresca: true }, devices: [{ deviceId: 'dEu', name: 'Notebook de teste', euMesmo: true }], gruposDeConsumo: [{ id: ID, nome: 'Time', estado: 'configurado', requisitos: [], controlados: ['pLab'], naoControlados: [] }] }, { aceitarAdmin: true });
  AP.renderAparelhos();
  GR.renderGrupos();
  const aparelhos = document.querySelector('#devicesManager').innerHTML;
  const grupos = document.querySelector('#groupsManager').innerHTML;
  assert.match(aparelhos, /Notebook de teste/);
  assert.match(grupos, /data-grupo-ativar/);
  assert.match(grupos, /Laboratório/);
});

/* ---------- a costura com o Sistema e o HTML ---------- */

function corpoDe(fonte, inicio) {
  const i = fonte.indexOf(inicio);
  assert.ok(i >= 0, `trecho não encontrado: ${inicio}`);
  return fonte.slice(i, fonte.indexOf('\n});', i));
}

test('o Sistema desenha as duas seções ao entrar e a cada estado, e lê as leituras sob demanda só ao entrar', () => {
  const fonte = fs.readFileSync(path.join(RAIZ, 'ui', 'telas', 'sistema.js'), 'utf8');
  const registro = corpoDe(fonte, "registrarTela({\n  id: 'sistema'");
  const entrar = registro.slice(registro.indexOf('aoEntrar'), registro.indexOf('aoEstado'));
  const aoEstado = registro.slice(registro.indexOf('aoEstado'));
  assert.match(entrar, /carregarAparelhos\(\)/);
  assert.match(entrar, /renderGrupos\(\)/);
  assert.match(aoEstado, /renderAparelhos\(\)/);
  assert.match(aoEstado, /renderGrupos\(\)/);
  assert.ok(!/carregarAparelhos/.test(aoEstado), 'ler o banco a cada snapshot faria uma chamada de rede por ciclo');
});

test('as duas seções existem na barra lateral entre Sincronização e Plano e chaves, com o container', () => {
  const html = fs.readFileSync(path.join(RAIZ, 'ui', 'index.html'), 'utf8');
  const ordem = ['data-section="sync"', 'data-section="devices"', 'data-section="groups"', 'data-section="plans"'].map((t) => html.indexOf(t));
  assert.ok(ordem.every((n) => n > 0));
  assert.deepEqual([...ordem].sort((a, b) => a - b), ordem, 'a ordem da barra lateral é sync, devices, groups, plans');
  assert.match(html, /id="sys-devices"[\s\S]*?id="devicesManager"/);
  assert.match(html, /id="sys-groups"[\s\S]*?id="groupsManager"/);
});

test('nenhuma variável de módulo das duas telas guarda senha', () => {
  for (const arq of ['sistema-aparelhos.js', 'sistema-grupos.js']) {
    const fonte = fs.readFileSync(path.join(RAIZ, 'ui', 'telas', arq), 'utf8');
    const doModulo = [...fonte.matchAll(/^let (\w+)/gm)].map((m) => m[1]);
    assert.ok(doModulo.every((n) => !/senha|password/i.test(n)), `${arq}: ${doModulo.join(', ')}`);
  }
});
