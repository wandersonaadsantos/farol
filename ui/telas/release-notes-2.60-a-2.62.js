// Notas de versão da 2.60.0 até a 2.62.2, que a tela Novidades mostra depois das recentes.
// Arquivo FECHADO desde 05/11/2026: saiu de ./release-notes.js pelo mesmo motivo do
// ./release-notes-ate-2.59.js (o teto de tamanho), e nada entra aqui. Release nova vai para o
// topo de ./release-notes.js.
export const NOTAS_2_60_A_2_62 = [
  ['2.62.2', ['Depois de abrir o Farol, a tela passa a dizer quem administra o conjunto em segundos: o relógio que observa os aparelhos começa ao conectar, e não no primeiro ciclo de busca de PRs.']],
  ['2.62.1', ['Com a sincronização ligada e o Firebase fora do ar, o que é ação sua volta a postar: aprovar, pedir mudanças e a revisão sem coordenação. O Farol confere no GitHub antes para não repetir um veredito que já está lá; o que é automático continua esperando o Firebase voltar.',
    'Com o Firebase fora do ar, o reenvio automático de postagens espera a conexão em vez de consultar o GitHub a cada ciclo.']],
  ['2.62.0', ['Sistema > Contas confere as contas logadas no gh deste computador com as que o Farol monitora, e avisa o que não bate, cada caso com o botão que resolve: conta logada que o Farol não monitora (Monitorar), conta do Farol sem login no gh (Remover), a mesma org em duas contas (Tirar da outra) e org que a conta revisa mas não está nas orgs dela (Adicionar).',
    'Conta sem login no gh deixou de encher o log: uma linha quando o login some, não duas a cada ciclo.',
    'Com mais de uma conta, PR de org que nenhuma conta cobre não é postado com a conta primária por falta de opção: a postagem recusa e diz o motivo.']],
  ['2.61.1', ['A chave do conjunto reabre sozinha depois de reiniciar, inclusive depois da atualização automática: você não precisa mais digitar a senha da sincronização a cada reinício. Ela só reabre quando a cópia guardada neste computador confere com a do banco.',
    '"Tornar este aparelho admin" aparece na tela mesmo com a chave trancada, e o sinal de vida do admin chega em segundos, não em minutos.',
    'Sumiu o aviso "recibo não marcado como publicado" que aparecia a cada aprovação automática sem efeito real.']],
  ['2.61.0', ['O Farol no celular passa a pedir login sozinho: detectado o modo celular, a API local exige pareamento sem precisar configurar nada, e isso destrava a visão compartilhada nesse aparelho. Se a interface trancar, o desbloqueio é pelo terminal, com node tools/farol-parear.js.',
    'O teto de consumo do grupo passa a barrar de verdade: com grupo configurado, com identidade e teto, estourar o valor do dia segura revisões novas do grupo. Barrar é espera, não estacionamento, e sem grupo configurado nada muda.',
    'As duas foram ligadas antes das medições que as seguravam (Termux real e atraso do consumo entre dois aparelhos), por decisão sua, e voltam a desligar numa versão nova se incomodarem.',
    'A revisão automática parou de cair em "falha técnica ao postar" com a coordenação entre aparelhos ligada: o Farol tenta de novo até 3 vezes, com 2 segundos entre elas, e se ainda não sair reenvia sozinho nos ciclos seguintes. Só repete quando nada chegou ao GitHub.',
    '"Tornar este aparelho admin" passa a aparecer na tela na hora, mesmo quando os outros aparelhos da conta estão em versão antiga.',
    'No Mac, o Farol pode abrir junto com o sistema: Sistema > Preferências > Iniciar com o macOS. Vale a partir do próximo login.']],
  ['2.60.1', ['Autoanálise sem nada a ajustar virou motivo de festa: quando o veredito é aprovável e não há pendência no PR, pendência de fora dele nem dica de melhoria, caem confetes por quatro segundos, com um aviso discreto. Qualquer ponto levantado, ou análise desatualizada por commit novo, não festeja, e a mesma análise só festeja uma vez.',
    'Com movimento reduzido ligado no sistema, nada se mexe: fica só o aviso, pelo mesmo tempo.',
    'O card "Analisando agora" parou de vazar: o passo da sessão cabe em duas linhas, com o texto completo ao passar o mouse, e os elementos do card ganharam espaço entre si.']],
  ['2.60.0', ['Vários aparelhos, um Farol só: em Sistema cada aparelho aparece com nome, versão e o que está fazendo, e tudo o que sobe para o banco vai cifrado com a chave do conjunto. Quem não liga a sincronização continua com o Farol de sempre.',
    'Revisão distribuída, opcional: o aparelho administrador coloca cada revisão em quem tem vaga, e se ele some cada aparelho volta sozinho a revisar localmente.',
    'Comandos entre aparelhos com recibo (cancelar, repetir, decidir, iniciar e designar administrador), e transferir ou tomar uma revisão em andamento, com o risco explicado antes de confirmar.',
    'Panorama e Meus PRs dos outros aparelhos, o motivo de cada revisão que espera, e a memória do que já foi verificado viajando junto com o PR.',
    'Encerrar as sessões dos outros aparelhos com a senha, para aparelho perdido. Antes de ligar os recursos novos, publique as regras novas do banco no console do Firebase.']],
];
