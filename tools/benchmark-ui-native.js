// Electron dedicado, UI completa de cada revisão e transporte local com dados sintéticos.
// Invocar com electron.exe tools/benchmark-ui-native.js --baseline <raiz> --target <raiz> --output <json>.
import { app, BrowserWindow, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { estadoInicial } from './bench/ui-fixture.js';
import { executarTraco } from './bench/ui-native-trace.js';
import { parseJson, safeStringify, writeJsonAtomic } from '../lib/io.js';
import { envSemRepositorioHerdado } from '../lib/git-env.js';
const args = process.argv.slice(2);
function argumento(nome) {
  const i = args.indexOf(nome);
  if (i < 0 || !args[i + 1]) throw new Error(`Informe ${nome}.`);
  return path.resolve(args[i + 1]);
}
const output = argumento('--output');
const roots = { baseline: argumento('--baseline'), entrega: argumento('--target') };
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-ui-native-'));
app.setPath('userData', path.join(sandbox, 'userData'));
app.setPath('sessionData', path.join(sandbox, 'sessionData'));
app.on('window-all-closed', () => {});
const report = { method: 'UI completa de cada revisão, DOM/SSE/janela nativos, engine e provedores substituídos por transporte sintético. Contagens DOM não equivalem a CPU, GPU ou qualidade de review.',
  cadencesMs: [120, 1000], fixture: { queue: 12, panorama: 20, myPRs: 1, reports: 6, reportItems: 20 },
  versions: process.versions, architecture: process.arch, platform: process.platform,
  configuration: { externalNetwork: 'blocked', sandbox, gpuDisabled: app.commandLine.hasSwitch('disable-gpu'),
    nodeIntegration: false, contextIsolation: true, realEngine: false, autostartProbe: false,
    elapsedLimit: 'Durações incluem esperas do transporte e a cadência proposital; não medem tempo exclusivo de CPU.' },
  results: {}, status: 'running' };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = text => createHash('sha256').update(text).digest('hex');
const git = (root, ...command) => execFileSync('git', command, { cwd: root, encoding: 'utf8', windowsHide: true, env: envSemRepositorioHerdado() }).trim();
function manifesto(root, files) {
  return [...files].sort().map(file => ({ file: path.relative(root, file).replaceAll('\\', '/'),
    bytes: fs.statSync(file).size, sha256: hash(fs.readFileSync(file)) }));
}
function servidor(root) {
  const streams = new Set(), requests = [], files = new Set();
  const fixture = estadoInicial();
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write(`event: state\ndata: ${safeStringify(fixture)}\n\n`);
      streams.add(res); req.on('close', () => streams.delete(res)); return;
    }
    if (pathname.startsWith('/api/')) {
      let body = ''; for await (const chunk of req) body += chunk;
      requests.push({ path: pathname, method: req.method, body: body ? parseJson(body, null) : null });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(safeStringify(req.method === 'POST' ? { ok: true } : null)); return;
    }
    const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
    let file = path.resolve(root, 'ui', relative || 'index.html');
    if (!file.startsWith(path.resolve(root, 'ui') + path.sep)) { res.writeHead(403); res.end(); return; }
    if (!fs.existsSync(file) && !path.extname(file)) file = path.join(root, 'ui/index.html');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    files.add(file);
    const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  function enviar(event, data) { for (const stream of streams) stream.write(`event: ${event}\ndata: ${safeStringify(data)}\n\n`); }
  return { server, requests, streams, files, enviar };
}
async function medir(nome, root) {
  const transport = servidor(root);
  await new Promise(resolve => transport.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${transport.server.address().port}`;
  const partition = session.fromPartition(`bench-${nome}`);
  const blocked = [], errors = [];
  partition.webRequest.onBeforeRequest((details, callback) => {
    const allow = details.url.startsWith(`${origin}/`) || details.url === 'about:blank' || details.url.startsWith('data:');
    if (!allow) blocked.push(details.url);
    callback({ cancel: !allow });
  });
  const win = new BrowserWindow({ width: 1100, height: 800, show: false,
    webPreferences: { session: partition, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
  win.webContents.on('console-message', (_event, _level, message) => { if (/^(?:Uncaught|\[benchmark-error\])/.test(message)) errors.push(message); });
  win.webContents.on('render-process-gone', (_event, details) => errors.push(safeStringify(details)));
  try {
    await win.loadURL(origin);
    win.showInactive();
    const commit = git(root, 'rev-parse', 'HEAD');
    const sourceBefore = manifesto(root, transport.files);
    const metrics = () => app.getAppMetrics().find(metric => metric.pid === win.webContents.getOSProcessId());
    await win.webContents.executeJavaScript("fetch('https://farol-benchmark.invalid/isolation-probe').catch(()=>null)");
    if (!blocked.length) throw new Error('A barreira de rede externa não bloqueou a sonda.');
    const result = await executarTraco({ win, transport, delay, metrics, revised: nome === 'entrega' });
    const sourceAfter = manifesto(root, transport.files);
    const unchanged = sourceBefore.every(entry => sourceAfter.some(after => after.file === entry.file && after.sha256 === entry.sha256));
    if (!unchanged) throw new Error('Fonte servida alterada durante a medição.');
    if (errors.length) throw new Error(`Renderer apresentou erros: ${safeStringify(errors)}`);
    return { root, commit, commitAfter: git(root, 'rev-parse', 'HEAD'), dirty: git(root, 'status', '--short'),
      servedManifest: sourceAfter, servedManifestHash: hash(safeStringify(sourceAfter)), sourcesUnchanged: unchanged,
      ...result, blockedRequests: blocked, rendererErrors: errors };
  } finally {
    win.destroy(); for (const stream of transport.streams) stream.end();
    transport.server.closeAllConnections(); await new Promise(resolve => transport.server.close(resolve));
  }
}
async function main() {
  await app.whenReady();
  try {
    const tools = ['tools/benchmark-ui-native.js', 'tools/bench/ui-native-trace.js', 'tools/bench/ui-fixture.js'];
    report.fixtureManifest = manifesto(path.resolve(import.meta.dirname, '..'), tools.map(file => path.resolve(import.meta.dirname, '..', file)));
    for (const [nome, root] of Object.entries(roots)) report.results[nome] = await medir(nome, root);
    assert.deepEqual(report.results.entrega.finalState, report.results.baseline.finalState, 'mesmo estado funcional final');
    report.finalStateEquivalent = true;
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.error = error.stack; }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  writeJsonAtomic(output, report);
  fs.writeFileSync(`${output}.log`, safeStringify({ status: report.status, runtime: process.versions,
    architecture: process.arch, command: process.argv, error: report.error || null }));
  console.log(safeStringify({ status: report.status, output, error: report.error }));
  app.exit(report.status === 'passed' ? 0 : 1);
}
main().catch(error => { console.error(error); app.exit(1); });
