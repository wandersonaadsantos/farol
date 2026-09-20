// A visão compartilhada no Radar, parte pura (ui/pure/compartilhado.js e
// ui/pure/compartilhado-historico.js). Teste por SAÍDA: o que a tela afirma.
//
// As três garantias que este arquivo trava, cada uma com caso próprio:
//   - compartilhamento bloqueado pelo Farol nunca aparece como ligado;
//   - comando nunca aparece como concluído sem recibo;
//   - falha nunca se disfarça de vazio (lista de revisões, recibo, envio do histórico).
//
// fmtClock formata no fuso do processo; sem fixar, passa aqui e falha em outra máquina.
process.env.TZ = 'America/Sao_Paulo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
const P = await import('../ui/pure.js');

const AGORA = Date.UTC(2026, 8, 16, 13, 0, 0);
const DEVICES = [{ deviceId: 'dEu', name: 'Notebook de teste', euMesmo: true }, { deviceId: 'dOutro', name: 'Desktop antigo' }];

function sync(extra = {}) {
  return { shared: true, bloqueioCompartilhamento: '', deviceId: 'dEu', devices: DEVICES, distribuicao: { modo: 'distribuido', esperando: [] }, ...extra };
}

const CFG_DIST = { distribution: { enabled: true } };

/* ---------- a visão está valendo? ---------- */

test('visaoCompartilhada: bloqueada vence o pedido, e nunca vira ligada', () => {
  assert.equal(P.visaoCompartilhada(sync()), 'ligada');
  assert.equal(P.visaoCompartilhada(sync({ shared: false })), 'desligada');
  assert.equal(P.visaoCompartilhada(sync({ bloqueioCompartilhamento: 'autenticacao-local' })), 'bloqueada');
  assert.equal(P.visaoCompartilhada(null), 'desligada');
});

