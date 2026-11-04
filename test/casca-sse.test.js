// Os eventos das cascas nativas no SSE (lib/http-server.js + lib/engine/avisos-nativos.js): a
// conexão nova recebe `casca` logo depois do `state` inicial, cada evento que vira notificação
// sai também como `aviso-nativo` pronto, e `casca` volta a sair quando o retrato muda. Servidor
// real, no molde do test/http-ui-spa.test.js.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-casca-sse-'));
process.env.FAROL_HOME = HOME;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const { parseJson } = await import('../lib/io.js');

let engine, server, porta;

before(async () => {
  engine = new Engine();
  engine.config.port = 0;
  server = await new Promise((resolve, reject) => {
    const s = startServer(engine, (url, err) => (err ? reject(err) : resolve(s)));
  });
  porta = server.address().port;
});

after(() => {
  try { server.close(); } catch { /* já fechado */ }
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// Abre o stream e guarda os quadros `event:`/`data:` na ordem; `proximo(nome)` espera o
// próximo quadro daquele nome depois do último que ele já devolveu.
function abrirStream() {
  const todos = [];
  const esperas = new Set();
  let resto = '';
  let lidos = 0;
  let res = null;
  const req = http.request({ host: '127.0.0.1', port: porta, path: '/api/events', headers: { host: `127.0.0.1:${porta}`, 'x-farol': '1' } }, (r) => {
    res = r;
    r.setEncoding('utf8');
    r.on('data', (pedaco) => {
      resto += pedaco;
      let fim;
      while ((fim = resto.indexOf('\n\n')) >= 0) {
        const bloco = resto.slice(0, fim);
        resto = resto.slice(fim + 2);
        const evento = (bloco.match(/^event: (.*)$/m) || [])[1];
        const data = (bloco.match(/^data: (.*)$/m) || [])[1];
        todos.push({ evento, data: parseJson(data) });
        for (const tentar of esperas) tentar();
      }
    });
  });
  req.end();
  return {
    todos,
    proximo(nome) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { esperas.delete(tentar); reject(new Error(`sem evento ${nome}`)); }, 5000);
        function tentar() {
          const i = todos.findIndex((q, j) => j >= lidos && q.evento === nome);
          if (i < 0) return;
          esperas.delete(tentar);
          clearTimeout(timer);
          lidos = i + 1;
          resolve(todos[i]);
        }
        esperas.add(tentar);
        tentar();
      });
    },
    fechar() {
      try { req.destroy(); } catch { /* já fechado */ }
      try { if (res) res.destroy(); } catch { /* já fechado */ }
    },
  };
}

test('a conexão SSE recebe casca depois do state inicial, e aviso-nativo a cada evento', async () => {
  const s = abrirStream();
  try {
    await s.proximo('state');
    const casca = await s.proximo('casca');
    assert.deepEqual(casca.data.badge, { contador: 0, rotulo: '' });
    assert.equal(casca.data.ocupado, false);
    assert.equal(s.todos.findIndex(q => q.evento === 'state') < s.todos.findIndex(q => q.evento === 'casca'), true);

    engine.emit('auto-commented', { pr: { key: 'o/r#1', url: 'u' } });
    const aviso = await s.proximo('aviso-nativo');
    assert.equal(aviso.data.titulo, 'Farol · comentado 💬');
    assert.equal(aviso.data.pr, 'o/r#1');

    engine.config.autostart = true;
    engine.emit('settings-changed', engine.config);
    const depois = await s.proximo('casca');
    assert.equal(depois.data.autostart, true);
  } finally {
    s.fechar();
  }
});

test('evento que não vira notificação não sai como aviso-nativo, e casca igual não repete', async () => {
  const s = abrirStream();
  try {
    await s.proximo('casca');
    engine.emit('needs-decision', { key: 'o/r#2' });
    // o mesmo config de antes: o retrato não mudou, então nenhuma casca nova
    engine.emit('settings-changed', engine.config);
    engine.emit('settings-changed', engine.config);
    engine.emit('tool-done', { name: 'kudos', label: 'Kudos' });
    const aviso = await s.proximo('aviso-nativo');
    assert.equal(aviso.data.titulo, 'Farol · Kudos');
    const nomes = s.todos.map(q => q.evento);
    assert.equal(nomes.filter(n => n === 'aviso-nativo').length, 1);
    assert.equal(nomes.filter(n => n === 'casca').length, 1);
  } finally {
    s.fechar();
  }
});

test('aviso que não se monta (payload fora da forma) vira WARN e não derruba quem emitiu', async () => {
  const s = abrirStream();
  const logs = [];
  const logReal = engine.log;
  engine.log = (nivel, texto) => { logs.push([nivel, texto]); };
  try {
    await s.proximo('casca');
    // sem `pr`: o avisoDeAprovado lança; o emit vem do desfecho que já postou no GitHub
    assert.doesNotThrow(() => engine.emit('auto-approved', { result: {} }));
    engine.emit('tool-done', { name: 'kudos', label: 'Kudos' });
    const aviso = await s.proximo('aviso-nativo');
    assert.equal(aviso.data.titulo, 'Farol · Kudos', 'o stream segue vivo e o aviso seguinte sai');
    assert.ok(s.todos.some(q => q.evento === 'auto-approved'), 'o evento original foi repassado antes');
    assert.equal(s.todos.filter(q => q.evento === 'aviso-nativo').length, 1, 'nenhum aviso do payload quebrado');
    assert.ok(logs.some(([nivel, texto]) => nivel === 'WARN' && /auto-approved/.test(texto)), 'a falha fica no farol.log');
  } finally {
    engine.log = logReal;
    s.fechar();
  }
});
