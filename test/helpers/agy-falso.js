// O `agy` falso dos testes do Antigravity (lib/agy/). O Farol o roda pelo próprio Node quando
// FAROL_AGY_CMD aponta para este arquivo (lib/agy/home.js, comandoDoAgy), com os mesmos
// argumentos e o mesmo ambiente que o `agy` de verdade receberia. Os eventos imitam os do
// `agy` 1.4.3 medidos em docs/superpowers/specs/2026-10-20-agy-provedor.md (seções 1, 3 e 6).
//
// Sem argumento (o executor de testes roda tudo em test/), sai sem fazer nada.
//
// Controle por ambiente:
//   AGY_FALSO_REGISTRO  arquivo onde cada execução anota { modo, home, args, env } (uma linha)
//   AGY_FALSO_CENARIO   ok | timeout | cota | sem-result
//   AGY_FALSO_CONTA     a conta que o log diz ter autenticado (padrão eu@exemplo.com)
//   AGY_FALSO_CHAVEIRO  '1': o log não diz que o token veio de arquivo (o CLI voltou ao chaveiro)
//   AGY_FALSO_COTA      fração restante do grupo Gemini no /usage (padrão 0.8)
//   AGY_FALSO_RESET     reset_time do grupo Gemini (padrão 2026-10-27T07:45:34Z)
//   AGY_FALSO_RETOMA    '0': a retomada pedida não existe e o agy abre outra conversa
//   AGY_FALSO_ESGOTADOS pastas de perfil (nome) com o grupo Gemini zerado, separadas por vírgula
//   AGY_FALSO_ZERA_APOS '1': o grupo Gemini zera depois que uma sessão rodou (cota no meio)
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const env = process.env;
const home = process.platform === 'win32' ? env.USERPROFILE : env.HOME;
const cli = home ? path.join(home, '.gemini', 'antigravity-cli') : '';
const token = cli ? path.join(cli, 'antigravity-oauth-token') : '';
const valor = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined; };
const linha = (o) => process.stdout.write(JSON.stringify(o) + '\n');

function anotar(modo) {
  if (!env.AGY_FALSO_REGISTRO) return;
  const visto = {};
  for (const k of ['USERPROFILE', 'HOME', 'SSH_CLIENT', 'GIT_CONFIG_GLOBAL', 'GH_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'AGY_ADC_AUTH']) {
    if (env[k] !== undefined) visto[k] = env[k];
  }
  fs.appendFileSync(env.AGY_FALSO_REGISTRO, JSON.stringify({ modo, home, args, env: visto }) + '\n');
}

function escreverLog() {
  const destino = valor('--log-file');
  if (!destino) return;
  const linhas = ['I1020 07:35:49.030349 53 server.go:1722] Starting language server process'];
  if (env.AGY_FALSO_CHAVEIRO !== '1' && env.SSH_CLIENT) linhas.push('I1020 07:35:49.563913 1 composite_token_storage.go:123] Using file-based token storage because SSH session detected');
  linhas.push('I1020 07:35:49.980105 1 auth.go:157] ChainedAuth: authenticated via keyring (effective: keyring)');
  linhas.push(`I1020 07:35:49.986729 1 server_oauth.go:229] OAuth: authenticated successfully as ${env.AGY_FALSO_CONTA || 'eu@exemplo.com'}`);
  fs.writeFileSync(destino, linhas.join('\n') + '\n');
}

function jaRodouSessao() {
  try { return fs.readFileSync(env.AGY_FALSO_REGISTRO, 'utf8').includes('"modo":"sessao"'); } catch { return false; }
}

function restanteGemini() {
  const esgotados = String(env.AGY_FALSO_ESGOTADOS || '').split(',').filter(Boolean);
  if (home && esgotados.includes(path.basename(home))) return 0;
  if (env.AGY_FALSO_ZERA_APOS === '1' && jaRodouSessao()) return 0;
  return env.AGY_FALSO_COTA === undefined ? 0.8 : Number(env.AGY_FALSO_COTA);
}

function usage() {
  const restante = restanteGemini();
  const grupos = [
    { name: 'Gemini Models', buckets: [{ id: 'gemini-weekly', name: 'Weekly Limit Remaining', window: 'weekly', remaining_fraction: restante, reset_time: env.AGY_FALSO_RESET || '2026-10-27T07:45:34Z' }] },
    { name: 'Claude and GPT models', buckets: [{ id: '3p-weekly', name: 'Weekly Limit Remaining', window: 'weekly', remaining_fraction: 1, reset_time: '2026-10-27T09:22:09Z' }] },
  ];
  linha({ conversation_id: '', status: 'SUCCESS', response: '', duration_seconds: 0, num_turns: 0, usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 0 }, command: { name: 'usage', data: { groups: grupos } } });
}

