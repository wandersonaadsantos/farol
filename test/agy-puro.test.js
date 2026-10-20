// As peças puras do Antigravity CLI: o ambiente do filho por sistema operacional, o
// protocolo partido abaixo do teto de 24.000 bytes do `agy`, a cota do `/usage`, a
// allowlist de modelos, o protocolo "dispensado" no gate e as classes da taxonomia.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-agy-puro-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { agyEnv } = await import('../lib/agy/ambiente.js');
const proto = await import('../lib/agy/protocolo.js');
const cota = await import('../lib/agy/cota.js');
const parse = await import('../lib/parse.js');
const { TEMPLATE_DIR } = await import('../lib/paths.js');
const { classify } = await import('../lib/log-taxonomy.js');
const { approvalGaps } = await import('../lib/technical-review/evidence.js');
const { sanear } = await import('../lib/settings.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

/* ---------- ambiente do filho ---------- */

const HERDADO = { PATH: '/bin', HOME: '/home/eu', USERPROFILE: 'C:\\Users\\eu', GH_TOKEN: 'gho_conta', GEMINI_API_KEY: 'k1', Google_Api_Key: 'k2', AGY_ADC_AUTH: 'true' };

test('Windows: USERPROFILE é a pasta do perfil, SSH_CLIENT liga o token em arquivo, HOME fica', () => {
  const env = agyEnv(HERDADO, 'C:\\farol\\agy\\p1', { win: true });
  assert.equal(env.USERPROFILE, 'C:\\farol\\agy\\p1');
  assert.equal(env.SSH_CLIENT, 'farol 0 0');
  assert.equal(env.HOME, '/home/eu', 'o git lê HOME: ele não muda no Windows');
  assert.equal(env.GH_TOKEN, 'gho_conta', 'o token da conta segue como nos outros provedores');
  for (const k of ['GEMINI_API_KEY', 'Google_Api_Key', 'AGY_ADC_AUTH']) assert.equal(env[k], undefined, `${k} herdada sai`);
  assert.equal(env.GIT_CONFIG_GLOBAL, undefined);
});

test('Windows: a variável em outra caixa não convive com a do Farol', () => {
  const env = agyEnv({ UserProfile: 'C:\\Users\\eu', ssh_client: 'x' }, 'C:\\p', { win: true });
  assert.deepEqual(Object.keys(env).filter((k) => k.toUpperCase() === 'USERPROFILE'), ['USERPROFILE']);
  assert.deepEqual(Object.keys(env).filter((k) => k.toUpperCase() === 'SSH_CLIENT'), ['SSH_CLIENT']);
});

test('POSIX: HOME é a pasta do perfil e o git volta ao ~/.gitconfig real', () => {
  const env = agyEnv(HERDADO, '/home/eu/.farol/agy/p1', { win: false, gitconfigReal: '/home/eu/.gitconfig' });
  assert.equal(env.HOME, '/home/eu/.farol/agy/p1');
  assert.equal(env.SSH_CLIENT, 'farol 0 0');
  assert.equal(env.GIT_CONFIG_GLOBAL, '/home/eu/.gitconfig');
  assert.equal(env.GH_TOKEN, 'gho_conta');
  assert.equal(env.GEMINI_API_KEY, undefined);
  assert.equal(agyEnv({}, '/p', { win: false }).GIT_CONFIG_GLOBAL, undefined, 'sem ~/.gitconfig, nada');
});

/* ---------- protocolo partido ---------- */

const LIMITE = 24000;

test('o protocolo real é partido em arquivos abaixo de 24.000 bytes, sem perder seção', () => {
  const original = fs.readFileSync(path.join(TEMPLATE_DIR, 'CLAUDE.md'), 'utf8');
  assert.ok(Buffer.byteLength(original) > LIMITE, 'premissa: o protocolo inteiro passa do teto do agy');
  const partes = proto.partirProtocolo(original);
  assert.ok(partes.length >= 2);
  for (const p of partes) assert.ok(Buffer.byteLength(p, 'utf8') < LIMITE, `parte com ${Buffer.byteLength(p)} bytes`);
  const junto = partes.join('\n');
  for (const s of proto.secoes(original)) {
    const titulo = s.split('\n')[0];
    assert.ok(junto.includes(titulo), `seção perdida: ${titulo}`);
  }
  // a última seção (as regras invioláveis) chega inteira: era ela que o corte comia
  const ultima = proto.secoes(original).at(-1).trim();
  assert.ok(junto.includes(ultima));
});

test('seção maior que o teto é partida por parágrafo, e nenhuma parte passa do teto', () => {
  const enorme = '## Grande\n\n' + Array.from({ length: 400 }, (_, i) => `Parágrafo ${i} ${'é'.repeat(120)}`).join('\n\n');
  const partes = proto.partirProtocolo(enorme);
  assert.ok(partes.length > 2);
  for (const p of partes) assert.ok(Buffer.byteLength(p) < LIMITE);
});

test('as regras gravadas em .agents/rules ficam abaixo do teto, e parte velha sai', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-agy-regras-'));
  try {
    const pasta = path.join(ws, '.agents', 'rules');
    fs.mkdirSync(pasta, { recursive: true });
    fs.writeFileSync(path.join(pasta, 'farol-protocolo-09.md'), 'sobra de versão anterior');
    fs.writeFileSync(path.join(pasta, 'regra-do-usuario.md'), 'não é do Farol');
    const gravados = proto.escreverRegras(ws, fs.readFileSync(path.join(TEMPLATE_DIR, 'CLAUDE.md'), 'utf8'));
    const nomes = fs.readdirSync(pasta);
    assert.ok(!nomes.includes('farol-protocolo-09.md'), 'parte que sobrou sai');
    assert.ok(nomes.includes('regra-do-usuario.md'), 'arquivo que não é do Farol fica');
    for (const n of nomes) {
      const tam = fs.statSync(path.join(pasta, n)).size;
      assert.ok(tam < LIMITE, `${n} tem ${tam} bytes: o agy cortaria o protocolo`);
    }
    assert.equal(gravados.length, nomes.filter((n) => n.startsWith('farol-protocolo-')).length);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('o bloco do provedor dispensa o pr-reviewer com motivo e manda o checkpoint em texto', () => {
  const b = proto.blocoDoProvedor('review');
  assert.match(b, /"prReviewer": "dispensado", "motivo": "/);
  assert.match(b, /FAROL_CHECKPOINT: \{\.\.\.\}/);
  assert.equal(proto.blocoDoProvedor('chat'), '', 'chat recebe o prompt como veio');
});

/* ---------- o gate aceita "dispensado" com motivo ---------- */

test('evidence: protocolo dispensado COM motivo não é lacuna; sem motivo é', () => {
  const lacuna = 'protocolo de revisão não comprovado';
  const com = approvalGaps({ analysisStatus: 'complete', protocolo: { prReviewer: 'dispensado', motivo: proto.MOTIVO_SEM_SUBAGENTE } });
  assert.ok(!com.includes(lacuna));
  const sem = approvalGaps({ analysisStatus: 'complete', protocolo: { prReviewer: 'dispensado', motivo: '  ' } });
  assert.ok(sem.includes(lacuna));
});

/* ---------- cota ---------- */

const USAGE_MEDIDO = { conversation_id: '', status: 'SUCCESS', command: { name: 'usage', data: { groups: [
  { name: 'Gemini Models', buckets: [{ id: 'gemini-weekly', window: 'weekly', remaining_fraction: 0, reset_time: '2026-10-27T07:08:29Z' }, { id: 'gemini-5h', window: '5h', remaining_fraction: 0, reset_time: '2026-10-20T12:00:00Z' }] },
  { name: 'Claude and GPT models', buckets: [{ id: '3p-weekly', window: 'weekly', remaining_fraction: 1, reset_time: '2026-10-27T07:23:38Z' }] },
] } } };

test('cota: grupos do /usage, o grupo do modelo e o maior reset dos buckets esgotados', () => {
  const grupos = cota.resumirCota(USAGE_MEDIDO);
  assert.deepEqual(grupos.map((g) => g.grupo), ['gemini', '3p']);
  const g = cota.grupoNaCota(grupos, cota.grupoDoModelo('gemini-3.8-flash-high'));
  assert.equal(cota.esgotado(g), true);
  assert.equal(cota.voltaEm(g), Date.parse('2026-10-27T07:08:29Z'), 'antes do semanal o grupo não volta');
  const outro = cota.grupoNaCota(grupos, cota.grupoDoModelo('claude-sonnet-4-6'));
  assert.equal(cota.esgotado(outro), false, 'o balde Claude e GPT é outro');
  assert.equal(cota.voltaEm(outro), 0, 'reset de grupo cheio não quer dizer nada');
  assert.deepEqual(cota.resumirCota({ status: 'ERROR' }), []);
  assert.equal(cota.jsonDaSaida(`aviso\n${JSON.stringify(USAGE_MEDIDO)}\n`).status, 'SUCCESS');
});

test('identidade: a conta do log, o modo de arquivo e a conferência com o perfil', () => {
  const log = 'x Using file-based token storage because SSH session detected\ny OAuth: authenticated successfully as Wa@Exemplo.com\n';
  const l = cota.identidadeDoLog(log);
  assert.deepEqual(l, { conta: 'wa@exemplo.com', arquivo: true });
  assert.equal(cota.contaConfere({ email: 'wa@exemplo.com' }, l), true);
  assert.equal(cota.contaConfere({ email: 'outra@exemplo.com' }, l), false);
  assert.equal(cota.contaConfere({}, l), null, 'sem e-mail registrado não dá para saber');
  assert.equal(cota.contaConfere({ email: 'wa@exemplo.com' }, cota.identidadeDoLog('OAuth: authenticated successfully as wa@exemplo.com')), false, 'token do chaveiro é conta errada');
  assert.equal(cota.contaConfere({ email: 'wa@exemplo.com' }, cota.identidadeDoLog('')), null);
  assert.equal(cota.mascararEmail('wanderson@icloud.com'), 'wa***@icloud.com');
});

/* ---------- allowlist de modelos ---------- */

test('flash-low fora da allowlist; Claude e GPT só por escolha explícita; o padrão é flash-high', () => {
  assert.equal(parse.sanitizeAgyModel('gemini-3.8-flash-low'), null);
  assert.equal(parse.sanitizeAgyModel('gemini-3.8-flash-high'), 'gemini-3.8-flash-high');
  assert.equal(parse.sanitizeAgyModel('claude-sonnet-4-6'), 'claude-sonnet-4-6');
  assert.equal(parse.sanitizeAgyModel('opus'), null, 'apelido do Claude não é slug do agy');
  assert.equal(parse.sanitizeAgyModel('gemini-3.8-flash-high; rm -rf /'), null);
  assert.equal(parse.sanitizeAgyEffort('max'), null);
  assert.equal(sanear('agyReviewModel', 'gemini-3.8-flash-low', { agyReviewModel: 'gemini-3.8-flash-high' }, parse), 'gemini-3.8-flash-high', 'valor recusado mantém o anterior');
  assert.equal(sanear('agyReviewModel', 'claude-sonnet-4-6', { agyReviewModel: 'gemini-3.8-flash-high' }, parse), 'claude-sonnet-4-6', 'escolha explícita entra');
});

/* ---------- taxonomia ---------- */

test('taxonomia: cota é espera-reset; capacidade e timeout são passageiros; login e conta, permanentes', () => {
  const casos = [
    ['agy: You have exhausted your quota on this model.', 'limite-agy', 'espera-reset'],
    ['agy: RESOURCE_EXHAUSTED 429 individual quota reached', 'limite-agy', 'espera-reset'],
    ['agy: QUOTA_EXHAUSTED', 'limite-agy', 'espera-reset'],
    ['agy: RESOURCE_EXHAUSTED: MODEL_CAPACITY_EXHAUSTED', 'capacidade-agy', 'transitorio'],
    ['agy: UNAVAILABLE (code 503): No capacity available for model', 'capacidade-agy', 'transitorio'],
    ['agy: [agy] print timeout after 30m0s with turn in progress', 'agy-print-timeout', 'transitorio'],
    ['agy: sem login na pasta do perfil; abra o login do perfil em Plano e chaves', 'agy-sem-login', 'permanente'],
    ['error: authentication failed or timed out', 'agy-sem-login', 'permanente'],
    ['agy: a conta autenticada na pasta do perfil não é a esperada; abra o login', 'agy-conta-trocada', 'permanente'],
  ];
  for (const [msg, id, kind] of casos) {
    const c = classify(msg);
    assert.equal(c.id, id, msg);
    assert.equal(c.kind, kind, msg);
  }
});
