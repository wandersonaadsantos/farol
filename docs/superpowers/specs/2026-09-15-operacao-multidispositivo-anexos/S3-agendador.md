# Anexo S3: agendador, degradação e contraprovas

**Natureza:** anexo **normativo** da spec `../2026-09-15-operacao-multidispositivo-design.md`, gerado a partir de `../../handoff/2026-09-15-operacao-multidispositivo/evidencias/03-s3-agendador-capacidade-completo.json` (campo `sintese`).

**Precedência:** a spec prevalece sobre este anexo. Cada seção lista, no topo, os trechos superados por decisões posteriores do dono. Campos inteiramente superados (decisões apresentadas, cortes, resumo, enxertos, recomendações não adotadas) **não** foram trazidos para cá e continuam só como histórico na evidência.

---

## Dono de cada estado (`quem_e_dono_de_cada_estado`)

> **Trechos superados neste campo, que NÃO valem.** Onde o texto abaixo divergir destes itens, vale a spec.
>
> - "Vaga e ocupação por aparelho: derivada, nunca declarada, dos leases vivos": substituído pelo resumo da admissão local (CT-ADM) com reserva, fila e execução, e pela ocupação provisória de atribuição (CT-PRONT). Leases ficam como verificação cruzada e para aparelho em versão antiga.
> - "Teto de orçamento por perfil ... profileTag": substituído por CT-GRUPO (grupo explícito, configurar na C2, ativar na C4b).
> - "Pendências ... EXCEÇÃO DECLARADA, e é risco aberto: a co-assinatura": fechado por CT-POST e C0b.
> - "Teto de simultâneas POR APARELHO": a contagem inclui todas as execuções de IA geridas pelo Farol (S3-6, CT-ADM).

- **estado:** Descoberta (panorama, fila mine, labels, refs, PRs meus)
- **dono_com_admin_online:** Coletor local de cada conta, sem mudança (server.js:904-1026). O admin só lê a união.
- **dono_com_admin_fora:** Idêntico.
- **na_virada:** Idêntico. Descoberta nunca troca de dono em nenhum cenário.

- **estado:** Candidatura (quais PRs passam nos filtros síncronos e no gate de consciência)
- **dono_com_admin_online:** Coletor local (server.js:1140-1174 e lib/engine/review.js:288-293). Publica ponteiro, nunca PR.
- **dono_com_admin_fora:** Coletor local, que enfileira ele mesmo, como hoje.
- **na_virada:** Coletor local nos dois casos. A virada não reavalia candidatura publicada: ela caduca por TTL e é republicada no ciclo seguinte.

- **estado:** Ordem da fila (rodízio por org, seq monotônico)
- **dono_com_admin_online:** Admin, sobre a união, com a mesma função de lib/engine/review.js:487-501 recebendo orgTag já resolvido.
- **dono_com_admin_fora:** Cada aparelho sobre a fila dele, exatamente como hoje (lib/engine/review.js:508-534).
- **na_virada:** Admin recomeça com orgLastStart VAZIO, e isso é aceitável: org nunca atendida vale -Infinity e fura a fila (lib/engine/review.js:494-497), então o pior caso é uma org já atendida ser servida uma vez a mais. Persistir esse mapa continua proibido pelo motivo já escrito em server.js:256-268.

- **estado:** Colocação (qual aparelho executa)
- **dono_com_admin_online:** Admin, e só ele. Único estado que hoje não existe em lugar nenhum.
- **dono_com_admin_fora:** Não existe: quem coletou executa, que é o comportamento de hoje.
- **na_virada:** O admin só coloca o que ainda não entrou em fila local nem tem lease vivo. O que já está na headlessQueue drena ali mesmo.

- **estado:** Vaga e ocupação por aparelho
- **dono_com_admin_online:** Derivada, nunca declarada: leases vivos daquele deviceId (lib/sync/lease.js:41-45 carrega deviceId, operationKind e expiresAt; o stream já traz a árvore em lib/engine/sync-stream.js:212) mais as atribuições pendentes ainda dentro do TTL. Reconstruível depois de reinício do admin, porque as duas fontes vivem no banco.
- **dono_com_admin_fora:** Contagem local de sempre (headlessBusyAccounts, lib/engine/review.js:467-471).
- **na_virada:** Admin reconta pelas duas fontes, sem tocar no que roda.

- **estado:** Teto de simultâneas POR APARELHO e habilitado/pausado
- **dono_com_admin_online:** Admin escreve a política; o aparelho só aplica com config.sync.aceitarAdmin local. O ENFORCEMENT é local e novo: hoje parallelLimit é por CONTA (lib/engine/review.js:426-429) e globalParallelLimit nasce desligado devolvendo Infinity (lib/engine/review.js:460-465), então três atribuições de três contas passariam juntas no celular. Entra um clamp próprio por aparelho em processHeadless, ao lado do teto por conta.
- **dono_com_admin_fora:** Config local, com o mesmo clamp por aparelho.
- **na_virada:** A política remota volta a valer no primeiro batimento válido; o clamp local nunca sai do caminho.

