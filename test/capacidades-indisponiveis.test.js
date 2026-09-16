// Estados de indisponibilidade (adendo de 16/09/2026, item 5): a tela NUNCA mostra como
// ativa uma proteção que o engine não está aplicando, e diz por que ela está de fora.
// O caso que motiva: a A4 tem o núcleo pronto e a ativação automática desligada; o teto do
// grupo (C4b) é configurável e não gateia nada até a medição existir; e no celular sem
// autenticação exigida o engine DESLIGA o compartilhamento, mesmo com a config ligada.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-capacidades-'));
process.env.FAROL_HOME = BASE;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { estadoDasCapacidades } = await import('../lib/engine/capacidades.js');
const { capacidadesIndisponiveis, capacidadesIndisponiveisHtml, syncSecaoHtml, esc } = await import('../ui/pure.js');

after(() => { try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* best-effort */ } });

const DESKTOP = { modoCelular: false, ativacaoA4: false, ativacaoTetoGrupo: false, config: {}, bloqueio: '', grupoConfigurado: false };

test('no desktop, sem nada configurado, não há capacidade prometida e não aplicada', () => {
  assert.deepEqual(capacidadesIndisponiveis(estadoDasCapacidades(DESKTOP)), []);
});

test('autenticação local: núcleo pronto, ativação automática desligada, e a tela diz isso', () => {
  const e = estadoDasCapacidades({ ...DESKTOP, modoCelular: true });
  assert.equal(e.autenticacaoLocal.exigida, false);
  assert.equal(e.autenticacaoLocal.modoCelular, true);
  const itens = capacidadesIndisponiveis(e);
  const alvo = itens.find((i) => i.id === 'autenticacao-local');
  assert.ok(alvo);
  assert.equal(alvo.estado, 'indisponivel');
  assert.match(alvo.motivo, /não está sendo exigida/i);
  assert.match(alvo.oQueFalta, /tela de pareamento/i);
});

test('com a exigência ligada pelo arquivo, a autenticação sai da lista de indisponíveis', () => {
  const e = estadoDasCapacidades({ ...DESKTOP, modoCelular: true, config: { localAuth: 'exigir' } });
  assert.equal(e.autenticacaoLocal.exigida, true);
  assert.equal(capacidadesIndisponiveis(e).some((i) => i.id === 'autenticacao-local'), false);
});

test('compartilhamento ligado na config e desligado pelo engine aparece como bloqueado, nunca como ligado', () => {
  const e = estadoDasCapacidades({
    ...DESKTOP, modoCelular: true,
    config: { enabled: true, shared: { enabled: true }, distribution: { enabled: true } },
    bloqueio: 'autenticacao-local',
  });
  assert.equal(e.compartilhamento.pedido, true);
  assert.equal(e.compartilhamento.aplicado, false);
  const alvo = capacidadesIndisponiveis(e).find((i) => i.id === 'compartilhamento');
  assert.ok(alvo);
  assert.equal(alvo.estado, 'bloqueado');
  assert.match(alvo.motivo, /autenticação/i);
});

test('o caso real do celular: a config JÁ vem zerada pela guarda, e o bloqueio prova o pedido', () => {
  // medido em 16/09/2026 numa instância isolada com TERMUX_VERSION: o engine zera shared e
  // distribution no boot, então a configuração não serve como sinal de "foi pedido"
  const e = estadoDasCapacidades({
    ...DESKTOP, modoCelular: true,
    config: { enabled: true, shared: { enabled: false }, distribution: { enabled: false } },
    bloqueio: 'autenticacao-local',
  });
  assert.equal(e.compartilhamento.pedido, true);
  assert.equal(e.compartilhamento.aplicado, false);
  assert.equal(capacidadesIndisponiveis(e).some((i) => i.id === 'compartilhamento'), true);
});

test('teto do grupo configurado sem estar aplicado é "configurado, ainda não vale"', () => {
  const e = estadoDasCapacidades({ ...DESKTOP, config: { enabled: true }, grupoConfigurado: true });
  assert.equal(e.tetoGrupo.configurado, true);
  assert.equal(e.tetoGrupo.aplicado, false);
  const alvo = capacidadesIndisponiveis(e).find((i) => i.id === 'teto-grupo');
  assert.ok(alvo);
  assert.equal(alvo.estado, 'configurado-sem-efeito');
  assert.match(alvo.motivo, /não segura nenhuma sessão/i);
});

