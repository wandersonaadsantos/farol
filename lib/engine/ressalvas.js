// As ressalvas de uma revisão aprovável: a ÚNICA coisa que separa "limpo" de "com ressalvas"
// (30/09/2026).
//
// Pedido do dono: "A configuração tem de cumprir o que promete, sem exceção: se é pra aprovar
// automaticamente, ele realmente aprova, sem desculpas pra passar por um approve humano."
// Até aqui o shouldAutoApprove tinha gates que mandavam um resultado aprovável para a mesa
// SEM consultar a política da conta: discordância de outro review, lacuna de cobertura,
// divergência do checkpoint e dependência em aberto. E havia uma terceira classe escondida:
// zero ponto de atenção com `decision !== 'auto_approve'` caía em "com ressalvas" sem
// mostrar nada no card.
//
// Agora são duas classes, e só a política da conta (approvePolicyFor) decide entre postar e
// esperar você: limpo = nenhum ponto aqui; com ressalvas = um ou mais. Tudo que rebaixava
// virou ponto com texto próprio, para o card sempre dizer POR QUE é "com ressalvas". CI
// obrigatório não entra aqui: com `aguardarCiParaAprovar` ligado é espera automática
// (lib/engine/espera-ci.js); desligado (padrão desde 02/10/2026) o estado da pipe é anexado
// às ressalvas guardadas DEPOIS da classe decidida (review.js), só para o card dizer com que
// CI a aprovação saiu.
//
// PURO: só lê o envelope. Saiu do decision.js, que estava no teto de tamanho, e levou junto
// as duas leituras que só ele usava (contestations e checkpointGap); o decision.js reexporta.
import { coverageGap } from './file-proof.js';
import { dependenciasAbertas } from './gate-espera.js';

// mesmo padrão de coverageGap: função PURA, só olha result.verificationCheckpoint
// (montado por runHeadlessReview ANTES de chamar o gate, ver review.js), nunca disco.
function checkpointGap(result) {
  const vc = result && result.verificationCheckpoint;
  if (!vc) return [];
  if (vc.malformed) return ['checkpoint de verificação malformado'];
  const conflicts = Array.isArray(vc.conflicts) ? vc.conflicts : [];
  return conflicts.map((c) => {
    const primeira = (c.entries && c.entries[0]) || {};
    return `divergência de veredito em ${primeira.file || '?'}:${primeira.line || '?'} ("${primeira.claim || '?'}") entre passadas de verificação`;
  });
}

// Discordâncias de review de terceiro que a sessão quer publicar (campo `contested`
// do envelope). Normaliza e descarta item sem prova: contestação sem evidência não
// vale como contestação, e a regra é ficar calado quando não dá pra provar.
const CONTEST_LABELS = ['falso_positivo', 'fora_de_escopo', 'pre_existente', 'criterio_nao_vigente'];
function contestations(result) {
  const raw = (result && result.contested) || [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map(c => (c && typeof c === 'object') ? c : null)
    .filter(Boolean)
    .filter(c => CONTEST_LABELS.includes(String(c.label || '')) && String(c.evidence || '').trim());
}

// Rótulo curto pra tela e pro motivo (o texto longo vive no reportMarkdown).
const CONTEST_LABEL_PT = {
  falso_positivo: 'falso positivo',
  fora_de_escopo: 'fora do escopo pactuado',
  pre_existente: 'pré-existente, não veio deste PR',
  criterio_nao_vigente: 'critério não vigente no repo'
};

// Os pontos que o APP deriva do envelope, cada um { text, kind: 'gate' } menos o do card,
// que é a revisão falando do PR. Nenhum deles é escrito no PR: ficam no campo `attention`.
function pontosDoApp(result) {
  const pts = [];
  if (result.cardMet === false) pts.push({ text: 'O card não foi totalmente comprovado na revisão automática, confira se necessário.', kind: 'content' });
  const faltando = coverageGap(result);
  if (faltando.length) {
    const amostra = faltando.slice(0, 5).join(', ');
    pts.push({ text: `A cobertura da leitura tem ${faltando.length} pendência(s): ${amostra}${faltando.length > 5 ? ', ...' : ''}`, kind: 'gate' });
  }
  const gaps = checkpointGap(result);
  if (gaps.length) pts.push({ text: `A verificação de afirmações ficou com problema: ${gaps.join('; ')}`, kind: 'gate' });
  for (const c of contestations(result)) {
    pts.push({ text: `Discordância de outro review (${CONTEST_LABEL_PT[c.label]}): ${String(c.claim || '').trim()} · prova: ${String(c.evidence).trim()}`, kind: 'gate' });
  }
  const dependencias = dependenciasAbertas(result);
  if (dependencias.length) pts.push({ text: `A aprovação depende de algo que estava em aberto na leitura: ${dependencias.join('; ')}`, kind: 'gate' });
  return pts;
}

// Pontos de atenção de uma revisão aprovável: os que o app deriva (acima) mais as ressalvas
// que a sessão levantou (result.reasons). É o que a gente deixa claro ao aprovar sozinho, na
// tela, e é a contagem que decide a classe.
// Cada ponto é { text, kind }: 'content' é a IA apontando algo sobre o PR, 'gate' é
// regra do app, 'infra' vem de result.reasons quando review.js marcou falha de postagem.
function attentionPoints(_engine, result) {
  const pts = pontosDoApp(result);
  // result.reasons já chega como { text, kind } (normalizado em runHeadlessReview);
  // string solta só acontece em caminho antigo/teste, vira 'content' por padrão.
  for (const r of (result.reasons || [])) {
    if (!r) continue;
    pts.push((typeof r === 'object' && typeof r.text === 'string') ? r : { text: String(r), kind: 'content' });
  }
  // A classe escondida (30/09/2026): a sessão respondeu `needs_decision` (ou não respondeu
  // `decision`) e não escreveu motivo nenhum. Antes isso rebaixava em silêncio; agora o
  // rebaixamento tem ponto próprio, e sem ele o resultado é limpo. Só entra quando não há
  // outro ponto: havendo, é ele que explica.
  if (!pts.length && result.decision !== 'auto_approve') {
    pts.push({ text: 'A revisão concluiu aprovar, mas não marcou o PR como aprovável sem ressalvas nem escreveu o motivo; confira o relatório.', kind: 'gate' });
  }
  return pts;
}

// O que a reprovação automática registra no card quando sai apesar de lacuna de cobertura,
// divergência do checkpoint ou contestação (01/10/2026): o bloqueio vale por si e é postado, e
// estas notas são só do app, nunca do corpo público. Vazio quando não há nada a registrar.
function notasDaReprovacao(result) {
  const notas = [];
  const lacunas = coverageGap(result);
  if (lacunas.length) notas.push(`a reprovação sai com a cobertura da leitura incompleta (${lacunas.length} pendência(s): ${lacunas.slice(0, 3).join(', ')}${lacunas.length > 3 ? ', ...' : ''}): os bloqueios acima valem por si`);
  const divergencias = checkpointGap(result);
  if (divergencias.length) notas.push(`a reprovação sai com a verificação de afirmações com problema (${divergencias.join('; ')})`);
  const contestadas = contestations(result);
  if (contestadas.length) notas.push(`a reprovação sai com ${contestadas.length} contestação(ões) de outro review registrada(s)`);
  return notas;
}

export default { attentionPoints, contestations, checkpointGap, notasDaReprovacao };
export { attentionPoints, contestations, checkpointGap, notasDaReprovacao };
