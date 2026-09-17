// Executor do roteiro de validação das regras do Realtime Database (firebase/README.md:
// "Validação manual com o emulador (Fase 5)", Parte 1, e os itens 1 a 42 das seções
// "Validação manual das regras v2"), contra os emuladores oficiais do Firebase.
//
// O QUE ELE NÃO FAZ: não sobe emulador, não instala nada, não fala com o Firebase real
// e não lê `~/.farol`. As URLs chegam por argumento ou variável de ambiente, e ele
// falha dizendo o que falta quando elas não respondem.
//
// ANTES DE MEDIR QUALQUER COISA ele confere que as regras carregadas no emulador são
// as de `firebase/database.rules.json`. Sem essa conferência todo o resto mede uma
// versão qualquer e o relatório mente com cara de prova.
//
// Uso (a partir da raiz do repositório):
//   node tools/emuladores/regras-v2.js --banco=http://127.0.0.1:9010 \
//     --auth=http://127.0.0.1:9109 --projeto=demo-farol
//
// Variáveis equivalentes: FAROL_EMU_BANCO, FAROL_EMU_AUTH, FAROL_EMU_PROJETO.
// Sai com 0 quando todos os casos batem, e com 1 no primeiro que não bater.
import fs from 'node:fs';
import path from 'node:path';
import { emuladorBanco, emuladorAuth, emuladorProjeto } from '../../lib/env.js';
import { executadoDireto } from '../../lib/paths.js';
import { montarContexto, conferirRegras, conferirDisponibilidade, derivaDoRelogio, espacoDeNomes } from './regras-contexto.js';
import * as parte1 from './regras-casos-parte1.js';
import * as c1 from './regras-casos-c1.js';
import * as c2a from './regras-casos-c2a.js';
import * as c2b from './regras-casos-c2b.js';
import * as c3a from './regras-casos-c3a.js';
import * as c3b from './regras-casos-c3b.js';
import * as c5 from './regras-casos-c5.js';
import * as tempo from './regras-casos-tempo.js';

const RAIZ = path.join(import.meta.dirname, '..', '..');
const REGRAS = path.join(RAIZ, 'firebase', 'database.rules.json');
const PROJETO_PADRAO = 'demo-farol';
const RAIZ_SONDA = 'sonda-do-executor';
const SECOES = [
  ['Parte 1: dono, lease e os furos declarados', parte1],
  ['C1: itens 2 a 8', c1],
  ['C2a: itens 9 a 13', c2a],
  ['C2b: itens 15 a 21', c2b],
  ['C3a: itens 22 a 25', c3a],
  ['C3b a C3f: itens 26 a 34', c3b],
  ['C5c: itens 35 a 42, mais o campo espera', c5],
  ['Tempo real: itens 1, 11, 14 e 17', tempo],
];

function argumento(nome, doAmbiente, padrao) {
  const prefixo = `--${nome}=`;
  const achado = process.argv.find((a) => a.startsWith(prefixo));
  if (achado) return achado.slice(prefixo.length);
  return doAmbiente() || padrao;
}

function opcoes() {
  return {
    banco: String(argumento('banco', emuladorBanco, '')).replace(/\/+$/, ''),
    auth: String(argumento('auth', emuladorAuth, '')).replace(/\/+$/, ''),
    projeto: argumento('projeto', emuladorProjeto, PROJETO_PADRAO),
    raizSonda: RAIZ_SONDA,
  };
}

function aviso(texto) {
  process.stdout.write(`   .. ${texto}\n`);
}

function linhaDoCaso(r) {
  const marca = r.ok ? 'ok    ' : 'FALHOU';
  const detalhe = r.ok ? '' : `  (esperava ${r.esperado}, veio ${r.obtido})`;
  return `${marca} item ${String(r.item).padEnd(4)} ${r.prova}${detalhe}`;
}

function resumoPorItem(resultados) {
  const mapa = new Map();
  for (const r of resultados) {
    const atual = mapa.get(r.item) || { total: 0, falhas: 0 };
    atual.total += 1;
    if (!r.ok) atual.falhas += 1;
    mapa.set(r.item, atual);
  }
  return mapa;
}

function imprimirResumo(resultados) {
  process.stdout.write('\n== resumo por item do roteiro ==\n');
  for (const [item, n] of resumoPorItem(resultados)) {
    const marca = n.falhas ? 'FALHOU' : 'ok    ';
    process.stdout.write(`${marca} item ${String(item).padEnd(4)} ${n.total - n.falhas}/${n.total} casos\n`);
  }
}

async function preflight(ctx) {
  const faltas = await conferirDisponibilidade(ctx);
  if (faltas.length) {
    for (const f of faltas) process.stderr.write(`falta: ${f}\n`);
    process.stderr.write('suba os emuladores antes (ver firebase/README.md, "Roteiro automático")\n');
    return false;
  }
  const relogio = await derivaDoRelogio(ctx);
  if (!relogio.ok) {
    process.stderr.write(`${relogio.motivo}\n`);
    return false;
  }
  process.stdout.write(`relógio do emulador: ${relogio.deriva} ms de diferença desta máquina\n`);
  const regras = await conferirRegras(ctx, fs.readFileSync(REGRAS, 'utf8'));
  if (!regras.ok) {
    process.stderr.write(`${regras.motivo}\n`);
    return false;
  }
  process.stdout.write('regras carregadas no emulador conferem com firebase/database.rules.json\n');
  return true;
}

async function rodarSecoes(ctx) {
  const resultados = [];
  for (const [nome, secao] of SECOES) {
    process.stdout.write(`\n-- ${nome}\n`);
    const parciais = await secao.casos(ctx, aviso);
    for (const r of parciais) process.stdout.write(`${linhaDoCaso(r)}\n`);
    resultados.push(...parciais);
  }
  return resultados;
}

async function main() {
  const o = opcoes();
  if (!o.banco || !o.auth) {
    process.stderr.write('faltam as URLs dos emuladores: use --banco= e --auth= (ou FAROL_EMU_BANCO e FAROL_EMU_AUTH)\n');
    return 1;
  }
  const base = { ...o, ns: espacoDeNomes(o.projeto) };
  process.stdout.write(`banco ${base.banco}  auth ${base.auth}  projeto ${base.projeto}  ns ${base.ns}\n`);
  const ctx = await montarContexto(o);
  ctx.antiga = { email: ctx.u1.email, refreshToken: ctx.u1.refreshToken, authTime: ctx.u1.authTime };
  if (!await preflight(ctx)) return 1;
  const resultados = await rodarSecoes(ctx);
  imprimirResumo(resultados);
  const falhas = resultados.filter((r) => !r.ok);
  process.stdout.write(`\n${resultados.length - falhas.length}/${resultados.length} casos conferem\n`);
  return falhas.length ? 1 : 0;
}

if (executadoDireto(import.meta.url)) process.exit(await main());

export default { main };
