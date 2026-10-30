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
  ['2.78.21', [
    'Autoanálise restrita pode selecionar explicitamente um perfil Codex só para a execução, sem mudar a associação global nem iniciar fallback.',
    'Codex recusa resultado com saída de processo malsucedida e preserva o consumo; diagnóstico restrito usa somente contagens e sinais fechados.',
    'Seleção preserva orçamento, reservas de cota e coordenação entre aparelhos.',
  ]],
  ['2.78.20', [
    'O confete da análise impecável volta a sair da tela depois de quatro segundos, mesmo com a hora do computador ajustada no meio da festa.',
    'O gate de pré-push passa a rodar também no Linux e no macOS: o hook estava versionado sem permissão de execução e o git o ignorava.',
  ]],
  ['2.78.19', [
    'Preparação restrita evita varreduras de quota por blob e mantém somente textos já ocultados em cache temporário limitado por execução.',
    'Reutilização preserva versão, caminho e política de template. Cancelamento e limites continuam impedindo resultados sem prova.',
  ]],
  ['2.78.18', [
    'Autoanálises restritas recebem representações com valores ocultos e deixam claro o que não foi lido, sem mudar o perfil ou abrir fontes sensíveis no fluxo normal.',
    'Patches ausentes usam versões verificadas. Templates públicos expõem somente chaves; contraprovas em arquivos com valores ocultos continuam inconclusivas.',
  ]],
  ['2.78.17', [
    'Depois de uma aprovação ou reprovação publicada, o mesmo commit não é revisado automaticamente de novo, mesmo quando alguém pede review outra vez. Outro commit libera nova análise.',
    'A leitura percorre o histórico paginado e a conferência final respeita qualquer parecer decisivo anterior da conta naquele commit.',
    'Uma reprovação pelo CI encerra aquele commit; o CI ficar verde depois, sem outro commit, não publica uma segunda review de aprovação.',
    'Uma tag residual da própria conta num head já decidido entra na limpeza durável, preservando sessões ativas e a posse de outro aparelho.',
    'Falhas sem parecer publicado continuam pendentes. A revisão manual explícita mantém seu caminho próprio.',
  ]],
  ['2.78.16', [
    'A API local oferece autoanálise restrita por execução, sem reconfigurar a conta ou interromper outras sessões.',
    'Claude e Codex recebem fontes fixadas; cobertura e contraprovas de leitura ficam separadas de testes executados e aprovação humana.',
  ]],
  ['2.78.15', [
    'Erros de formato e evidências da avaliação técnica voltam à própria conversa para correção, com a versão exigida fornecida pelo avaliador.',
    'Uma pendência nova permite uma segunda continuação na mesma sessão; erros repetidos encerram a tentativa. A aprovação continua bloqueada enquanto a análise for inconclusiva.',
    'Pendências preservadas retomam automaticamente pelo agendador após a atualização, respeitando sessões ativas, pausas e limites da conta.',
  ]],
  ['2.78.14', [
    'Análises e critérios incompletos ganham uma continuação dirigida na mesma conversa antes de outra rodada, com todos os gates de publicação preservados.',
    'O Codex recebe protocolo próprio para revisar sem depender do login do Claude; a avaliação técnica é executada pelo Farol com a configuração correta.',
    'Recuperações detectam cinco minutos sem progresso e preservam as pendências específicas. Análise incompleta continua sem aprovação habilitada.',
  ]],
  ['2.78.13', [
    'A orientação de escrita pede motivo, evidência e condição de liberação para cada bloqueio, no corpo e nos comentários inline.',
    'Sugestões são apresentadas como opcionais, preservando a classificação técnica e sem reescrever revisões já publicadas.',
  ]],
  ['2.78.12', [
    'Critérios publicados mantêm identidade, fonte e escopo entre rodadas e PRs do mesmo card confirmado; mudar classificação exige nova evidência e justificativa.',
    'Recomendações distinguem hipótese de solução validada, com prova da correção e de um comportamento preservado no commit atual.',
    'Decisões de produto exigem procedência no Jira: alegação no PR ou autoria de comentário não comprovam aceite de PO.',
    'Resultados inconsistentes não saem pelo automático, clique ou reenvio. A confirmação dos critérios publicados é local; registros antigos permanecem como contexto.',
  ]],
  ['2.78.11', ['Repositórios cuja declaração técnica diz que não têm testes de ponta a ponta ou componentes deixam de ter os PRs parados por "pasta que não existe"; os PRs que ficaram parados voltam a ser revisados sozinhos. Quando a pasta declarada tem outro problema, o card diz qual.']],
  ['2.78.10', ['Quando o Farol fecha no meio de uma busca de código, a marca de Git em andamento e a reserva de disco que ficaram para trás são recuperadas sozinhas, assim que o processo dono terminou e nenhum Git anterior continua em execução. Antes elas prendiam até 2 GB de folga e paravam a análise técnica de todos os repositórios.']],
  ['2.78.9', ['Quando a declaração técnica de um repositório cita uma pasta que não existe mais, o card diz quais pastas faltam e a revisão espera a declaração ser corrigida, em vez de falhar sem explicação, tentar de novo e virar ressalva genérica. Isso nunca vira pedido de mudanças no PR.']],
  ['2.78.8', ['A trava da quota de disco que fica para trás deixa de parar a análise técnica de todos os repositórios: ela nasce com o dono escrito e é retomada sozinha quando o próprio Farol a deixou, quando o computador reiniciou depois dela ou quando o processo dono já terminou.', 'Apagar a trava tenta de novo quando o Windows recusa por instantes, e a falha ao liberar as fontes registra o código da causa no log.']],
  ['2.78.7', ['Uma busca de código travada num repositório deixa de parar a análise técnica dos outros: só o repositório afetado espera, e a quota de disco desconta com folga o que o processo interrompido ainda pode gravar.']],
  ['2.78.6', ['A busca do código para a análise técnica traz só o que falta em vez do histórico inteiro, e repositórios grandes deixam de passar do limite de 2 minutos. A primeira busca de um cache vazio tem limite próprio de 10 minutos.', 'Uma busca interrompida por tempo esgotado deixa de travar o cache até reiniciar o Farol: a recuperação age assim que nenhum Git anterior à interrupção continua em execução.']],
  ['2.78.5', ['Revisões voltam a preparar o código quando o Farol encerrou no meio de uma operação Git sem o computador reiniciar, desde que o processo dono tenha terminado e nenhum Git anterior à interrupção continue em execução.', 'Na dúvida o cache continua bloqueado, preservando arquivos parciais e sessões em andamento.']],
  ['2.78.4', ['Atualizar agora baixa e verifica o instalador completo quando a versão exige outro Electron, sem abrir a página de downloads. O botão mostra a preparação, e sessões ativas continuam protegidas. Pacotes de macOS para Apple Silicon e Intel.']],
  ['2.78.3', ['Consumo separa operações concluídas, execuções e novas tentativas de reviews, autoanálises e outras atividades. Conclusão técnica não é confirmação de publicação no GitHub.', 'Filtros por período, conta, repositório, provedor, modelo principal e tipo, com histórico agrupado por operação e detalhes dos modelos participantes quando disponíveis.', 'Entrada, saída e cache separados. A modalidade de acesso vem da execução; registros antigos sem essa informação ficam desconhecidos. Dólares do CLI são referência, não cobrança confirmada.', 'IDs curtos antigos não permitem inferir conclusões ou retentativas. Atualizações renovam todos os indicadores; a troca de fonte limpa filtros incompatíveis, e Hoje também vale para o consolidado avançado.', 'Orçamentos e gráficos anteriores continuam nos detalhes avançados. A consulta reaproveita os dados existentes sem executar novas análises nem alterar os critérios das reviews.']],
  ['2.78.2', ['Reverificar saúde atualiza na hora a versão do Claude Code e o comparativo que informa o atraso, sem esperar seis horas nem reiniciar o Farol.', 'Consultas antigas não substituem o resultado novo. Falhas no registro são informadas sem mostrar um aviso referente a outra versão. As checagens automáticas mantêm o cache enquanto o CLI não muda.']],
  ['2.78.1', ['Revisões voltam a preparar o código quando uma operação Git interrompida antes do último reinício deixou o cache bloqueado, desde que os arquivos tenham sido liberados e não existam consumidores ativos.', 'A recuperação preserva arquivos parciais e sessões em andamento. A consulta ao sistema operacional permite que outras operações Git terminem durante a verificação do reinício.', 'Escritas de cache com tamanho conhecido evitam reservas excessivas sob I/O lento, mantendo os limites de quota.']],
  ['2.78.0', ['Sistema > Visão geral permite consultar um PR e remover individualmente suas tags conta:revisando, com confirmação e indicação da conta usada.', 'A remoção da tag não cancela a revisão. A mesma sessão local respeita a escolha, e uma revisão nova pode adicionar o marcador novamente.', 'Cancelamento, falha e reinício mantêm a limpeza pendente até o GitHub confirmar a remoção, inclusive quando a resposta da inclusão se perdeu. Pendências de várias contas são preservadas e não expiram após sete dias.', 'A limpeza automática respeita revisões vivas e a posse entre aparelhos para não apagar o marcador de outra execução.']],

  ['2.77.10', ['Achados, veredito e texto público precisam concordar: falha interna não justifica pedir mudanças em código sem defeito bloqueante.', 'Resultados contraditórios voltam para recuperação, inclusive quando existe um defeito real. Esgotar tentativas não libera a contradição nem aprova o PR.', 'Reprovações legítimas são preservadas. Voz e experimentos de otimização continuam desligados por padrão.']],
  ['2.77.9', ['Cards de decisão e histórico atualizam ao iniciar ou terminar uma revisão e ao mudar a fila de execução.', 'Falhas de presença não provocam reconexão a cada 10 segundos pelo relógio de andamento; tentativas respeitam a janela de cinco minutos sem simular presença saudável.', 'Exportação/importação das 45 preferências: valores iguais não aparecem como diferenças, o intervalo é comparado corretamente e contas coincidentes são preservadas. Exporte novamente para incluir preferências ausentes de arquivos antigos.', 'Voz e experimentos de otimização continuam desligados por padrão. Os ensaios de tokens não qualificaram as opções para ativação.']],
  ['2.77.8', ['O índice de código prioriza arquivos alterados e distribui as pistas entre símbolos, dependências e os dois commits, mantendo os limites e as omissões explícitas.', 'Os experimentos continuam desligados até comprovar qualidade e economia nas reviews reais. Voz permanece desligada por padrão.']],
  ['2.77.7', ['Preparação de otimizações de review com gate offline de qualidade: omissões conhecidas, falsos positivos e avaliação incompleta impedem considerar um piloto.', 'Orientação sintática, leituras agrupadas e responsabilidades por lote são experimentos desligados por padrão, sem ativação pela interface. Patches e critérios ficam preservados; economia de tokens e qualidade real ainda não foram comprovadas. Voz permanece desligada por padrão.']],
  ['2.77.6', ['Esperar o CI antes de revisar é reconferido na boca da sessão automática, preservando a retomada e as tentativas quando houver espera. A recuperação recebe as lacunas completas, e os cards distinguem espera e execução. Decisões e histórico não oferecem nova revisão do mesmo PR e conta enquanto ele está ativo.', 'A sincronização confirma presença sem esperar consultas longas ao GitHub. Falhas de rede continuam impedindo a admissão quando não há presença válida. Analisando agora só aparece com sessões; pedidos em espera continuam na fila. Voz e seleção de contexto permanecem desligadas por padrão.']],
  ['2.77.5', ['Uma revisão em andamento sai da fila de espera da mesma conta, incluindo os contadores e Revisar tudo. Pedidos de outra conta continuam visíveis; sem decisão ao terminar, o PR pode voltar à fila.']],
  ['2.77.4', [
    'Review e autoanálise reaproveitam fontes fixadas no PR, separadas por conta e repositório, com autorização reconferida.',
    'Mapa de JS, TS, JSX e TSX para investigar consumidores e contratos. A seleção de contexto continua desligada por padrão; relações não resolvidas ampliam a investigação e não provam ausência de impacto.',
    'Quota global configurável para o cache gerenciado, com reservas concorrentes e proteção de materiais ativos. Falta de espaço adia trabalho novo; legados não são apagados.',
    'Atualizações de tela agrupadas preservam foco, rascunhos e arquivos selecionados. Histórico de consumo e memória de rodadas reduzem trabalho repetido, mantendo confirmação de persistência.',
    'O motor externo, desenvolvimento e testes exigem Node 24 LTS, de 24.22.1 até antes de 25. O desktop mantém o Node do Electron e dispensa Node externo na instalação offline. Node 22 deixa o contrato sem alegação de correção do crash histórico.',
    'Electron 44.9.3 mitiga certificados TLS comprometidos. O desktop ainda depende de patch upstream para o DoS de fetch GHSA-xjj6-f33q-929c no Undici embarcado; o pacote npm atualizado não elimina essa limitação.',
    'A voz permanece desligada por padrão. O contexto opcional não dispensa os gates de revisão nem comprova ganhos de qualidade ou economia total de tokens.',
  ]],
  ["2.77.3", ["O consumo do Claude inclui os subagentes quando o CLI informa o total completo e atribui o uso aos modelos que participaram.", "Retomadas descontam o gasto anterior, inclusive após reiniciar. Interrupções e falhas com custo zerado preservam a indicação de custo desconhecido quando não há cursor confiável.", "Saída pública única preparada para avaliação, desligada por padrão. Esta versão não reduz modelo ou esforço, não ativa o piloto pago e não promete economia de tokens ainda não medida.", "Os padrões do time voltam a aparecer em Contas depois de fechar e abrir o Farol.", "Autoanálise no mesmo commit por clique explícito, com histórico preservado. Merge e autoanálise respeitam a posse entre aparelhos e o commit conferido."]],
  ['2.77.2', ["Especialistas, auditorias, cotas e preferências seguem os cartões, espaçamentos e controles do Farol, com detalhes técnicos recolhíveis e adaptação a telas estreitas.","Intervenções ficam agrupadas e recolhidas no Radar, com as ações existentes, sem um aviso sobreposto por pendência.","As opções de voz aparecem apenas quando ativadas; a voz continua desligada por padrão. O roteiro de configuração e a importação preservam seus limites e confirmações."]],
  ['2.77.1', ['Escolha review automático ou manual por organização e autor em Sistema > Contas. Sem regra nova, suas configurações atuais continuam valendo.', 'Regras manuais também impedem retentativas e novas rodadas automáticas, inclusive fora das organizações do panorama. Revisar por clique continua disponível.', 'Remover uma exceção restaura a herança. As regras de aprovação e pedido de mudanças permanecem independentes.']],
  ['2.77.0', ['Especialistas por repositório e auditorias independentes, com comparação entre análises, avaliação humana e amostragem por risco; lições exigem curadoria antes de entrar em uso.', 'Cobertura verificável do diff completo e memória imutável entre rodadas, distinguindo análise concluída de publicação confirmada.', 'Pendências agrupadas com menos avisos repetidos. A voz continua desligada por padrão e importar preferências não a ativa.', 'Cota do Antigravity vinculada à conta e à leitura recente, com reservas configuráveis. Provedores sem medição confiável não recebem percentual inventado.', 'Filas agrupadas e recolhíveis, progresso baseado na execução, configuração retomável e importação de preferências com prévia, sem credenciais nem políticas.', 'Auditorias recuperam bloqueios de processos encerrados e mostram somente o trabalho ativo como em execução. Falhas na memória remota permanecem visíveis; consumo após fallback pertence ao perfil que executou.']],
  ['2.76.8', [
    'A fila mostra a posição de entrada e o motivo efetivo da espera, incluindo os limites de execução e a falta de memória.',
    'Configurações de ferramentas, como eslint.config.mjs, deixam de bloquear a aprovação por falta de chamadores. A leitura do diff e os demais gates continuam obrigatórios.',
    'Esperas registradas antes desta correção são reavaliadas sob as novas regras de evidência.',
  ]],
  ['2.76.7', ['O orçamento do perfil diz a diferença entre vazio e 0: campo vazio é sem teto, e 0 pausa a revisão automática do perfil (o clique manual continua valendo). Com teto 0 valendo hoje, a linha do gasto diz que a revisão automática está pausada e de onde vem o 0.', 'O botão Revisar funciona com o orçamento do perfil estourado; antes, o PR estacionado por orçamento estacionava de novo a cada clique.']],
  ['2.76.6', ['Silenciar bloqueia novos trabalhos e permite que revisões em andamento concluam e publiquem pela conta original, inclusive após a espera do CI ou um reenvio no mesmo commit.']],
  ['2.76.5', ['Revisões com progresso seguem além de 30 minutos, até duas horas; sem progresso, param em 30 minutos. A regra vale para Claude Code, Codex e Antigravity.', 'Timeouts preservam a conversa do Codex e do Antigravity para continuar a revisão. O sinal entre executores acompanha o novo prazo.', 'Cota recuperada do Antigravity libera o bloqueio antigo com leitura recente e conta confirmada.']],
  ['2.76.4', ['A leitura da cota do Antigravity não abre consultas duplicadas quando resolve a ordem dos perfis, evitando recursão e esgotamento de processos.', 'Quando a hospedagem recusa temporariamente a criação do processo (EAGAIN), a revisão volta à fila e tenta de novo.']],
  ['2.76.3', ['O login do Antigravity pela tela funciona no Linux, sem eco do código de autorização nem transcrição em disco. Cancelar encerra também o CLI, e a recusa do código continua sendo falha.', 'Com o Farol atrás de um login (como o portão do Google no servidor), a sessão desse login vencida recarrega a página e leva ao login, em vez de pedir um pareamento do navegador que não resolve.']],
  ['2.76.2', ['Login OAuth expirado também aciona o fallback: a revisão segue automaticamente no próximo perfil ligado e disponível, inclusive de outro provedor.', 'O perfil vencido aparece como sem login. Sem alternativa, a revisão para sem entrar em loop; contas com perfil próprio continuam isoladas. A troca não reutiliza a sessão do perfil anterior.', 'A reinstalação no macOS prepara o aplicativo inteiro antes de trocar a versão instalada, e uma falha na troca ou no registro restaura a anterior, preservando configuração, histórico e prompts pessoais.']],
  ['2.76.1', ['Removido o teto diário interno de quantidade de reviews, inclusive na reserva entre aparelhos. Esperas antigas desse limite não seguram a fila.', 'Corrigida a execução dos testes de sessão no Windows quando o Bash do WSL aparece antes do Git Bash. Limites externos da assinatura continuam separados.']],
  ['2.76.0', ['O Antigravity (agy) entra como provedor de revisão: em Plano e chaves, adicione um perfil por conta Google e faça o login pela tela, também no Farol em servidor.', 'A cota de cada conta é lida antes da revisão, sem gastar nada; conta esgotada fica fora até o reset e a revisão segue no próximo perfil da ordem de uso.', 'A revisão no Antigravity usa o Gemini 3.8 Flash (High) sem subagente, e a cota de cada perfil aparece ao vivo com a hora do reset.']],
  ['2.75.1', ['O endereço de cada tela é um caminho de página, sem o /#/ (por exemplo /radar/pra-mim). Link antigo com /#/ continua funcionando e é trocado pelo caminho novo.', 'Um Farol novo configurado no arquivo para não revisar sozinho não nasce mais com a conta revisando e aprovando sozinha.']],
  ['2.75.0', ['Em Sistema > Plano e chaves, a ordem de uso dos perfis: o primeiro ligado paga as revisões, e quando ele chega ao limite do plano o Farol segue para o próximo sozinho e volta ao primeiro depois do reset.', 'Cada perfil mostra o estado ao vivo (em uso, no limite até a hora do reset, sem login). Com todos no limite, as revisões esperam o primeiro reset sem estacionar nenhum PR.', 'O modelo e o esforço de cada provedor ficam em Plano e chaves, ao lado da ordem de uso.']],
  ['2.74.0', ['O login padrão da máquina aparece em Plano e chaves como perfil com nome próprio, e pode ser escolhido como padrão, numa conta do GitHub ou num grupo de consumo, sem mudar como a sessão entra.', 'Sem terminal para abrir, como no Farol em servidor, o login de um perfil se faz pela tela: abra a página de login da Anthropic e cole aqui o código que ela mostrar.', 'No Windows, a limpeza presa do material temporário da revisão técnica não estaciona mais o PR.']],
  ['2.73.2', ['O endereço da página reflete a tela (aba, aparelho, seção, filtros e revisão aberta): voltar, avançar e abrir um link levam à mesma tela.', 'Com a conta configurada para aprovar ou reprovar sozinha, o Farol decide sozinho: revisão mandada por você (Panorama, link, admin, comandos, fila compartilhada) segue a configuração da conta.', 'Defeito técnico confirmado, a parte do card deste PR não entregue e CI obrigatório vermelho viram pedido de mudanças quando a conta reprova sozinha; a aprovação sai quando o CI fechar verde no mesmo commit.', 'Duas aprovações de pessoas dispensam a aprovação automática, pedido de mudanças de uma pessoa não segura a revisão, PR da própria conta recebe a revisão como comentário e revisão incompleta é refeita sozinha.', 'Repositório sem declaração técnica e prova que faltou depois das duas tentativas voltam a ser ressalva; a configuração da conta decide.', 'Precisa de você fica para a configuração que pede você e para falhas de postagem, sempre com o motivo.']],
  ['2.73.1', ['Em Radar > Aparelhos, solicite um diagnóstico remoto das contas, da fila e das retomadas. A coleta compara o login autenticado com a conta pretendida, chega cifrada e expira em cinco minutos. Não envia tokens nem permite acesso ao terminal do aparelho.', "Uma mudança no histórico de reviews retoma a análise, mesmo após reinício ou tentativa de postagem esgotada.", "Aprovar respeita a reconferência no card, na paleta de comandos e nos outros aparelhos.", "Uma revisão em andamento substitui a decisão antiga, sem deixar outra pendência órfã."]],
  ['2.72.11', ['A análise técnica se recupera automaticamente após falhas, com intervalos crescentes e sem dispensar provas.', 'Pendências antigas e execuções interrompidas são retomadas; o card mostra a próxima tentativa ou o impedimento real do ambiente.', 'A janela do Windows usa identidade, ícone e reabertura próprios para evitar agrupamento com outros aplicativos.', 'O macOS recebe um aplicativo com executável, ícone e menus próprios, preservando dados e configurações.']],
  ['2.72.9', ['O card explica quando a revisão automática está desativada para a conta neste aparelho e indica como iniciar manualmente.', 'Recusas técnicas dos comandos do Admin mostram o motivo e o próximo passo, preservando a exigência de prova técnica para aprovar. Recibos antigos recebem uma orientação geral.']],
  ['2.72.8', ['A aprovação exige avaliação técnica completa, mesmo com aprovação automática configurada.', 'Falta de cadastro ou de prova não vira ressalva após novas tentativas. O botão Aprovar e a publicação permanecem bloqueados até a comprovação.']],
  ['2.72.7', ['A fila compartilhada mostra a conta que precisa assinar cada revisão e avisa quando ela não está autenticada neste aparelho.', 'A falta de credencial deixa de ficar escondida atrás de "não publicou este candidato" ao escolher onde começar.', 'A contagem mostra quantos aparelhos se ofereceram, sem prometer vaga disponível. Não muda a identidade de quem revisa, não copia credenciais e não interrompe as reviews em andamento.']],
  ['2.72.6', ['Com a aprovação automática ligada, PR aprovável com prova incompleta não espera mais o PR mudar: o Farol revisa de novo o mesmo commit na hora, até duas vezes, e o card mostra "Buscando a prova (tentativa 1 de 2)".', 'Depois das duas tentativas, o que faltar vira ressalva e a sua configuração de ressalvas decide. CI vermelho ou rodando, violação técnica e a parte do card deste PR não entregue continuam bloqueando.', 'PR aberto pela própria conta que revisa vai para Precisa de você, dizendo que outra pessoa precisa aprovar, em vez de esperar para sempre.', 'Esperas criadas antes de uma mudança de regra são revistas uma vez com as regras atuais.']],
  ['2.72.5', ['Sem teto de rodadas automáticas por dia: o PR que precisa de revisão hoje não espera mais o dia seguinte por ter passado de três rodadas entre os seus aparelhos.', 'Contra laço continuam valendo a revisão única por commit e a espera de o PR ficar quieto.', 'Repositório sem declaração técnica cadastrada vira ressalva, não bloqueio: a aprovação automática volta a sair, ainda exigindo leitura completa e checks obrigatórios verdes no commit.']],
  ['2.72.4', ['O PR que entrega a parte dele de um card dividido entre vários repositórios volta a ser aprovado sozinho: o que falta nos PRs irmãos e a dependência em aberto viram ressalva, e a sua configuração de ressalvas decide.', 'Continua bloqueando: a revisão dizer que a parte do card deste PR não foi entregue, CI vermelho ou rodando, violação técnica e lacuna na leitura.']],
  ['2.72.3', ['Com a aprovação automática ligada, PR aprovável sem a prova técnica completa deixa de esperar o seu clique: nada é aprovado sem a prova, e o Farol revisa de novo sozinho quando o PR muda.', 'Quando o que faltou é da própria revisão, o Farol revisa de novo sozinho até duas vezes no mesmo commit, e depois espera o PR mudar, sem pedir você.']],
  ['2.72.2', ['A aprovação exige critérios técnicos e provas atuais antes da política da conta.', 'Clique, reenvio, endosso e espera de CI passam pela mesma conferência; checks obrigatórios não podem ser dispensados.', 'A revisão distingue bloqueio técnico, verificação pendente e conformidade, com material isolado e cadastro privado por repositório.']],
  ['2.72.1', ['Corrige o erro ao abrir Ver ao vivo pelo navegador.', 'Linhas longas continuam válidas depois de ocultar credenciais, incluindo chaves em JSON, AWS, GitLab e Slack.', 'Fechar a observação retira o pedido no próximo ciclo, com nova tentativa quando a rede falha.']],
  ['2.72.0', ["Padrões do time por conta: em Sistema > Contas, escreva o que o time combinou, e a revisão daquela conta aponta como sugestão o que se afasta deles, citando o padrão e propondo a forma que o segue.", "A revisão passa a ler as regras que o próprio repositório declara (CLAUDE.md, AGENTS.md, CONTRIBUTING e ADRs) e cita qual regra embasou cada cobrança.", "Os dois entram como dado, nunca como instrução: não mudam o protocolo, os critérios para aprovar sozinho nem a política da conta.", "Ver ao vivo acompanha as últimas 120 linhas da sessão local, incluindo mensagens, ferramentas, horários, etapas e agentes, com cifra exclusiva do observador e aviso de sinal vencido.", "A fila remota inclui autoanálises e preserva sessões simultâneas do mesmo PR. A admissão volta a avaliar a fila após restrições temporárias.", "O aviso de privacidade explica o conteúdo cifrado compartilhado e o espelho sob demanda."]],
  ['2.71.18', ["Rodar os testes do Farol deixa de abrir terminais vazios no Windows. O teste de encerramento de sessão verifica a limpeza e o retorno dos PRs à fila sem abrir uma janela real."]],
  ['2.71.17', ["Com o aparelho pausado pelo admin, o Revisar agora fica desligado e diz que é preciso Retomar antes, em vez de aceitar o pedido e parar calado.", "O Diagnóstico separa a recusa do update automático da busca sem resposta, e não mostra mais o aviso de Git Bash fora do Windows.", "Com a mesma conta em vários aparelhos, cada um fica com a sua parte do limite de busca do GitHub, sem estourar o limite de rajada.", "A revisão passa a ler corretamente um PR de outro repositório citado como dependência."]],
  ['2.71.16', ["Uma organização que a conta não consegue buscar deixa de esconder do admin os PRs pedidos a essa conta: eles voltam a aparecer na fila do aparelho, com o botão Revisar agora.", "O aviso de organização sem acesso sai uma vez no log, e não mais a cada ciclo."]],
  ['2.71.15', ["O Farol que roda só o motor, sem a janela (no celular pelo Termux ou num servidor), passa a se atualizar sozinho: troca os próprios arquivos e reinicia, sem instalação à mão.", "O painel do aparelho compara a versão dele com a última release e avisa quando ele está atrasado, em vez de dizer sempre que está em dia."]],
  ['2.71.14', ["Os PRs pedidos a uma conta que não monitora nenhuma organização no aparelho dela passam a aparecer no controle do aparelho, com o botão Revisar agora. Antes o admin não via esses PRs na fila do outro aparelho."]],
  ['2.71.13', ["Cancelar uma revisão agora pede confirmação e funciona também na preparação e nas verificações finais, antes do envio ao GitHub. Confirmar devolve o PR à fila sem relançar sozinho; Continuar sessão ou Escape mantém a análise.", "Falhas no cancelamento aparecem na tela e permitem tentar novamente. Quando o envio do review já começou, o botão fica indisponível e pedidos atrasados são recusados."]],
  ['2.71.12', ["PRs que pediram sua revisão continuam visíveis no Radar enquanto aguardam distribuição ou uma vaga de execução. O card mostra esse estado sem oferecer um segundo disparo da revisão."]],
  ['2.71.11', ["O aviso de PR em conflito ou superado pela base ganhou desenho próprio em Meus PRs: barra âmbar e selo no card, uma linha com o que fazer no conflito e, no superado, como o Farol conferiu, a lista de arquivos e o botão Fechar no GitHub.", "Quando a leitura do GitHub falha, o último aviso fica no card com há quanto tempo ele foi visto e o motivo.", "O aviso no app leva até o card pelo botão Ver em Meus PRs, e vários PRs ao abrir o app saem num aviso só.", "Clicar na notificação de um PR seu agora leva ao card dele em Meus PRs."]],
  ['2.71.10', ["Meus PRs avisa, sem esperar o clique na autoanálise, quando um PR seu entra em conflito com a base ou quando a base já tem tudo o que ele muda: o card ganha uma linha e o aviso sai uma vez por PR e commit, no app e como notificação.", "O Farol só diz que um PR foi superado depois de conferir no código que a base tem o mesmo conteúdo, ou as mesmas linhas, de tudo o que o PR muda.", "A etiqueta de revisão em andamento sai do PR mesmo quando a remoção falha no fim da revisão: o Farol tenta de novo a cada ciclo, em vez de deixá-la presa até a próxima revisão."]],
  ['2.71.9', ["A barra das revisões em andamento volta a ter porcentagem, calculada pelo tempo que revisões de PR de tamanho parecido costumam levar no seu Farol, e mostra quanto falta. Ela não para mais em 90% para depois pular para 100%.", "Na autoanálise dos seus PRs, a barra segue os arquivos lidos.", "No lugar da barra que ia e voltava, um ponto discreto pisca a cada ação da sessão e fica âmbar quando ela fica sem sinal."]],
  ['2.71.8', ["Com duas contas na mesma organização, o Farol passou a agir com a conta ativa, e não com a silenciada: antes, se a silenciada aparecia primeiro na lista, revisão por link, chat do PR e o painel da organização saíam com a identidade dela.", "Conta silenciada não escreve mais no GitHub, nem pelo clique: revisar, postar decisão, conversar, pedir reviewers e mergear recusam com o aviso \"conta X está silenciada e não age; reative a conta ou use outra\". Ela continua monitorada como antes."]],
  ['2.71.7', ["Manutenção: os testes automáticos do Farol deixaram de gravar no ~/.claude.json da máquina, a configuração do Claude Code. Nada muda no uso do app."]],
  ['2.71.6', ["O instalador do Windows deixou de misturar arquivos de duas versões do Electron ao instalar por cima de uma versão anterior: o Electron novo é copiado inteiro e só substitui o antigo no fim.", "Quem instalou o Setup da v2.71.5 por cima de uma versão anterior pode instalar o Setup desta versão para corrigir. A atualização automática não troca o Electron."]],
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
