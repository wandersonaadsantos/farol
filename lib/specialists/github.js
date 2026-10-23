// Fontes na conta e no commit solicitados. Percorre árvores sem seguir symlinks/submódulos.
import crypto from 'node:crypto';
import io, { parseJson } from '../io.js';
import { check, SHA, safeText, sourceRef } from './contract.js';

async function api(engine, scope, endpoint, jq) {
  const user = engine.accountList().find(a => a.user?.toLowerCase() === scope.account)?.user;
  check(user && engine.tokenFor(user), 'Credencial da conta indisponível para verificar as fontes.');
  const result = await io.run('gh', ['api', `repos/${scope.repo}/${endpoint}`, '--jq', jq], { env: engine.ghEnv(user) });
  check(result.ok, 'Não foi possível verificar a fonte no GitHub.');
  const data = parseJson(result.stdout);
  check(data && typeof data === 'object', 'Resposta de fonte inválida.');
  return data;
}

async function branchHead(engine, scope) {
  const ref = await api(engine, scope, `git/ref/heads/${scope.branch.split('/').map(encodeURIComponent).join('/')}`,
    '{ref: .ref, object: .object}');
  check(ref.ref === `refs/heads/${scope.branch}` && ref.object?.type === 'commit' && SHA.test(ref.object.sha), 'Branch não pôde ser confirmada.');
  return ref.object.sha;
}

async function reader(engine, scope, commit) {
  check(SHA.test(commit), 'Commit da fonte inválido.');
  const data = await api(engine, scope, `git/commits/${commit}`, '{sha: .sha, tree: .tree.sha}');
  check(data.sha === commit && SHA.test(data.tree), 'Árvore do commit indisponível.');
  const trees = new Map();
  async function tree(sha) {
    if (!trees.has(sha)) {
      const value = await api(engine, scope, `git/trees/${sha}`, '{sha: .sha, truncated: .truncated, tree: [.tree[] | {path, mode, type, sha}]}');
      check(value.sha === sha && value.truncated === false && Array.isArray(value.tree), 'Árvore incompleta; não comprova validade.');
      trees.set(sha, value.tree);
    }
    return trees.get(sha);
  }
  async function blobAt(ref) {
    const parts = sourceRef(ref).path.split('/');
    let sha = data.tree;
    for (const [i, name] of parts.entries()) {
      const matches = (await tree(sha)).filter(e => e.path === name);
      if (!matches.length) return null;
      check(matches.length === 1 && SHA.test(matches[0].sha), 'Entrada de árvore inválida.');
      const entry = matches[0], last = i === parts.length - 1;
      if (last) { check(entry.type === 'blob' && ['100644', '100755'].includes(entry.mode), 'Symlink ou submódulo não é fonte de especialista.'); return entry.sha; }
      check(entry.type === 'tree' && entry.mode === '040000', 'Diretório de fonte inválido.');
      sha = entry.sha;
    }
    return null;
  }
  async function textAt(ref) {
    const blob = await blobAt(ref);
    check(blob, 'Arquivo de evidência não encontrado.');
    const result = await api(engine, scope, `git/blobs/${blob}`, '{sha, encoding, size, content}');
    check(result.sha === blob && result.encoding === 'base64' && Number.isInteger(result.size) && result.size <= 1024 * 1024
      && typeof result.content === 'string' && result.content.length <= 1500000, 'Fonte não é um texto suportado (máximo 1 MiB).');
    const bytes = Buffer.from(result.content.replace(/\s/g, ''), 'base64');
    const hash = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    check(hash === blob && bytes.length === result.size, 'Conteúdo da fonte não confere com o blob.');
    const text = bytes.toString('utf8');
    check(!text.includes('\0') && !text.includes('\uFFFD'), 'Fonte binária ou codificação não suportada.');
    return { blob, text };
  }
  async function evidence(ref) {
    const { blob, text } = await textAt(ref);
    const lines = text.split(/\r?\n/);
    check(ref.end <= lines.length, 'Linhas da evidência não existem.');
    const excerpt = safeText(lines.slice(ref.start - 1, ref.end).join('\n'), 4000, 'Evidência');
    return { ...ref, commit, blob, excerpt };
  }
  return { blobAt, evidence, textAt };
}

async function prBase(engine, pr, inventory) {
  const account = engine.accountForPr(pr);
  const response = await io.run('gh', ['api', `repos/${pr.repo}/pulls/${pr.number}`, '--jq', '{head: .head.sha, base: .base.sha, branch: .base.ref}'], { env: engine.ghEnv(account) });
  check(response.ok, 'Não foi possível confirmar a branch do PR.');
  const data = parseJson(response.stdout);
  check(data?.head === inventory.headSha && data.base === inventory.baseSha && typeof data.branch === 'string', 'PR mudou durante a verificação do especialista.');
  return data.branch;
}
export { branchHead, reader, prBase };