- **estado:** Teto de orçamento por perfil (único do conjunto)
- **dono_com_admin_online:** O valor é do admin; a CONTA é feita em cada aparelho, com a mesma função pura profileBudgetStatus (lib/engine/usage.js:469-490) recebendo um store do conjunto. O único ponto de composição é budgetStatusFor (lib/engine/usage.js:498-500). Pré-requisito declarado: identidade de perfil entre aparelhos, que hoje NÃO existe (genProfileId em ui/app.js:574-576 é aleatório por máquina e é esse id que vai para byProfileDay em lib/engine/usage.js:239-242 e para o evento em lib/sync/outbox.js:84).
- **dono_com_admin_fora:** Store do CONJUNTO continua valendo enquanto o BANCO estiver de pé. Store local puro só quando o banco cai, que é o comportamento de hoje.
- **na_virada:** Nenhuma: o teto depende do banco, nunca do agendador. Confundir os dois devolveria a cada aparelho o teto inteiro justamente quando ninguém está olhando.

- **estado:** Freio de republicação (hoje state/seen)
- **dono_com_admin_online:** Continua local (server.js:584-590), mas deixa de ser o freio: o freio é a existência de candidato vivo, atribuição ou lease para aquele par (prHash, head). O seen volta a significar só 'lancei aqui'. O recibo já marca visto hoje (lib/sync/coordinator.js:78-89) e cobre 'terminou em outro aparelho'.
- **dono_com_admin_fora:** Volta a ser o freio de sempre.
- **na_virada:** Os dois convivem, porque o remoto é mais restritivo.

- **estado:** Estacionamento (falhou aqui, por quê)
- **dono_com_admin_online:** Local e só local, sem campo novo no candidato. O aparelho que estacionou nem publica aquele PR, porque server.js:1145 o corta do toReview antes de qualquer lançamento. Se outro aparelho tem a conta, ele publica e recebe a colocação; se ninguém mais tem, o PR espera ação manual, que é o que estacionar significa hoje.
- **dono_com_admin_fora:** Idêntico.
- **na_virada:** Idêntico.

- **estado:** Retomada (sid, checkpoint, prova por arquivo, escopo materializado) e repesca do retry
- **dono_com_admin_online:** Sempre do aparelho que rodou, e FORA da distribuição: item com retomarSid enfileira local como o clique. O sid só vale na máquina que abriu a sessão (lib/engine/review.js:1080-1087) e o consumo é destrutivo (lib/engine/review.js:347-354), então publicar antes de consumir perderia a retomada em silêncio e publicar depois a jogaria fora.
- **dono_com_admin_fora:** Aparelho que rodou, como hoje (server.js:1195-1243).
- **na_virada:** Idem. Reatribuir para outro aparelho não está neste corte.

- **estado:** Âncora do round automático e teto de 3 rodadas por dia
- **dono_com_admin_online:** Com distribuição ligada, o teto do dia fica EXCLUSIVAMENTE na reserva remota, que já existe e já é consumida na admissão (lib/sync/rounds.js:86 e lib/sync/coordinator.js:154-163, com o mesmo número que lib/engine/review.js:1607 repete). A âncora local some do caminho automático distribuído, e quem impede republicação é o candidato vivo mais o recibo. Assim ninguém precisa escrever no disco de outro aparelho, e a regra 'âncora só se grava depois de o trabalho acontecer' é respeitada pela reserva, que só é consumida quando a sessão de fato começa.
- **dono_com_admin_fora:** Âncora local com dia e rodadas, queimada no relançamento, exatamente como hoje (lib/engine/review.js:1929).
- **na_virada:** Sem efeito: a reserva é consumida uma vez só, na admissão.

- **estado:** Pendências, payload, motivo, postRetry e a POSTAGEM
- **dono_com_admin_online:** Sempre e só do aparelho dono do decisions.json (lib/engine/decision.js:18-80 e 310-388). O agendador nunca atribui postagem, porque o dedup de postagem é por processo (lib/engine/decision.js:680-710).
- **dono_com_admin_fora:** Idêntico.
- **na_virada:** Idêntico. EXCEÇÃO DECLARADA, e é risco aberto: a co-assinatura (lib/engine/skip-review.js:422-434) posta APPROVE sem sessão, sem lease e sem pendência, e roda a cada ciclo em todo aparelho com a mesma conta. Ela não está coberta por este modelo.

- **estado:** Lease, recibo, rodadas do dia, label de revisando
- **dono_com_admin_online:** Compartilhados como hoje, sem uma linha de mudança. O lease é a autoridade final e a atribuição nunca o substitui.
- **dono_com_admin_fora:** Idêntico.
- **na_virada:** Idêntico, e é por isso que a virada é segura sem protocolo de handover.

---

## Ciclo de atribuição (`ciclo_de_atribuicao`)

