// Prontidão do distribuidor (CT-PRONT), a parte pura. Sem estado, sem IO, sem rede.
//
// PRONTIDÃO É RECENTE, NÃO SUCESSO ANTIGO. O admin só renova depois de um ciclo de
// distribuição SAUDÁVEL, e o frescor é o mesmo de CT-ADM-POL: snapshot inicial, keep-alive
// e reentrega de valor antigo não renovam nada. Até o primeiro valor fresco, a prontidão é
// DESCONHECIDA, e desconhecida vale como indisponível.
//
// O QUE É CICLO SAUDÁVEL: leu candidatos, ocupação e políticas, e terminou com cada
// registro elegível atribuído, em espera com motivo conhecido, ou isolado como defeituoso.
// Fila vazia, falta de vaga, bloqueio de política ou de orçamento e "nenhum aparelho apto"
// são RESULTADOS LEGÍTIMOS: eles renovam. Exceção, leitura que não conclui, falha devolvida
// sem exceção e ciclo que estourou o prazo NÃO renovam, e nenhuma delas é disfarçada de
// fila vazia.
//
// DEFEITO É DO REGISTRO, NÃO DO PR. O registro de um publicador com envelope ilegível não
// invalida o registro válido de outro publicador do mesmo PR. Cada defeito guarda a
// IMPRESSÃO DA CAUSA (revisão do registro, geração de chave, versões das dependências): o
// registro volta a ser avaliado quando a causa muda, inclusive no mesmo head. Enquanto a
// impressão não muda, ele não é reavaliado a cada ciclo; para causa externa que a impressão
// não enxerga, a revalidação tem intervalo crescente com teto de uma hora.
import { SYNC } from '../constants.js';

const LEGITIMOS = ['atribuido', 'fila-vazia', 'sem-vaga', 'politica', 'orcamento', 'sem-aparelho-apto', 'espera-com-motivo', 'isolado'];
const FALHAS = ['excecao', 'leitura-incompleta', 'falha-devolvida', 'prazo-estourado', 'estado-impede'];
const BACKOFF_INICIAL_MS = 60 * 1000;
const BACKOFF_TETO_MS = SYNC.PRONTIDAO_BACKOFF_TETO_MS;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function lista(v) {
  return Array.isArray(v) ? v : [];
}

// O relatório do ciclo: o que foi lido, o que foi avaliado e quanto demorou.
function cicloSaudavel(relatorio, { limiteMs = SYNC.AUTORIDADE_INTERVALO_MS } = {}) {
  const r = objeto(relatorio) ? relatorio : {};
  if (r.erro) return { ok: false, motivo: FALHAS.includes(String(r.erro)) ? String(r.erro) : 'estado-impede' };
  const leituras = objeto(r.leituras) ? r.leituras : {};
  for (const fonte of ['candidatos', 'ocupacao', 'politicas']) {
    if (leituras[fonte] !== true) return { ok: false, motivo: 'leitura-incompleta', fonte };
  }
  if (Number(r.duracaoMs) > Number(limiteMs)) return { ok: false, motivo: 'prazo-estourado' };
  for (const av of lista(r.avaliados)) {
    if (!objeto(av) || !LEGITIMOS.includes(String(av.desfecho))) {
      return { ok: false, motivo: 'falha-devolvida', itemId: objeto(av) ? av.itemId : '' };
    }
  }
  return { ok: true, motivo: '' };
}

// A impressão da causa: muda quando o coletor republicou, quando a chave ficou disponível
// ou quando a política mudou. É o que faz a recuperação acontecer sem HEAD novo.
function impressaoDaCausa({ revisao, geracao, versoes } = {}) {
  const deps = objeto(versoes) ? Object.keys(versoes).sort().map((k) => `${k}=${versoes[k]}`) : [];
  return [String(revisao || ''), String(geracao || ''), ...deps].join('|');
}

function isolar(defeito, { causa, motivo, agora }) {
  const anterior = objeto(defeito) ? defeito : null;
  const mesmaCausa = anterior && anterior.causa === causa;
  const espera = mesmaCausa ? Math.min(BACKOFF_TETO_MS, (Number(anterior.espera) || BACKOFF_INICIAL_MS) * 2) : BACKOFF_INICIAL_MS;
  return { causa, motivo: String(motivo || ''), desde: mesmaCausa ? anterior.desde : Number(agora), espera, proxima: Number(agora) + espera };
}

// Reavalia quando a CAUSA muda, ou quando a janela crescente venceu (a causa externa que a
// impressão não enxerga). Enquanto nada disso acontece, o registro não custa nada por ciclo.
function deveReavaliar(defeito, causaAtual, { agora }) {
  if (!objeto(defeito)) return true;
  if (defeito.causa !== causaAtual) return true;
  return Number(agora) >= Number(defeito.proxima);
}

// Ocupação de um aparelho para o admin: reserva e execução somam, fila só informa.
// Atribuição enviada e não aceita conta como provisória até o TTL; quando o aparelho a
// aceita, ela aparece no resumo com o id da atribuição e deixa de ser contada duas vezes.
function ocupacaoDe(dev, { resumo, atribuicoes, leases, agora }) {
  const r = objeto(resumo) ? resumo : null;
  const frescoAte = r ? Number(r.frescoAte) : 0;
  const temResumo = !!r && frescoAte > Number(agora);
  const doResumo = temResumo ? Number(r.porEstado && r.porEstado.reserva) + Number(r.porEstado && r.porEstado.execucao) : 0;
  const idsNoResumo = new Set(temResumo ? lista(r.atribuicoes) : []);
  const provisorias = lista(atribuicoes).filter((a) => objeto(a) && a.dev === dev && Number(a.ttl) > Number(agora) && !idsNoResumo.has(a.id));
  // aparelho em versão antiga não publica resumo: aí o lease é o que o admin enxerga
  const porLease = temResumo ? 0 : lista(leases).filter((l) => objeto(l) && l.dev === dev && Number(l.expiresAt) > Number(agora)).length;
  return { total: (temResumo ? doResumo : 0) + provisorias.length + porLease, temResumo, provisorias: provisorias.length, porLease };
}

// Aparelho sem resumo fresco é INAPTO para atribuição nova; o que ele já roda continua.
function aptoParaAtribuir(dev, ctx) {
  return ocupacaoDe(dev, ctx).temResumo;
}

export default { LEGITIMOS, FALHAS, BACKOFF_TETO_MS, cicloSaudavel, impressaoDaCausa, isolar, deveReavaliar, ocupacaoDe, aptoParaAtribuir };
export { LEGITIMOS, FALHAS, BACKOFF_TETO_MS, cicloSaudavel, impressaoDaCausa, isolar, deveReavaliar, ocupacaoDe, aptoParaAtribuir };
