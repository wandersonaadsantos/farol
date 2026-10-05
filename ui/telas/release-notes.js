// As notas de versão que a tela Novidades mostra. DADO, não tela: a lista cresce uma
// entrada por release, para sempre, e por isso ela saiu do ui/telas/novidades.js em
// 02/10/2026, quando o ratchet de tamanho (que passou a medir excesso de linhas) reprovou
// o arquivo da tela por causa do crescimento dela.
//
// A fonte completa do histórico é o CHANGELOG.md; aqui fica o que o app mostra, com o
// mesmo número de versão no topo (test/release-consistency.test.js amarra os três).
//
// Dividida em 05/10/2026, antes de este arquivo passar do teto de 400 linhas úteis: as notas
// até a 2.59 moram em ./release-notes-ate-2.59.js, que não muda mais. Release nova entra
// SEMPRE no topo da lista abaixo. Quando este arquivo voltar a se aproximar do teto, a série
// mais antiga daqui vai inteira para um arquivo próprio do mesmo jeito (um por faixa, nunca
// editado depois), e o teto não sobe.
import { NOTAS_ATE_2_59 } from './release-notes-ate-2.59.js';

const RELEASE_NOTES_RECENTES = [
  ['2.71.5', ["PR que você já revisou fora do Farol parou de voltar à fila a cada ciclo: ele só volta com commit novo ou com um pedido de revisão novo de outra pessoa.", "Revisão que terminava com um caractere a mais no resultado deixou de ser descartada: a mesma sessão reenvia o resultado uma vez, sem revisar de novo.", "Menos chamadas ao GitHub: o que não mudou no PR não é relido a cada ciclo, e o limite do GitHub espera a cota que acabou de verdade.", "A aprovação não sai sobre um commit que chegou no meio da postagem, e o estado é gravado no disco antes de substituir o anterior."]],
  ['2.71.4', ["Quando a sessão da autoanálise devolve uma resposta quebrada, o Diagnóstico agora mostra \"Sessão sem resultado estruturado válido\", a mesma classe da revisão, em vez de \"falha não classificada\" com a mensagem crua do interpretador.", "Nada muda no comportamento: a análise continua parando e esperando você, sem tentar de novo sozinha."]],
  ['2.71.3', ["Quando a revisão encontra algo que só uma pessoa decide (segurança, produto, escopo além do card), isso agora vai no texto da aprovação, para quem faz o merge ver. Antes ficava só no app.", "Cada decisão guarda o que a sustentou (cobertura da leitura, checks, se o revisor detalhado rodou), para dar para auditar depois.", "A revisão parou de contar com travas que a configuração pode ter desligado, como a espera do CI."]],
  ['2.71.2', ["Sistema > Conexões saiu: a conta e as organizações que estavam lá não tinham efeito. As organizações de cada conta continuam em Sistema > Contas.", "Repos bloqueados pra merge agora ficam em Sistema > Automação, num bloco próprio: um repo por linha, campo que aceita owner/repo ou URL, e Desfazer.", "Em Meus PRs, o card de um repo bloqueado diz por que não há Merge e leva direto à lista."]],
  ['2.71.1', ["Aprovação dispensada pelo push agora também dispara a re-revisão: antes o PR que perdia a sua aprovação ficava sem revisão nova.", "Resultado esperando você que ganha commit novo é revisado de novo sozinho, depois que o PR fica alguns minutos sem push. Antes só o seu clique destravava.", "A saída de cena vale só para o commit em que nasceu: commit novo traz o Farol de volta, a menos que a outra pessoa continue revisando."]],
  ['2.71.0', ["O card da fila mostra quem já está revisando o PR, e o botão vira \"Revisar junto\". Panorama e sessão em andamento também mostram. Se a pessoa já revisou, o card diz que a decisão é sua.", "Nova chave em Sistema > Automação, \"Revisar sozinho mesmo com outra pessoa revisando\", desligada por padrão. Ligada, o Farol revisa mesmo assim e não co-assina.", "Quando a assinatura do Claude bate no limite do plano, o card diz que a revisão automática recomeça sozinha no reset, em vez de ficar parado sem explicação."]],
  ['2.70.0', ["Nova chave em Sistema > Automação, \"Esperar o CI para aprovar\", desligada por padrão. Desligada, a aprovação automática sai assim que a revisão termina, mesmo com check obrigatório vermelho ou rodando, e o estado do CI fica como ressalva no card, nunca no PR. Ligada, o Farol espera a pipe fechar verde no mesmo commit, como antes.", "Aprovações que já estavam esperando o CI saem sozinhas depois de atualizar, conferindo de novo política, commit e reviews de pessoas. Quem quer manter a espera precisa ligar a chave."]],
  ['2.69.1', [
    "Pedir a revisão de novo volta a produzir revisão, mesmo sem commit novo: antes o Farol não revisava, não recusava e não avisava.",
  ]],
  ['2.69.0', ["Conta nova aprova e reprova sozinha por padrão (aprova com ou sem ressalvas e pede mudanças sozinha). Quem prefere revisar escolhe \"espera você\" nos seletores do cartão da conta, em Sistema > Contas.", "Reprovar sozinho não para mais por cobertura incompleta, divergência entre passadas ou contestação do autor: o bloqueio escrito vale por si, e o card registra o que a leitura não cobriu. Nada disso vai para o texto do PR.", "Contas que já existem não mudam: cada uma continua fazendo o que tinha gravado. Valor torto numa edição de conta é recusado em vez de virar ação automática."]],
  ['2.68.0', [
    "Nova chave em Sistema > Automação, \"Esperar o CI antes de revisar\", desligada por padrão. Ligada, a revisão automática só começa com todos os checks obrigatórios do PR verdes (o comportamento de antes); desligada, o Farol revisa assim que o PR chega.",
    "A aprovação continua esperando o CI nos dois casos: nunca aprova com check obrigatório vermelho ou rodando, e posta sozinho quando a pipe fecha verde no mesmo commit. O botão Revisar nunca esperou.",
    "Quem contava com a espera de antes precisa ligar a chave depois de atualizar."
  ]],
  ['2.67.0', [
    "CI obrigatório vermelho ou rodando virou espera automática: o Farol guarda a aprovação e aprova sozinho quando a pipe fecha verde no mesmo commit. Esses PRs têm seção própria, \"Esperando o CI (aprova sozinho)\", e saíram do \"Precisa de você\".",
    "Os outros aparelhos também sabem da espera: em Radar > Aparelhos o PR aparece em \"Esperando o CI (aprova sozinho)\", fora do \"pedem você\" e sem aviso de decisão pendente. Aparelho ainda na versão anterior continua mostrando como pendência comum até ser atualizado.",
    "A política de revisar e aprovar mora só na conta. As chaves gerais saíram de Sistema > Automação, e cada conta recebeu por extenso o que já fazia.",
    "\"Aprova sozinho\" tem só duas classes, sem ressalvas e com ressalvas. Discordância de outro review, leitura incompleta e dependência em aberto viraram ressalvas visíveis, e quem decide é o \"com ressalvas\" da conta.",
    "O card sempre diz por que um PR é \"com ressalvas\", inclusive quando falta o card do Jira, e diz qual conta mandou esperar, quando e de onde veio a configuração.",
    "Aparelho pausado pelo admin para de verdade: além da revisão, não classifica pushback nem aprova junto com quem pegou o PR.",
    "\"Revisões paralelas por conta\" é sempre por conta, e o total do aparelho é o \"Teto total deste aparelho\". Quem já compartilhava entre aparelhos mantém o total que tinha.",
    "PR que não pediu a sua revisão continua sem postar nada sozinho, e o Farol continua saindo de cena quando outra pessoa está revisando."
  ]],
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

export const RELEASE_NOTES = [...RELEASE_NOTES_RECENTES, ...NOTAS_ATE_2_59];

export default RELEASE_NOTES;
