// As funções PURAS da seção Sistema > Grupos de consumo (ui/pure/grupos.js). Sem DOM: cada
// uma recebe a projeção `sync.gruposDeConsumo` (resumoParaTela, em
// lib/engine/sync-consumo-grupo.js), os perfis da config e devolve HTML ou o corpo de rota.
//
// O que está em jogo é o que a tela AFIRMA sobre o orçamento:
//   - teto configurado e não ativo NUNCA ganha selo de protegido;
//   - grupo marcado ativo com requisito faltando não barra nada (o engine o descarta em
//     gruposAtivos), e a tela não pode dizer o contrário;
//   - soma não calculada não é "US$ 0,00";
//   - Codex é não controlado, em seção própria, nunca consumo zero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const P = await import('../ui/pure.js');

const ID = 'a'.repeat(32);

function grupo(extra = {}) {
  return {
    id: ID, nome: 'Grupo do time', periodo: 'mes', tetoUsd: 120, controlados: [], naoControlados: [],
    ativo: false, estado: 'configurado', requisitos: ['medicao-pendente'], verificavel: null, custoUsd: null, parcialmenteEstimado: false, ...extra,
  };
}

const PERFIS = [
  { id: 'pPessoal', label: 'Pessoal' },
  { id: 'pLab', label: 'Chave de laboratório', kind: 'apikey' },
  { id: 'pCodex', label: 'Codex', kind: 'codex' },
  { id: 'pRoteador', label: 'Roteador', kind: 'openrouter' },
];

/* ---------- tipo do perfil ---------- */

test('grupoTipoDoPerfil: o tipo do vínculo sai do kind do perfil, na allowlist do engine', () => {
  assert.equal(P.grupoTipoDoPerfil({ id: 'x' }), 'assinatura', 'perfil de pasta não carrega kind e é assinatura');
  assert.equal(P.grupoTipoDoPerfil({ kind: 'apikey' }), 'api');
  assert.equal(P.grupoTipoDoPerfil({ kind: 'openrouter' }), 'openrouter');
  assert.equal(P.grupoTipoDoPerfil({ kind: 'codex' }), 'codex');
  assert.equal(P.grupoTipoDoPerfil({ kind: 'inventado' }), '', 'kind desconhecido não vira tipo controlado por omissão');
});

/* ---------- selo e estados ---------- */

