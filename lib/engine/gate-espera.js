// Quando a aprovação automática ESPERA você, olhando o estado do PR e não o texto (27/09/2026).
//
// PURO: só lê o envelope da revisão, que o runHeadlessReview completa antes do gate
// (`checksObrigatorios`, a mesma leitura do gate de lançamento em checks-exigidos.js) ou
// que a própria sessão preenche (`dependenciasAbertas`). Quem aplica é o shouldAutoApprove
// (lib/engine/decision.js), numa linha, e o texto do card sai de textoDaEspera.
//
// Três motivos, em ordem de força:
//   - ci_vermelho: check obrigatório em FAILURE no head. Nasceu em biud-frontend#896
//     (02/09/2026): a política de ressalvas aprovou por cima do `audit` vermelho, e o PR foi
//     mergeado por bypass três minutos depois, com a aprovação assinada pelo dono de cobertura.
//   - ci_em_andamento: check obrigatório ainda rodando ou que nem começou. Até 27/09/2026
//     isso passava ("aprovar com pipe em andamento é o que um revisor humano faz"), e a
//     auditoria de qualidade achou APPROVE saindo com o próprio relatório pedindo espera
//     (biud-frontend#1187). Decisão do dono: não aprova sozinho.
//   - dependencia: a revisão declarou um PR, deploy ou aplicação de que a aprovação depende
//     e que estava em aberto na hora da leitura (engine-ai#266 aprovado com infra-k8s#189
//     ainda aberto). A sessão confere o fato antes de escrever (pr-review-auto.md).
// Falta de dado não inventa espera: campo ausente ou lista vazia deixam passar.
const TETO_DE_DEPENDENCIAS = 10;
const TETO_DO_ITEM = 200;

function checksNoEstado(result, estados) {
  const lista = result && result.checksObrigatorios;
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((c) => c && estados.includes(String(c.estado || '')))
    .map((c) => String(c.nome || '').trim())
    .filter(Boolean);
}

// Checks obrigatórios em FAILURE no head (a regra de biud-frontend#896). Reexportada pelo
// decision.js para a fachada do server.js.
function checksVermelhos(result) {
  return checksNoEstado(result, ['vermelho']);
}

function dependenciasAbertas(result) {
  const lista = result && result.dependenciasAbertas;
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((d) => typeof d === 'string')
    .map((d) => d.trim().slice(0, TETO_DO_ITEM))
    .filter(Boolean)
    .slice(0, TETO_DE_DEPENDENCIAS);
}

function motivoDeEspera(result) {
  if (checksVermelhos(result).length) return 'ci_vermelho';
  if (checksNoEstado(result, ['rodando', 'ausente']).length) return 'ci_em_andamento';
  if (dependenciasAbertas(result).length) return 'dependencia';
  return null;
}

const TEXTO = {
  ci_vermelho: (r) => `check obrigatório vermelho no head (${checksVermelhos(r).join(', ')}): aprovação não sai sozinha com CI reprovando, mesmo aprovável com ressalvas; o merge está travado pelo ruleset até a pipe ficar verde`,
  ci_em_andamento: (r) => `check obrigatório ainda sem resultado no head (${checksNoEstado(r, ['rodando', 'ausente']).join(', ')}): a aprovação não sai sozinha com a pipe em andamento; aprove quando a pipe fechar`,
  dependencia: (r) => `a aprovação depende de algo ainda em aberto (${dependenciasAbertas(r).join('; ')}): não sai sozinha antes disso`,
};

// O texto do motivo, para o card. Motivo que não é de espera devolve ''.
function textoDaEspera(motivo, result) {
  return Object.hasOwn(TEXTO, String(motivo)) ? TEXTO[motivo](result || {}) : '';
}

export default { motivoDeEspera, textoDaEspera, dependenciasAbertas, checksVermelhos };
export { motivoDeEspera, textoDaEspera, dependenciasAbertas, checksVermelhos };
