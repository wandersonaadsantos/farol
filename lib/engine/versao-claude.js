// O Claude Code atrasado deixa o Farol rodando num modelo legado, em silencio (24/09/2026).
//
// O Farol pede o modelo por APELIDO (`opus`, `sonnet`, `haiku`) e quem decide para onde o
// apelido aponta e o CLI, versao a versao: a 2.1.280 fez do Opus 5.5 "o Opus padrao". Este
// aparelho estava na 2.1.268 desde 10/09, entao o `opus` seguia no Opus 5, que a pagina
// oficial de modelos ja lista como legado: 1001 sessoes rodaram nele, com o doctor todo
// verde. E fixar o ID novo na config nao era saida: a 2.1.268 responde
// `unrecognized_model` para `claude-opus-5-5` (medido), entao a fixacao teria derrubado
// todas as sessoes. A alavanca e manter o CLI atual, e este modulo diz quando ele nao esta.
//
// A regra conta desde QUANDO voce esta atras, e nao quantas versoes: o CLI sai com versao
// nova quase todo dia, e um aviso por patch viveria aceso. Atrasado e quando a primeira
// versao publicada depois da sua ja saiu ha mais de `CLAUDE_CLI_TOLERANCIA_MS`.
//
// CLI ausente é assunto do check de presença. A leitura periódica preserva o aviso
// da mesma versão se o registro falhar; a reverificação explícita expõe a indisponibilidade.
import io from '../io.js';
import { TEMPOS } from '../constants.js';

const REGISTRO = 'https://registry.npmjs.org/@anthropic-ai/claude-code';
const SEMVER = /(\d+)\.(\d+)\.(\d+)/;
const leituras = new WeakMap();

// "2.1.268 (Claude Code)" -> [2, 1, 268]; pre-lancamento (2.2.0-beta.1) nao conta como
// versao publicada para quem usa o canal normal
function partes(texto) {
  const s = String(texto || '').trim();
  if (!s || /-/.test(s.split(/\s/)[0])) return null;
  const m = SEMVER.exec(s);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function comparar(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// PURA. Devolve null quando nao da para comparar (sem versao instalada legivel, ou sem a
// mais recente): o check some da tela em vez de mostrar um verde que ninguem conferiu.
function avaliarVersao({ instalada, maisRecente, datas = {}, agora = Date.now(), tolerancia = TEMPOS.CLAUDE_CLI_TOLERANCIA_MS }) {
  const minha = partes(instalada);
  const ultima = partes(maisRecente);
  if (!minha || !ultima) return null;
  const base = { instalada: minha.join('.'), maisRecente: ultima.join('.') };
  if (comparar(minha, ultima) >= 0) return { ...base, atualizada: true, atrasadaDesde: 0, atrasada: false };
  // a PRIMEIRA versao publicada depois da minha: e dela que conta o atraso
  const seguinte = Object.keys(datas)
    .map((v) => ({ v, p: partes(v) }))
    .filter((x) => x.p && comparar(x.p, minha) > 0)
    .sort((a, b) => comparar(a.p, b.p))[0];
  const desde = seguinte ? Date.parse(datas[seguinte.v]) : NaN;
  if (!Number.isFinite(desde)) return { ...base, atualizada: false, atrasadaDesde: 0, atrasada: false };
  return { ...base, atualizada: false, atrasadaDesde: desde, atrasada: agora - desde > tolerancia };
}

async function lerVersaoInstalada() {
  const r = await io.runShell('claude --version');
  return r.ok ? r.stdout.trim().split('\n')[0] : '';
}

// O documento do pacote traz a versao mais recente (dist-tags) e a data de cada versao
// (time). Pesa ~1,5 MB e e lido no maximo uma vez por intervalo. null em qualquer falha.
async function lerRegistro() {
  try {
    const r = await fetch(REGISTRO, { signal: AbortSignal.timeout(TEMPOS.CLAUDE_CLI_REGISTRO_TIMEOUT_MS) });
    if (!r.ok) return null;
    const doc = await r.json();
    const maisRecente = doc && doc['dist-tags'] && doc['dist-tags'].latest;
    return maisRecente ? { maisRecente, datas: doc.time || {} } : null;
  } catch {
    return null; // rede, timeout ou corpo invalido: sem dado, sem aviso
  }
}

// Polling usa o intervalo de seis horas; o diagnóstico explícito força a consulta
// e reaproveita o CLI que acabou de ler. Uma versão instalada diferente invalida o cache.
async function atualizarVersaoClaude(engine, deps = {}) {
  const agora = deps.agora != null ? deps.agora : Date.now();
  const conhecida = Object.hasOwn(deps, 'instalada');
  const mesmaVersao = !conhecida || partes(deps.instalada)?.join('.') === engine.claudeVersao?.instalada;
  if (!deps.forcar && mesmaVersao && engine.versaoClaudeLidaEm && agora - engine.versaoClaudeLidaEm < TEMPOS.CLAUDE_CLI_VERSAO_MS) return engine.claudeVersao;
  const leitura = {};
  leituras.set(engine, leitura);
  engine.versaoClaudeLidaEm = agora;
  const [cli, referencia] = await Promise.allSettled([
    Promise.resolve().then(() => conhecida ? deps.instalada : (deps.lerVersao || lerVersaoInstalada)()),
    Promise.resolve().then(() => (deps.lerRegistro || lerRegistro)()),
  ]);
  if (leituras.get(engine) !== leitura) return engine.claudeVersao;
  const instalada = cli.status === 'fulfilled' ? partes(cli.value)?.join('.') : '';
  const registro = referencia.status === 'fulfilled' ? referencia.value : null;
  const v = registro && avaliarVersao({ instalada, maisRecente: registro.maisRecente, datas: registro.datas, agora });
  // Sem comparação nova, só conserva um aviso que ainda corresponda ao mesmo CLI.
  if (!v && !deps.forcar && (!instalada || engine.claudeVersao?.instalada === instalada)) return engine.claudeVersao;
  if (v) engine.claudeVersao = v;
  else engine.claudeVersao = instalada ? { instalada, indisponivel: true } : null;
  engine.pushState();
  return engine.claudeVersao;
}

export default { avaliarVersao, atualizarVersaoClaude };
export { avaliarVersao, atualizarVersaoClaude };
