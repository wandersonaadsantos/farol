// Notas de versão da 2.62.3 até a 2.62.24, que a tela Novidades mostra depois das recentes.
// Arquivo FECHADO desde 06/11/2026: saiu de ./release-notes.js pelo mesmo motivo do
// ./release-notes-2.60-a-2.62.js (o teto de tamanho), e nada entra aqui. Release nova vai para o
// topo de ./release-notes.js.
export const NOTAS_2_62_3_A_2_62_24 = [
  ['2.62.24', [
    "O modo Auto revisa todo PR com o Opus, e usa um raciocínio mais longo em repositório crítico, caminho sensível ou PR muito grande. Uma auditoria mostrou o Haiku e o Sonnet aprovando o que o Opus reprovaria.",
    "Revisão que não declara o que leu, ou que deixou um arquivo do PR de fora, não aprova sozinha: a decisão volta para você.",
    "Só revisão pedida a você posta sozinha, também nos comandos vindos de outro aparelho.",
    "A co-assinatura passa a conferir o commit que a outra pessoa aprovou antes de aprovar em seu nome.",
  ]],
  ['2.62.23', [
    "No celular com proot-distro, a interface passa a pedir pareamento, como já devia desde a v2.61.0: o Farol não se reconhecia como celular ali e a API local ficava aberta. Gere o código com node ~/.farol/app/tools/farol-parear.js, dentro do proot.",
  ]],
  ['2.62.22', [
    "'Abrir sessão de login' passa a copiar o comando de login em qualquer aparelho sem terminal, inclusive no celular, onde a versão anterior ainda pedia para instalar um emulador.",
    "O Claude Code instalado pelo instalador oficial passa a ser usado mesmo quando existe uma versão antiga em outra pasta.",
  ]],
  ['2.62.21', [
    "No celular, 'Abrir sessão de login' copia um comando para colar no Termux: ele abre o Claude já na pasta certa do perfil, então o login novo passa a valer para as revisões.",
    "Um Claude Code instalado ou atualizado depois de o Farol abrir passa a ser usado sem precisar reiniciar o Farol.",
  ]],
  ['2.62.20', [
    "No modo Auto, a revisão sobe para o Opus quando o PR pede: repositório crítico, caminho sensível (infraestrutura, autenticação, banco, pagamento) ou PR muito grande. Fora disso, continua escolhendo pelo tamanho. A atividade da revisão diz qual motivo valeu.",
    "O Farol deixa de postar aprovação ou pedido de mudanças em PR que foi mergeado ou fechado enquanto a revisão rodava.",
    "A revisão ficou mais rigorosa com base numa auditoria de 73 revisões: confere o comportamento real por trás dos testes, lê o que o código novo chama, dá o mesmo veredito para a mesma mudança e não diz no relatório algo diferente do que o app fez.",
  ]],
  ['2.62.19', [
    "O card de 'Sua fila' volta ao lugar na visão Todas com mais de uma conta: avatar, texto e botões na mesma linha, com o ponto da conta ao lado do nome do PR. Antes o avatar ficava solto no meio do card e os botões caíam para baixo.",
  ]],
  ['2.62.18', [
    "'Precisa de você em todos os aparelhos' deixa de mostrar PR que já foi decidido no aparelho dono. Um item resolvido com a sincronização fora do ar, seguido de um reinício, ficava aparecendo nos outros aparelhos para sempre; agora ele sai sozinho, inclusive os que já estão lá.",
  ]],
  ['2.62.17', [
    "Conta que bate num bloqueio curto do GitHub volta a buscar em 2 minutos. Antes, qualquer recusa parava as buscas até o fim da janela de uma hora da cota, mesmo com a cota sobrando, e Sistema > Visão geral mostrava a conta 'no limite de requisições' por quase uma hora.",
  ]],
  ['2.62.16', [
    "Revisão interrompida de um PR que foi mergeado ou fechado antes de ser retomada deixa de ficar pendente para sempre. O Farol confere no GitHub, no máximo uma vez por hora por PR, e só descarta depois de confirmar que o PR fechou.",
  ]],
  ['2.62.15', [
    "Quando há uma versão nova e o Farol ainda não se atualizou, Sistema > Visão geral passa a dizer o que está segurando e desde quando (por exemplo, \"Esperando: 1 revisão em andamento, desde 11:10\"). O Farol continua se atualizando sozinho assim que fica ocioso; a diferença é que a espera deixou de parecer defeito.",
  ]],
  ['2.62.14', [
    "Editar uma conta em Sistema > Contas passou a mudar só aquele campo daquela conta. Antes a tela regravava todas as contas com o que tinha na memória, e uma tela desatualizada podia apagar ou trazer de volta configurações que você não mexeu.",
    "O peso na cota do perfil passou a valer: ele era gravado, mas nunca chegava ao cálculo da cota, e a tela mostrava sempre \"igual as outras\".",
    "Toda mudança na política de automação fica registrada com data e origem. Quando um PR espera por causa da política, o card diz quando e de onde veio a configuração, e o Diagnóstico lista as mudanças recentes.",
  ]],
  ['2.62.13', [
    "O Farol passou a rodar o modelo mais novo de cada família. Ele pede o modelo pelo apelido (Opus, Sonnet, Haiku, Fable) e quem decide qual modelo é esse é o Claude Code instalado: com o Claude Code desatualizado, o Opus seguia sendo o Opus 5 mesmo depois do Opus 5.5. Sistema > Visão geral ganhou o check \"Versão do Claude Code\", que fica vermelho quando ele está mais de três dias atrás e diz o comando que resolve.",
    "A escolha de modelo virou uma definição só: o seletor de Automação, o que o modo Auto usa em cada tamanho de PR e o texto que descreve o Auto saem do mesmo lugar, então nunca mais dizem coisas diferentes.",
    "Haiku fixado pelo nome completo deixou de receber uma configuração de esforço que ele não aceita.",
  ]],
  ['2.62.12', [
    "Re-pedir revisão no MESMO commit parou de custar uma revisão inteira. Antes, pedir revisão de novo sem enviar código novo fazia o Farol abrir uma sessão completa que terminava concluindo \"isto já está revisado\", sem postar nada (num caso medido, doze minutos, e depois outra sessão). A pergunta passou a ser feita antes de começar. O clique manual continua sempre revisando, e quando não dá para confirmar a revisão acontece normalmente.",
    "Comentar num PR deixou de ser confundido com revisar: um recado de \"vou olhar\" podia encerrar a revisão que estava lendo o código. Agora só aprovar e pedir mudanças contam como revisão feita.",
  ]],
  ['2.62.11', [
    "A conta no limite de buscas do GitHub parou de insistir. Cada ciclo saía com sete buscas novas que batiam no limite já estourado, e cada tentativa ainda consome cota: o Farol prolongava o próprio bloqueio e o painel ficava vazio sem explicar nada. Agora as buscas daquela conta esperam, com a hora que o próprio GitHub informa, e \"Monitoramento de @conta\" fica vermelho dizendo até que horas elas voltam.",
    "Sessão que trabalhou e não entregou o resultado ganha uma segunda chance. Duas revisões medidas rodaram 10 e 15 minutos, passaram por todas as etapas e terminaram devolvendo um parágrafo de texto em vez do resultado, e o trabalho inteiro ia pro lixo. Agora o Farol pede o resultado de novo, na mesma conversa e uma vez só, sem refazer verificação nenhuma.",
    "Revisão que virou trabalho perdido é encerrada na hora. Se chega commit novo durante a revisão, ou se a revisão daquele commit já existe, a sessão é encerrada em vez de seguir até o fim por um resultado que já nasceu velho. Falha de rede na conferência nunca encerra nada.",
    "O Farol parou de falar de si em terceira pessoa. Rodando numa conta, ele escreveu um comentário citando essa mesma conta com arroba, como se a aprovação anterior fosse de outra pessoa. Agora a sessão sabe qual conta assina, fala das próprias revisões na primeira pessoa, e o texto que citar a própria conta nem chega a ser postado.",
    "E parou de receber o nome de outra pessoa como voz: o protocolo mandava escrever \"como o Wanderson escreveria\" em qualquer instalação, o que numa máquina que não é a dele é ordem de escrever com a voz de quem não assina o review.",
    "A lista de falhas, em Sistema > Diagnóstico, parou de enterrar o que pede ação. Repetição antiga da mesma falha some numa linha só com a contagem (num aparelho real, 19 cartões viraram 5), e o cartão nasce fechado mostrando quando, o que é e sobre qual PR. A falha que precisa de você continua nascendo aberta.",
    "A lição aprendida passou a valer para o repositório: quando o autor contesta uma revisão e tem razão, isso deixa de valer só para as revisões seguintes daquela pessoa e passa a valer para a base inteira.",
    "Fato de fora do diff é reconferido antes de virar bloqueio. Uma revisão reprovou um PR dizendo que outro PR do qual ele dependia seguia aberto, e ele tinha sido mesclado quatro minutos antes: o dado envelheceu durante a sessão.",
  ]],
  ['2.62.10', ['O limite do plano do Claude passou a valer para a conta inteira. Na versão anterior cada PR esperava o reset depois de bater no limite, mas com a fila cheia os outros PRs ainda batiam nele um a um, cada um pondo e tirando a label "<conta>:revisando". Agora o primeiro PR que descobre o limite segura os outros da mesma conta, e eles esperam o reset na fila, sem abrir sessão.', 'Reiniciar o Farol durante o limite não dispara mais a fila inteira: a espera fica gravada. O clique manual continua passando, e uma revisão que dá certo libera a conta.']],
  ['2.62.9', ['Com a conta do Claude no limite, o Farol parou de relançar a revisão a cada ciclo. Antes ele só reconhecia três das frases de limite do Claude Code: as outras eram tratadas como falha passageira, a sessão morria em segundos e a label "<conta>:revisando" entrava e saía do PR várias vezes por hora. Agora o PR espera o horário de reset que a própria mensagem informa, e o limite semanal com data ("resets Sep 24 at 5am") também passou a ser lido.', 'Teto da organização (orçamento do time, gasto mensal, crédito zerado pelo admin) não se resolve esperando: o PR estaciona dizendo que alguém com acesso de admin no Claude precisa subir o teto.', 'O resultado de "Testar perfil", em Sistema > Plano e chaves, voltou a ser legível: cada informação na sua linha, com o selo de onde ela veio em cor própria, inclusive em tela estreita.']],
  ['2.62.8', ['Três textos da sincronização de aparelhos ficaram mais claros. O motivo de um aparelho não aceitar o admin passou a usar o nome do interruptor que resolve isso ("Aceitar políticas e comandos do admin"), em vez da palavra "consentimento", que não existe em controle nenhum da tela.', 'Recibo que não é do aparelho alvo tinha dois estados parecidos demais: agora um diz "recibo de outro aparelho" e o outro "recibo não conferido", com cores diferentes.', 'E ainda não ter lido quem administra parou de usar o mesmo selo de "sem admin": são fatos opostos, e o de leitura pendente agora diz "ainda não li".']],
  ['2.62.7', ['"Ver relatório completo" parou de fechar sozinho enquanto você lê. Com uma revisão em andamento, as listas do Radar e de Meus PRs se redesenham a cada poucos segundos, e cada redesenho fechava o relatório aberto (e também os motivos e o pushback). Agora o que você abriu continua aberto e no mesmo lugar da tela, mesmo quando uma revisão nova entra no topo da lista.']],
  ['2.62.6', ['Os botões de cada aparelho, em Sistema > Aparelhos, ganharam uma faixa própria logo abaixo dos dados: eles voltam a caber numa linha só, e as quatro colunas continuam alinhadas sob os cabeçalhos. Na versão anterior o alinhamento veio ao custo de os botões quebrarem em duas linhas.']],
  ['2.62.5', ['O aviso de análise já feita parou de falar do seu próprio aparelho em terceira pessoa: quando o trabalho foi feito aqui, ele diz "neste aparelho" em vez de nomear a máquina em que você está lendo.',
    'O recibo de um comando passou a pertencer ao aparelho a quem ele foi enviado: um terceiro não responde mais por ele, e o desfecho na tela só aparece quando o recibo é mesmo do alvo.',
    'Aposentar e reativar aparelho exigem o aparelho admin, e o aviso diz QUAL aparelho vai ser aposentado. Antes dizia "este aparelho" para qualquer linha da lista.',
    'Aposentar um aparelho deixou de travar o teto do grupo de consumo para sempre; o gasto que ele já tinha feito continua contando. Aparelho apenas desligado continua sendo exigido.',
    'O aparelho que não aceita comandos do admin parou de receber trabalho que ia recusar, num laço sem fim, e a recusa agora chega com o motivo.',
    'A lista de aparelhos voltou a ter os valores embaixo dos cabeçalhos certos, e no celular cada valor diz o que é. A tabela de consumo por aparelho parou de perder sessões e custo no estreito.',
    'O cartão "medido x estimado" parou de mostrar 100% havendo estimativa, e a tela parou de afirmar "ninguém administra" ou "nada precisa de você" antes de ter lido qualquer coisa.']],
  ['2.62.4', ['O Diagnóstico parou de encher de cartão repetido com o limite do plano Claude. A verificação de contestação do autor gastava uma sessão por ciclo mesmo com o limite estourado, e cada tentativa virava uma falha nova: agora ela espera a hora do reset que vem na mensagem, ou meia hora quando a mensagem não cita hora.',
    'Falha que se resolve sozinha, repetida no mesmo PR e com a mesma mensagem, fica num cartão só, com a contagem e desde quando repete. Falha que precisa de você continua com uma linha por acontecimento.']],
  ['2.62.3', ['A preparação do Claude Code no boot deixou de falhar por uma corrida de leitura: o Farol tenta ler o ~/.claude.json três vezes antes de desistir, porque o Claude reescreve esse arquivo o tempo todo. Sem isso, a primeira sessão podia parar no diálogo de confiar na pasta.']],
];
