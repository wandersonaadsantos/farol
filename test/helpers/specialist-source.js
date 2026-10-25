// Dublê apenas da fronteira gh/GitHub. Conteúdo e IDs de blobs são Git reais.
import crypto from 'node:crypto';
const sha = value => crypto.createHash('sha1').update(value).digest('hex');
const gitBlob = text => sha(Buffer.concat([Buffer.from(`blob ${Buffer.byteLength(text)}\0`), Buffer.from(text)]));
function specialistSource() {
  const first = 'a'.repeat(40), second = 'b'.repeat(40);
  const state = { head: first, branch: 'main', mode: '100644', unavailable: false, truncated: false,
    commits: { [first]: { 'CLAUDE.md': 'Use domain services.\nAdapters contain I/O.\n', 'src/a.ts': 'export const value = 1;\n' } }, requests: [] };
  state.commits[second] = { ...state.commits[first], 'CLAUDE.md': 'Use ports and adapters.\nAdapters contain I/O.\n' };
  function material(files) {
    const trees = new Map(), blobs = new Map();
    function makeTree(prefix) {
      const children = new Map();
      for (const [file, text] of Object.entries(files)) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length), [name, ...parts] = rest.split('/');
        if (parts.length) children.set(name, { path: name, type: 'tree', mode: '040000', sha: makeTree(prefix + name + '/') });
        else { const blob = gitBlob(text); blobs.set(blob, text); children.set(name, { path: name, type: 'blob', mode: state.mode, sha: blob }); }
      }
      const tree = [...children.values()], id = sha(JSON.stringify(tree)); trees.set(id, tree); return id;
    }
    return { root: makeTree(''), trees, blobs };
  }
  async function run(command, args, options) {
    state.requests.push({ command, args, account: options?.env?.TEST_ACCOUNT });
    if (state.unavailable) return { ok: false, stdout: '', stderr: 'synthetic network unavailable' };
    if (command !== 'gh' || args[0] !== 'api') return { ok: true, stdout: '[]', stderr: '' };
    const endpoint = args[1], materials = Object.values(state.commits).map(material);
    let value;
    if (endpoint.includes('/git/ref/heads/')) value = { ref: 'refs/heads/' + state.branch, object: { type: 'commit', sha: state.head } };
    else if (endpoint.includes('/pulls/')) value = { head: state.head, base: first, branch: state.branch };
    else if (endpoint.includes('/git/commits/')) {
      const id = endpoint.split('/').at(-1), files = state.commits[id];
      if (files) value = { sha: id, tree: material(files).root };
    } else if (endpoint.includes('/git/trees/')) {
      const id = endpoint.split('/').at(-1), found = materials.find(m => m.trees.has(id));
      if (found) value = { sha: id, tree: found.trees.get(id), truncated: state.truncated };
    } else if (endpoint.includes('/git/blobs/')) {
      const id = endpoint.split('/').at(-1), found = materials.find(m => m.blobs.has(id));
      if (found) { const text = found.blobs.get(id); value = { sha: id, content: Buffer.from(text).toString('base64'), encoding: 'base64', size: Buffer.byteLength(text) }; }
    }
    return { ok: !!value, stdout: JSON.stringify(value || null), stderr: '' };
  }
  return { state, run, first, second, gitBlob };
}
export { specialistSource, gitBlob };
