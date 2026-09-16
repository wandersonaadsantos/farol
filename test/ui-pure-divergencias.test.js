// As funções PURAS que resolvem as divergências entre o desenho e o contrato das seções
// Aparelhos e Grupos de consumo (evidência tela-aparelhos-grupos.md, seções 2 e 7). Cada
// caso nomeia o item que resolve. A regra de fundo é a mesma das duas seções: a tela só
// afirma o que o engine afirma, e o dado que chegou agora vira texto sem virar promessa.
process.env.TZ = 'America/Sao_Paulo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
const P = await import('../ui/pure.js');

const AGORA = Date.parse('2026-09-16T12:00:00-03:00');
const MIN = 60 * 1000;
const ID = 'a'.repeat(32);

function aparelho(extra = {}) {
  return { deviceId: 'dEu', name: 'Notebook de teste', platform: 'Windows', farolVersion: '2.60.0', lastSeenAt: AGORA, retiredAt: 0, euMesmo: true, semPresenca: false, ...extra };
}

const VELHO = aparelho({ deviceId: 'dVelho', name: 'Desktop antigo', platform: 'Linux', farolVersion: '2.58.2', euMesmo: false });

/* ---------- item 4: tempo sem batimento ---------- */

test('item 4: admin sem batimento diz há quanto tempo, pelo instante que este aparelho observou', () => {
  const admin = { deviceId: 'dVelho', generation: 3, souEu: false, fresca: false, ultimoBatimentoEm: AGORA - 18 * MIN };
  const html = P.aparelhosAdminHtml(admin, { devices: [aparelho(), VELHO], agora: AGORA });
  assert.match(html, /sem batimento há 18min/);
  const nunca = P.aparelhosAdminHtml({ ...admin, ultimoBatimentoEm: 0 }, { devices: [VELHO], agora: AGORA });
  assert.match(nunca, /nenhum batimento observado desde que este aparelho conectou/);
  assert.doesNotMatch(nunca, /sem batimento há/, 'sem instante observado, nenhuma duração é inventada');
  const comigo = P.aparelhosAdminHtml({ deviceId: 'dEu', generation: 3, souEu: true, fresca: false, ultimoBatimentoEm: AGORA - 7 * MIN }, { devices: [aparelho()], agora: AGORA });
  assert.match(comigo, /sem batimento há 7min/);
  const vivo = P.aparelhosAdminHtml({ ...admin, fresca: true }, { devices: [VELHO], agora: AGORA });
  assert.doesNotMatch(vivo, /sem batimento/);
});

/* ---------- item 5: versão mínima e o caminho para atualizar ---------- */

test('item 5: a nota da garantia nomeia a versão mínima e leva a "Verificar atualização"', () => {
  const cobertura = [{ account: 'acme-exemplo', coberta: false, naoCobertaPor: ['Desktop antigo'] }];
  const html = P.aparelhosListaHtml([aparelho(), VELHO], { cobertura, agora: AGORA, versaoMinima: '2.59.4' });
  assert.match(html, /anterior à 2\.59\.4/);
  assert.match(html, /data-goto="sys:overview:#updateBox"[^>]*role="button"[^>]*tabindex="0"[^>]*>Como atualizar o Farol</);
  const semVersao = P.aparelhosListaHtml([aparelho(), VELHO], { cobertura, agora: AGORA });
  assert.match(semVersao, /anterior à da postagem coordenada/, 'sem o número no snapshot, a nota não inventa um');
  const coberta = P.aparelhosListaHtml([aparelho(), VELHO], { cobertura: [], agora: AGORA, versaoMinima: '2.59.4' });
  assert.doesNotMatch(coberta, /Como atualizar/, 'sem conta descoberta não há nota');
});

/* ---------- item 6: sem presença e primeiro aparelho ---------- */

test('item 6: aparelho sem presença ganha selo próprio, com o visto por último ao lado', () => {
  const sumido = aparelho({ deviceId: 'dSumido', name: 'Tablet', euMesmo: false, semPresenca: true, lastSeenAt: AGORA - 3 * 24 * 60 * MIN });
  const html = P.aparelhosListaHtml([aparelho(), sumido], { agora: AGORA });
  assert.match(html, /Tablet<span class="sync-chip mute">sem presença<\/span>/);
  assert.doesNotMatch(P.aparelhosListaHtml([aparelho(), VELHO], { agora: AGORA }), /sem presença/);
});

