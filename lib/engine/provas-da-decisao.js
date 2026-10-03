// O que sustentou cada decisão, guardado junto dela (03/10/2026).
//
// Até aqui o recordDecision descartava `decision`, `coverage`, `alcance` e o estado dos
// checks obrigatórios: medido em 03/10/2026, nenhuma das 60 aprovações automáticas desde
// 30/09 preservava esses campos, e 47 dos 60 relatórios nem mencionavam o `pr-reviewer`.
// Não dava para reconstruir se uma aprovação cumpriu o protocolo nem com que prova saiu.
//
// Aqui fica um RESUMO, não o envelope inteiro: o histórico guarda 3000 decisões, e a lista
// completa de arquivos de um PR grande multiplicaria o decisions.json. Contagens mais uma
// amostra limitada bastam para auditar ("aprovou com 83 lacunas" é o fato que importa).
// PURO: só lê o resultado que o runHeadlessReview já completou.
import { coverageGap } from './file-proof.js';
import { itensParaQuemMergeia } from './para-quem-mergeia.js';

const AMOSTRA = 10;

function contar(v) {
  if (Array.isArray(v)) return v.length;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function textos(lista) {
  return (Array.isArray(lista) ? lista : []).map((x) => String((x && x.nome) || x || '').slice(0, 200)).filter(Boolean);
}

// O que a sessão declarou sobre o protocolo (`protocolo.prReviewer`): rodou, dispensou (com o
// motivo) ou não disse. Valor fora disso vira "nao_declarado", nunca "rodou".
function protocoloDeclarado(result) {
  const p = (result && result.protocolo) || {};
  const estado = ['rodou', 'dispensado'].includes(p.prReviewer) ? p.prReviewer : 'nao_declarado';
  return { prReviewer: estado, motivo: String(p.motivo || '').trim().slice(0, 300) };
}

// null = o campo nem chegou (sessão sem leitura de checks); lista vazia = todos verdes,
// sem exigência ou leitura que falhou (anexarChecksObrigatorios grava [] nesse caso)
function checksNaoVerdes(r) {
  if (!Array.isArray(r.checksObrigatorios)) return null;
  return r.checksObrigatorios.map((c) => `${String((c && c.nome) || '?').slice(0, 120)}:${String((c && c.estado) || '?')}`);
}

function provasDaDecisao(result) {
  const r = result || {};
  const cov = r.coverage || {};
  const lacunas = coverageGap(r);
  const decision = ['auto_approve', 'needs_decision'].includes(r.decision) ? r.decision : '';
  return {
    decision,
    cobertura: {
      total: contar(cov.total),
      lidos: contar(cov.reviewed),
      faltando: contar(cov.missing),
      lacunas: lacunas.length,
      amostra: lacunas.slice(0, AMOSTRA).map((t) => String(t).slice(0, 200)),
    },
    alcance: { declarados: Array.isArray(r.alcance) ? r.alcance.length : 0 },
    checksNaoVerdes: checksNaoVerdes(r),
    dependenciasAbertas: textos(r.dependenciasAbertas).slice(0, AMOSTRA),
    paraQuemMergeia: itensParaQuemMergeia(r),
    protocolo: protocoloDeclarado(r),
  };
}

export default { provasDaDecisao };
export { provasDaDecisao };