> **Trechos superados neste campo, que NÃO valem.** Onde o texto abaixo divergir destes itens, vale a spec.
>
> - Passo 2, candidato com `head` em claro: o head vai como `tag('mat', head)` e o nome do owner cifrado (S3-4, 7.C5).
> - Passo 7, lista de recusas: vale com a reavaliação por mudança de causa de CT-PRONT, não por HEAD novo.
> - Atribuição recusada, expirada ou não iniciada: libera a ocupação provisória e devolve o candidato à elegibilidade (spec 9.1).

1. PUBLICAR. Em enqueueHeadless (lib/engine/review.js:368), com distribuição ligada, batimento vivo, pr.manual falso e pr.retomarSid ausente, o item não entra na headlessQueue: vira candidato num canal PRÓPRIO (não a outbox de consumo, que é append-only de eventos imutáveis com pausa por conexão, lib/sync/outbox.js:21-27, e cujo flush só roda no tick, lib/engine/sync.js:355-374). O PR fica VISÍVEL como "esperando distribuição", pela lição do estacionamento visível da v2.57.4.

2. CANDIDATO É PONTEIRO. {itemId, prHash, acctTag, orgTag, head, isDraft, rodadaAutomatica, publishedAt, ttl}. Não viaja requested (rederivado no executor), não viaja parkedAqui (campo morto: server.js:1145 corta o PR estacionado antes de qualquer lançamento), não viaja peso, não viaja texto legível de PR.

3. FUNDIR. Candidatos do mesmo par (prHash, head) de aparelhos diferentes são UM item com N publicadores, e os publicadores são os executores possíveis.

4. ESCOLHER QUAL. Mesma função de hoje, pura, sobre a união: rodízio por org com contador monotônico (lib/engine/review.js:487-501). O predicado de elegibilidade passa de "conta abaixo do teto" para "existe aparelho apto com vaga", o que preserva o break do laço e mantém a política work-conserving: se existe item colocável, ele sai.

5. ESCOLHER ONDE. Puro: filtra publicadores habilitados, não pausados, com vaga no teto do APARELHO, aptos pelos requisitos duros, e que não tenham recusado este item neste head dentro da janela de espera. Ordena por prioridade (menor vence) e depois por folga relativa. Nenhum apto: o item FICA na fila com motivo legível e o laço tenta o próximo, nunca trava a fila.

6. ATRIBUIR. Escrita assinada com TTL curto (2 batimentos, 240 s). Atribuição pendente OCUPA VAGA até virar lease ou caducar, e é isso que fecha a janela em que o executor já está medindo o PR e ainda não pegou lease (a medição inteira roda antes do spawn, lib/engine/review.js:1188-1254, e o lease só nasce em lib/engine/session.js:802).

7. ACEITAR, RECUSAR OU EXECUTAR. O executor confere aceitarAdmin local, assinatura, geração, batimento vivo, head inalterado e token da conta. Recusa é EXPLÍCITA, com código e com o instante de fim da espera quando houver: sem isso, um fato local invisível ao admin (saída de cena registrada, que hoje descarta em silêncio no return mudo de lib/engine/review.js:390) vira laço de recolocação a cada 240 s sem nada na tela. Códigos previstos: saida_de_cena, sem_token, head_mudou, orcamento, sem_vaga, inapto. O NACK de orçamento carrega a espera até a virada do dia, que o app já sabe calcular (lib/engine/sync.js:486-492).

8. EXECUTAR. enqueueHeadless pelo ramo local, e daí em diante o caminho é byte a byte o de hoje, incluindo a admissão por lease e a releitura do head dentro da sessão.

9. FECHAR E LIMPAR. Recibo, liberação do lease e remoção do item na conclusão (executor). O agendador apaga item cuja atribuição caducou sem lease, item sem publicador vivo e item cujo head deixou de ser publicado por alguém; a faxina diária que já existe no syncTick pega o resto. Head novo cria item novo (a chave inclui o head), então o antigo tem que ter dono de remoção, senão live/queue acumula lixo a cada push.

PRECEDÊNCIA DA ESPERA. A espera anotada pela coordenação (lib/engine/review.js:113-121 e lib/engine/sync.js:467-476) é hoje o único backoff que existe, e ela é lida só por toReview, reReviewTargets e retryTargets, ou seja, fora do caminho da atribuição. No desenho final, o NACK carrega a espera ao agendador e o agendador a respeita: sem isso o mesmo aparelho pagaria a medição inteira do PR a cada 240 s para ouvir a mesma recusa enquanto a sessão alheia dura 30 minutos.

ORDEM NO CICLO. A publicação é escrita PRÓPRIA no ato da criação do candidato, não carona no syncTick: hoje _dispararAutomacoes roda em server.js:854 e syncTick em server.js:862, mas launchReReviews só roda em server.js:869, DEPOIS da carona, então o round 2 pós-push perderia um ciclo inteiro (de 180 s a 3600 s), que é exatamente o que ele existe para não perder.

---

## Degradação e volta (`degradacao_e_volta`)