test('item 6: só este aparelho ativo na conta vira o estado "primeiro aparelho"', () => {
  assert.match(P.aparelhosListaHtml([aparelho()], { agora: AGORA }), /Só este aparelho na conta\. Nada é compartilhado até haver outro pronto\./);
  const comAposentado = [aparelho(), aparelho({ deviceId: 'dCel', name: 'Celular', euMesmo: false, retiredAt: AGORA })];
  assert.match(P.aparelhosListaHtml(comAposentado, { agora: AGORA }), /Só este aparelho na conta/);
  assert.doesNotMatch(P.aparelhosListaHtml([aparelho(), VELHO], { agora: AGORA }), /Só este aparelho/);
  assert.doesNotMatch(P.aparelhosListaHtml([VELHO], { agora: AGORA }), /Só este aparelho/, 'sem este aparelho na lista, não é o primeiro');
});

/* ---------- item 3: recusar o pedido de designação ---------- */

test('item 3: o pedido de designação oferece aceitar com a senha e recusar', () => {
  const html = P.aparelhosDesignacaoHtml({ desde: AGORA }, AGORA);
  assert.match(html, /id="aparAceitarDesignacao"/);
  assert.match(html, /id="aparRecusarDesignacao"/);
});

/* ---------- item 17: o olho da senha ---------- */

test('item 17: syncOlhoHtml sai pela fachada, e sem alvo mantém o botão da Sincronização como era', () => {
  const padrao = P.syncOlhoHtml(false);
  assert.match(padrao, /id="syncSenhaOlho"/);
  assert.doesNotMatch(padrao, /data-olho-de/, 'o olho da Sincronização segue com o handler dela');
  const alvo = P.syncOlhoHtml(true, 'aparSenhaAdmin');
  assert.match(alvo, /id="aparSenhaAdminOlho"/);
  assert.match(alvo, /data-olho-de="aparSenhaAdmin"/);
  assert.match(alvo, /aria-pressed="true"/);
});

test('item 17: os campos de senha novos têm o olho, dentro da moldura do campo', () => {
  const admin = P.aparelhosAdminHtml(null, { devices: [aparelho()] });
  assert.match(admin, /<span class="sync-senha"><input id="aparSenhaAdmin"[^>]*type="password"[^>]*>[\s\S]*?data-olho-de="aparSenhaAdmin"/);
  const designacao = P.aparelhosDesignacaoHtml({ desde: AGORA }, AGORA);
  assert.match(designacao, /data-olho-de="aparSenhaDesignacao"/);
  assert.match(P.aparelhosCampoSenhaModal(), /<input id="aparModalSenha"[^>]*type="password"[^>]*>[\s\S]*?data-olho-de="aparModalSenha"/);
});

/* ---------- itens 1 e 2: a política aberta com o valor vigente ---------- */

const POL = { pausado: true, tetoParalelismo: 2, tiposDeOperacao: ['review', 'self'], contasElegiveis: ['f'.repeat(32)] };

function marcado(html, valor) {
  return new RegExp(`class="apar-tipo-check" value="${valor}" checked`).test(html);
}

test('item 2: o formulário abre com a política vigente no banco, e diz a versão publicada', () => {
  const html = P.aparelhoPoliticaHtml(VELHO, { leitura: { estado: 'ok', existe: true, valida: true, versao: 5, politica: POL } });
  assert.match(html, /publicada, versão 5/);
  assert.match(html, /id="aparPolPausado" checked/);
  assert.match(html, /<option value="2" selected>/);
  assert.ok(marcado(html, 'review') && marcado(html, 'self'));
  assert.ok(!marcado(html, 'chat') && !marcado(html, 'tool') && !marcado(html, 'pushback'), 'tipo fora da política não vem marcado');
  assert.match(html, /contas elegíveis/i, 'o que a tela não edita é dito, e preservado');
});

test('item 2: campo que a política não opina abre como "vale o do aparelho", não como o mínimo', () => {
  const html = P.aparelhoPoliticaHtml(VELHO, { leitura: { estado: 'ok', existe: true, valida: true, versao: 1, politica: { pausado: false } } });
  assert.match(html, /<option value="" selected>não definir \(vale o do aparelho\)<\/option>/);
  for (const t of ['review', 'self', 'pushback', 'chat', 'tool']) assert.ok(marcado(html, t), `${t} sem opinião remota abre marcado`);
});

