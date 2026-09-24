// O CATALOGO de selecoes de modelo do Farol (24/09/2026). Um lugar so, e todo o resto le
// daqui.
//
// Ate aqui a mesma decisao estava escrita em quatro lugares: a lista de apelidos aceitos
// (lib/parse.js), as opcoes do seletor com os seus textos (ui/index.html), os modelos que o
// modo Auto usa (lib/engine/model-router.js, com 'haiku' e 'sonnet' escritos a mao) e a
// regra de quem nao aceita esforco (lib/parse.js, a tela de Automacao E o texto de ajuda,
// tres copias). Mudar o que uma selecao significa exigia achar e acertar todos, e o
// primeiro esquecido virava uma tela dizendo uma coisa e o engine fazendo outra.
//
// Cada selecao e definida UMA vez aqui:
//   - a allowlist da config (lib/parse.js) e derivada dela;
//   - o seletor e o estado do esforco na tela vem dela, pelo snapshot (a tela nao importa
//     lib/, o servidor so entrega ui/);
//   - quem nao aceita esforco nao recebe a flag, inclusive quando o modelo foi fixado pelo
//     nome completo (`claude-haiku-4-5` e da familia Haiku, e a regra vale igual);
//   - o modo Auto escolhe ENTRE as selecoes daqui, e nunca um modelo proprio: mudar o que
//     "Haiku" significa muda o Auto junto.
//
// `modelo` e o que vai no `--model` do CLI, e sao APELIDOS de familia de proposito: quem
// decide para onde cada apelido aponta e o Claude Code, versao a versao (a 2.1.280 fez do
// Opus 5.5 "o Opus padrao"). E isso que mantem o Farol no modelo mais atual sem release; o
// que garante que o CLI esteja em dia e lib/engine/versao-claude.js.
//
// `familia` so existe para quem E uma familia: e com ela que um nome completo fixado a mao
// (a escotilha de lib/parse.js) e reconhecido como Opus, Sonnet, Haiku ou Fable, para rotulo
// e para a regra de esforco. A ordem importa: a primeira familia que casa vence.

const SELECOES_CLAUDE = Object.freeze([
  { valor: '', rotulo: 'Padrão do Claude (herda a tua assinatura)', modelo: '', aceitaEsforco: true },
  { valor: 'auto', rotulo: '', modelo: '', aceitaEsforco: false, auto: true },
  { valor: 'best', rotulo: 'Melhor disponível (o Claude escolhe o topo da conta)', modelo: 'best', aceitaEsforco: true },
  { valor: 'opus', rotulo: 'Opus (qualidade máxima, gasta mais do limite)', modelo: 'opus', familia: /opus/i, nome: 'Opus', aceitaEsforco: true },
  { valor: 'sonnet', rotulo: 'Sonnet (equilíbrio: bom e bem mais leve)', modelo: 'sonnet', familia: /sonnet/i, nome: 'Sonnet', aceitaEsforco: true },
  { valor: 'haiku', rotulo: 'Haiku (o mais leve, pra economizar)', modelo: 'haiku', familia: /haiku/i, nome: 'Haiku', aceitaEsforco: false },
  { valor: 'fable', rotulo: 'Fable (raciocínio longo, sessão mais demorada)', modelo: 'fable', familia: /fable/i, nome: 'Fable', aceitaEsforco: true },
].map(Object.freeze));

// O modo Auto por faixa de tamanho do PR. `selecao` aponta para uma entrada de
// SELECOES_CLAUDE pelo valor: e isso que faz o Auto usar exatamente o que cada selecao
// significa. As faixas (o que e pequeno, medio e grande) sao do roteador, alinhadas ao
// fan-out; aqui mora so O QUE cada faixa usa. `fast: 'config'` herda o modo rapido da
// config. Sem metrica nunca cai no mais leve: o meio da tabela e o lado seguro.
const AUTO_POR_FAIXA = Object.freeze({
  semMetrica: Object.freeze({ selecao: 'sonnet', effort: 'medium', fast: false }),
  pequeno: Object.freeze({ selecao: 'haiku', effort: '', fast: true }),
  medio: Object.freeze({ selecao: 'sonnet', effort: 'medium', fast: 'config' }),
  grande: Object.freeze({ selecao: 'sonnet', effort: 'high', fast: false }),
});