> **Trechos superados neste campo, que NÃO valem.** Onde o texto abaixo divergir destes itens, vale a spec.
>
> - "GATILHO, MEDIDO SEM COMPARAR RELÓGIOS": vale, com o complemento de CT-ADM-POL (snapshot inicial, keep-alive e reentrega não renovam; sequência persistida).
> - "VOLTA DO ADMIN. Ele monta a ocupação a partir dos leases vivos": substituído pela recuperação com o resumo da admissão local (CT-PRONT).
> - "admin fora" passa a significar "prontidão do distribuidor indisponível" para a distribuição, e "autoridade indisponível" para as políticas.

DUAS COISAS DIFERENTES, e confundi-las quebra a decisão do dono. (a) BANCO FORA: seguraAutomacao (lib/engine/sync.js:467-476) segura toda a automação enquanto o status não é CONECTADO, inclusive em conectando. Continua igual e é certo, porque sem banco não há lease e rodar seria duplicar. (b) ADMIN FORA com banco de pé: a distribuição desliga e a revisão automática local coordenada por lease VOLTA. O gate novo nunca herda o fail-closed de (a). A mesma separação vale para o orçamento: o store do conjunto depende do BANCO, nunca do admin.

GATILHO, MEDIDO SEM COMPARAR RELÓGIOS. Não usar beatAt mais 360 s contra o relógio local corrigido por skew: skewMs só é reescrito em touchPresence, que roda dentro do tick e no máximo a cada 5 minutos (lib/engine/sync.js:296 e 334-338), então um ajuste de NTP ou uma suspensão do Android deixa o desvio velho, e esse único número decide se a automação inteira roda. O vencimento usa o padrão que o app já aplica à label alheia: há quanto tempo EU vejo o MESMO valor de batimento, carimbado com o relógio local a cada leitura (lib/engine/skip-review.js:147-152 e 174-205). Isso compara o relógio local com ele mesmo e tira a comparação entre relógios do caminho crítico. Assinatura inválida, geração divergente ou chave desconhecida contam como vencido na hora.

"NA HORA", DE VERDADE. O ciclo vai de 180 s a 3600 s (server.js:1247-1253), então esperar o próximo check() não é na hora. A volta usa um relógio de 30 s no seguidor, o mesmo intervalo do heartbeat que já existe (lib/sync/coordinator.js:353-355). Ao vencer, o seguidor vira a chave local e recalcula o toReview sobre a this.queue JÁ COLETADA, sem nenhuma BUSCA nova no GitHub (o gate de consciência dos elegíveis ainda custa gh, e isso precisa ser dito assim, não como "sem chamada nenhuma").

DUAS GUARDAS OBRIGATÓRIAS NESSA VOLTA. Primeira: o recálculo não pode entrar em concorrência com o ciclo. this.checking protege o check (server.js:796-798), não o disparo, e _dispararAutomacoes lê this.queue e this.panorama enquanto server.js:1065-1067 os substitui. A volta usa um caminho próprio com guarda, rodando só o filtro e o lançamento, sem a repesca do retry: chamar _dispararAutomacoes com fresh vazio some com a exclusão por freshKeys de lib/engine/review.js:1580 e puxa para a repesca PRs recém-chegados, cada um custando um gh pr view mais o gate de consciência. Segunda: JITTER por deviceId. Todos os seguidores vencem o mesmo batimento, e sem jitter a frota inteira dispara no mesmo segundo sobre o MESMO token de conta. O rate limit do GitHub é por token, e headSha devolve string vazia em qualquer falha do gh (lib/engine/gh-queries.js:200-207), que é a rodada cega descrita em lib/engine/review.js:1148-1156, com dedup desarmado. Junto do jitter, teto de PRs lançados por virada.

O QUE ROLA TERMINA ONDE ESTÁ. Nenhuma sessão viva é tocada. O heartbeat do lease e o valido() do handle continuam operando, porque o lease não depende do admin.

HISTERESE, SÓ NA DESCIDA. Cair para local é imediato ao vencer, e o vencimento já embute três batimentos de tolerância. Voltar para distribuído é IMEDIATO no primeiro batimento válido. Exigir dois batimentos para o seguidor parar de enfileirar criaria, em toda recuperação, uma janela garantida de 240 s com dois escalonadores ativos, pagando o gate de consciência em dobro (até quatro chamadas gh por PR, lib/engine/skip-review.js:492-497 e lib/engine/checks-exigidos.js:112-125). O pior caso de voltar cedo é ninguém enfileirar por até um ciclo, estritamente mais barato.

VOLTA DO ADMIN. Ele monta a ocupação a partir dos leases vivos (o stream de lib/engine/sync-stream.js:212 já os entrega, e é o que também enxerga aparelho em versão antiga) mais as atribuições pendentes, conta contra os tetos e distribui só o que não está rodando nem na fila local de ninguém. Não pede nada de volta, não cancela nada, não reordena.