test('teto do grupo sem grupo nenhum não vira aviso', () => {
  assert.equal(capacidadesIndisponiveis(estadoDasCapacidades({ ...DESKTOP, config: { enabled: true } })).some((i) => i.id === 'teto-grupo'), false);
  assert.equal(capacidadesIndisponiveis(estadoDasCapacidades({ ...DESKTOP, grupoConfigurado: true, ativacaoTetoGrupo: true })).some((i) => i.id === 'teto-grupo'), false, 'com a ativação valendo, não é aviso');
});

test('cada item diz o que já existe, para não parecer que a capacidade não foi feita', () => {
  const e = estadoDasCapacidades({ ...DESKTOP, modoCelular: true, grupoConfigurado: true, config: { enabled: true, shared: { enabled: true } }, bloqueio: 'autenticacao-local' });
  const itens = capacidadesIndisponiveis(e);
  assert.equal(itens.length, 3);
  for (const i of itens) {
    assert.ok(i.titulo && i.motivo && i.oQueFalta, `item ${i.id} completo`);
    assert.ok(['indisponivel', 'bloqueado', 'configurado-sem-efeito'].includes(i.estado));
  }
});

test('o snapshot do engine leva o estado das capacidades, com as ativações reais', () => {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  const s = e.snapshot();
  assert.equal(typeof s.capacidades, 'object');
  assert.equal(s.capacidades.autenticacaoLocal.ativacaoAutomatica, false, 'a ativação da A4 continua desligada');
  assert.equal(s.capacidades.tetoGrupo.aplicado, false, 'o teto do grupo continua sem efeito');
  assert.equal(s.capacidades.autenticacaoLocal.modoCelular, false, 'esta máquina não é celular');
});

test('a proteção só é anunciada como ativa quando o engine está mesmo aplicando', () => {
  const e = estadoDasCapacidades({ ...DESKTOP, modoCelular: true, config: { localAuth: 'exigir', enabled: true, shared: { enabled: true } }, bloqueio: '' });
  assert.equal(e.autenticacaoLocal.exigida, true);
  assert.equal(e.compartilhamento.aplicado, true);
  assert.deepEqual(capacidadesIndisponiveis(e), []);
});

// --- o cartão da tela -------------------------------------------------------------

test('sem nada indisponível, não há cartão: silêncio é a mensagem certa', () => {
  assert.equal(capacidadesIndisponiveisHtml(estadoDasCapacidades(DESKTOP)), '');
  assert.equal(capacidadesIndisponiveisHtml(null), '');
});

test('o cartão aparece na seção de sincronização, inclusive com a chave geral desligada', () => {
  const caps = estadoDasCapacidades({ ...DESKTOP, modoCelular: true });
  const desligada = syncSecaoHtml({}, { enabled: false }, null, caps);
  assert.match(desligada, /O que ainda não está valendo/);
  assert.match(desligada, /Autenticação da API local/);
  const ligada = syncSecaoHtml({}, { enabled: true }, null, caps);
  assert.match(ligada, /O que ainda não está valendo/);
  assert.equal(syncSecaoHtml({}, { enabled: true }, null, estadoDasCapacidades(DESKTOP)).includes('O que ainda não está valendo'), false);
});

test('o cartão mostra o motivo e o que falta de cada item, não só o título', () => {
  const caps = estadoDasCapacidades({ ...DESKTOP, modoCelular: true });
  const html = capacidadesIndisponiveisHtml(caps);
  const item = capacidadesIndisponiveis(caps)[0];
  // o HTML vem escapado (o texto tem aspas), então a comparação é contra o texto escapado
  assert.ok(html.includes(esc(item.motivo)), 'o motivo aparece');
  assert.ok(html.includes(esc(item.oQueFalta)), 'o que falta aparece');
  assert.doesNotMatch(html, /<script/i);
});

// A tela é quem liga o snapshot ao cartão, e esse fio não tem como ser exercitado sem DOM.
// Fica como leitura do fonte, de propósito e declarada: sem ele o cartão nunca aparece, e a
// seção volta a mostrar interruptor ligado sem dizer que o Farol não está aplicando nada.
test('a tela da sincronização passa as capacidades do snapshot para a seção', () => {
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'telas', 'sistema-sync.js'), 'utf8');
  assert.match(fonte, /syncSecaoHtml\([\s\S]{0,200}?estado\(\)\.capacidades\)/);
});

test('distribuição ligada sozinha também é pedido de compartilhamento', () => {
  const e = estadoDasCapacidades({ ...DESKTOP, modoCelular: true, config: { enabled: true, distribution: { enabled: true } }, bloqueio: 'autenticacao-local' });
  assert.equal(e.compartilhamento.pedido, true);
  assert.equal(capacidadesIndisponiveis(e).some((i) => i.id === 'compartilhamento'), true);
});