const SELECOES_CODEX = Object.freeze([
  { valor: '', rotulo: 'Padrão do Codex (recomendado)' },
  { valor: 'gpt-5.6-sol', rotulo: 'GPT-5.6 Sol (máxima capacidade)' },
  { valor: 'gpt-5.6-terra', rotulo: 'GPT-5.6 Terra (equilíbrio)' },
  { valor: 'gpt-5.6-luna', rotulo: 'GPT-5.6 Luna (mais rápido e econômico)' },
  { valor: 'gpt-5.5', rotulo: 'GPT-5.5 (compatibilidade)' },
  { valor: 'gpt-5.4', rotulo: 'GPT-5.4 (compatibilidade)' },
].map(Object.freeze));

// Os apelidos que a config aceita para o Claude: toda selecao menos o padrao (vazio).
const APELIDOS_CLAUDE = Object.freeze(SELECOES_CLAUDE.filter((s) => s.valor).map((s) => s.valor));

function selecaoClaude(valor) {
  const v = String(valor == null ? '' : valor).trim().toLowerCase();
  return SELECOES_CLAUDE.find((s) => s.valor === v) || null;
}

// A familia de um modelo qualquer: pelo apelido, ou pelo nome completo fixado a mao
// (claude-haiku-4-5 e Haiku). null quando nao e de familia conhecida.
function familiaDe(modelo) {
  const bruto = String(modelo || '').trim();
  if (!bruto) return null;
  const pelaSelecao = selecaoClaude(bruto);
  if (pelaSelecao && pelaSelecao.familia) return pelaSelecao;
  return SELECOES_CLAUDE.find((s) => s.familia && s.familia.test(bruto)) || null;
}

// Um modelo recebe `--effort`? Modelo desconhecido recebe: quem decide e o CLI.
function aceitaEsforco(modelo) {
  const s = selecaoClaude(modelo) || familiaDe(modelo);
  return s ? s.aceitaEsforco : true;
}

// O que o modo Auto usa numa faixa, ja resolvido para o `--model` da selecao apontada.
function autoNaFaixa(faixa, config = {}) {
  const f = AUTO_POR_FAIXA[faixa];
  const s = f && selecaoClaude(f.selecao);
  if (!s) return null;
  return { model: s.modelo, effort: f.effort, fast: f.fast === 'config' ? !!config.reviewFast : f.fast };
}

// "Auto (custo-benefício: Haiku/Sonnet pelo tamanho do PR)": os nomes saem das faixas,
// entao o rotulo nunca promete um modelo que o Auto deixou de usar.
function rotuloDoAuto() {
  const nomes = [];
  for (const f of Object.values(AUTO_POR_FAIXA)) {
    const s = selecaoClaude(f.selecao);
    const nome = (s && (s.nome || s.valor)) || '';
    if (nome && !nomes.includes(nome)) nomes.push(nome);
  }
  const ordem = SELECOES_CLAUDE.map((s) => s.nome || s.valor);
  nomes.sort((a, b) => ordem.indexOf(b) - ordem.indexOf(a));
  return `Auto (custo-benefício: ${nomes.join('/')} pelo tamanho do PR)`;
}

function rotuloDaSelecao(s) { return s.auto ? rotuloDoAuto() : s.rotulo; }

// O que vai para a tela pelo snapshot: so dados (regex nao atravessa JSON), por allowlist.
// `cli` e a versao do Claude Code (lib/engine/versao-claude.js): as selecoes daqui sao
// apelidos, e quem diz para onde cada apelido aponta e o CLI instalado, entao as duas
// metades de "qual modelo o Farol roda" viajam juntas.
function catalogoParaTela(cli = null) {
  return {
    cli,
    claude: SELECOES_CLAUDE.map((s) => ({
      valor: s.valor, rotulo: rotuloDaSelecao(s), nome: s.nome || '', auto: !!s.auto, aceitaEsforco: s.aceitaEsforco,
    })),
    codex: SELECOES_CODEX.map((s) => ({ valor: s.valor, rotulo: s.rotulo })),
  };
}

export default {
  SELECOES_CLAUDE, SELECOES_CODEX, AUTO_POR_FAIXA, APELIDOS_CLAUDE,
  selecaoClaude, familiaDe, aceitaEsforco, autoNaFaixa, rotuloDoAuto, catalogoParaTela,
};
export {
  SELECOES_CLAUDE, SELECOES_CODEX, AUTO_POR_FAIXA, APELIDOS_CLAUDE,
  selecaoClaude, familiaDe, aceitaEsforco, autoNaFaixa, rotuloDoAuto, catalogoParaTela,
};
