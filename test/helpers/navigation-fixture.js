import { blobHash } from '../../lib/review-source/contract.js';

const H = 'a'.repeat(40), B = 'b'.repeat(40), M = 'c'.repeat(40);
const HEAD = { 'src/api.js': 'export function price(total) { return { amount: total }; }',
  'src/page.js': "import { price } from './api.js';\nexport const show = () => price(1).toFixed(2);" };
const PREVIOUS = { ...HEAD, 'src/api.js': 'export function price(total) { return total; }' };
function navigationSource(head = HEAD, previous = PREVIOUS, changed = 'src/api.js') {
  let releases = 0;
  const files = [{ path: changed, status: 'modified', sha: blobHash(Buffer.from(head[changed])),
    patchStatus: 'available', patch: '@@ -1 +1 @@\n-return total;\n+return { amount: total };' }];
  return { status: 'complete', manifest: { scope: { host: 'github.com', account: 'alice', repo: 'org/project', authAccount: 'alice' }, H, B, M, files },
    inventory: { status: 'complete', headSha: H, baseSha: B, files, changedFiles: 1 },
    reader: {
      async tree(side) { const texts = side === 'head' ? head : previous; return { complete: true, entries: Object.entries(texts).map(([path, text]) => ({ path, type: 'blob', size: Buffer.byteLength(text) })) }; },
      async read(path, side) { const text = (side === 'head' ? head : previous)[path];
        return text === undefined ? { status: 'unavailable' } : { status: 'available', text, path, blob: blobHash(Buffer.from(text)), commit: side === 'head' ? H : M }; }
    }, release: async () => { releases++; }, releases: () => releases };
}
export { navigationSource, H, B, M };
