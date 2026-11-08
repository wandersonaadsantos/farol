// O que a revisão não leu por ser arquivo de ambiente ou caminho protegido, PURO.
//
// Ordem do dono de 08/11/2026 ("se eu deixei pra aprovar sozinho ele deve aprovar sozinho"),
// que supera a de 03/11/2026 (valor oculto de quem não é Tech Lead ia para a pessoa) e a de
// 06/11/2026 (protegido sem projeção ia para a pessoa): os dois viram ressalva visível no app
// (ressalvas.js), e a política da conta decide entre aprovar com ressalvas e a mesa. A espera da
// prova continua recusando armar para o protegido sem projeção (espera-prova.js), porque outra
// sessão também não o leria.
import { KIND as ENV_KIND } from '../review-source/env-changes.js';
import { arquivoProtegido } from '../review-source/caminho-protegido.js';

function arquivosDoDiff(result) {
  return Array.isArray(result?.inventarioDiff?.files) ? result.inventarioDiff.files : [];
}

// Arquivo de ambiente com valor oculto ou com o patch truncado pelo GitHub.
function valoresOcultosDeAmbiente(result) {
  return arquivosDoDiff(result).filter(f => f?.representation?.kind === ENV_KIND && (f.representation.hiddenValues > 0 || f.representation.partial));
}

// Sem a projeção, a revisão não viu o arquivo protegido.
function arquivosProtegidosSemProjecao(result) {
  return arquivosDoDiff(result).filter(f => arquivoProtegido(f) && f?.representation?.kind !== ENV_KIND);
}

function pontosDoNaoLido(result) {
  const pts = [];
  const ambiente = valoresOcultosDeAmbiente(result).map(f => f.path);
  if (ambiente.length) pts.push({ text: `Arquivo de ambiente com valor que pode ser credencial e que a revisão não leu (${ambiente.join(', ')}); confira o valor.`, kind: 'gate' });
  // o protegido que a cobertura já aponta (protegidosSemLeitura, file-proof.js) chega ao card pela
  // ressalva da cobertura; repetir aqui o mostraria duas vezes
  const jaNaCobertura = new Set(Array.isArray(result?.protegidosSemLeitura) ? result.protegidosSemLeitura : []);
  const protegidos = arquivosProtegidosSemProjecao(result).map(f => f.path).filter(p => !jaNaCobertura.has(p));
  if (protegidos.length) pts.push({ text: `Arquivo protegido que a revisão não pôde ler (${protegidos.join(', ')}); confira o conteúdo.`, kind: 'gate' });
  return pts;
}

export { valoresOcultosDeAmbiente, arquivosProtegidosSemProjecao, pontosDoNaoLido };