test('compartilhadoBloqueioHtml: diz bloqueada com o motivo e leva à Sincronização', () => {
  const html = P.compartilhadoBloqueioHtml(sync({ bloqueioCompartilhamento: 'autenticacao-local' }));
  assert.match(html, /sync-chip warn">bloqueada</);
  assert.match(html, /autenticação local não está exigida/);
  assert.match(html, /data-goto="sys:sync" role="button" tabindex="0"/);
  assert.doesNotMatch(html, /ligad[ao]</, 'bloqueada nunca se apresenta como ligada');
  assert.equal(P.compartilhadoBloqueioHtml(sync()), '', 'sem bloqueio, sem faixa');
  assert.equal(P.compartilhadoBloqueioHtml(sync({ shared: false })), '');
});

/* ---------- faixa do modo da distribuição ---------- */

test('modoDistribuicaoHtml: só existe com a distribuição pedida e a visão valendo', () => {
  assert.equal(P.modoDistribuicaoHtml(sync(), {}), '');
  assert.equal(P.modoDistribuicaoHtml(sync(), { distribution: { enabled: false } }), '');
  assert.equal(P.modoDistribuicaoHtml(sync({ bloqueioCompartilhamento: 'autenticacao-local' }), CFG_DIST), '');
  assert.equal(P.modoDistribuicaoHtml(sync({ shared: false }), CFG_DIST), '');
});

test('modoDistribuicaoHtml: distribuído com o nome do distribuidor', () => {
  const html = P.modoDistribuicaoHtml(sync({ admin: { deviceId: 'dOutro', souEu: false, fresca: true } }), CFG_DIST);
  assert.match(html, /sync-chip ok">fila distribuída</);
  assert.match(html, /Desktop antigo escolhe onde cada revisão roda/);
  const eu = P.modoDistribuicaoHtml(sync({ admin: { deviceId: 'dEu', souEu: true, fresca: true } }), CFG_DIST);
  assert.match(eu, /Este aparelho distribui/);
});

test('modoDistribuicaoHtml: distribuidor sem sinal vira aviso da janela de três giros', () => {
  const html = P.modoDistribuicaoHtml(sync({ admin: { deviceId: 'dOutro', souEu: false, fresca: false } }), CFG_DIST);
  assert.match(html, /sync-chip warn">sem sinal do distribuidor</);
  assert.match(html, /até três giros sem ninguém enfileirar/);
});

test('modoDistribuicaoHtml: local e modo ainda não decidido são estados, não silêncio', () => {
  const local = P.modoDistribuicaoHtml(sync({ distribuicao: { modo: 'local', esperando: [{ key: 'a/b#1', desde: 1 }] } }), CFG_DIST);
  assert.match(local, /sync-chip warn">fila local</);
  assert.match(local, /1 PR espera colocação/);
  const vazio = P.modoDistribuicaoHtml(sync({ distribuicao: { modo: '', esperando: [] } }), CFG_DIST);
  assert.match(vazio, /modo ainda não decidido/);
});

/* ---------- notas por PR ---------- */

test('notaDistribuicaoHtml: PR esperando colocação ganha nota com o tempo', () => {
  const s = sync({ distribuicao: { modo: 'distribuido', esperando: [{ key: 'acme-exemplo/app-web#42', desde: AGORA - 3 * 60000 }] } });
  const html = P.notaDistribuicaoHtml('acme-exemplo/app-web#42', s, AGORA);
  assert.match(html, /Esperando distribuição há 3m:/);
  assert.equal(P.notaDistribuicaoHtml('acme-exemplo/app-web#1', s, AGORA), '');
});

test('notaTomadaSofridaHtml: tomada sofrida diz quem tomou e que nada será postado', () => {
  const s = sync({ tomadasSofridas: [{ prKey: 'acme-exemplo/app-web#41', para: 'dOutro', geracao: 2, risco: 'provavel', at: AGORA }] });
  const html = P.notaTomadaSofridaHtml('acme-exemplo/app-web#41', s);
  assert.match(html, /pr-coord bad/);
  assert.match(html, /Tomado pelo Desktop antigo/);
  assert.match(html, /geração 2/);
  assert.match(html, /Nada desta revisão será postado/);
  assert.equal(P.notaTomadaSofridaHtml('outro#1', s), '');
});

test('prCoordNoteHtml: soma as notas novas sem mudar a da coordenação', () => {
  const s = sync({
    espera: { 'a/b#1': { reason: 'alheio', deviceName: 'Desktop antigo' } }, leasesVistos: {},
    distribuicao: { modo: 'distribuido', esperando: [{ key: 'a/b#1', desde: AGORA }] },
  });
  const html = P.prCoordNoteHtml('a/b#1', s, AGORA);
  assert.ok(html.startsWith('<div class="pr-coord">Em análise no Desktop antigo.'), 'a nota antiga continua primeiro');
  assert.match(html, /Esperando distribuição/);
  assert.equal(P.prCoordNoteHtml('x/y#9', sync()), '', 'sem nada a dizer, nada');
  // reforço da contraprova M15: a tomada sofrida chega ao card pela MESMA boca
  const tomado = sync({ tomadasSofridas: [{ prKey: 'a/b#1', para: 'dOutro', geracao: 3, at: AGORA }] });
  assert.match(P.prCoordNoteHtml('a/b#1', tomado, AGORA), /pr-coord bad">Tomado pelo Desktop antigo/);
});

/* ---------- quem pode emitir comando ---------- */

test('comandoPermitido: só o admin com sinal fresco', () => {
  assert.equal(P.comandoPermitido(sync()).pode, false);
  assert.match(P.comandoPermitido(sync()).motivo, /nenhum aparelho admin/);
  assert.match(P.comandoPermitido(sync({ admin: { souEu: false, fresca: true } })).motivo, /este não é o admin/);
  assert.match(P.comandoPermitido(sync({ admin: { souEu: true, fresca: false } })).motivo, /sem sinal fresco/);
  assert.deepEqual(P.comandoPermitido(sync({ admin: { souEu: true, fresca: true } })), { pode: true, motivo: '' });
});

/* ---------- precisa de você em todos os aparelhos ---------- */

const PEND = { itemId: 'ab12', dev: 'dOutro', aparelho: 'Desktop antigo', at: AGORA, visto: false, veredito: 'request_changes', motivos: [{ text: 'x', kind: 'gate' }, { text: 'y', kind: 'content' }], bloqueio: '' };

test('pendenciasCompartilhadasHtml: vazio legítimo tem frase própria', () => {
  assert.match(P.pendenciasCompartilhadasHtml([], {}), /Nada precisa de você/);
});

test('pendenciasCompartilhadasHtml: nova, veredito, motivos e as duas ações para o admin', () => {
  const html = P.pendenciasCompartilhadasHtml([PEND], { novas: new Set(['ab12']), podeComandar: true });
  assert.match(html, /sync-chip mute">no Desktop antigo</);
  assert.match(html, /sync-chip warn">nova</);
  assert.match(html, /veredito: pedir mudanças, 2 motivos registrados/);
  assert.match(html, /class="btn sm primary md-decidir" data-item="ab12" data-dev="dOutro"/);
  assert.match(html, /class="btn sm ghost md-visto" data-item="ab12"/);
  assert.doesNotMatch(html, /\[object Object\]/);
});

test('pendenciasCompartilhadasHtml: sem permissão, a decisão vira explicação, e o visto continua', () => {
  const html = P.pendenciasCompartilhadasHtml([PEND], { podeComandar: false, motivoSemComando: 'só o admin emite' });
  assert.doesNotMatch(html, /md-decidir/);
  assert.match(html, /só o admin emite/);
  assert.match(html, /md-visto/);
});

test('pendenciasCompartilhadasHtml: vista perde o botão e o selo de nova', () => {
  const html = P.pendenciasCompartilhadasHtml([{ ...PEND, visto: true }], { novas: new Set(['ab12']) });
  assert.match(html, /sync-chip mute">visto</);
  assert.doesNotMatch(html, /md-visto/);
  assert.doesNotMatch(html, />nova</);
});

test('pendenciasCompartilhadasHtml: sem o nome do catálogo, o PR não é nomeado', () => {
  const html = P.pendenciasCompartilhadasHtml([{ ...PEND, prTag: 'f'.repeat(32) }], {});
  assert.doesNotMatch(html, /f{32}/, 'a tag não é nome e não aparece como se fosse');
  assert.doesNotMatch(html, /github\.com/);
  assert.match(html, /não abriu no catálogo cifrado/);
});

test('pendenciasCompartilhadasHtml: texto vindo de fora é escapado', () => {
  const html = P.pendenciasCompartilhadasHtml([{ ...PEND, aparelho: '<img src=x>' }], {});
  assert.doesNotMatch(html, /<img/);
});

/* ---------- em outros aparelhos ---------- */

const OP = { opId: 'op1', dev: 'dOutro', aparelho: 'Desktop antigo', t0: AGORA, situacao: 'viva', etapa: 'verificacao', msPorEtapa: { leitura: 60000, verificacao: 180000 }, subagentes: ['a', 'b'], modelo: 'opus', prTag: 'a'.repeat(32), acctTag: 'b'.repeat(32), tipo: 'review' };

test('operacoesRemotasHtml: etapa, tempo, subagentes e modelo', () => {
  const html = P.operacoesRemotasHtml([OP], { podeComandar: true });
  assert.match(html, /sync-chip mute">Desktop antigo</);
  assert.match(html, /verificando, 2 subagentes/);
  assert.match(html, /4m, opus/);
  assert.match(html, /class="btn sm ghost md-cancelar" data-op="op1" data-dev="dOutro"/);
  assert.match(P.operacoesRemotasHtml([], {}), /Nenhuma análise rodando/);
});

test('operacoesRemotasHtml: nó vencido aparece como sem renovar, nunca como em andamento puro', () => {
  assert.match(P.operacoesRemotasHtml([{ ...OP, situacao: 'interrompida' }], {}), /sync-chip warn">sem renovar</);
});

test('acoesDaOperacao: transferir e tomar ficam indisponíveis com o motivo do contrato', () => {
  const a = P.acoesDaOperacao(OP, { podeComandar: true });
  assert.equal(a.cancelar.pode, true);
  assert.equal(a.transferir.pode, false);
  assert.match(a.transferir.motivo, /não traz o commit/);
  assert.equal(a.tomar.pode, false);
  assert.match(a.tomar.motivo, /não traz o commit/);
  const html = P.operacoesRemotasHtml([OP], { podeComandar: true });
  assert.doesNotMatch(html, /md-transferir"/, 'botão que sempre recusaria não é oferecido');
  assert.doesNotMatch(html, /md-tomar"/);
  assert.match(html, /Transferir: indisponível/);
});

// O PR em claro chega em `op.pr` (resolvido pelo catálogo no engine) desde a entrega da
// transferência pela tela; antes o teste o punha solto em `prKey`/`account`, que o engine
// nunca mandou. E transferir deixou de ser sempre indisponível: a lista de destinos vem da
// rota própria (test/ui-pure-compartilhado-posse.test.js).
test('acoesDaOperacao: tomar só com commit E PR em claro, e nunca sem permissão', () => {
  const completa = { ...OP, matTag: 'c'.repeat(32), pr: { key: 'a/b#1', account: 'conta', title: '', author: '' } };
  assert.equal(P.acoesDaOperacao(completa, { podeComandar: true }).tomar.pode, true);
  assert.equal(P.acoesDaOperacao({ ...completa, pr: { ...completa.pr, account: '' } }, { podeComandar: true }).tomar.pode, false);
  assert.equal(P.acoesDaOperacao(completa, { podeComandar: false }).tomar.pode, false);
  assert.equal(P.acoesDaOperacao(completa, { podeComandar: false }).transferir.pode, false, 'sem permissão, nunca');
  assert.equal(P.acoesDaOperacao({ ...OP, prTag: '' }, { podeComandar: true }).cancelar.pode, false);
  assert.equal(P.acoesDaOperacao(OP, {}).cancelar.pode, false);
});

test('andamentoAtrasado: leitura velha aparece como tal, recente não', () => {
  assert.equal(P.andamentoAtrasado(0, AGORA).atrasada, false, 'sem leitura ainda não é atraso');
  assert.equal(P.andamentoAtrasado(AGORA - 20000, AGORA).atrasada, false);
  const velha = P.andamentoAtrasado(AGORA - 120000, AGORA);
  assert.equal(velha.atrasada, true);
  assert.match(velha.texto, /09:58/);
  assert.match(P.andamentoAtrasadoHtml(AGORA - 120000, AGORA), /sync-chip warn">leitura atrasada</);
  assert.equal(P.andamentoAtrasadoHtml(AGORA, AGORA), '');
});

/* ---------- comandos e recibos ---------- */

const CMD = { cmdId: '0'.repeat(32), tipo: 'cancelar', alvo: 'dOutro', at: AGORA - 60000, vence: AGORA + 14 * 60000 };

test('reciboEstado: sem recibo é enviado ou vencido, nunca concluído', () => {
  const enviado = P.reciboEstado(CMD, null, AGORA);
  assert.equal(enviado.estado, 'enviado');
  assert.match(enviado.detalhe, /vale até 10:14/);
  const vencido = P.reciboEstado(CMD, null, CMD.vence + 1);
  assert.equal(vencido.estado, 'vencido');
  for (const r of [enviado, vencido]) {
    assert.notEqual(r.estado, 'aplicado');
    assert.doesNotMatch(r.rotulo, /conclu|aplicado/);
  }
  assert.equal(P.reciboEstado(CMD, { estado: 'inventado' }, AGORA).estado, 'enviado', 'recibo desconhecido não vira sucesso');
});

test('reciboEstado: recibo manda, com o porquê traduzido', () => {
  assert.equal(P.reciboEstado(CMD, { estado: 'aplicado', at: AGORA }, AGORA).classe, 'ok');
  const recusado = P.reciboEstado(CMD, { estado: 'recusado', code: 'head_mudou', at: AGORA }, AGORA);
  assert.equal(recusado.estado, 'recusado');
  assert.match(recusado.detalhe, /commit mudou/);
  assert.match(P.reciboEstado(CMD, { estado: 'ignorado', code: 'nao-aceita-admin' }, AGORA).detalhe, /não aceita comandos/);
  assert.match(P.reciboEstado(CMD, { estado: 'recusado', code: 'novo_codigo' }, AGORA).detalhe, /código novo_codigo/);
});

test('reciboEstado: consulta que falhou aparece, sem virar recibo', () => {
  const r = P.reciboEstado(CMD, null, AGORA, true);
  assert.equal(r.estado, 'enviado');
  assert.match(r.detalhe, /consulta do recibo falhou/);
});

test('reciboFinal: só aplicado, recusado e ignorado encerram a consulta', () => {
  assert.equal(P.reciboFinal(null), false);
  assert.equal(P.reciboFinal({ estado: 'pendente' }), false);
  for (const e of ['aplicado', 'recusado', 'ignorado']) assert.equal(P.reciboFinal({ estado: e }), true);
});

test('comandosEmitidosHtml: nomeia o aparelho alvo e mostra o estado do recibo', () => {
  assert.equal(P.comandosEmitidosHtml([], {}, {}), '');
  const html = P.comandosEmitidosHtml([CMD], {}, { devices: DEVICES, agora: AGORA });
  assert.match(html, /<b>cancelar<\/b> para Desktop antigo/);
  assert.match(html, /sync-chip info">enviado</);
  const com = P.comandosEmitidosHtml([CMD], { [CMD.cmdId]: { estado: 'aplicado', at: AGORA } }, { devices: DEVICES, agora: AGORA });
  assert.match(com, /sync-chip ok">aplicado</);
});

/* ---------- tomada ---------- */

test('tomadaDialogo: aviso do engine, risco declarado, e só então pode', () => {
  const d = P.tomadaDialogo({ ok: true, podeTomar: true, dono: 'dOutro', risco: 'provavel', aviso: 'Este PR está sendo analisado em Desktop antigo.' });
  assert.equal(d.pode, true);
  assert.match(d.corpo, /analisado em Desktop antigo/);
  assert.match(d.corpo, /Duplicidade provável/);
  assert.match(d.corpo, /não é encerrado/);
  assert.match(P.tomadaDialogo({ ok: true, podeTomar: true, risco: 'possivel', aviso: '' }).corpo, /Duplicidade possível/);
});

test('tomadaDialogo: sem leitura ou sem posse alheia, nada a tomar', () => {
  const falha = P.tomadaDialogo(null);
  assert.equal(falha.pode, false);
  assert.match(falha.corpo, /Não deu para ler/);
  assert.equal(P.tomadaDialogo({ ok: false, code: 'indisponivel' }).pode, false);
  const semLease = P.tomadaDialogo({ ok: true, podeTomar: false, motivo: 'sem-lease' });
  assert.equal(semLease.pode, false);
  assert.match(semLease.corpo, /Ninguém está com este PR/);
});

test('oQueELocalHtml: nomeia Destaques, Kudos e Time como locais', () => {
  assert.match(P.oQueELocalHtml(), /Destaques, Kudos e Time continuam locais/);
});

/* ---------- revisões de todos os aparelhos ---------- */

const REV = { reviewId: 'r1', t: AGORA, dev: 'dOutro', aparelho: 'Desktop antigo', veredito: 'approve', status: 'auto_approved', acao: 'approve', contagens: { motivos: 0, atencao: 0 }, prTag: 'd'.repeat(32) };

test('revisoesCompartilhadasHtml: carregando, falha e vazio são três frases diferentes', () => {
  const carregando = P.revisoesCompartilhadasHtml({ estado: 'carregando' });
  const falha = P.revisoesCompartilhadasHtml({ estado: 'falha' });
  const vazio = P.revisoesCompartilhadasHtml({ estado: 'lista', revisoes: [] });
  assert.match(carregando, /Buscando/);
  assert.match(falha, /falhou/);
  assert.match(vazio, /Nenhuma revisão compartilhada/);
  assert.doesNotMatch(falha, /Nenhuma revisão/, 'falha não se disfarça de vazio');
});

test('revisoesCompartilhadasHtml: origem por aparelho, este marcado, e o escopo ativo', () => {
  const html = P.revisoesCompartilhadasHtml({ estado: 'lista', revisoes: [REV, { ...REV, reviewId: 'r2', dev: 'dEu' }], deviceIdLocal: 'dEu', escopo: 'este', agora: AGORA });
  assert.match(html, /sync-chip mute">Desktop antigo</);
  assert.match(html, /sync-chip info">este</);
  assert.match(html, /aprovado sozinho/);
  assert.match(html, /md-ver-revisao" data-review="r1"/);
  assert.match(html, /md-escopo active" data-escopo="este" aria-pressed="true"/);
  assert.match(html, /data-escopo="todos" aria-pressed="false"/);
});

test('revisaoAbertaHtml: corpo sob demanda, e falha diferente de indisponível', () => {
  assert.match(P.revisaoAbertaHtml(null).corpo, /busca do corpo falhou/);
  assert.match(P.revisaoAbertaHtml({ found: false }).corpo, /não abriu neste aparelho/);
  const ok = P.revisaoAbertaHtml({ found: true, revisao: { key: 'acme-exemplo/app-web#35', pr: { title: 'Ajusta <rodapé>' }, reportMarkdown: '## Achados' } });
  assert.equal(ok.ok, true);
  assert.match(ok.corpo, /github\.com\/acme-exemplo\/app-web\/pull\/35/, 'o PR em claro vira menção navegável');
  assert.match(ok.corpo, /Ajusta &lt;rodapé&gt;/);
  assert.match(ok.corpo, /<h\d[^>]*>Achados/);
});

/* ---------- envio do histórico ---------- */

const MEDIDA = { ok: true, categorias: { revisoes: 1240 }, pendentes: 1240, bytes: 7 * 1024 * 1024, impressao: 'imp1' };

test('envioHistoricoHtml: cada fase com o próprio texto', () => {
  assert.match(P.envioHistoricoHtml({ fase: 'inicial' }), /md-medir/);
  assert.match(P.envioHistoricoHtml({ fase: 'medindo' }), /pill busy">medindo/);
  const medido = P.envioHistoricoHtml({ fase: 'medido', medida: MEDIDA });
  assert.match(medido, /1\.240/);
  assert.match(medido, /7,0 MB/);
  assert.match(medido, /volume grande/);
  assert.match(medido, /md-enviar">Enviar 1\.240 revisões/);
  assert.match(P.envioHistoricoHtml({ fase: 'enviando', parcial: { enviados: 50, restantes: 1190 } }), /enviando.*50 enviadas, 1\.190 faltando/s);
  assert.match(P.envioHistoricoHtml({ fase: 'vencida' }), /mudou desde a medida/);
  assert.match(P.envioHistoricoHtml({ fase: 'concluido' }), /sync-chip ok">enviado/);
  assert.match(P.envioHistoricoHtml({ fase: 'medido', medida: { ...MEDIDA, pendentes: 0 } }), /Nada a enviar/);
  assert.match(P.envioHistoricoHtml({ fase: 'falha', erro: { motivo: 'o compartilhamento cifrado está desligado' } }), /falhou.*compartilhamento cifrado/s);
  const interrompido = P.envioHistoricoHtml({ fase: 'falha', medida: MEDIDA, parcial: { enviados: 300, restantes: 940 }, erro: { motivo: 'rede' } });
  assert.match(interrompido, /interrompido/);
  assert.match(interrompido, /Continuar o envio/);
});

test('envioDepoisDoLote: progresso acumula, e parar é interrupção, não sucesso', () => {
  const um = P.envioDepoisDoLote(MEDIDA, { ok: true, enviados: 50, restantes: 1190, concluido: false }, null);
  assert.deepEqual(um, { fase: 'enviando', medida: MEDIDA, parcial: { enviados: 50, restantes: 1190 } });
  const dois = P.envioDepoisDoLote(MEDIDA, { ok: true, enviados: 50, restantes: 1140, concluido: false }, um.parcial);
  assert.equal(dois.parcial.enviados, 100);
  assert.equal(P.envioDepoisDoLote(MEDIDA, { ok: true, enviados: 40, restantes: 0, concluido: true }, dois.parcial).fase, 'concluido');
  const parado = P.envioDepoisDoLote(MEDIDA, { ok: true, enviados: 0, restantes: 1140, concluido: false }, dois.parcial);
  assert.equal(parado.fase, 'falha', 'lote vazio não pode girar para sempre');
  assert.equal(parado.parcial.enviados, 100);
  assert.equal(P.envioDepoisDoLote(MEDIDA, { ok: false, code: 'medida-vencida' }, dois.parcial).fase, 'vencida');
  const caiu = P.envioDepoisDoLote(MEDIDA, null, dois.parcial);
  assert.equal(caiu.fase, 'falha');
  assert.equal(caiu.parcial.enviados, 100);
  assert.equal(P.envioDepoisDoLote(MEDIDA, null, null).parcial, null, 'sem progresso, falha simples');
});

test('revisoesCompartilhadasHtml: as que não abriram são contadas, com ou sem lista', () => {
  const uma = P.revisoesCompartilhadasHtml({ estado: 'lista', revisoes: [], naoAbriram: 1 });
  assert.match(uma, /1 revisão não abriu/);
  assert.match(uma, /nunca pela metade/);
  const duas = P.revisoesCompartilhadasHtml({ estado: 'lista', revisoes: [{ reviewId: 'a', t: 1, dev: 'x', aparelho: 'Desktop', veredito: 'approve' }], naoAbriram: 2 });
  assert.match(duas, /2 revisões não abriram/);
  assert.doesNotMatch(P.revisoesCompartilhadasHtml({ estado: 'lista', revisoes: [], naoAbriram: 0 }), /não abri/);
});

test('revisoesCompartilhadasHtml: o PR aparece pelo nome quando o catálogo abriu, e genérico quando não', () => {
  const base = { reviewId: 'a', t: 1, dev: 'x', aparelho: 'Desktop', veredito: 'approve', status: 'posted' };
  const html = P.revisoesCompartilhadasHtml({ estado: 'lista', revisoes: [{ ...base, pr: { key: 'acme-exemplo/app-web#35', title: 'Ajusta rodapé', author: 'ana-exemplo' } }, { ...base, reviewId: 'b', pr: null }] });
  assert.match(html, /href="https:\/\/github\.com\/acme-exemplo\/app-web\/pull\/35"/);
  assert.match(html, /Ajusta rodapé/);
  assert.match(html, /PR sem nome neste aparelho/);
});

test('operacoesRemotasHtml: operação recém-começada não mostra vírgula solta antes do modelo', () => {
  const op = { opId: 'o9', dev: 'x', aparelho: 'Notebook', situacao: 'viva', etapa: 'leitura', msPorEtapa: {}, subagentes: [], modelo: 'Opus 5', prTag: 'a'.repeat(32), tipo: 'review' };
  const html = P.operacoesRemotasHtml([op], {});
  assert.match(html, /Opus 5/);
  assert.doesNotMatch(html, />, Opus 5/, 'sem tempo, o modelo vem sozinho');
});

/* ---------- 7.C6: recibo que não é do alvo não vira desfecho na tela ---------- */

test('reciboEstado: recibo de terceiro não aparece como recusa do alvo', () => {
  const r = P.reciboEstado(CMD, null, AGORA, false, 'de-outro');
  assert.equal(r.estado, 'de-outro');
  assert.equal(r.classe, 'warn');
  assert.match(r.detalhe, /não é do aparelho alvo/);
});

test('reciboEstado: alvo desconhecido não vira esperando nem sucesso', () => {
  const r = P.reciboEstado(CMD, null, AGORA, false, 'alvo-desconhecido');
  assert.equal(r.estado, 'alvo-desconhecido');
  assert.match(r.detalhe, /não deu para conferir de quem ele é/);
});

test('reciboEstado: ausência continua sendo espera, e a conferência não muda isso', () => {
  const r = P.reciboEstado(CMD, null, AGORA, false, 'ausente');
  assert.equal(r.estado, 'enviado');
  assert.match(r.detalhe, /esperando o recibo/);
});

test('reciboEstado: com recibo do alvo, a conferência não atrapalha o desfecho', () => {
  const r = P.reciboEstado(CMD, { dev: 'dA', estado: 'aplicado', code: '', at: AGORA }, AGORA, false, 'do-alvo');
  assert.equal(r.estado, 'aplicado');
  assert.equal(r.classe, 'ok');
});
