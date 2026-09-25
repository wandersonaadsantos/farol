// Diagnóstico unificado (spec 7.A3): UM Markdown só, que a tela renderiza, o botão copia e
// a sessão de IA lê. Antes eram três superfícies sobrepostas (relatório da IA, export de
// texto e despejo cru do log), e nenhuma delas era segura de colar num lugar público.
//
// A REGRA AQUI É INÉRCIA. Tudo que vem de fora (mensagem de erro, referência de PR, amostra
// do log) é conteúdo hostil até prova em contrário: sai mascarado, com menção e URL dentro
// de código e com texto livre dentro de cerca. Markdown ativo é ataque: `[x](javascript:…)`
// clicado por quem pediu ajuda, `![](http://…)` avisando um terceiro que o diagnóstico foi
// aberto, `@login` notificando gente de verdade num relato copiado para um PR.
//
// Nada aqui decide: é projeção do que o doctor, o registro durável de falha (A1) e o triage
// (lib/log-taxonomy.js) já dizem.
import { APP_VERSION } from '../paths.js';
import { triage, classify, CLASSES, DESCONHECIDO } from '../log-taxonomy.js';
import { tailLog } from '../workspace.js';
import { mascararSegredos, falhasRecentes } from './falhas.js';
import { problemasDePerfil } from './perfil-claude.js';
import { historicoRecente } from './contas-config.js';

const MAX_FALHAS = 20;
const MAX_GRUPOS = 10;
const LINHAS_DO_LOG = 300;
const MAX_TEXTO = 4000;

