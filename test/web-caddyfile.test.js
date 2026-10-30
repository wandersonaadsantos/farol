// Web hospedada, Task 2: o Caddyfile por pessoa (tools/web/caddyfile.js). Cada pessoa de
// /etc/farol/portas vira um bloco `<pessoa>.farol.<dominio>` que encaminha para o motor
// dela em 127.0.0.1:<porta>, com o Host reescrito para o que a allowlist do motor
// (lib/http-guard.js) aceita, o Origin conferido na borda e retirado antes do motor, o
// SSE sem buffer e o log sem query string. A geração é PURA; a CLI fina que o
// gerar-caddyfile.sh chama é coberta com um diretório temporário. O Caddy de verdade e o
// smoke.sh só rodam na VPS.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// caddyfile.js importa lib/paths.js (executadoDireto); com FAROL_HOME definido antes da
// carga, nada cai no diretório provisório de teste nem emite o aviso dele
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-web-caddyfile-'));

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { DEFAULT_PORT } = await import('../lib/constants.js');
const { gerarCaddyfile, executar } = await import('../tools/web/caddyfile.js');

const DOMINIO = 'exemplo.com.br';
const ANA = { login: 'ana', porta: DEFAULT_PORT };
const BETO = { login: 'beto', porta: DEFAULT_PORT + 1 };

function coletor() {
  let texto = '';
  return { write: (s) => { texto += s; }, get texto() { return texto; } };
}

// O bloco do site: da linha `<host> {` até a chave que fecha na coluna zero.
function blocoDe(texto, host) {
  const inicio = texto.indexOf(`\n${host} {\n`);
  assert.notEqual(inicio, -1, `sem bloco para ${host}`);
  const fim = texto.indexOf('\n}\n', inicio + 1);
  assert.notEqual(fim, -1, `bloco de ${host} sem fechamento`);
  return texto.slice(inicio + 1, fim + 3);
}

test('um bloco por pessoa, no subdomínio <pessoa>.farol.<dominio>', () => {
  const texto = gerarCaddyfile({ dominio: DOMINIO, pessoas: [ANA, BETO] });
  const sites = texto.split('\n').filter(l => /^\S.* \{$/.test(l));
  assert.deepEqual(sites, [`ana.farol.${DOMINIO} {`, `beto.farol.${DOMINIO} {`]);
  assert.doesNotMatch(texto, /@[A-Z_]+@/, 'marcador do template sem substituir');
});

test('o bloco encaminha para a porta da pessoa com o Host que o motor aceita', () => {
  const texto = gerarCaddyfile({ dominio: DOMINIO, pessoas: [ANA, BETO] });
  const ana = blocoDe(texto, `ana.farol.${DOMINIO}`);
  const beto = blocoDe(texto, `beto.farol.${DOMINIO}`);
  assert.match(ana, new RegExp(`\\breverse_proxy 127\\.0\\.0\\.1:${ANA.porta} \\{`));
  assert.match(ana, new RegExp(`\\bheader_up Host 127\\.0\\.0\\.1:${ANA.porta}\\n`));
  assert.match(beto, new RegExp(`\\breverse_proxy 127\\.0\\.0\\.1:${BETO.porta} \\{`));
  assert.match(beto, new RegExp(`\\bheader_up Host 127\\.0\\.0\\.1:${BETO.porta}\\n`));
  assert.doesNotMatch(ana, new RegExp(`:${BETO.porta}\\b`));
  assert.doesNotMatch(beto, new RegExp(`:${ANA.porta}\\b`));
});

test('o SSE sai sem buffer em todo bloco', () => {
  const texto = gerarCaddyfile({ dominio: DOMINIO, pessoas: [ANA, BETO] });
  for (const login of ['ana', 'beto']) {
    assert.match(blocoDe(texto, `${login}.farol.${DOMINIO}`), /\n\s*flush_interval -1\n/);
  }
});

test('Origin presente e alheio é recusado na borda; o aceito é retirado antes do motor', () => {
  const texto = gerarCaddyfile({ dominio: DOMINIO, pessoas: [ANA, BETO] });
  const ana = blocoDe(texto, `ana.farol.${DOMINIO}`);
  const matcher = ana.match(/\n\s*@(\S+) \{\n([^}]*)\}\n/);
  assert.ok(matcher, 'matcher nomeado do Origin ausente');
  assert.match(matcher[2], /^\s*header Origin \*$/m);
  assert.match(matcher[2], new RegExp(`^\\s*not header Origin https://ana\\.farol\\.exemplo\\.com\\.br$`, 'm'));
  assert.match(ana, new RegExp(`\\n\\s*respond @${matcher[1]} 403\\n`));
  assert.match(ana, /\n\s*header_up -Origin\n/);
  // cada pessoa só aceita a própria origem
  assert.doesNotMatch(ana, /beto\.farol/);
});

