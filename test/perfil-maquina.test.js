// O login padrão da máquina como perfil listado (20/10/2026). Antes, quem usava o login de
// ~/.claude sem pasta indicada não via nada na lista de perfis, e a adoção recusava. Agora
// ele vira o perfil `maquina` (nome editável, id fixo), que se escolhe como padrão, numa
// conta ou num grupo, SEM mudar como a sessão autentica: ela continua sem CLAUDE_CONFIG_DIR.
// Medido com o Claude Code 2.1.295: apontar CLAUDE_CONFIG_DIR para ~/.claude faz o CLI ler a
// conta de ~/.claude/.claude.json em vez de ~/.claude.json, ou seja, outro login.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-perfil-maquina-'));
process.env.FAROL_HOME = path.join(BASE, 'farol');

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { normalizeClaudeProfiles, applyClaudeAuthEnv } = await import('../lib/parse.js');
const { authFromProfile, problemasDePerfil } = await import('../lib/engine/perfil-claude.js');
const { claudeProfilesHtml } = await import('../ui/pure.js');

after(() => { try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* best-effort */ } });

function engineCom(config) {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.doctor = async () => ({});
  Object.assign(e.config, config);
  return e;
}

const MAQUINA = { id: 'maquina', label: 'BIUD Max 20X', kind: 'maquina' };

test('o normalizador guarda um perfil maquina só, com id fixo e orçamento, e sem pasta', () => {
  const r = normalizeClaudeProfiles([
    { id: 'outro-id', label: 'BIUD Max 20X', kind: 'maquina', dir: '/nao/vale', budgetDaily: 5 },
    { id: 'repetido', label: 'Segundo', kind: 'maquina' },
    { id: 'p1', label: 'Pessoal', dir: '/home/farol/.claude-pessoal' },
  ]);
  assert.deepEqual(r, [
    { id: 'maquina', label: 'BIUD Max 20X', kind: 'maquina', budgetDaily: 5 },
    { id: 'p1', label: 'Pessoal', dir: '/home/farol/.claude-pessoal' },
  ]);
});

test('o perfil maquina resolve para o mesmo caminho de hoje: pasta vazia, sem CLAUDE_CONFIG_DIR', () => {
  assert.deepEqual(authFromProfile(MAQUINA), { kind: 'dir', id: 'maquina', dir: '' });
  const e = engineCom({ claudeProfiles: [MAQUINA], claudeProfileId: '', claudeConfigDir: '', accounts: [{ user: 'conta-a', claudeProfileId: 'maquina' }] });
  const conta = e.resolveClaudeAuth('conta-a');
  assert.deepEqual(conta, { kind: 'dir', id: 'maquina', dir: '' });
  // o legado (sem perfil) e o perfil maquina montam o MESMO ambiente
  const comPerfil = { CLAUDE_CONFIG_DIR: '/herdado' };
  const semPerfil = { CLAUDE_CONFIG_DIR: '/herdado' };
  applyClaudeAuthEnv(comPerfil, conta);
  applyClaudeAuthEnv(semPerfil, { kind: 'dir', id: '', dir: '' });
  assert.deepEqual(comPerfil, semPerfil);
  assert.equal('CLAUDE_CONFIG_DIR' in comPerfil, false);
  assert.equal(e.resolveConfigDirForLogin('maquina'), '');
  assert.deepEqual(e.resolveAuthForLogin('maquina'), { kind: 'dir', dir: '' });
  // perfil válido, nada a acusar
  assert.deepEqual(problemasDePerfil(e.config), []);
  // o selo lê a conta de ~/.claude.json, como o legado
  const selo = e.allClaudeAuthInfo().find((x) => x.id === 'maquina');
  assert.equal(selo.configDir, null);
  assert.equal(selo.label, 'BIUD Max 20X');
});

test('sem pasta legada, a adoção lista o login da máquina e o escolhe como padrão só se o padrão estava vazio', () => {
  const vazio = engineCom({ claudeProfiles: [], claudeProfileId: '', claudeConfigDir: '', accounts: [] });
  const previa = vazio.claudeAdotarLegado({});
  assert.equal(previa.escreveu, false);
  assert.equal(previa.perfil.kind, 'maquina');
  assert.deepEqual(vazio.config.claudeProfiles, []);
  const r = vazio.claudeAdotarLegado({ confirmar: true, label: 'BIUD Max 20X' });
  assert.equal(r.escreveu, true);
  assert.deepEqual(vazio.config.claudeProfiles, [MAQUINA]);
  assert.equal(vazio.config.claudeProfileId, 'maquina');
  assert.equal(vazio.claudeAdotarLegado({ confirmar: true }).code, 'maquina-ja-listada');

  // com outros perfis salvos, o da máquina entra junto e o padrão escolhido não muda
  const comPerfis = engineCom({ claudeProfiles: [{ id: 'p1', label: 'Pessoal', dir: path.join(BASE, 'p1') }], claudeProfileId: 'p1', claudeConfigDir: '', accounts: [] });
  comPerfis.claudeAdotarLegado({ confirmar: true, label: 'BIUD Max 20X' });
  assert.deepEqual(comPerfis.config.claudeProfiles.map((p) => p.id), ['p1', 'maquina']);
  assert.equal(comPerfis.config.claudeProfileId, 'p1');
});

test('a tela oferece listar o login da máquina enquanto ele não está na lista, e mostra o perfil sem campo de pasta', () => {
  const antes = claudeProfilesHtml({ config: { claudeProfiles: [], claudeConfigDir: '' }, ehWin: false });
  assert.match(antes, /Login padrão desta máquina/);
  assert.match(antes, /id="btnClaudeMigrate"/);
  const depois = claudeProfilesHtml({ config: { claudeProfiles: [MAQUINA], claudeProfileId: 'maquina', claudeConfigDir: '' }, ehWin: false });
  assert.doesNotMatch(depois, /btnClaudeMigrate/);
  assert.match(depois, /value="BIUD Max 20X"/);
  assert.doesNotMatch(depois, /class="cp-dir"/);
  assert.match(depois, /cp-login" data-id="maquina"/);
  // com pasta legada, o cartão continua sendo o de sempre (salvar a pasta como perfil)
  const legado = claudeProfilesHtml({ config: { claudeProfiles: [], claudeConfigDir: '/home/farol/.claude-x' }, ehWin: false });
  assert.match(legado, /Perfil atual detectado/);
});