// esquemas que um leitor pode seguir sozinho; ficam em código, nunca como link
const ESQUEMA = /\b[a-z][a-z0-9+.-]*:(?:\/\/)?[^\s`]*/gi;
const MENCAO = /@[A-Za-z0-9][A-Za-z0-9-]*/g;
const ATIVOS = /[\\`*_[\]()<>!|]/g;
// hífen, mais, sustenido e citação só mudam o sentido no INÍCIO da linha (item de lista,
// título, bloco citado). Escapá-los no meio do texto só sujava a data e o texto do erro.
const INICIO_ATIVO = /^(\s*)([-+#>])/;

function texto(v) {
  return mascararSegredos(v ?? '').slice(0, MAX_TEXTO);
}

function lista(v) {
  return Array.isArray(v) ? v : [];
}

// uma linha do ambiente: o detalhe depende de o sinal existir
function sinal(label, presente, seSim, seNao) {
  return { label, ok: !!presente, detalhe: presente ? seSim : seNao };
}

// Trecho de código com o conteúdo neutralizado: crase dentro vira aspa simples, senão o
// próprio conteúdo fecharia o trecho e o resto da linha voltaria a renderizar.
function codigo(s) {
  return '`' + String(s).replace(/`/g, "'") + '`';
}

// Texto de UMA linha, para rótulo e detalhe. Menção e URL saem primeiro para um cofre, o
// resto perde todo caractere ativo, e só então elas voltam como código.
function inline(v) {
  const guardados = [];
  const cofre = (m) => { guardados.push(m); return `\u0000${guardados.length - 1}\u0000`; };
  let s = texto(v).replace(/[\r\n]+/g, ' ').replace(ESQUEMA, cofre).replace(MENCAO, cofre);
  s = s.replace(ATIVOS, '\\$&').replace(INICIO_ATIVO, '$1\\$2');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => codigo(guardados[i]));
}

// Texto livre de várias linhas: cerca maior que a maior sequência de crases de dentro, para
// conteúdo com ``` não fechar a cerca e passar a renderizar como Markdown do diagnóstico.
function cerca(v) {
  const s = texto(v);
  const maior = Math.max(0, ...(s.match(/`+/g) || []).map((c) => c.length));
  const marca = '`'.repeat(Math.max(3, maior + 1));
  return `${marca}text\n${s}\n${marca}`;
}

function quando(at) {
  const n = Number(at) || 0;
  return n > 0 ? new Date(n).toISOString() : 'sem data';
}

// O ambiente como o doctor já enxerga. Caminho de pasta e e-mail de login NÃO entram: o
// diagnóstico existe para ser colado num canal de suporte, e nenhum dos dois ajuda a
// entender a falha o bastante para pagar o que revelam.
function ambienteDoDoctor(d) {
  const info = d && typeof d === 'object' ? d : {};
  const linhas = [
    sinal('Node', info.node, info.node, 'não detectado'),
    sinal('GitHub CLI', info.gh, info.gh, 'não detectado'),
    sinal('Autenticação do GitHub', info.ghAuth === true, 'autenticado', 'sem autenticação'),
    sinal('Claude Code', info.claude, info.claude, 'não detectado'),
    sinal('Codex CLI', info.codex, info.codex, 'não detectado'),
    sinal('Git Bash', info.gitBash, 'encontrado', 'não encontrado'),
    sinal('Usuário do sistema', info.root !== true, 'usuário comum', 'rodando como root'),
  ];
  for (const p of lista(info.claudeAuth)) {
    linhas.push(sinal(`Perfil de assinatura: ${p.label || p.id || 'sem nome'}`, p.ready === true, 'pronto', 'sem login ou sem chave'));
  }
  return linhas;
}

// A2: perfil apontado que a cascata não usa. O id é da configuração local, não é segredo.
function problemasComoLinhas(problemas) {
  return lista(problemas).map((p) => sinal(`Perfil de assinatura (${p.escopo})`, false, '', `${p.code}: ${p.profileId}`));
}

function linhaDeAmbiente(c) {
  const marca = c.ok ? 'ok' : 'ATENÇÃO';
  return `- ${marca} · ${inline(c.label)}: ${inline(c.detalhe)}`;
}

function secaoAmbiente(ambiente) {
  const linhas = lista(ambiente).map(linhaDeAmbiente);
  if (!linhas.length) linhas.push('O diagnóstico do ambiente ainda não rodou nesta sessão.');
  return ['## Ambiente', '', ...linhas, ''];
}

// A configuração que ajuda a entender uma falha, em NÚMERO e em sim ou não. Login de conta,
// organização, caminho e e-mail ficam de fora: o texto é feito para ser colado num canal de
// suporte, e o export antigo (que morava na tela) levava tudo isso junto.
function secaoConfiguracao(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const contas = lista(c.accounts);
  const perfis = lista(c.claudeProfiles);
  const sync = (c.sync && typeof c.sync === 'object') ? c.sync : {};
  const ligado = (v) => (v === true ? 'ligado' : 'desligado');
  return [
    '## Configuração',
    '',
    `- Contas monitoradas: ${contas.length} (${contas.filter((a) => lista(a && a.owners).length).length} com organização)`,
    `- Perfis de assinatura: ${perfis.length}`,
    `- Intervalo de checagem: ${Number(c.intervalSeconds) || 0} s`,
    `- Revisão automática: ${ligado(c.autoReview)}`,
    `- Sincronização entre aparelhos: ${ligado(sync.enabled)} (coordenação ${ligado(sync.coordination && sync.coordination.enabled)}, visão compartilhada ${ligado(sync.shared && sync.shared.enabled)})`,
    `- Autenticação da API local: ${c.localAuth === 'exigir' ? 'exigida pelo arquivo' : 'como o ambiente decidir'}`,
    '',
  ];
}

// campo ausente é herdar o padrão, e é assim que a tela chama
function valorDaPolitica(v) {
  return v === null || v === undefined ? 'herdado' : inline(String(v));
}

// Quem mudou a política de automação, quando e por qual tela. A conta vai pela POSIÇÃO na
// config ("conta 1"), nunca pelo login, pela mesma regra da seção de configuração.
function secaoPolitica(mudancas, contas) {
  const todas = lista(mudancas);
  if (!todas.length) return [];
  const posicao = (login) => {
    if (login === null) return 'padrão geral';
    const i = lista(contas).findIndex((a) => String((a && a.user) || '').toLowerCase() === String(login).toLowerCase());
    return i >= 0 ? `conta ${i + 1}` : 'conta removida';
  };
  return [
    `## Mudanças na política de automação (${todas.length} mais recentes)`,
    '',
    ...todas.map((m) => `- ${quando(m.at)}: ${posicao(m.conta)}, ${inline(m.campo)} de ${valorDaPolitica(m.de)} para ${valorDaPolitica(m.para)} (origem: ${inline(m.origem)})`),
    '',
  ];
}

function secaoFalhas(falhas) {
  const todas = lista(falhas);
  const out = [`## Falhas registradas (${todas.length})`, ''];
  if (!todas.length) return [...out, 'Nenhuma falha registrada.', ''];
  for (const f of todas) {
    out.push(`### ${quando(f.at)} · ${inline(f.classe || 'sem classe')} · ${inline(f.kind || 'outro')}`, '');
    if (f.sessionId) out.push(`- Sessão: ${codigo(f.sessionId)}`);
    if (f.ref) out.push(`- Referência: ${inline(f.ref)}`);
    if (f.resumeOutcome) out.push(`- Retomada: ${inline(f.resumeOutcome)}`);
    // repetição idêntica é contagem, não cartão novo (ver lib/engine/falhas.js)
    if (Number(f.ocorrencias) > 1) out.push(`- Ocorrências: ${Number(f.ocorrencias)}, desde ${quando(f.primeiraAt)}`);
    out.push('', cerca(f.motivo), '');
  }
  return out;
}

function secaoResumo(resumo) {
  const grupos = lista(resumo);
  const out = ['## Resumo do log de falhas', ''];
  if (!grupos.length) return [...out, 'O log de falhas está vazio.', ''];
  for (const g of grupos) {
    out.push(`### ${inline(g.label || g.id || 'sem rótulo')}`, '');
    out.push(`- ${Number(g.count) || 0} ocorrências, de ${inline(g.first)} até ${inline(g.last)} (${inline(g.kind || 'sem classificação')})`);
    out.push('', cerca(g.sample), '');
  }
  return out;
}

/**
 * O Markdown do diagnóstico, PURO: só depende do que recebe. Quem junta as fontes é o
 * `diagnosticoMarkdown`.
 */
function montarDiagnostico(dados) {
  const d = dados && typeof dados === 'object' ? dados : {};
  return [
    '# Diagnóstico do Farol',
    '',
    `- Versão: ${inline(d.versao)}`,
    `- Plataforma: ${inline(d.plataforma)}`,
    `- Gerado em: ${inline(d.geradoEm)}`,
    '',
    ...secaoAmbiente(d.ambiente),
    ...secaoConfiguracao(d.config),
    ...secaoPolitica(d.politica, d.config && d.config.accounts),
    ...secaoFalhas(d.falhas),
    ...secaoResumo(d.resumo),
  ].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** O mesmo Markdown, montado das três fontes do engine. Nada é executado para produzi-lo. */
function diagnosticoMarkdown(engine) {
  return montarDiagnostico({
    versao: APP_VERSION,
    plataforma: process.platform,
    geradoEm: new Date().toISOString(),
    ambiente: [...ambienteDoDoctor(engine && engine.doctorInfo), ...problemasComoLinhas(problemasDePerfil(engine && engine.config))],
    config: engine && engine.config,
    politica: engine ? historicoRecente(engine) : [],
    falhas: falhasRecentes(engine, { limite: MAX_FALHAS }),
    resumo: triage(tailLog(LINHAS_DO_LOG)).slice(0, MAX_GRUPOS),
  });
}

// A classe gravada no registro manda; se ela não existe mais na tabela (versão antiga),
// reclassifica pelo motivo, que é o que a taxonomia sabe ler.
function classeDe(falha) {
  return [...CLASSES, DESCONHECIDO].find((c) => c.id === falha.classe) || classify(String(falha.motivo || ''));
}

/**
 * As falhas registradas, uma por cartão na tela: o que é, o que fazer, se precisa de alguém
 * e o Markdown inerte daquela falha, que é o que o botão copia.
 */
function falhasParaTela(engine) {
  return falhasRecentes(engine, { limite: MAX_FALHAS }).map((f) => {
    const c = classeDe(f);
    return {
      id: String(f.id || ''), at: Number(f.at) || 0, kind: String(f.kind || ''),
      classe: c.id, rotulo: c.label, acao: c.acao, gravidade: c.kind,
      precisaDeVoce: c.kind === 'permanente',
      ref: texto(f.ref), sessionId: String(f.sessionId || ''),
      ocorrencias: Math.max(1, Number(f.ocorrencias) || 1), primeiraAt: Number(f.primeiraAt) || Number(f.at) || 0,
      // a mesma seção do diagnóstico inteiro, sem o título "Falhas registradas (1)"
      markdown: secaoFalhas([f]).slice(2).join('\n').trim() + '\n',
    };
  });
}

export default { montarDiagnostico, diagnosticoMarkdown, ambienteDoDoctor, falhasParaTela };
export { montarDiagnostico, diagnosticoMarkdown, ambienteDoDoctor, falhasParaTela };