CUSTO HONESTO. Entre a queda do admin e a virada há uma janela de até 360 s em que ninguém enfileira automaticamente, consequência direta de "agendador sem substituto", e ela tem que aparecer na tela como estado, não como silêncio. E aparelho em versão antiga só vira visível quando pega lease, ou seja, depois da medição inteira do PR: durante a preparação ele é invisível para a contagem, e isso é limite declarado, não bug.

---

## Comandos (esboço) (`comandos_esboco`)

> **Trechos superados neste campo, que NÃO valem.** Onde o texto abaixo divergir destes itens, vale a spec.
>
> - "batimento vivo" passa a ser "autoridade fresca" (CT-ADM-POL). "Decidir e postar" passa por CT-POST.

ESBOÇO, não desenho fechado. O esboço fixa só as regras que não podem ser descobertas depois.

REGRA QUE MANDA EM TUDO: comando remoto NUNCA vira pr.manual. Hoje manual atravessa a saída de cena (lib/engine/review.js:390), o gate de consciência (lib/engine/skip-review.js:582), os checks obrigatórios e os overrides de coordenação (lib/sync/coordinator.js:209-213), e só é carimbado no clique (lib/engine/review.js:217-224). Comando carrega origem própria, que não atravessa NADA. Marcar comando como manual por conveniência derruba três gates de uma vez, em silêncio. É o mesmo princípio do requested: o que vem do fio só restringe.

FORMA. {cmdId, alvo, tipo, args, issuedAt, ttl, generation, sig}, idempotente por cmdId, com recibo de desfecho. Executor offline: o comando fica pendente e é aplicado quando ele volta, com o TTL decidindo se ainda faz sentido.

APLICAÇÃO. Só com config.sync.aceitarAdmin ligado LOCALMENTE no alvo, assinatura válida, geração corrente e batimento vivo. Sem os quatro, o comando é ignorado e o recibo diz por quê.

OS QUATRO PREVISTOS. Cancelar: reusa cancelSession, que o coordenador já chama na perda de lease. Repetir: reenfileira como atribuição comum. Decidir e postar: roteado OBRIGATORIAMENTE para o aparelho dono da pendência, porque payload, motivo e postRetry vivem no decisions.json dele (lib/engine/decision.js:18-80 e 310-388) e o dedup de postagem é por processo (lib/engine/decision.js:680-710). Iniciar em outro aparelho: é atribuição forçada, e ainda assim passa pela admissão por lease.

O QUE A ASSINATURA É E O QUE NÃO É. O banco NÃO verifica assinatura: firebase/database.rules.json dá .read e .write para todo /users/$uid e valida forma apenas em leases, receipts, dailyRounds e usageEvents. A regra PODE impor monotonia de geração, janela do batimento contra o now do servidor e forma dos campos; NÃO pode fazer criptografia. Portanto a assinatura vale contra cliente honesto com bug e contra versão divergente, nunca como permissão. Escrever isso evita que alguém trate a assinatura como controle de acesso.

FORA DO ESBOÇO, POR DECISÃO: transferência voluntária e tomada forçada.

---

## Continuidade (esboço) (`continuidade_esboco`)

> **Trechos superados neste campo, que NÃO valem.** Onde o texto abaixo divergir destes itens, vale a spec.
>
> - A retomada fica fora da distribuição sem privilégios e com a transição durável de CT-RET (S3-5). A afinidade é adiada para a C7, não cortada.

O LIMITE É FÍSICO, não de desenho. O sid do CLI só vale na máquina que abriu a sessão (lib/engine/review.js:1080-1087 e server.js:367-383), e checkpoint, prova por arquivo e escopo materializado são arquivos locais (lib/engine/review.js:1198 e 1242-1246). Migrar processo vivo não está em discussão.

CONSEQUÊNCIA JÁ APLICADA NESTE CORTE: a retomada fica FORA da distribuição. Item com retomarSid enfileira local, como o clique. Isso resolve de vez o risco de publicar antes do consumo destrutivo do sid (lib/engine/review.js:347-354) ou depois dele (lib/engine/review.js:400-406, que consome antes do push), e dispensa transformar material local em requisito de colocação.

O QUE DÁ PARA PROMETER DEPOIS: retomada COORDENADA, não migração. Checkpoint de verificação compartilhado permitiria a outro aparelho retomar a MEMÓRIA do que já foi confirmado contra o código, sem retomar a sessão, e o gate checkpointGap continuaria puro. A separação de lojas review e self não é cosmética: sem ela, a análise do MEU PR alimentaria o gate de uma revisão de outra conta. Prova por arquivo compartilhada permitiria herança de cobertura por blob entre aparelhos, mas sobe caminhos e blobs do repositório e abre discussão de privacidade que esta feature não precisa agora.

DEGRADAÇÃO DECLARADA. Sem material local, o aparelho novo faz revisão CHEIA, que é sempre segura, e o pulo de push trivial degrada para relançar (lib/engine/review.js:1834-1840). O custo é dinheiro, não correção, e é o preço aceito por não ter afinidade de material neste corte.

