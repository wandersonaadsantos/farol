// Notas de versão da 2.63.0 até a 2.66.3, que a tela Novidades mostra depois das recentes.
// Arquivo FECHADO desde 13/11/2026: saiu de ./release-notes.js pelo mesmo motivo do
// ./release-notes-2.62.3-a-2.62.24.js (o teto de tamanho), e nada entra aqui. Release nova vai
// para o topo de ./release-notes.js.
export const NOTAS_2_63_A_2_66 = [
  ['2.66.3', [
    "A política do aparelho ficou só com pausa e teto. Os tipos permitidos e as contas elegíveis eram gravados e mostrados, mas nada no Farol os aplicava: desmarcar a conversa não a impedia de rodar.",
    "Admin em versão antiga que ainda publique esses campos não quebra nada: eles são descartados na chegada, e a pausa e o teto continuam valendo."
  ]],
  ['2.66.2', [
    "A revisão não morre mais esperando o CI terminar. A sessão punha a espera em segundo plano e acabava sem entregar a revisão (\"a sessão não devolveu JSON\"); agora ela registra os checks como estão, e o Farol segura a aprovação enquanto um obrigatório roda.",
    "Contas e Automação pararam de prometer autonomia que o Farol não tem. O \"com ressalvas\" herdado de cada conta agora diz o que acontece de verdade: numa conta cujo \"sem ressalvas\" espera você, ele também espera.",
    "A co-assinatura deixou de dar como exemplo justamente o caso em que ela nunca age: código do qual você é dono pelo CODEOWNERS. E o texto diz que só é detectado quem revisa com o Farol.",
    "\"Aprovável sem ressalvas\" diz o que exige: com o Jira ligado, card lido e atendido. O APPROVE sai com o texto da revisão, e as ressalvas ficam no app.",
    "\"Revisar sozinho\" lista o que segura a revisão automática, o modo rápido avisa que não vale no Auto, e a dica do Auto diz que ele usa sempre o Opus.",
    "A notificação de PR novo diz \"na fila da revisão automática\", e só quando é o próprio PR novo que entrou nela; antes anunciava \"revisando sozinho\" por causa de qualquer PR da fila.",
    "A tabela de Justiça de fila segue a ordem real do escalonador, e os textos de paralelismo, pausa e política do aparelho passaram a dizer o que de fato vale."
  ]],
  ['2.66.1', [
    "As buscas do ciclo saem espaçadas e o Farol para de tomar bloqueio do GitHub por rajada.",
    "Enquanto as buscas de uma conta estão bloqueadas, o painel avisa qual conta, até quando, e que o que está na tela é o último retrato.",
  ]],
  ['2.66.0', [
    "O painel recebe só o que mudou, e não o estado inteiro a cada atualização: 84% menos tráfego na medição desta máquina.",
    "A tela avisa quando perde o engine, em qualquer aba, e para de contar o tempo para a próxima checagem enquanto está sem conexão.",
    "O cartão da revisão mostra a etapa real, os arquivos do PR já lidos e quando o modelo terminou e o Farol está decidindo e postando; sessão sem sinal há mais de 45 segundos é avisada.",
  ]],
  ['2.65.4', [
    "A revisão pedida pela conta silenciada aparece na conta certa: não surge mais em execução na conta dona da organização.",
  ]],
  ['2.65.3', [
    "O comando do admin volta a chegar ao celular: aparelho vivo não aparece mais como sem sinal.",
    "A configuração das contas diz o que cada botão faz: as chaves gerais mostram quantas contas alcançam, e aprovar junto com quem pegou o PR respeita a conta.",
  ]],
  ['2.65.2', [
    "Radar > Aparelhos mostra só os aparelhos que aceitaram o controle deste computador: aparelho de outra pessoa no mesmo conjunto não aparece.",
  ]],
  ['2.65.1', [
    "Radar > Aparelhos: o item que pede decisão lista os motivos por extenso, o que está revisando mostra subagentes e memória herdada, e a fila não diz vazia antes de ler.",
  ]],
  ['2.65.0', [
    "Radar > Aparelhos: pelo computador você vê a fila de cada aparelho, decide, revisa agora, destrava, ignora e restaura, sem tocar no celular.",
    "A configuração da conta do celular também muda daqui, com confirmação antes de ligar qualquer coisa que poste sozinha no GitHub.",
  ]],
  ['2.64.2', [
    "O aparelho admin volta a revisar a própria fila, pelo botão e sozinho, e continua acompanhando e decidindo pelos outros aparelhos.",
  ]],
  ['2.64.1', [
    "O Ver review completo de uma pendência de outro aparelho cabe na tela: o texto rola por dentro, e o que cada decisão postaria fica em seções fechadas em vez de repetido quatro vezes.",
  ]],
  ['2.64.0', [
    "O aparelho admin virou a mesa de controle: assiste ao vivo às revisões dos outros aparelhos e decide por eles com o review completo na tela, sem executar nada.",
    "Toda revisão roda só no aparelho que tem a conta dela, e quem não é admin vê só o próprio trabalho.",
  ]],
  ['2.63.4', [
    "PR seu não abre mais revisão, nem pelo clique, nem por comando de outro aparelho: a marca de revisando com o seu nome no seu próprio PR acabou. O caminho para olhar o próprio PR é a autoanálise, em Meus PRs.",
  ]],
  ['2.63.3', [
    "Revisar de novo, por clique, um PR que você já revisou vai até o fim: antes a sessão era encerrada no meio, sem resultado.",
  ]],
  ['2.63.2', [
    "A revisão automática declara onde o código alterado é usado fora do PR, e o Farol abre esses arquivos no commit revisado para conferir. Sem essa prova, a aprovação automática não sai e a decisão fica com você.",
  ]],
  ['2.63.1', [
    "A aprovação automática espera você quando um check obrigatório ainda está rodando: a revisão fica na mesa com o nome do check, e você aprova quando a pipe fechar.",
    "A aprovação automática também espera quando a revisão confere que o PR depende de outro PR, deploy ou aplicação ainda em aberto. O card diz qual.",
  ]],
  ['2.63.0', [
    "O chat do PR exporta a conversa completa em Markdown ou JSON, ou copia o Markdown, com o id da sessão e a hora de cada mensagem no horário de Brasília. Token colado na conversa sai mascarado.",
    "O id da sessão do Claude aparece no chat, com o botão Copiar id.",
    "A conversa rola como uma coisa só: as respostas aparecem inteiras, sem a barra de rolagem dentro de cada uma.",
    "No celular, o chat ficou legível: resposta na largura toda, o id e a exportação atrás de \"Id e exportar\", e o campo e o Enviar na mesma linha.",
    "Blocos de código e listas numeradas das respostas do Claude aparecem formatados.",
  ]],
];
