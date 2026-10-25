// Aquisição pelo GitHub com autenticação atual; nunca consulta checkout pessoal.
import io, { parseJson } from '../io.js';
import { SHA, DEFAULTS, check, aborted, sourcePath } from './contract.js';
import { sourceWork } from './work.js';
import { mascararSegredos } from '../engine/falhas.js';

const META = '{number, url: .html_url, changedFiles: .changed_files, head: .head.sha, base: .base.sha, '
  + 'headRepo: .head.repo.full_name, headRepositoryId: .head.repo.id, baseRepo: .base.repo.full_name, baseRepositoryId: .base.repo.id}';
async function request(engine, scope, endpoint, jq, options = {}) {
  aborted(options.signal);
  const args = ['api', '--hostname', scope.host, endpoint];
  if (options.paginate) args.push('--paginate', '--slurp');
  if (jq) args.push('--jq', jq);
  const result = await sourceWork(options.limits || DEFAULTS, options.signal, () => io.run('gh', args,
    { env: engine.ghEnv(scope.authAccount || scope.account), signal: options.signal, timeout: options.limits?.timeoutMs || DEFAULTS.timeoutMs,
      maxBuffer: options.maxBuffer || 32 * 1024 ** 2 }));
  aborted(options.signal);
  check(result.ok, 'Fonte GitHub indisponível para a conta atual.');
  const data = parseJson(result.stdout);
  check(data !== null, 'Resposta GitHub inválida.');
  return data;
}
async function authorize(engine, scope, options) {
  check(engine.tokenFor(scope.authAccount || scope.account), 'Credencial da fonte indisponível.');
  const user = await request(engine, scope, 'user', '{login}', options);
  check(user.login?.toLowerCase() === scope.account, 'A identidade autenticada difere da conta da fonte.');
  const repo = await request(engine, scope, `repos/${scope.repo}`, '{id, full_name, private}', options);
  check(Number.isSafeInteger(repo.id) && repo.id > 0 && repo.full_name?.toLowerCase() === scope.repo, 'Acesso ao repositório não confirmado.');
  return { ...scope, repositoryId: repo.id, private: repo.private === true };
}
async function snapshot(engine, scope, options) {
  const value = await request(engine, scope, `repos/${scope.repo}/pulls/${scope.number}`, META, options);
  check(value.number === scope.number && value.baseRepositoryId === scope.repositoryId
    && value.baseRepo?.toLowerCase() === scope.repo && SHA.test(value.head || '') && SHA.test(value.base || '')
    && value.url?.toLowerCase() === `https://${scope.host}/${scope.repo}/pull/${scope.number}`
    && Number.isSafeInteger(value.changedFiles) && value.changedFiles >= 0, 'Identidade ou versão do PR não confirmada.');
  return value;
}
function normalizeFile(file) {
  const path = sourcePath(file?.path ?? file?.filename, true);
  check(['added', 'modified', 'removed', 'renamed', 'copied', 'changed', 'unchanged'].includes(file.status), 'Status de arquivo não suportado.');
  const lines = file.lines ?? ((file.additions ?? 0) + (file.deletions ?? 0));
  check(Number.isSafeInteger(lines) && lines >= 0, 'Contagem de linhas inválida.');
  const previous = file.previousPath ?? file.previous_filename;
  const previousPath = previous ? sourcePath(previous, true) : null;
  let sensitive = false;
  try { sourcePath(path); } catch { sensitive = true; }
  if (typeof file.patch === 'string' && mascararSegredos(file.patch) !== file.patch) sensitive = true;
  const patchAvailable = !sensitive && typeof file.patch === 'string' && file.patch.length > 0;
  let patchStatus = patchAvailable ? 'available' : 'unavailable';
  if (patchAvailable && Number.isInteger(file.additions) && Number.isInteger(file.deletions)) {
    const lines = file.patch.split(/\r?\n/);
    const additions = lines.filter(line => line.startsWith('+')).length;
    const deletions = lines.filter(line => line.startsWith('-')).length;
    if (additions !== file.additions || deletions !== file.deletions) patchStatus = 'partial';
  }
  const patch = patchAvailable ? file.patch : null;
  const headBlob = file.status === 'removed' ? null : String(file.sha || '');
  return { path, sha: String(file.sha || ''), status: file.status, lines, previousPath,
    patch, patchStatus, sensitive, headBlob, baseBlob: null };
}
function parsePages(pages) {
  check(Array.isArray(pages) && pages.length > 0 && pages.every(Array.isArray), 'Páginas de patches incompatíveis.');
  return pages.flatMap(page => page.map(normalizeFile));
}
async function files(engine, scope, options) {
  const pages = await request(engine, scope, `repos/${scope.repo}/pulls/${scope.number}/files?per_page=100`, null, { ...options, paginate: true });
  return parsePages(pages);
}
async function mergeBase(engine, scope, target, options) {
  const value = await request(engine, scope, `repos/${scope.repo}/compare/${target.base}...${target.head}`, '{mergeBase: .merge_base_commit.sha}', options);
  check(SHA.test(value.mergeBase || ''), 'Merge-base indisponível.');
  return value.mergeBase;
}
function sameTarget(before, after) {
  return ['head', 'base', 'changedFiles', 'headRepo', 'headRepositoryId', 'baseRepositoryId'].every(k => before[k] === after[k]);
}
export { request, authorize, snapshot, files, mergeBase, sameTarget, parsePages };