test('o log vai para um arquivo por pessoa, em JSON, sem query string', () => {
  const texto = gerarCaddyfile({ dominio: DOMINIO, pessoas: [ANA, BETO] });
  const ana = blocoDe(texto, `ana.farol.${DOMINIO}`);
  assert.match(ana, /\n\s*output file \/var\/log\/caddy\/farol-ana\.log\n/);
  assert.match(ana, /\n\s*wrap json\n/);
  assert.match(ana, /\n\s*request>uri regexp \\\?\.\*\$ ""\n/);
  assert.match(blocoDe(texto, `beto.farol.${DOMINIO}`), /farol-beto\.log/);
});

test('sem pessoa, sai só o cabeçalho (Caddyfile válido sem site)', () => {
  const texto = gerarCaddyfile({ dominio: DOMINIO, pessoas: [] });
  assert.doesNotMatch(texto, /reverse_proxy/);
  assert.match(texto, /^# /);
});

test('recusa domínio fora do formato de nome de host', () => {
  for (const dominio of ['', 'Exemplo.com', 'https://exemplo.com', 'exemplo.com/x', 'exemplo', 'exe mplo.com', '-exemplo.com', 'exemplo..com', 'exemplo.com.', undefined]) {
    assert.throws(() => gerarCaddyfile({ dominio, pessoas: [ANA] }), /domínio inválido/, String(dominio));
  }
});

test('recusa login que não serve de subdomínio e repetições, pela regra do portas.js', () => {
  for (const login of ['ana_b', 'ana-', '_ana']) {
    assert.throws(() => gerarCaddyfile({ dominio: DOMINIO, pessoas: [{ login, porta: DEFAULT_PORT }] }), /subdomínio/, login);
  }
  assert.throws(() => gerarCaddyfile({ dominio: DOMINIO, pessoas: [ANA, { login: 'ana', porta: DEFAULT_PORT + 2 }] }), /login repetido/);
  assert.throws(() => gerarCaddyfile({ dominio: DOMINIO, pessoas: [ANA, { login: 'caio', porta: ANA.porta }] }), /porta repetida/);
  assert.throws(() => gerarCaddyfile({ dominio: DOMINIO, pessoas: [{ login: 'Ana', porta: DEFAULT_PORT }] }), /subdomínio/);
});

test('o template guarda os três marcadores, e o gerador nunca copia o cabeçalho dele', () => {
  const template = fs.readFileSync(new URL('../tools/web/Caddyfile.template', import.meta.url), 'utf8');
  for (const marcador of ['@PESSOA@', '@DOMINIO@', '@PORTA@']) assert.ok(template.includes(marcador), marcador);
  const texto = gerarCaddyfile({ dominio: DOMINIO, pessoas: [ANA] });
  assert.doesNotMatch(texto, /@PESSOA@|@DOMINIO@|@PORTA@/);
});

test('CLI lê o arquivo de portas e imprime o Caddyfile; erros saem com código', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-caddyfile-'));
  try {
    const arquivo = path.join(dir, 'portas');
    fs.writeFileSync(arquivo, `ana ${ANA.porta}\nbeto ${BETO.porta}\n`);
    const saida = coletor();
    assert.equal(executar([arquivo, DOMINIO], saida, coletor()), 0);
    assert.equal(saida.texto, gerarCaddyfile({ dominio: DOMINIO, pessoas: [ANA, BETO] }));

    fs.writeFileSync(arquivo, `ana ${ANA.porta}\nana ${BETO.porta}\n`);
    const erro = coletor();
    assert.equal(executar([arquivo, DOMINIO], coletor(), erro), 1);
    assert.match(erro.texto, /login repetido/);

    const ausente = coletor();
    assert.equal(executar([path.join(dir, 'nao-existe'), DOMINIO], coletor(), ausente), 1);
    assert.match(ausente.texto, /nao-existe/);

    const uso = coletor();
    assert.equal(executar([arquivo], coletor(), uso), 2);
    assert.match(uso.texto, /Uso:/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
