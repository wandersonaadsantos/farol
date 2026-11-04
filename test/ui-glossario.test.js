// Glossário de produto: o texto que a pessoa lê não usa o jargão interno do motor.
//
// Lê o texto VISÍVEL do index.html (sem <code>, sem comentários, sem atributos que não
// são texto) e as strings entre aspas ou crases dos módulos de ui/pure e ui/telas.
// Exceções declaradas e curtas:
//   - conteúdo de <code>…</code> e atributos id/value/name/for/class/data-*/href/type/min/max/step
//     (nomes de flag, campo e valor técnico);
//   - strings que são caminho ou seletor de código ('#…', '.…', '/…');
//   - strings de um só token em minúsculas (identificador, chave de dado como `pushback` em
//     USAGE_KIND_LABEL, nome de campo do snapshot como headlessWaiting);
//   - o histórico de versões (telas/release-notes*.js), que registra o texto de cada época;
//   - as dicas de busca (`hint`) de ui/pure/sistema-busca.js, que guardam o jargão antigo
//     como sinônimo (quem digita "pushback" ainda acha a opção).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { arquivosDosPuros, arquivosDasTelas } from './helpers/fontes-ui.js';

const RAIZ = path.join(import.meta.dirname, '..');

const PROIBIDOS = [
  /\bgates?\b/i, /headless/i, /\blease\b/i, /pushback/i, /round 2/i, /\bxhigh\b/i,
  /\bMCPs?\b/i, /conectores/i, /\badmiss[ãa]o\b/i, /\badmiss[õo]es\b/i, /\bcadeia\b/i,
  /conexão com o engine/i, /SHA-256 sem chave/i, /\bmedium\b/i,
];

function htmlSemCodigo() {
  return fs.readFileSync(path.join(RAIZ, 'ui', 'index.html'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<code[^>]*>[\s\S]*?<\/code>/gi, ' ')
    .replace(/\s(?:id|value|name|for|class|href|type|min|max|step|data-[\w-]+)="[^"]*"/g, ' ');
}

function stringsDe(texto) {
  const semComentarios = texto
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1');
  const achados = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(semComentarios))) {
    const s = m[1] ?? m[2] ?? m[3] ?? '';
    if (/^(#|\.|\/)/.test(s)) continue;
    if (/^[a-z][\w.-]*$/.test(s)) continue; // identificador ou chave de dado, não texto
    achados.push(s.replace(/\$\{[^}]*\}/g, ' ').replace(/\s(?:id|class|name|for|href|type|data-[\w-]+)="[^"]*"/g, ' '));
  }
  return achados;
}

function procurar(nome, textos) {
  const pontos = [];
  for (const t of textos) {
    for (const re of PROIBIDOS) {
      const m = t.match(re);
      if (m) pontos.push(`${nome}: "${m[0]}" em «${t.replace(/\s+/g, ' ').slice(0, 90)}»`);
    }
  }
  return pontos;
}

test('o index.html não usa o jargão interno no texto visível', () => {
  const html = htmlSemCodigo();
  const pontos = procurar('index.html', html.split(/<[^>]+>/).filter(Boolean));
  const atributos = (html.match(/<[^>]+>/g) || [])
    .flatMap((t) => [...t.matchAll(/(?:title|placeholder|aria-label)="([^"]*)"/g)].map((m) => m[1]));
  pontos.push(...procurar('index.html (atributo)', atributos));
  assert.deepEqual(pontos, []);
});

test('os módulos de ui/pure e ui/telas não usam o jargão interno nas strings', () => {
  const pontos = [];
  for (const { nome, texto } of [...arquivosDosPuros(), ...arquivosDasTelas()]) {
    if (nome === 'pure.js') continue;
    let strings = stringsDe(texto);
    if (/^telas\/release-notes/.test(nome)) continue; // histórico de versões: texto de época, não se reescreve
    if (nome === 'pure/sistema-busca.js') strings = [];
    pontos.push(...procurar(nome, strings));
  }
  assert.deepEqual(pontos, []);
});