test('grupoCartaoHtml: teto configurado e não ativo não ganha selo de protegido', () => {
  const html = P.grupoCartaoHtml(grupo(), { perfis: PERFIS });
  assert.match(html, /teto configurado, ainda não ativo/);
  assert.ok(!/sync-chip ok[^"]*">ativo/.test(html), 'configurado não é ativo');
  assert.ok(!html.includes('verificado'), 'nada foi verificado num grupo inativo');
  assert.match(html, /medir o atraso real do consumo entre dois aparelhos/);
});

test('grupoCartaoHtml: grupo sem teto só soma, e diz isso', () => {
  const html = P.grupoCartaoHtml(grupo({ estado: 'sem-teto', tetoUsd: undefined }), { perfis: PERFIS });
  assert.match(html, /sem teto/);
  assert.match(html, /nada segura/);
});

test('grupoCartaoHtml: não identificado é estado próprio', () => {
  assert.match(P.grupoCartaoHtml(grupo({ estado: 'nao-identificado', id: '' }), {}), /não identificado/);
});

test('grupoCartaoHtml: marcado ativo com requisito faltando NÃO aparece como protegido', () => {
  const html = P.grupoCartaoHtml(grupo({ ativo: true, estado: 'ativo', requisitos: ['compartilhamento'] }), { perfis: PERFIS });
  assert.match(html, /sem efeito neste aparelho/);
  assert.ok(!html.includes('verificado'));
  assert.match(html, /ligar o compartilhamento cifrado/);
});

test('grupoCartaoHtml: ativo e verificável mostra o gasto do período', () => {
  const html = P.grupoCartaoHtml(grupo({ ativo: true, estado: 'ativo', requisitos: [], verificavel: true, custoUsd: 64.2 }), { perfis: PERFIS });
  assert.match(html, /verificado/);
  assert.match(html, /US\$ 64\.20/);
  assert.match(html, /US\$ 120\.00/);
});

test('grupoCartaoHtml: não verificável segura o automático e o clique, sem estacionar', () => {
  const html = P.grupoCartaoHtml(grupo({ ativo: true, estado: 'ativo', requisitos: [], verificavel: false, custoUsd: 10 }), { perfis: PERFIS });
  assert.match(html, /não verificável/);
  assert.match(html, /inclusive as de clique/);
  assert.match(html, /sem estacionar/);
});

test('grupoCartaoHtml: soma ainda não calculada não vira zero', () => {
  const html = P.grupoCartaoHtml(grupo({ ativo: true, estado: 'ativo', requisitos: [], verificavel: null, custoUsd: null }), { perfis: PERFIS });
  assert.ok(!html.includes('US$ 0.00'), 'soma ausente não é gasto zero');
  assert.match(html, /ainda não calculad/);
});

test('grupoCartaoHtml: parcialmente estimado é declarado', () => {
  const html = P.grupoCartaoHtml(grupo({ ativo: true, estado: 'ativo', requisitos: [], verificavel: true, custoUsd: 13.2, parcialmenteEstimado: true }), { perfis: PERFIS });
  assert.match(html, /parcialmente estimado/);
});

test('grupoCartaoHtml: controlados pelo rótulo do perfil, e Codex em seção própria sem valor', () => {
  const html = P.grupoCartaoHtml(grupo({ controlados: ['pPessoal', 'pLab'], naoControlados: ['pCodex'] }), { perfis: PERFIS });
  assert.match(html, /Pessoal/);
  assert.match(html, /Chave de laboratório/);
  assert.match(html, /Não controlados/);
  assert.match(html, /Codex/);
  assert.match(html, /não entra na soma/);
});

test('grupoCartaoHtml: perfil vinculado que não está na config aparece pelo id, não some', () => {
  const html = P.grupoCartaoHtml(grupo({ controlados: ['pSumido'] }), { perfis: PERFIS });
  assert.match(html, /pSumido/);
});

test('grupoCartaoHtml: só o admin ativa, e só com a lista do que falta vazia', () => {
  const pronto = grupo({ requisitos: [] });
  assert.match(P.grupoCartaoHtml(pronto, { souAdmin: true }), new RegExp(`data-grupo-ativar="${ID}"`));
  assert.ok(!P.grupoCartaoHtml(pronto, { souAdmin: false }).includes('data-grupo-ativar'));
  assert.ok(!P.grupoCartaoHtml(grupo(), { souAdmin: true }).includes('data-grupo-ativar'), 'com requisito faltando não existe ativar');
  assert.match(P.grupoCartaoHtml(grupo(), { souAdmin: true }), new RegExp(`data-grupo-editar="${ID}"`));
  const ativo = grupo({ ativo: true, estado: 'ativo', requisitos: [], verificavel: true, custoUsd: 1 });
  assert.match(P.grupoCartaoHtml(ativo, { souAdmin: true }), new RegExp(`data-grupo-desativar="${ID}"`));
});

test('grupoCartaoHtml: escapa o nome do grupo', () => {
  const html = P.grupoCartaoHtml(grupo({ nome: '<b>x</b>' }), {});
  assert.ok(!html.includes('<b>x</b>'));
});

/* ---------- perfis e vínculo ---------- */

test('gruposPerfisHtml: perfil sem vínculo é declarado e ganha o vincular', () => {
  const html = P.gruposPerfisHtml(PERFIS, [grupo({ controlados: ['pPessoal'] })]);
  assert.match(html, /sem grupo/);
  assert.match(html, /data-grupo-vincular="pLab"/);
  assert.match(html, /data-grupo-desvincular="pPessoal"/);
  assert.ok(!html.includes('data-grupo-desvincular="pLab"'), 'desvincular só existe para quem tem vínculo');
});

test('gruposPerfisHtml: sem grupo com identidade não oferece vincular (não há para onde)', () => {
  const html = P.gruposPerfisHtml(PERFIS, []);
  assert.ok(!html.includes('data-grupo-vincular'));
  assert.match(html, /nenhum grupo/i);
});

test('gruposPerfisHtml: sem perfil salvo, diz isso', () => {
  assert.match(P.gruposPerfisHtml([], [grupo()]), /Nenhum perfil/);
});

/* ---------- formulário e corpo da rota ---------- */

test('grupoNovoId: 16 bytes viram 32 hex minúsculos, o formato que o engine aceita', () => {
  const bytes = Array.from({ length: 16 }, (_, i) => i * 17);
  const id = P.grupoNovoId(bytes);
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.equal(id.slice(0, 4), '0011');
  assert.equal(P.grupoNovoId([1, 2]), '', 'entropia curta não vira id');
});

test('grupoCorpoDaRota: teto vazio é omitido, nunca zero; ativo só vai quando pedido', () => {
  assert.deepEqual(P.grupoCorpoDaRota({ id: ID, nome: ' Time ', periodo: 'semana', teto: '' }), { id: ID, nome: 'Time', periodo: 'semana' });
  assert.deepEqual(P.grupoCorpoDaRota({ id: ID, nome: 'Time', periodo: 'mes', teto: '12,5' }), { id: ID, nome: 'Time', periodo: 'mes', tetoUsd: 12.5 });
  assert.deepEqual(P.grupoCorpoDaRota({ id: ID, nome: 'Time', periodo: 'mes', teto: '-3' }), { id: ID, nome: 'Time', periodo: 'mes' }, 'teto negativo é descartado, como no engine');
  assert.deepEqual(P.grupoCorpoDaRota({ id: ID, nome: 'Time', periodo: 'mes', teto: '10', ativo: true }), { id: ID, nome: 'Time', periodo: 'mes', tetoUsd: 10, ativo: true });
});

test('grupoCorpoDoGrupo: republicar um grupo preserva nome, período e teto, e troca só o ativo', () => {
  const g = grupo({ tetoUsd: 30 });
  assert.deepEqual(P.grupoCorpoDoGrupo(g, true), { id: ID, nome: 'Grupo do time', periodo: 'mes', tetoUsd: 30, ativo: true });
  assert.deepEqual(P.grupoCorpoDoGrupo(grupo({ tetoUsd: undefined }), false), { id: ID, nome: 'Grupo do time', periodo: 'mes', ativo: false });
});

test('grupoFormHtml: período só dos três do engine, e o valor atual preenchido', () => {
  const html = P.grupoFormHtml(grupo({ periodo: 'semana', tetoUsd: 30 }));
  for (const p of ['dia', 'semana', 'mes']) assert.match(html, new RegExp(`value="${p}"`));
  assert.match(html, /value="semana" selected/);
  assert.match(html, /value="30"/);
  assert.match(html, /id="grupoSalvar"/);
  assert.match(P.grupoFormHtml(null), /Novo grupo/);
});

/* ---------- a seção inteira ---------- */

test('gruposSecaoHtml: sincronização desligada leva à Sincronização, não mostra lista vazia', () => {
  const html = P.gruposSecaoHtml({ cfg: { enabled: false }, sync: {} });
  assert.match(html, /data-goto="sys:sync"/);
  assert.ok(!html.includes('Nenhum grupo'));
});

test('gruposSecaoHtml: sem consentimento, a ausência de grupo é explicada e não parece vazio legítimo', () => {
  const html = P.gruposSecaoHtml({ cfg: { enabled: true, aceitarAdmin: false }, sync: { shared: true, gruposDeConsumo: [] }, perfis: PERFIS });
  assert.match(html, /não aceita configuração de admin/);
  assert.match(html, /data-goto="sys:devices"/);
});

test('gruposSecaoHtml: compartilhamento desligado é dito, e grupo nenhum chega', () => {
  const html = P.gruposSecaoHtml({ cfg: { enabled: true, aceitarAdmin: true }, sync: { shared: false, gruposDeConsumo: [] }, perfis: PERFIS });
  assert.match(html, /compartilhamento cifrado está desligado/);
});

test('gruposSecaoHtml: quem não é admin vê, vincula, e não cria', () => {
  const html = P.gruposSecaoHtml({ cfg: { enabled: true, aceitarAdmin: true }, sync: { shared: true, gruposDeConsumo: [grupo()] }, perfis: PERFIS, souAdmin: false });
  assert.match(html, /Só o admin cria e ativa grupos/);
  assert.ok(!html.includes('id="grupoNovo"'));
  assert.match(html, /Grupo do time/);
  const admin = P.gruposSecaoHtml({ cfg: { enabled: true, aceitarAdmin: true }, sync: { shared: true, gruposDeConsumo: [] }, perfis: PERFIS, souAdmin: true });
  assert.match(admin, /id="grupoNovo"/);
  assert.match(admin, /Nenhum grupo de consumo/);
});