function pedirLogin() {
  process.stdout.write('Authentication required. Please visit the URL to log in:\n');
  process.stdout.write('  https://accounts.google.com/o/oauth2/auth?access_type=offline&client_id=falso&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback&response_type=code&state=x\n\n');
  process.stdout.write('Waiting for authentication (timeout 60s)...\nOr, paste the authorization code here and press Enter:\n');
  let entrada = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => {
    entrada += c;
    if (!entrada.includes('\n')) return;
    const codigo = entrada.trim();
    if (!/^4\/bom/.test(codigo)) {
      process.stderr.write('error: authentication failed or timed out\n');
      process.exit(1);
    }
    fs.mkdirSync(cli, { recursive: true });
    fs.writeFileSync(token, '{"token":"falso"}');
    usage();
    process.exit(0);
  });
}

const ENVELOPE = { decision: 'needs_decision', analysisStatus: 'complete', reportMarkdown: 'relatório', payloads: { comment: { body: 'ok' } }, protocolo: { prReviewer: 'dispensado', motivo: 'provedor sem subagente' } };

function passo(indice, extra) {
  linha({ event: 'step_update', step_update: { conversation_id: 'c', step_index: indice, ...extra } });
}

function sessao(conversa) {
  linha({ event: 'init', conversation_id: conversa, init: { cwd: process.cwd(), tools: ['run_command', 'view_file'], permission_mode: 'always-proceed' } });
  const cenario = env.AGY_FALSO_CENARIO || 'ok';
  if (cenario === 'sem-result') { passo(1, { state: 'ACTIVE', step_type: 'agent_response', text_delta: 'come' }); process.exit(2); }
  passo(1, { state: 'DONE', step_type: 'agent_response', text_delta: 'Vou ler o PR.', usage: { input_tokens: 100, output_tokens: 10, thinking_tokens: 5, cache_read_tokens: 50 } });
  passo(2, { state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'gh pr view 1' } } });
  passo(2, { state: 'DONE', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', output: 'ok' } });
  if (cenario === 'timeout') {
    process.stderr.write('[agy] print timeout after 1m40s with turn in progress; returning partial output\n');
    linha({ event: 'result', result: { conversation_id: conversa, status: 'SUCCESS', response: '', num_turns: 0, usage: { input_tokens: 100, output_tokens: 10, thinking_tokens: 5, cache_read_tokens: 50 } } });
    process.exit(0);
  }
  if (cenario === 'cota') {
    process.stderr.write('AGY_ERROR: {"status":"RESOURCE_EXHAUSTED","code":429,"message":"You have exhausted your quota on this model.","retryable":false}\n');
    linha({ event: 'result', result: { conversation_id: conversa, status: 'ERROR', error: 'You have exhausted your quota on this model.', usage: { input_tokens: 100, output_tokens: 10, thinking_tokens: 5, cache_read_tokens: 50 } } });
    process.exit(3);
  }
  // o marcador chega partido entre dois pedaços, e há prosa antes do envelope no mesmo turno
  passo(3, { state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Conferi a afirmação.\n\nFAROL_CHECKPOINT {' });
  passo(3, { state: 'ACTIVE', step_type: 'agent_response', text_delta: '"claim":"c","file":"a.js","line":1,"verdict":"confirmado","evidence":"e"}\n' });
  passo(3, { state: 'DONE', step_type: 'agent_response', usage: { input_tokens: 200, output_tokens: 20, thinking_tokens: 10, cache_read_tokens: 100 } });
  const json = JSON.stringify(ENVELOPE);
  passo(4, { state: 'ACTIVE', step_type: 'agent_response', text_delta: json.slice(0, 40) });
  passo(4, { state: 'ACTIVE', step_type: 'agent_response', text_delta: json.slice(40) });
  passo(4, { state: 'DONE', step_type: 'agent_response' });
  const response = `Vou ler o PR.Conferi a afirmação.\n\nFAROL_CHECKPOINT {"claim":"c"}\n${json}\n`;
  linha({ event: 'result', result: { conversation_id: conversa, status: 'SUCCESS', response, num_turns: 1, usage: { input_tokens: 300, output_tokens: 30, thinking_tokens: 15, cache_read_tokens: 150, total_tokens: 330 } } });
  process.exit(0);
}

function principal() {
  if (args.includes('--version')) { anotar('versao'); process.stdout.write('1.4.3\n'); return; }
  if (valor('-p') === '/usage') {
    anotar('usage');
    if (!fs.existsSync(token)) return pedirLogin();
    escreverLog();
    usage();
    return;
  }
  if (valor('--input-format') !== 'stream-json') return;
  anotar('sessao');
  const pedida = valor('--conversation');
  const conversa = pedida && env.AGY_FALSO_RETOMA !== '0' ? pedida : 'c0ffee00-0000-4000-8000-000000000001';
  if (pedida && env.AGY_FALSO_RETOMA === '0') process.stderr.write(`warning: conversation "${pedida}" not found\n`);
  let entrada = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { entrada += c; });
  process.stdin.on('end', () => {
    if (env.AGY_FALSO_REGISTRO) fs.appendFileSync(env.AGY_FALSO_REGISTRO, JSON.stringify({ modo: 'prompt', entrada }) + '\n');
    sessao(conversa);
  });
}

principal();
