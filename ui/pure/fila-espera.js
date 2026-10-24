// Apresentação da espera confirmada pelo agendador; não recalcula seus gates.
import { esc } from './comum.js';

const MOTIVOS = {
  'aguardando-agendador': 'Aguardando a próxima passagem do agendador; motivo de bloqueio ainda não confirmado.',
  'limite-conta': 'Limite de revisões simultâneas desta conta atingido',
  'limite-global': 'Limite total de revisões simultâneas deste aparelho atingido',
  'sem-vaga': 'Todas as vagas de execução deste aparelho estão ocupadas',
  pausado: 'Este aparelho está pausado para novas execuções.',
  'grupo-nao-verificavel': 'Não foi possível verificar o limite de consumo compartilhado desta conta.',
  'presenca-vencida': 'A presença deste aparelho na coordenação está desatualizada.',
  root: 'O provedor não permite iniciar sessões como root.',
  'provedor-nao-pronto': 'O provedor de IA deste aparelho não está pronto.',
  'memoria-desconhecida': 'Não foi possível medir a memória disponível para iniciar uma revisão.',
  'memoria-insuficiente': 'Memória disponível insuficiente para iniciar uma revisão com segurança.',
};

export function filaEsperaHtml(espera) {
  const motivo = MOTIVOS[espera?.motivo] || 'Motivo da espera ainda não confirmado pelo agendador.';
  const contagem = Number.isFinite(espera?.ocupadas) && Number.isFinite(espera?.limite)
    ? ` (${espera.ocupadas}/${espera.limite})` : '';
  const posicaoValida = Number.isInteger(espera?.posicao) && espera.posicao > 0
    && Number.isInteger(espera?.total) && espera.total >= espera.posicao;
  const posicao = posicaoValida
    ? `<div class="pr-coord" title="A ordem de execução alterna organizações e depende das vagas de cada conta.">Posição ${espera.posicao} de ${espera.total} na fila local (ordem de entrada).</div>` : '';
  return `${posicao}<div class="pr-coord">${esc(motivo + contagem)}</div>`;
}
