// O stream da UI contra uma Engine real: quem conecta recebe o snapshot inteiro UMA
// vez e, dali em diante, só o que mudou. É o par de ponta a ponta do teste puro em
// test/estado-delta.test.js, porque o ganho medido (84% do tráfego de /api/events)
// depende da fiação em lib/http-server.js, não só da função.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-sse-delta-'));
process.env.FAROL_HOME = HOME;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');

let server, base, engine;

before(async () => {
  engine = new Engine();
  engine.config.port = 0;
  await new Promise((resolve, reject) => {
    server = startServer(engine, (url, err) => (err ? reject(err) : resolve()));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  try { server && server.close(); } catch { /* ok */ }
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// Abre o stream e devolve um coletor de eventos já separados por tipo.
function abrirStream() {
  return new Promise((resolve, reject) => {
    const req = http.get(base + '/api/events', (res) => {
      const eventos = [];
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (pedaco) => {
        buffer += pedaco;
        let corte;
        while ((corte = buffer.indexOf('\n\n')) >= 0) {
          const bloco = buffer.slice(0, corte);
          buffer = buffer.slice(corte + 2);
          const tipo = /^event: (.+)$/m.exec(bloco);
          const dado = /^data: (.*)$/m.exec(bloco);
          if (tipo && dado) eventos.push({ tipo: tipo[1], dados: dado[1] });
        }
      });
      resolve({ eventos, headers: res.headers, fechar: () => req.destroy() });
    });
    req.on('error', reject);
  });
}

// O write do estado é síncrono dentro do emit, mas o socket entrega no tique
// seguinte: esperar por condição em vez de dormir um tempo fixo.
async function ate(condicao, limiteMs = 3000) {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    if (condicao()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

test('abre com o snapshot inteiro e depois só manda o que mudou', async () => {
  const s = await abrirStream();
  assert.ok(await ate(() => s.eventos.length >= 1), 'o primeiro evento não chegou');
  assert.equal(s.eventos[0].tipo, 'state');
  const inicial = JSON.parse(s.eventos[0].dados);
  assert.ok(Object.keys(inicial).length > 10, 'o snapshot inicial deve vir inteiro');

  engine.status = 'checking';
  engine.pushState();
  assert.ok(await ate(() => s.eventos.length >= 2), 'o patch não chegou');
  const patch = s.eventos[1];
  assert.equal(patch.tipo, 'state-patch');
  const corpo = JSON.parse(patch.dados);
  assert.deepEqual(Object.keys(corpo.campos), ['status']);
  assert.equal(corpo.campos.status, 'checking');
  // o patch é ordens de grandeza menor que o snapshot: é o motivo desta mudança
  assert.ok(patch.dados.length < s.eventos[0].dados.length / 10,
    `patch de ${patch.dados.length} bytes contra snapshot de ${s.eventos[0].dados.length}`);
  s.fechar();
});

test('empurrão que não muda nada não vira evento nenhum', async () => {
  const s = await abrirStream();
  assert.ok(await ate(() => s.eventos.length >= 1));
  engine.pushState();
  engine.pushState();
  // espera ATIVA por um evento que não deve existir: se aparecer, o teste falha
  await ate(() => s.eventos.length >= 2, 300);
  assert.equal(s.eventos.length, 1, 'estado igual não pode gerar tráfego');
  s.fechar();
});

test('mesclar os patches no snapshot inicial reproduz o estado do engine', async () => {
  const s = await abrirStream();
  assert.ok(await ate(() => s.eventos.length >= 1));
  let estado = JSON.parse(s.eventos[0].dados);

  engine.status = 'idle';
  engine.pushState();
  assert.ok(await ate(() => s.eventos.length >= 2));
  engine.status = 'checking';
  engine.pushState();
  assert.ok(await ate(() => s.eventos.length >= 3));

  for (const e of s.eventos.slice(1)) {
    const corpo = JSON.parse(e.dados);
    estado = { ...estado, ...corpo.campos };
    for (const k of corpo.removidos || []) delete estado[k];
  }
  assert.deepEqual(estado, JSON.parse(JSON.stringify(engine.snapshot())));
  s.fechar();
});

// Quem conecta depois não pode receber a diferença contra o retrato de OUTRO cliente:
// ele nunca viu aquele estado, e mesclar sobre o que não tem daria tela divergente.
test('cliente novo recebe o snapshot inteiro, não o patch do vizinho', async () => {
  const antigo = await abrirStream();
  assert.ok(await ate(() => antigo.eventos.length >= 1));
  engine.status = 'idle';
  engine.pushState();
  assert.ok(await ate(() => antigo.eventos.length >= 2));

  const novo = await abrirStream();
  assert.ok(await ate(() => novo.eventos.length >= 1));
  assert.equal(novo.eventos[0].tipo, 'state');

  engine.status = 'checking';
  engine.pushState();
  assert.ok(await ate(() => novo.eventos.length >= 2));
  assert.equal(novo.eventos[1].tipo, 'state-patch');
  antigo.fechar(); novo.fechar();
});

test('o stream pede para não ser bufferizado por intermediário', async () => {
  const s = await abrirStream();
  assert.equal(s.headers['x-accel-buffering'], 'no');
  s.fechar();
});