test('item 2: carregando, sem política, inválida e falha são quatro saídas diferentes', () => {
  assert.match(P.aparelhoPoliticaHtml(VELHO, { leitura: { estado: 'carregando' } }), /lendo a política vigente/);
  assert.match(P.aparelhoPoliticaHtml(VELHO, { leitura: { estado: 'ok', existe: false } }), /nenhuma política publicada/);
  const invalida = P.aparelhoPoliticaHtml(VELHO, { leitura: { estado: 'ok', existe: true, valida: false, code: 'geracao' } });
  assert.match(invalida, /não se prova/);
  assert.doesNotMatch(invalida, /publicada, versão/);
  const falha = P.aparelhoPoliticaHtml(VELHO, { leitura: { estado: 'falha', motivo: 'não deu para ler a política agora' } });
  assert.match(falha, /não deu para ler a política agora/);
  assert.match(falha, /substitui a política inteira/);
});

test('item 1: o formulário diz que o aceite acontece no destino e não volta para cá', () => {
  const html = P.aparelhoPoliticaHtml(VELHO, { leitura: { estado: 'ok', existe: false } });
  assert.match(html, /aceite acontece no aparelho de destino e não volta para esta tela/);
  assert.doesNotMatch(html, /aceita pelo aparelho/);
});

test('item 2: publicar preserva o que a tela não edita e omite o teto não definido', () => {
  const lida = { estado: 'ok', existe: true, valida: true, versao: 3, politica: POL };
  const doForm = { pausado: false, tetoParalelismo: null, tiposDeOperacao: ['review'] };
  assert.deepEqual(P.aparelhoPoliticaParaPublicar(lida, doForm), { pausado: false, tiposDeOperacao: ['review'], contasElegiveis: POL.contasElegiveis });
  const comTeto = P.aparelhoPoliticaParaPublicar(lida, { ...doForm, tetoParalelismo: 3 });
  assert.equal(comTeto.tetoParalelismo, 3);
  const invalida = P.aparelhoPoliticaParaPublicar({ estado: 'ok', existe: true, valida: false }, doForm);
  assert.deepEqual(invalida, { pausado: false, tiposDeOperacao: ['review'] }, 'conteúdo que não se prova não é reaproveitado');
  assert.deepEqual(P.aparelhoPoliticaParaPublicar(null, doForm), { pausado: false, tiposDeOperacao: ['review'] });
});

/* ---------- item 18: datas dos navegadores ---------- */

test('item 18: a linha do navegador tem classe própria, para o estreito mostrar pareado e usado', () => {
  const html = P.aparelhosNavegadoresHtml({ estado: 'ok', sessoes: [{ id: 'abc', rotulo: 'Chrome', criadoEm: AGORA, ultimoUsoEm: AGORA }] }, AGORA);
  assert.match(html, /class="sync-linha apar-sessao"/);
});

/* ---------- itens 8 e 9: limpeza em andamento e categorias ---------- */

const LISTAS = { categorias: ['panorama', 'usageDaily', 'noNovo'], nuncaApagadas: ['keyring', 'receipts', 'live/control'] };