ORDEM: continuidade vem DEPOIS de comandos, que vêm depois de a distribuição rodar por algumas semanas. Não há como calibrar retomada sem medir quantas vezes o executor de fato cai no meio.

---

## Compatibilidade (`compatibilidade`)

> **Trechos superados neste campo, que NÃO valem.** Onde o texto abaixo divergir destes itens, vale a spec.
>
> - "CANAL DE LEITURA ... segundo stream SSE dedicado": substituído pela S3-8, opção A (batimento, prontidão e fila no stream `live`).
> - "UM APARELHO SÓ ... Idêntico a hoje INCLUSIVE EM LATÊNCIA": substituído por CT-COMPAT (c) (invariantes operacionais e nenhuma ida ao banco só para colocação local).

DISTRIBUIÇÃO DESLIGADA (o padrão). enqueueHeadless toma o ramo de hoje, processHeadless decide como hoje, nenhum nó novo é escrito. Sincronização ligada com distribuição desligada é exatamente o modelo atual: lease, recibo e rodadas do dia, e nada mais.

DISTRIBUIÇÃO EXIGE COORDENAÇÃO, E ISSO VIRA REGRA DE CONFIG. Hoje os interruptores são independentes: interruptor() lê cada chave isoladamente (lib/sync/config.js:59-61) e coordinationActive exige enabled mais coordination.enabled (lib/sync/config.js:91-93). Com distribuição ligada e coordenação desligada, admit devolve o noopHandle cujo valido() é sempre true de propósito (lib/sync/coordinator.js:69-72 e :208), ou seja, a atribuição distribuiria trabalho sem NENHUMA autoridade final, inclusive entre dois aparelhos da mesma conta, que não se enxergam por label (lib/engine/skip-review.js:123-140). Entra distributionActive exigindo coordinationActive, e o saneador zera distribution.enabled quando coordination.enabled não for true, no mesmo arquivo e no mesmo padrão dos outros dois.

SINCRONIZAÇÃO DESLIGADA. Custo zero, como já é hoje.

UM APARELHO SÓ. Ele é o admin, é o único publicador, o rodízio empata sempre e degrada para FIFO (lib/engine/review.js:494-497), e a colocação tem um candidato só. Idêntico a hoje INCLUSIVE EM LATÊNCIA, por causa do atalho: quando o escolhido é o próprio admin, ele enfileira local sem passar pelo banco. Sem esse atalho a afirmação seria falsa, porque hoje enqueueHeadless chama processHeadless no mesmo tick (lib/engine/review.js:407-410).

APARELHO EM VERSÃO ANTIGA. Não lê os nós novos, não obedece atribuição, continua coletando e coordenando por lease. O admin ENXERGA os leases dele pelo stream que já existe (lib/engine/sync-stream.js:212) e não atribui por cima, com o limite declarado de que ele só aparece quando o lease nasce, no spawn. Vale a regra dos nós legados: nenhuma validação nova nos campos que a v2.59.x já escreve, senão o aparelho antigo passaria a falhar na presença e sairia do radar justamente quando mais precisa ser visto.

CLIQUE MANUAL. Continua atravessando os gates automáticos e continua executando NO APARELHO EM QUE FOI CLICADO. Não passa pela colocação e não vira comando.

CANAL DE LEITURA. A feature acrescenta um segundo stream SSE dedicado aos nós novos, reusando a máquina de vigia e backoff do stream de leases (lib/engine/sync-stream.js:186-220). Alargar o stream atual para /users/{uid} não serve: arrastaria recibos e eventos de consumo por cima do canal que hoje existe só para leases. Se o segundo stream não entrar, a leitura cai no tick e a latência de colocação passa a ser de até um ciclo, e isso tem que ser escrito, não descoberto.

---

## Modos de falha (`modos_de_falha`)

> **Trechos superados neste campo, que NÃO valem.** Onde o texto abaixo divergir destes itens, vale a spec.
>
> - "Co-assinatura postando em duplicata entre aparelhos ... risco aberto": fechado por CT-POST e C0b.
> - "Teto do conjunto que não junta nada ... profileTag": fechado por CT-GRUPO.
> - "Ocupação que não enxerga quem está preparando": mitigado pela reserva antes do provedor de CT-ADM, não só pela atribuição pendente.

