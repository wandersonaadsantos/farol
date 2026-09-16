import { esc } from './comum.js';

/* O que a tela diz sobre capacidade que existe e não está valendo (adendo de 16/09/2026,
   item 5). PURA: recebe o retrato que o engine manda no snapshot (`capacidades`, de
   lib/engine/capacidades.js) e devolve a lista do que precisa aparecer como indisponível.

   A regra é uma só: enquanto a proteção não está sendo APLICADA, a tela não pode dizer que
   está. Cada item diz três coisas, porque qualquer uma sozinha engana: o que está fora, por
   que, e o que já existe pronto por trás (senão parece que a capacidade não foi feita). */

const ITENS = [
  {
    id: 'autenticacao-local',
    titulo: 'Autenticação da API local',
    estado: 'indisponivel',
    motivo: 'a API deste aparelho não está sendo exigida com credencial: o modo celular foi detectado, mas a exigência automática continua desligada',
    oQueFalta: 'a tela de pareamento (código de uso único e sessões) e a validação num aparelho Termux real; enquanto isso, dá para exigir pelo arquivo de configuração (localAuth: "exigir")',
    aplica: (c) => c.autenticacaoLocal.modoCelular && !c.autenticacaoLocal.exigida,
  },
  {
    id: 'compartilhamento',
    titulo: 'Visão compartilhada entre aparelhos',
    estado: 'bloqueado',
    motivo: 'está ligada na configuração e o Farol a mantém desligada aqui, porque a autenticação da API local não está sendo exigida neste aparelho',
    oQueFalta: 'exigir a autenticação local neste aparelho; o conteúdo compartilhado só volta a subir e descer depois disso',
    aplica: (c) => c.compartilhamento.pedido && !c.compartilhamento.aplicado,
  },
  {
    id: 'teto-grupo',
    titulo: 'Teto de consumo do grupo',
    estado: 'configurado-sem-efeito',
    motivo: 'o grupo está configurado e o teto ainda não segura nenhuma sessão: a ativação depende de medir o atraso real do consumo entre dois aparelhos',
    oQueFalta: 'a medição do atraso entre aparelhos físicos; até lá o teto aparece como número, e quem segura sessão continua sendo o orçamento por perfil',
    aplica: (c) => c.tetoGrupo.configurado && !c.tetoGrupo.aplicado,
  },
];

const ROTULO_DO_ESTADO = {
  indisponivel: 'indisponível',
  bloqueado: 'bloqueado pelo Farol',
  'configurado-sem-efeito': 'configurado, ainda não vale',
};

function capacidadesIndisponiveis(capacidades) {
  const c = capacidades;
  if (!c || !c.autenticacaoLocal || !c.compartilhamento || !c.tetoGrupo) return [];
  return ITENS.filter((i) => i.aplica(c)).map(({ id, titulo, estado, motivo, oQueFalta }) => ({ id, titulo, estado, motivo, oQueFalta }));
}

/* O cartão da tela. Devolve string vazia quando não há nada a dizer: cartão vazio prometendo
   "tudo certo" seria a mesma mentira ao contrário. */
function capacidadesIndisponiveisHtml(capacidades) {
  const itens = capacidadesIndisponiveis(capacidades);
  if (!itens.length) return '';
  const linhas = itens.map((i) => `<li class="cap-item">
      <span class="cap-titulo">${esc(i.titulo)}</span>
      <span class="cap-estado">${esc(ROTULO_DO_ESTADO[i.estado] || i.estado)}</span>
      <span class="cap-motivo">${esc(i.motivo)}</span>
      <span class="cap-falta">Falta: ${esc(i.oQueFalta)}</span>
    </li>`).join('');
  return `<div class="card cap-card">
    <div class="sync-sub-head">O que ainda não está valendo</div>
    <p class="sys-note">Existe no app e não está sendo aplicado neste aparelho. Enquanto estiver aqui, não conte com essa proteção.</p>
    <ul class="cap-lista">${linhas}</ul>
  </div>`;
}

export { capacidadesIndisponiveis, capacidadesIndisponiveisHtml };