test('item 8: trava viva no banco é "limpando", com o prazo, e sem botão de limpar', () => {
  const ate = AGORA + 7 * MIN;
  const html = P.aparelhosLimpezaHtml({ estado: 'ligada', travada: { dev: 'dVelho', ate }, ...LISTAS }, { souAdmin: true, devices: [VELHO], agora: AGORA });
  assert.match(html, /sync-chip warn">limpando</);
  assert.match(html, /Desktop antigo/);
  assert.match(html, /trava vale até hoje 12:07/);
  assert.doesNotMatch(html, /id="aparLimpar"/);
  const local = P.aparelhosLimpezaHtml({ estado: 'ligada', travada: null, ...LISTAS }, { souAdmin: true, limpando: true, agora: AGORA });
  assert.match(local, /limpando/);
  assert.doesNotMatch(local, /id="aparLimpar"/, 'o clique em andamento não oferece um segundo');
});

test('item 9: as categorias e as nunca apagadas vêm do engine, com rótulo, e o desconhecido sai como está', () => {
  const html = P.aparelhosLimpezaHtml({ estado: 'ligada', travada: null, ...LISTAS }, { souAdmin: true });
  assert.match(html, /Panorama/);
  assert.match(html, /consumo diário/);
  assert.match(html, /noNovo/);
  assert.match(html, /chaveiro/);
  assert.match(html, /recibos/);
  assert.match(html, /controle do conjunto/);
  const semLista = P.aparelhosLimpezaHtml({ estado: 'falha', motivo: 'x' }, { souAdmin: true });
  assert.doesNotMatch(semLista, /Nunca apagados/, 'sem a lista do engine a tela não escreve a própria');
});

test('item 9: o resultado da limpeza nomeia o que falhou, e falha parcial não é sucesso limpo', () => {
  const tudo = P.aparelhosResultadoDaLimpeza({ ok: true, apagadas: ['panorama', 'usageDaily'], falharam: [], corteGravado: true });
  assert.equal(tudo.tipo, 'ok');
  assert.match(tudo.texto, /2 categorias apagadas/);
  const parcial = P.aparelhosResultadoDaLimpeza({ ok: true, apagadas: ['panorama'], falharam: ['usageDaily'], corteGravado: true });
  assert.equal(parcial.tipo, 'error');
  assert.match(parcial.texto, /consumo diário/);
  const semCorte = P.aparelhosResultadoDaLimpeza({ ok: true, apagadas: ['panorama'], falharam: [], corteGravado: false });
  assert.equal(semCorte.tipo, 'error');
  assert.match(semCorte.texto, /corte/);
  const recusa = P.aparelhosResultadoDaLimpeza({ ok: false, motivo: 'a chave de limpeza de dados sincronizados está desligada' });
  assert.equal(recusa.tipo, 'error');
  assert.match(recusa.texto, /a chave de limpeza de dados sincronizados está desligada/);
});

/* ---------- item 10: revogar não retira o consentimento ---------- */

test('item 10: o cartão de revogar separa o corte de acesso do consentimento deste aparelho', () => {
  const html = P.aparelhosLimpezaHtml({ estado: 'desligada' }, {});
  assert.match(html, /não retira o consentimento deste aparelho/);
  assert.doesNotMatch(html, /e retira o consentimento/);
});

/* ---------- item 16: o que ainda não está valendo ---------- */

test('item 16: Aparelhos repete o cartão do que não está valendo, marcado para o estreito', () => {
  const capacidades = { autenticacaoLocal: { modoCelular: true, exigida: false }, compartilhamento: { pedido: true, aplicado: false }, tetoGrupo: { configurado: false, aplicado: false } };
  const html = P.aparelhosSecaoHtml({ sync: { devices: [aparelho()], admin: null }, cfg: { enabled: true }, auth: { estado: 'nao-exigida' }, limpeza: { estado: 'desligada' }, agora: AGORA, capacidades });
  assert.match(html, /<div class="apar-so-estreito"><div class="card cap-card">/);
  assert.match(html, /O que ainda não está valendo/);
  const semNada = P.aparelhosSecaoHtml({ sync: { devices: [aparelho()] }, cfg: { enabled: true }, agora: AGORA, capacidades: { autenticacaoLocal: {}, compartilhamento: {}, tetoGrupo: {} } });
  assert.doesNotMatch(semNada, /apar-so-estreito/, 'nada indisponível, nada de cartão');
});

/* ---------- item 15: a lista da Sincronização aponta para Aparelhos ---------- */

test('item 15: a lista de aparelhos da Sincronização leva à seção que administra', () => {
  const html = P.syncSecaoHtml({ devices: [aparelho()] }, { enabled: true }, {}, null, '');
  assert.match(html, /data-goto="sys:devices"[^>]*role="button"[^>]*tabindex="0"[^>]*>Administrar em Aparelhos</);
});

/* ---------- item 11: o que a soma do grupo sabe ---------- */

function grupo(extra = {}) {
  return {
    id: ID, nome: 'Grupo do laboratório', periodo: 'mes', tetoUsd: 30, controlados: [], naoControlados: [], ativo: true, estado: 'ativo', requisitos: [],
    verificavel: true, custoUsd: 12, parcialmenteEstimado: false, motivos: [], calculadoEm: AGORA - 2 * MIN, tetoAtingido: false, projecaoUsd: 0, ...extra,
  };
}

test('item 11: não verificável diz o motivo com o nome do aparelho, e leva a Aparelhos', () => {
  const g = grupo({ verificavel: false, motivos: [{ dev: 'dVelho', motivo: 'sem-dados' }, { dev: 'dX', motivo: 'inventado' }], tetoAtingido: null, projecaoUsd: null });
  const html = P.grupoCartaoHtml(g, { devices: [VELHO], agora: AGORA });
  assert.match(html, /não verificável/);
  assert.match(html, /o Desktop antigo não enviou dados do período/);
  assert.match(html, /inventado \(dX\)/, 'motivo desconhecido sai como está');
  assert.match(html, /data-goto="sys:devices"[^>]*role="button"[^>]*tabindex="0"[^>]*>Ver aparelhos</);
  const velho = P.grupoCartaoHtml(grupo({ verificavel: false, motivos: [{ dev: '', motivo: 'retrato-velho' }] }), { agora: AGORA });
  assert.match(velho, /a soma deste aparelho está velha/);
  assert.doesNotMatch(velho, /Ver aparelhos/, 'sem aparelho a apontar, sem botão');
});

test('item 11: verificado mostra a hora em que a soma fechou', () => {
  const html = P.grupoCartaoHtml(grupo(), { agora: AGORA });
  assert.match(html, /verificado/);
  assert.match(html, /soma fechada às 11:58/);
});

test('item 11: teto atingido ganha selo, texto de teto macio e a projeção separada do gasto', () => {
  const html = P.grupoCartaoHtml(grupo({ custoUsd: 30.4, tetoAtingido: true, projecaoUsd: 0.7 }), { agora: AGORA });
  assert.match(html, /sync-chip bad">teto atingido</);
  assert.match(html, /teto é macio/);
  assert.match(html, /Projeção com as reservas abertas: US\$ 0\.70 \(projeção, não gasto\)/);
  assert.match(html, /sync-card bad/);
  const folga = P.grupoCartaoHtml(grupo({ projecaoUsd: 0 }), { agora: AGORA });
  assert.doesNotMatch(folga, /teto atingido|Projeção com/);
  const comReserva = P.grupoCartaoHtml(grupo({ projecaoUsd: 1.5 }), { agora: AGORA });
  assert.match(comReserva, /Projeção com as reservas abertas: US\$ 1\.50/);
  assert.doesNotMatch(comReserva, /teto atingido/);
});

/* ---------- itens 12 e 14: vínculo conhecido e perfil não identificado ---------- */

const PERFIS = [
  { id: 'pLab', label: 'Chave de laboratório', kind: 'apikey' },
  { id: 'pPessoal', label: 'Pessoal' },
  { id: 'pOutro', label: 'Outro', kind: 'openrouter' },
];

test('item 12: o vínculo vem do snapshot, inclusive para grupo que não chegou aqui', () => {
  const vinculos = { pLab: { grupo: ID, tipo: 'api', desde: AGORA }, pPessoal: { grupo: 'b'.repeat(32), tipo: 'assinatura', desde: AGORA } };
  const html = P.gruposPerfisHtml(PERFIS, [grupo({ controlados: [] })], vinculos);
  assert.match(html, /Chave de laboratório[\s\S]*?no Grupo do laboratório[\s\S]*?data-grupo-desvincular="pLab"/);
  assert.match(html, /Pessoal[\s\S]*?vinculado a um grupo que não chegou a este aparelho[\s\S]*?data-grupo-desvincular="pPessoal"/);
  assert.match(html, /Outro[\s\S]*?sync-chip mute">sem grupo<[\s\S]*?data-grupo-vincular="pOutro"/);
  assert.doesNotMatch(html, /sem grupo conhecido/);
});

test('item 14: sem perfil salvo, a assinatura em uso é "não identificado", com o caminho para Plano e chaves', () => {
  const html = P.gruposPerfisHtml([], [grupo()], {});
  assert.match(html, /não identificado/);
  assert.match(html, /sem id estável/);
  assert.match(html, /data-goto="sys:plans"[^>]*role="button"[^>]*tabindex="0"/);
});

/* ---------- item 13: grupo publicado esperando o aceite ---------- */

test('item 13: grupo publicado aqui aparece como esperando o aceite até chegar pelo snapshot', () => {
  const pendentes = [{ id: 'd'.repeat(32), nome: 'Grupo novo', versao: 1 }, { id: ID, nome: 'Já chegou', versao: 2 }];
  const html = P.gruposSecaoHtml({ sync: { shared: true, gruposDeConsumo: [grupo()] }, cfg: { enabled: true, aceitarAdmin: true }, perfis: [], souAdmin: true, pendentes, agora: AGORA });
  assert.match(html, /Grupo novo[\s\S]*?publicado na versão 1/);
  assert.match(html, /aparece aqui quando o próximo ciclo o aceitar/);
  assert.doesNotMatch(html, /Já chegou/, 'o que já chegou pelo snapshot não fica duplicado');
  const semConsentimento = P.gruposSecaoHtml({ sync: { shared: true, gruposDeConsumo: [] }, cfg: { enabled: true, aceitarAdmin: false }, perfis: [], souAdmin: true, pendentes, agora: AGORA });
  assert.match(semConsentimento, /Grupo novo[\s\S]*?este aparelho não aceita configuração de admin, então o grupo não volta para esta lista/);
});
