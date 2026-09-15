// Medição da suspeita de contagem dobrada do consumo parcial (spec 7.A1, item 1).
//
// O acumulador da sessão (acumularParcial, lib/engine/session.js) soma o `usage` de
// CADA evento `assistant` do stream-json. No transcrito o mesmo `message.id` aparece
// em mais de um evento (um por bloco de conteúdo), e ninguém mediu se esses eventos
// repetem o MESMO uso (a soma conta duas vezes) ou carregam incrementos (a soma está
// certa). Este script lê um stream capturado de sessão REAL e compara três números: a
// soma do acumulador de verdade, a soma deduplicada por message.id (último uso de cada
// id) e o uso do evento final. Não corrige nada: a correção é a Tarefa 2 do plano da
// A1, e ela depende do desfecho impresso aqui.
//
// O critério usa o token de SAÍDA porque é o denominador do custo estimado
// (tokensDeCusto em lib/engine/usage.js); os outros campos saem no relatório.
import fs from 'node:fs';
import { parseJson, safeStringify } from '../../lib/io.js';
import { executadoDireto } from '../../lib/paths.js';
import { acumularParcial } from '../../lib/engine/session.js';

const CAMPOS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
// 5% de tolerância: o evento final pode incluir o fechamento da sessão
const TOLERANCIA = 0.05;

function zerado() { return Object.fromEntries(CAMPOS.map((c) => [c, 0])); }

function somar(acc, usage) {
  for (const c of CAMPOS) acc[c] += Number(usage && usage[c]) || 0;
}

function mesmoUso(a, b) {
  return CAMPOS.every((c) => (Number(a && a[c]) || 0) === (Number(b && b[c]) || 0));
}

function eventos(texto) {
  return String(texto || '').split(/\r?\n/).map((l) => parseJson(l.trim(), null)).filter((ev) => ev && typeof ev === 'object');
}

// id que já apareceu: conta a repetição e se ela trouxe uso diferente (incremento)
function contarRepeticao(m, anterior, usage) {
  m.repetidos++;
  if (!mesmoUso(anterior, usage)) m.repetidosDiferentes++;
}

function medirContagem(texto) {
  const m = { eventosAssistant: 0, mensagensUnicas: 0, repetidos: 0, repetidosDiferentes: 0, acumulador: zerado(), dedup: zerado(), final: null };
  const porId = new Map();
  for (const ev of eventos(texto)) {
    if (ev.type === 'result') { m.final = zerado(); somar(m.final, ev.usage); continue; }
    if (ev.type !== 'assistant' || !ev.message) continue;
    m.eventosAssistant++;
    const usage = ev.message.usage;
    acumularParcial(m.acumulador, usage);
    const id = typeof ev.message.id === 'string' ? ev.message.id : '';
    if (!id) { somar(m.dedup, usage); continue; }
    if (porId.has(id)) contarRepeticao(m, porId.get(id), usage);
    porId.set(id, usage);
  }
  for (const u of porId.values()) somar(m.dedup, u);
  m.mensagensUnicas = porId.size;
  m.desfecho = desfechoDaMedicao(m);
  return m;
}

function distancia(valor, final) {
  return Math.abs(valor - final) / Math.max(1, final);
}

// Ordem fixa, a primeira que vale decide. Cada desfecho tem a ação correspondente
// escrita na Tarefa 2 do plano da A1.
function desfechoDaMedicao(m) {
  if (!m.repetidos) return 'sem-repeticao';
  if (!m.final) return 'inconclusiva-sem-final';
  const alvo = m.final.output_tokens;
  const dAcum = distancia(m.acumulador.output_tokens, alvo);
  const dDedup = distancia(m.dedup.output_tokens, alvo);
  if (dDedup <= TOLERANCIA && dDedup < dAcum) return 'dobrada';
  if (dAcum <= TOLERANCIA) return 'soma-correta';
  return 'divergente';
}

function valorFinal(m, nome) {
  return m.final ? m.final[nome] : 'ausente';
}

function formatarRelatorio(m) {
  return [
    `eventos assistant: ${m.eventosAssistant}`,
    `mensagens únicas: ${m.mensagensUnicas}`,
    `ids repetidos: ${m.repetidos} (com uso diferente: ${m.repetidosDiferentes})`,
    ...CAMPOS.map((c) => `${c}: acumulador ${m.acumulador[c]} | dedup ${m.dedup[c]} | final ${valorFinal(m, c)}`),
    `desfecho: ${m.desfecho}`,
  ].join('\n');
}

// Fixture versionável: só o que a medição usa. Conteúdo, modelo, ferramenta e caminho
// ficam de fora, porque o stream de sessão real carrega código e texto de PR.
function extrairFixture(texto) {
  const saida = [];
  for (const ev of eventos(texto)) {
    if (ev.type === 'result') saida.push(safeStringify({ type: 'result', usage: ev.usage || {} }));
    else if (ev.type === 'assistant' && ev.message) saida.push(safeStringify({ type: 'assistant', message: { id: ev.message.id, usage: ev.message.usage || {} } }));
  }
  return saida.join('\n') + '\n';
}

function principal(args) {
  const arquivo = args[0];
  if (!arquivo) {
    console.error('uso: node tools/medicao/contagem-dobrada.js <stream.jsonl> [--fixture <saida.jsonl>]');
    return 2;
  }
  const texto = fs.readFileSync(arquivo, 'utf8');
  console.log(formatarRelatorio(medirContagem(texto)));
  const i = args.indexOf('--fixture');
  if (i >= 0 && args[i + 1]) fs.writeFileSync(args[i + 1], extrairFixture(texto));
  return 0;
}

if (executadoDireto(import.meta.url)) process.exitCode = principal(process.argv.slice(2));

export default { medirContagem, desfechoDaMedicao, formatarRelatorio, extrairFixture };
export { medirContagem, desfechoDaMedicao, formatarRelatorio, extrairFixture };