- Campo do fio que amplia autonomia. É o furo fatal do desenho anterior: requested viajando faria o executor auto-aprovar um PR que ninguém pediu, e se o campo se perdesse chegaria undefined, que o gate deixa PASSAR (lib/engine/decision.js:418 testa === false). Fechado por rederivação local mais a troca para !== true nos dois testes (lib/engine/decision.js:418 e :461).
- Distribuição ligada com coordenação desligada: nenhum lease, nenhuma autoridade final, duplicata inclusive entre dois aparelhos da mesma conta. Fechado por dependência entre os interruptores em lib/sync/config.js.
- Âncora do round queimada sem trabalho. Hoje ela queima em lib/engine/review.js:1929, antes do enqueueHeadless, e o próprio comentário de lib/engine/review.js:1903-1915 conta o bug de campo que isso já causou. Fechado tirando a âncora do caminho distribuído e deixando o teto do dia na reserva remota, que só é consumida quando a sessão começa (lib/sync/rounds.js:86).
- Aceitação que queima cota sem revisar. Aceitar não é trabalho acontecer: entre a aceitação e o spawn existem a medição inteira e a admissão, e o lease é por conta e PR sem o tipo (lib/sync/lease.js:18-20), então uma autoanálise em curso no outro aparelho recusa a revisão. Contado três vezes, o teto do dia esgotaria sem nenhuma revisão feita.
- Recusa silenciosa virando laço de recolocação. enqueueHeadless descarta em silêncio pelo gate de saída de cena (lib/engine/review.js:390); sem NACK o item só volta pelo TTL e o admin recoloca no mesmo aparelho a cada 240 s, sem nada na tela.
- Perda do único backoff existente. A espera anotada (lib/engine/review.js:113-121) é lida só por toReview, reReviewTargets e retryTargets, fora do caminho da atribuição; sem carregá-la no NACK, o executor paga a medição inteira do PR para ouvir a mesma recusa a cada recolocação.
- Teto por aparelho sem enforcement. O clamp é por conta (lib/engine/review.js:426-429) e o total nasce desligado (lib/engine/review.js:460-465): três atribuições de contas diferentes sobem três sessões juntas no aparelho mais fraco, que é exatamente a máquina que a capacidade existe para proteger.
- Ocupação que não enxerga quem está preparando. O lease só nasce no spawn (lib/engine/session.js:802), depois de toda a medição (lib/engine/review.js:1188-1254). Mitigado contando a atribuição pendente como vaga; para aparelho em versão antiga continua aberto e declarado.
- Consumidores de capacidade fora da contagem: pushback abre sessão direto e não registra em activeReviews (lib/engine/pushback.js:239-240), terminal não pega lease por decisão (lib/engine/review.js:315-327), ferramentas registram como sessão mas não passam pelo escalonador (lib/engine/tools.js:97). Qualquer teto por aparelho que conte uma fonte só subestima a carga.
- Rajada sincronizada na virada, no mesmo token de conta. O rate limit do GitHub é por token; headSha degrada para string vazia em qualquer falha (lib/engine/gh-queries.js:200-207), e rodada sem head é a rodada cega com dedup desarmado de lib/engine/review.js:1148-1156. Nenhuma das classes de lib/log-taxonomy.js casa rate limit, então a falha cai em desconhecido e portanto em permanente, estacionando o PR. Mitigação: jitter por deviceId, teto de lançamentos por virada e classe nova na taxonomia com kind transitório.
- Skew velho decidindo a virada. skewMs só é reescrito no touchPresence dentro do tick (lib/engine/sync.js:296 e 334-338); suspensão ou ajuste de NTP deixa o desvio defasado e o vencimento mente nos dois sentidos. Fechado medindo o batimento pelo relógio local contra ele mesmo.
- Disparo fora do ciclo concorrendo com o ciclo. this.checking protege só o check (server.js:796-798), e o recálculo da virada lê this.queue enquanto server.js:1065-1067 a substitui; além disso, fresh vazio desarma a exclusão por freshKeys (lib/engine/review.js:1580) e puxa PRs novos para a repesca, cada um custando gh.
- Teto do conjunto que não junta nada. profileId é aleatório por máquina (ui/app.js:574-576) e é a chave de byProfileDay (lib/engine/usage.js:239-242) e do evento (lib/sync/outbox.js:84): sem profileTag estável, a soma do conjunto é a soma de dois perfis distintos, cada um dentro do próprio teto.
- Estouro do teto do conjunto por atraso do consumo. Mitigado pela reserva por operação viva, nunca eliminado. Declarar na tela.
- Co-assinatura postando em duplicata entre aparelhos. Ela chama postReview direto (lib/engine/skip-review.js:422-434), sem lease, sem recibo e sem pendência, e roda a cada ciclo em todo aparelho com a mesma conta; postLanes e postedReviews são do PROCESSO (lib/engine/decision.js:680-710). É a única via que fura o modelo de postagem com dono, e fica declarada como risco aberto.
- Item órfão em live/queue. A chave inclui o head, então cada push cria item novo; sem dono de remoção o nó acumula lixo e a tela mostra fila que não existe.
- Busca do gh cortada em 100 sem aviso (lib/engine/gh-queries.js:37-39). Lista de candidatos nunca é prova de completude, e ausência de PR nunca prova fechamento.
- Avisos em duplicata. Toda memória de aviso é por processo (budgetWarned em server.js:318, historicoAvisado, checksAvisado, avisoRodadasDia, syncBloqueioAvisado em lib/engine/review.js:106-111): com N aparelhos, o mesmo fato vira N toasts. Aviso de decisão do conjunto tem que nascer no admin e ser lido pelos outros.
- Assinatura tratada como permissão. O banco não a verifica: firebase/database.rules.json dá escrita ampla em /users/$uid e valida forma só em quatro subárvores. Um aparelho com bug pode escrever o nó de admin; quem o recusa é o cliente atualizado, não o banco.
- Política absurda vinda assinada (teto 0, todos pausados). O clamp local impede teto 0 virar fila travada; todos pausados é estado legítimo e tem que aparecer como motivo na fila, não como silêncio.
- Executor que aceita, não abre operação e não devolve (processo vivo, disco cheio). Só o TTL da atribuição resolve; sem TTL o item some da fila sem estar rodando em lugar nenhum, que é a pior falha desta feature.

