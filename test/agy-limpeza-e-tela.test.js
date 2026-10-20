// O que sobra do Antigravity fora da sessão: a limpeza da pasta do perfil (brain/ e
// conversations/ crescem por revisão), o diagnóstico (versão, login, cota, sem conta nem
// pasta), o aviso de runtime e o que a tela mostra da cota.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-agy-limpeza-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { AGY_DIR } = await import('../lib/paths.js');
const home = await import('../lib/agy/home.js');
const { ambienteDoDoctor } = await import('../lib/engine/diagnostico.js');
const { runtimeChecks, cotaAgyHtml, cadeiaHtml } = await import('../ui/pure.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const C = (n) => `c0ffee00-0000-4000-8000-${String(n).padStart(12, '0')}`;

function conversa(cli, id, idadeMs = 0) {
  const brain = path.join(cli, 'brain', id);
  fs.mkdirSync(brain, { recursive: true });
  fs.writeFileSync(path.join(brain, 'x.md'), 'memória');
  fs.mkdirSync(path.join(cli, 'conversations'), { recursive: true });
  fs.writeFileSync(path.join(cli, 'conversations', `${id}.db`), 'db');
  if (idadeMs) {
    const quando = new Date(Date.now() - idadeMs);
    fs.utimesSync(brain, quando, quando);
  }
}

test('limpeza: a conversa encerrada e as velhas saem; a do chat e o token ficam', () => {
  const pasta = home.garantirPasta('pz1');
  const cli = home.dirDoCli(pasta);
  fs.mkdirSync(cli, { recursive: true });
  fs.writeFileSync(path.join(cli, 'antigravity-oauth-token'), '{}');
  conversa(cli, C(1));
  conversa(cli, C(2), 3 * 24 * 3600e3);
  conversa(cli, C(3), 3 * 24 * 3600e3);
  conversa(cli, C(4));
  fs.mkdirSync(path.join(cli, 'log'), { recursive: true });
  for (let i = 0; i < 35; i++) fs.writeFileSync(path.join(cli, 'log', `cli-20261020_0${String(10000 + i)}.log`), 'l');
  home.limparSessao('pz1', C(1), new Set([C(3)]));
  assert.equal(fs.existsSync(path.join(cli, 'brain', C(1))), false, 'a da sessão que acabou');
  assert.equal(fs.existsSync(path.join(cli, 'conversations', `${C(1)}.db`)), false);
  assert.equal(fs.existsSync(path.join(cli, 'brain', C(2))), false, 'a velha');
  assert.equal(fs.existsSync(path.join(cli, 'brain', C(3))), true, 'a do chat, mesmo velha');
  assert.equal(fs.existsSync(path.join(cli, 'brain', C(4))), true, 'a recente de outra sessão');
  assert.equal(home.temLogin('pz1'), true, 'o token nunca sai');
  assert.equal(fs.readdirSync(path.join(cli, 'log')).length, 30, 'os logs mais novos ficam');
});

test('limpeza: nome fora da forma de conversa não vira caminho', () => {
  const pasta = home.garantirPasta('pz2');
  const fora = path.join(pasta, 'importante');
  fs.mkdirSync(fora, { recursive: true });
  home.limparSessao('pz2', '../importante', new Set());
  assert.equal(fs.existsSync(fora), true);
  assert.equal(home.pastaDoPerfil('../x'), '', 'id de perfil fora da forma não vira pasta');
  assert.ok(home.pastaDoPerfil('pz2').startsWith(AGY_DIR));
});

test('conversas do chat: as dos chats e a da revisão pendente que o chat herda', () => {
  const ids = home.conversasDoChat({ chats: { a: { sessionId: C(7) }, b: {} }, decisions: { pending: [{ sessionId: C(8) }] } });
  assert.deepEqual([...ids].sort(), [C(7), C(8)]);
});

test('diagnóstico: versão do agy e cota por perfil, sem conta e sem pasta', () => {
  const linhas = ambienteDoDoctor({
    agy: '1.4.3',
    agyPerfis: [
      { id: 'gx', label: 'Gemini X', login: true, cota: { ok: true, conta: 'wa***@x.com', grupos: [{ nome: 'Gemini Models', grupo: 'gemini', restante: 0.21, esgotado: false, reset: 0 }] } },
      { id: 'gy', label: 'Gemini Y', login: false, cota: null },
    ],
  }, { windows: false });
  const agy = linhas.filter((l) => /Antigravity/.test(l.label));
  assert.deepEqual(agy.map((l) => l.ok), [true, true, false]);
  assert.match(agy[1].detalhe, /Gemini Models 21%/);
  assert.equal(agy[2].detalhe, 'sem login');
  assert.ok(!JSON.stringify(linhas).includes('wa***'), 'a conta não entra no diagnóstico');
  assert.ok(!JSON.stringify(linhas).includes(AGY_DIR), 'nem a pasta');
  assert.equal(ambienteDoDoctor({}, { windows: false }).some((l) => /Antigravity/.test(l.label)), false, 'sem perfil e sem agy, sem linha');
});

test('runtime: agy ausente e perfil sem login viram aviso', () => {
  const config = { claudeProfiles: [{ id: 'gx', label: 'Gemini X', kind: 'agy' }] };
  const sem = runtimeChecks({ agy: null, agyPerfis: [{ id: 'gx', login: false }] }, config);
  assert.deepEqual(sem.map((c) => [c.label, c.ok]), [['Antigravity CLI', false], ['Login do Antigravity em Gemini X', false]]);
  const com = runtimeChecks({ agy: '1.4.3', agyPerfis: [{ id: 'gx', login: true }] }, config);
  assert.deepEqual(com.map((c) => c.ok), [true]);
  assert.deepEqual(runtimeChecks({}, { claudeProfiles: [] }), [], 'sem perfil agy, nada');
});

test('tela: a cota ao vivo por grupo, com a hora em que volta, e o aviso de conta errada', () => {
  const volta = new Date(2026, 9, 27, 4, 45).getTime();
  const html = cotaAgyHtml({ ok: true, conta: 'wa***@x.com', contaConfere: false, grupos: [
    { nome: 'Gemini Models', restante: 0, esgotado: true, reset: volta },
    { nome: 'Claude and GPT models', restante: 0.37, esgotado: false, reset: 0 },
  ] });
  assert.match(html, /Gemini Models: esgotada, volta 27\/10 04:45/);
  assert.match(html, /Claude and GPT models: 37% da semana/);
  assert.match(html, /não é a conta esperada/);
  assert.match(cotaAgyHtml(null), /ainda não lida/);
  const cadeia = cadeiaHtml({ entradas: [{ id: 'gx', label: 'Gemini X', provedor: 'agy', provedorRotulo: 'Antigravity (Gemini)', ativo: true, estado: 'em-uso', cota: { ok: true, grupos: [{ nome: 'Gemini Models', restante: 0.5 }] } }] });
  assert.match(cadeia, /Gemini Models: 50% da semana/);
});
