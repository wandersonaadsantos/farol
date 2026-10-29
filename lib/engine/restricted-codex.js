// Codex mantém o plano e recebe uma única ferramenta de leitura, servida pelo host.
import path from 'node:path';
import io, { safeStringify, parseJson } from '../io.js';
import { APP_ROOT } from '../paths.js';
import { restrictedEnvironment, restrictedExecutable } from './restricted-launch.js';
import { assertSelfIsolation } from './self-isolation.js';
import { restrictedCheckpoint } from './self-read-proof.js';
import { observeSourceResult } from './read-evidence.js';

const DISABLED = ['shell_tool', 'unified_exec', 'hooks', 'plugins', 'apps', 'browser_use', 'computer_use',
  'in_app_browser', 'browser_use_external', 'browser_use_full_cdp_access', 'workspace_dependencies',
  'multi_agent', 'code_mode', 'skill_search', 'tool_suggest', 'view_image'];
const SERVER = 'farol_source';
const OUTPUT_TOKEN_LIMIT = 32768;

async function restrictedCodex(opts, auth, inherited, selection = {}) {
  assertSelfIsolation(opts.selfIsolation);
  if (opts.operationKind !== 'self' || auth.kind !== 'codex' || opts.extraArgs?.length || opts.continuationHandle) throw new Error('Contrato restrito do Codex incompatível.');
  const env = restrictedEnvironment(inherited, { kind: 'dir' }, opts.selfIsolation.root);
  if (inherited.CODEX_HOME) env.CODEX_HOME = inherited.CODEX_HOME;
  const command = restrictedExecutable(env, 'codex');
  const help = await io.run(command, ['exec', '--help'], { env });
  if (!help.ok || !['--ignore-user-config', '--ignore-rules', '--ephemeral', '--sandbox'].every(f => help.stdout.includes(f))) {
    throw new Error('Codex sem contrato restrito compatível; nenhum fallback iniciado.');
  }
  const args = ['--no-daemon', '-a', 'never', 'exec', '--ignore-user-config', '--ignore-rules', '--ephemeral',
    '--sandbox', 'read-only', '--strict-config', '--json', '--skip-git-repo-check', '--color', 'never'];
  for (const feature of DISABLED) args.push('--disable', feature);
  args.push('--enable', 'skip_host_skill_discovery');
  const settings = { forced_login_method: 'chatgpt', web_search: 'disabled',
    project_doc_max_bytes: 0, tool_output_token_limit: OUTPUT_TOKEN_LIMIT, 'shell_environment_policy.inherit': 'none' };
  settings[`mcp_servers.${SERVER}`] = { command: process.execPath,
    args: [path.join(APP_ROOT, 'lib/engine/restricted-source.js'), opts.selfIsolation.root],
    env: { ELECTRON_RUN_AS_NODE: '1', FAROL_HOME: path.join(opts.selfIsolation.root, 'runtime/broker-home') },
    enabled_tools: ['read_source', 'list_sources'], required: true };
  settings[`mcp_servers.${SERVER}.tools.read_source.output_token_limit`] = OUTPUT_TOKEN_LIMIT;
  for (const [key, value] of Object.entries(settings)) args.push('-c', `${key}=${tomlValue(value)}`);
  if (selection.model) args.push('--model', selection.model);
  if (selection.effort) args.push('-c', `model_reasoning_effort=${tomlValue(selection.effort)}`);
  args.push('-');
  return { command, args, env, cwd: opts.selfIsolation.root };
}

function tomlValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return '{' + Object.entries(value).map(([key, item]) => `${safeStringify(key)}=${tomlValue(item)}`).join(',') + '}';
  }
  return safeStringify(value);
}

function observeRestrictedCodex(engine, opts, event) {
  const item = event.item;
  assertRestrictedItem(item);
  if (event.type === 'item.completed' && item?.type === 'agent_message') restrictedCheckpoint(engine, opts, item.text);
  if (item?.type !== 'mcp_tool_call' || event.type !== 'item.completed') return;
  if (item.server !== SERVER || item.tool !== 'read_source' || item.status !== 'completed' || item.error || item.result?.isError) return;
  const content = item.result?.content;
  if (!Array.isArray(content) || content.length !== 2) return;
  const returned = parseJson(content[1]?.text, null);
  if (returned?.side !== 'patches') return;
  observeSourceResult(engine, opts, returned, content[0]?.text);
  engine.pushState?.();
}

function assertRestrictedItem(item) {
  if (!item) return;
  if (!['agent_message', 'reasoning', 'mcp_tool_call', 'todo_list', 'error'].includes(item.type)) throw new Error('Ferramenta Codex fora do contrato restrito.');
  if (item.type === 'mcp_tool_call' && (item.server !== SERVER || !['read_source', 'list_sources'].includes(item.tool))) {
    throw new Error('MCP fora do contrato restrito.');
  }
}

function restrictedCodexBlock() {
  return '\nUse a ferramenta read_source do servidor farol_source (side: patches|head|base|mergeBase, path relativo, start e count). '
    + 'Use-a em vez de Read/Grep/Glob. Não há shell, aplicativos ou navegação. Leia integralmente cada patch em páginas. '
    + 'A ferramenta list_sources desse servidor lista caminhos por lado, com paginação offset. '
    + 'O resultado traz totalLines. As contraprovas são somente de leitura, nunca testes executados.';
}

export { restrictedCodex, observeRestrictedCodex, restrictedCodexBlock, tomlValue };
