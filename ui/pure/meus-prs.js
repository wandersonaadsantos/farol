// "Meus PRs": ocultos, marcas de sessão expirada, merge em andamento e o vazio da aba.
// Extraído do ui/pure.js na Fase 1a da reorganização; o conteúdo não mudou.
//
// PR oculto: experimento velho que nunca vai mergear ficava para sempre na aba (havia PR
// pessoal parado há 750 dias). O motor guarda as chaves ocultas (snapshot.hiddenPRs) e
// continua mandando myPRs COMPLETO: quem esconde é a UI, e por isso a separação mora aqui,
// pura e testada. Ocultar não é para sempre: atividade nova no PR faz o motor reexibir
// sozinho.

// marcadores de sessao do merge (auto-merge/admin recusados) expiram quando chega
// um refresh de mergeStates mais NOVO que a marcacao (B17): o dado fresco do repo
// volta a mandar. Presenca de campo nao serve de gatilho (o mergeStates JA existia
// na hora da recusa); a geracao do refresh (lastCheckAt do engine) serve.
// marks: array de pares [key, marcadoEmMs]; retorna as chaves que expiraram.
import { plural } from './comum.js';

export function expiredSessionMarks(marks, lastCheckAt) {
  const ref = Number(lastCheckAt) || 0;
  if (!ref) return [];
  return (marks || []).filter(([, at]) => ref > (Number(at) || 0)).map(([k]) => k);
}

// separa a lista do motor em visiveis e ocultos. Comparacao SEM CAIXA, como no
// validScope/sameSet: o GitHub trata owner/repo sem distinguir maiuscula e uma chave
// gravada com caixa diferente nao pode reaparecer como se nunca tivesse sido ocultada.
export function splitHiddenPRs(list, hidden) {
  const H = new Set([...(hidden || [])].map(k => String(k).toLowerCase()));
  const visiveis = [], ocultos = [];
  for (const pr of (list || [])) {
    (H.has(String((pr && pr.key) ?? '').toLowerCase()) ? ocultos : visiveis).push(pr);
  }
  return { visiveis, ocultos };
}

// o conjunto de ocultos que a tela usa AGORA: o que o motor confirmou, mais o que a
// pessoa acabou de ocultar (otimista, some na hora do clique), menos o que ela acabou
// de reexibir. Sem isso o card so sumiria no proximo push de estado, e o clique
// pareceria ter falhado.
export function effectiveHidden(doMotor, marcados, reexibidos) {
  const out = new Set([...(doMotor || []), ...(marcados || [])].map(k => String(k).toLowerCase()));
  for (const k of (reexibidos || [])) out.delete(String(k).toLowerCase());
  return [...out];
}

// rodape da secao: "3 PRs ocultos · mostrar". Sem oculto nenhum devolve vazio, pra a
// linha sumir em vez de mostrar zero (mesma regra do logSummaryShort).
export function hiddenFootLabel(n, aberto) {
  n = Number(n) || 0;
  if (n <= 0) return '';
  return `${plural(n, 'PR oculto', 'PRs ocultos')} · ${aberto ? 'ocultar' : 'mostrar'}`;
}

// mensagem do vazio de "Meus PRs". Separa dois vazios que a tela confundia: nao ter PR
// aberto e ter TODOS ocultos (que deixava a lista em branco, sem dizer por que nem como
// desfazer). `vs` vem do listViewState, calculado sobre a lista COMPLETA do motor.
export function myPRsEmptyMsg(vs, { escopoTodas = true, ocultos = 0 } = {}) {
  if (vs === 'loading') return 'Verificando se você tem PRs abertos…';
  if (vs === 'error') return 'Não foi possível confirmar ainda (a checagem falhou; veja o aviso no topo). Vou tentar de novo no próximo ciclo.';
  const n = Number(ocultos) || 0;
  if (n > 0) return `${plural(n, 'PR seu está oculto', 'PRs seus estão ocultos')} e não há mais nenhum aberto. Use "mostrar", no rodapé da seção, pra ver de novo.`;
  return `Você não tem PRs abertos ${escopoTodas ? 'nas organizações monitoradas' : 'nesta conta'}.`;
}

// G19 (I3): a guarda de merge em andamento recusa a SEGUNDA metade de um clique
// duplo. Nada falhou ali: o primeiro merge seguiu em frente e o toast vermelho
// mentia, aparecendo colado no "merge realizado com sucesso" do mesmo clique.
// Recusa benigna informa, nao alarma. Fica aqui, e nao inline no handler, porque
// os tres botoes de merge (normal, auto, admin) passam pela MESMA guarda do
// mergeSelfPR: um so lugar decide a cor.
export const MERGE_EM_ANDAMENTO = 'merge já em andamento';

export function mergeToastKind(erro) {
  return String(erro || '') === MERGE_EM_ANDAMENTO ? 'info' : 'error';
}