---

## Contraprovas (`contraprovas`)

> **Trechos superados neste campo, que NÃO valem.** Onde o texto abaixo divergir destes itens, vale a spec.
>
> - "Identidade de perfil: dois aparelhos com a mesma assinatura produzem o MESMO profileTag": substituída por "perfis pareados no mesmo grupo somam; perfil sem vínculo não entra na execução distribuída" (CT-GRUPO).
> - "Volta em 30 s": vale; a volta respeita as restrições de CT-ADM-POL.

- Desligar a distribuição reproduz o comportamento de hoje: a suíte inteira verde com a chave desligada, mais um teste que prova que enqueueHeadless toma o ramo local quando a chave está desligada, quando o batimento venceu, quando pr.manual é verdadeiro e quando pr.retomarSid existe.
- Teste que lê o FONTE e proíbe qualquer caminho vindo de atribuição remota de escrever requested ou manual, na técnica de test/motivo-nunca-vira-objeto.test.js. Mais um teste de unidade provando que requested ausente NÃO auto-aprova depois da troca para !== true em lib/engine/decision.js:418 e :461.
- O agendador produz a MESMA ordem de hoje: alimentar a função pura com candidatos de dois aparelhos e comparar com a ordem que proximoHeadless produz num aparelho só. Divergir com uma org só significa rodízio regredido. O mesmo teste roda a função SEM engine, o que prova que a resolução de conta e de org foi de fato injetada.
- Work-conserving: com um item incolocável no topo da ordem e um colocável atrás, o colocável sai no mesmo passo.
- Volta em 30 s: com o batimento vencido artificialmente, medir o intervalo até o lançamento local e contar as chamadas gh, separando busca (tem que ser zero) de gate de consciência (não é zero, e o número tem que ser dito).
- Banco fora e admin fora são caminhos diferentes: um teste para cada. Admin fora com banco de pé tem que liberar a automação local E manter o store de orçamento do conjunto.
- Config: distribuição ligada com coordenação desligada nunca distribui, e o saneador zera a chave, com teste de config.json editado à mão.
- Emulador: a regra recusa batimento fora da janela e geração retrocedida. Sem essa prova, o vencimento é convenção do cliente. E um teste que documente que a regra NÃO verifica assinatura, para ninguém tratá-la como permissão.
- Atribuição não substitui admissão: forçar duas atribuições do mesmo PR para dois aparelhos e confirmar que só uma sessão abre e que a outra vira espera, nunca falha.
- NACK: atribuir para um aparelho com saída de cena registrada naquele head e provar que ele responde com código, que o admin não recoloca nele e que a espera do NACK é respeitada.
- Âncora e cota do dia: publicar, deixar a atribuição caducar e confirmar que o mesmo head ainda arma round no ciclo seguinte e que a reserva do dia não foi consumida.
- Retomada nunca é publicada: PR com retomarSid vindo do boot enfileira local, e o sid chega à sessão.
- Teto por aparelho: três atribuições de três contas diferentes em um aparelho com teto 1 abrem UMA sessão. E a contagem inclui autoanálise e pushback (abrir um pushback e confirmar que o aparelho conta como ocupado).
- Fusão de candidatos: o mesmo PR publicado por dois aparelhos gera UM item com dois publicadores.
- Jitter: simular N seguidores vencendo o mesmo batimento e provar que os disparos se espalham; medir o pico de chamadas gh por token na virada.
- Medir RAM real no Termux com proot antes de qualquer gate mecânico duro: os.freemem, /proc/meminfo e process.constrainedMemory com uma sessão real rodando. Hoje isso é NÃO VERIFICADO e nenhum número pode entrar no código sem essa medição.
- Medir o atraso do consumo entre aparelhos em operação real, para saber quanto o teto do conjunto erra no pior caso, e comparar com a reserva por operação viva.
- Latência ponta a ponta com distribuição ligada (publicação até sessão aberta) comparada com a de hoje, que é de segundos porque processHeadless roda no mesmo tick do push (lib/engine/review.js:407-410). Sem esse número a tela não distingue esperando distribuição de quebrado.
- Identidade de perfil: dois aparelhos com a mesma assinatura produzem o MESMO profileTag, e perfil não pareado aparece como fora do teto do conjunto, nunca somando errado.
