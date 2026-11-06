# Revisão dos desfechos, recuperação e configurações

Data: 06/11/2026. Repositório: `wandersonaadsantos/farol`.

Base inicial analisada: `f2fabc2811b9e9b1b33ef920442e76b585156863`, versão `2.78.39`.
Integrações da base: `c9aa06f28e2199c967471b2b885796ae8dd4447e` (PR #348, autoanálise por agente) e `34c2d887fa3af8ad393311331f895273ab953a4c` (PR #351, prova na primeira rodada, leitura entre PRs e recuperação encerrada por decisão humana). O segundo merge foi incorporado à branch depois da abertura do PR #352, com resolução explícita dos conflitos. Depois, a branch recebeu por merge a `main` `1306111c0d85194566745ad422ae7a2a57651380` (PRs #353 e #349, saída da recuperação da prova); ver "Integração com a saída da recuperação" abaixo.
Branch de trabalho: `fix/revisao-desfecho-configuracoes`.

## Resultado e critério da correção

O levantamento contém defeitos reproduzíveis, oportunidades de redução de custo e limites que não podem ser declarados resolvidos sem evidência adicional. A implementação trata os caminhos concretos de decisão e recuperação sem transformar dúvida em defeito, nem configuração de aprovação em dispensa de prova obrigatória.

O objetivo de não travar a revisão tem duas partes: um resultado tecnicamente suficiente deve alcançar o desfecho configurado; uma execução incompleta deve conservar uma recuperação válida ou mostrar uma inconclusão explícita, sem repetir indefinidamente a mesma sessão. Aprovar um resultado contraditório para desocupar a fila não cumpre esse objetivo.

As alterações são de código, testes e documentação. A integração preserva a versão `2.78.40` e `VERSAO_DAS_REGRAS = 8` adotadas pela `main`; esta correção não acrescenta outro bump de versão. Este registro documenta a implementação e sua validação; o PR acompanha o estado da publicação. A preparação não instalou o app nos aparelhos nem publicou reviews, merge ou release.

## Situação dos doze pontos

| Item | Conclusão técnica | Tratamento aplicado |
|---|---|---|
| 1. Divergência impede retirar pedido resolvido | Defeito confirmado no caminho da retirada | A divergência histórica isolada, longe dos pedidos respondidos, deixa de impedir a retirada; a que cai no ponto de um pedido dito resolvido continua segurando. Prova da rodada, referências anteriores, ausência de defeitos e demais gates continuam necessários. |
| 2. Sessão reprova pela mesma dívida antiga | Defeito confirmado para dívida correspondente à medição técnica | Correlação dos achados da sessão com todos os achados mecânicos, antes do corte público. Correção na conversa existente; regra exata ou âncora causal em mudança real. |
| 3. Construção longa vira dívida | Defeito confirmado | Intervalo sintático completo, vinculado ao blob do head. Sem margem arbitrária de proximidade. |
| 4. Ausência de consumidores herdada sem reconferência | Defeito confirmado de frescor do contexto | Herança vinculada à árvore completa do head, incluindo arquivos do diff, base e identidade da conta/repositório. Contradição concreta do mapa já habilitado invalida a declaração. |
| 5. Objeção nova já lida descarta aprovação | Limitação confirmada do protocolo anterior | Consulta somente de leitura entrega texto e recibo; envelope declara tipo, id e hash de conteúdo. Publicação reconfirma os recibos contra o histórico atual. |
| 6. Resposta do autor conta como objeção | Custo evitável confirmado | Autor identificado é excluído das objeções independentes; PR avulso consulta a identidade. Identidade desconhecida conserva a classificação cautelosa. |
| 7. Mudança de versão antecipa esperas | Comportamento confirmado | Mudança de regra respeita `proximaEm`; a próxima rodada usa a regra atual e, como qualquer outra desde o PR #349, só entra no contador quando conclui. Não se concede sessão fora do recuo pela migração. |
| 8. Causa da queda da janela | Causa ainda não demonstrada | Diagnóstico local opt-in, sem upload, em `FAROL_HOME`; tratamento da rejeição assíncrona ao recarregar e exclusão de saída limpa. Não declarar correção da causa. |
| 9. Estado grande enviado à tela | Peso confirmado por inspeção e fixture; alegação de ausência total de retenção era excessiva | Projeção de uso e ações somente para os consumidores da tela, preservando séries, totais, limites, trabalho visível e consulta histórica. |
| 10. Divergência duplicada no card | Defeito de apresentação confirmado | Um único ponto de divergência, inclusive com prova esgotada. Evidência usada pelo gate fica separada do texto da UI. |
| 11. Ratchet desatualizado | Confirmado | `review.js`: 707 → 704, medido após integrar a `main` atual. `server.js`: 936 → 929; `decision.js`: 257 → 254 (medido depois de integrar o PR #349), além da redução de outras dívidas nesses arquivos tocados. Nenhuma baseline aumentou em relação à base publicada. |
| 12. Herança de production, compare e terminal duplicado | Conjunto de defeitos e limites distintos | Pontas P/B/H fixadas, ancestralidade e completude conferidas, renomes e interação causal observada preservados; compare real exercitado; terminal incluído na exclusão local. Limites semânticos e coordenação humana entre aparelhos explicitados abaixo. |

## Decisão correta sem nova trava

### Divergência e retirada do pedido

`retirada-de-pedido.js` consultava a lista produzida para exibir ressalvas de prova esgotada. Uma divergência histórica persistente acabava confundida com falta de evidência de que o problema anterior havia sido resolvido.

O cálculo foi separado: `lacunasDispensadas` representa a evidência dispensada; `pontosDaProvaEsgotada` representa a apresentação. A retirada recusa outras lacunas dispensadas, mas não a divergência isolada. O resultado ainda precisa ser completo, ter rodada anterior identificada e referências respondidas, não conter defeito ativo e atravessar os gates aplicáveis. Retirar um pedido automático resolvido continua sendo uma decisão diferente de aprovar pela política da conta.

### Dívida e regressão em linha antiga

Uma linha não alterada pode participar de regressão causada em outro arquivo. Por isso, não foi implementado um filtro que simplesmente descarta todos os bloqueios fora dos hunks.

O worker mede `intervaloVerificado: {inicio, fim, blob}` usando o parser já distribuído. A classificação exige inventário completo do mesmo head, blob igual e construção inteira fora do patch, incluindo contexto. Supressões com linha vazia ou comentário intermediário continuam vinculadas à construção seguinte. Diretivas de alcance amplo, parser indisponível, sintaxe não suportada e regras sem intervalo confiável não recebem desconto local.

O runtime correlaciona os achados da sessão com a avaliação inteira, antes de limitar o relatório a dez achados. Quando a sessão repete uma dívida mecânica comprovada, deve tratá-la como sugestão. Quando relata regressão distinta, pode fornecer:

```js
introduzidoPor: {
  file: "src/consumidor.ts",
  line: 42,
  side: "head", // ou "base", para linha removida do patch
  evidence: "Evidência concreta do cenário e da relação causal."
}
```

A linha precisa pertencer a uma alteração real, não apenas ao contexto do patch. Essa medição confirma localização. Ela não substitui a demonstração da causalidade.

A classificação tem versão própria, `foraDasLinhas.versao = 2`. Somente relatórios que concederam o desconto com a régua antiga exigem reconferência por essa mudança. Um defeito independente continua bloqueando, mesmo quando outro achado precisa dessa reconferência.

### Recuperação limitada e retomável

A correção usa o limite existente de até duas continuações na mesma conversa. O app exige um novo envelope quando reclassifica a dívida; não fabrica um veredito de aprovação usando o texto antigo. São correções do resultado dentro da sessão em curso. A integração preserva a decisão da primeira rodada adotada pelo PR #351: lacuna não dura vira ressalva pela política da conta, sem gerar outra rodada; análise incompleta e as duas marcas de escopo continuam impedindo texto pendente de correção.

| Situação | Comportamento |
|---|---|
| Resposta nova válida | Reconfere critérios, avaliação, coerência, prova e configuração da conta. |
| Admissão/coordenação interrompida, resposta ausente ou conversa sem identificador | Marca `escopoSessaoPendente`, impede publicar o parecer anterior e conserva a recuperação com o recuo vigente. |
| Falha de rede | Segue pelo caminho de recuperação de rede existente. |
| Resposta sem progresso, malformada ou limite da correção atingido | Marca `escopoSessaoInconclusivo`, mostra o motivo e suspende a repetição automática idêntica. |
| Revisão explícita posterior ou nova rodada com evidência suficiente | O resultado novo substitui a pendência de escopo anterior e passa a ser o mostrado na UI. |

A distinção entre pausa e esgotamento é necessária: uma recusa temporária não pode virar uma marca permanente. Também não basta marcar a análise como incompleta, porque o Farol permite reprovar uma análise incompleta que já comprovou outro defeito real. Os dois estados de escopo impedem enviar o texto ainda pendente de correção, inclusive nesse caso.

A revisão independente reproduziu uma falha adicional durante a implementação: após JSON malformado, o código reutilizava o objeto que o app já havia reclassificado e o tratava como uma resposta nova. O caminho foi corrigido; a pendência anterior permanece explícita e nada é publicado.

Um envelope novo ainda pode conter prosa inadequada. Os gates estruturais não entendem semanticamente cada frase. Não foi criado um bloqueio por igualdade literal do texto, pois o texto anterior pode já cobrar corretamente somente outro defeito real.

## Herança e contexto

### Ausência de uso fora do diff

Uma busca textual por um único símbolo não cobre de modo confiável aliases, reexports ou alteração de resolução. A implementação compara a identidade da árvore inteira do head, incluindo caminhos, blobs, modos e tipos, juntamente com a base e a identidade da conta/repositório.

A auditoria encontrou um caso que a primeira implementação ainda deixava passar: `tsconfig.json` já estava no diff e alterava um alias, enquanto o alvo e um consumidor externo permaneciam idênticos. Excluir todos os arquivos do diff do digest preservava indevidamente a ausência. A versão final inclui esses arquivos, e o caso foi revalidado com o mapa desligado.

Quando a identidade muda, somente a declaração de alcance perde a herança. A leitura comprovada do blob inalterado permanece aproveitada; a sessão que já estava prevista confere o alcance atual. Não há nova sessão paga apenas por essa invalidação nem ativação de mapa que estava desligado.

O índice de leitura entre PRs que entrou na `main` foi preservado: a prova própria é combinada com esse índice antes de aplicar o contexto, conservando a origem. O índice exige mesmo caminho, blob, patch e status; ele não herda declarações de ausência de consumidores entre PRs. A prova própria do mesmo PR continua sujeita ao digest completo. A regressão de integração exercita esses dois caminhos com o mapa desligado.

Árvore parcial, head diferente ou registro antigo/corrompido não comprova ausência. Se o mapa já habilitado mostrar um import estático exato contraditório, a ausência também não entra na prova herdável. O limite permanece: isso garante frescor de contexto, não prova universal da declaração semântica inicial.

### Production e comparação de três pontos

A implementação resolve P (production), B (base) e H (head) antes das comparações e usa SHAs imutáveis. B/H precisam concordar com o inventário. O head deve conter P, e o merge-base da comparação P...H precisa ser o próprio P. Renomes consideram nomes antigo e novo.

O rebaixamento exige fundamentação da sessão e prova mecânica do arquivo. Se título, resumo, evidência ou `introduzidoPor` citarem contexto alterado pela base/merge, o bloqueio é preservado. Um 404 da comparação não registra mais que o repositório não tem production; somente a consulta da própria ref pode produzir essa marca. Resposta com 300 arquivos não autoriza inferir completude.

O [registro do ensaio GitHub](github-compare-2026-11-06.json) contém as pontas, o merge-base e os blobs. A comparação real main → `docs/agy-provedor` retornou um arquivo como adicionado apesar de seu blob ser idêntico nas duas pontas, demonstrando a diferença entre merge-base → head e comparação direta das pontas. A comparação inversa aceitou a branch com barra e alcançou 300 arquivos. O fetch genérico recusou `%2F` em seu próprio validador; isso não foi um erro retornado pelo GitHub. A implementação por SHA remove essa dependência.

O app continua sem detectar semanticamente uma dependência omitida por completo pela sessão. Mesmo blob não equivale a mesmo comportamento. Esse limite foi registrado no protocolo de revisão.

### Terminal e duplicata

A mesma chave canônica agora é consultada na fila automática, na janela de início, nas revisões automáticas ativas e nos terminais ativos. A guarda acontece depois da preparação assíncrona e antes do lançamento. Há teste de duas requisições simultâneas, lote parcial, caixa diferente no nome do repositório e liberação após fechar o terminal.

O terminal só deixa de segurar o PR quando a janela avisa que fechou (no macOS e no Linux, pelo `trap EXIT` que chama a API local). Se esse aviso se perde, o cartão do terminal em "Analisando agora" oferece **Liberar PR**: o Farol faz o que o fim da sessão faria (solta o PR e revoga a capacidade de postagem do terminal) sem fechar a janela da pessoa. Login e sessão sem PR não seguram nada e não têm o botão. O "Refazer" de recibo órfão recusa sem apagar o recibo quando há revisão do mesmo PR em curso neste aparelho, e a autoanálise continua recusada contra a revisão automática ativa do mesmo PR, como antes.

A exceção humana existente para terminal entre aparelhos permanece: não foi criado lease remoto para uma sessão conduzida pela pessoa. A correção elimina a duplicação local observada; não promete exclusão global de terminais nem altera a configuração de coordenação.

## Integração com a saída da recuperação

O merge da `main` `1306111c` trouxe o PR #349: a tentativa da recuperação passou a contar quando a rodada **conclui** (`armar`), não quando é agendada (`relancar`), com teto de seis rodadas por commit (`MAX_TENTATIVAS_POR_HEAD`) e a pausa que pede uma pessoa (`pedeVoce`). A resolução seguiu essa semântica:

- A troca de regras continua sem antecipar `proximaEm`, mas deixou de somar tentativa ao relançar; quem conta é a conclusão da rodada. Os testes deste PR que esperavam a soma no agendamento foram ajustados para o contrato da `main`, e um deles agora roda a rodada relançada e confere a contagem na conclusão.
- `armar` mantém, lado a lado, a recusa por `ambienteSegura` (da `main`) e a recusa por `escopoSessaoInconclusivo` (deste PR).
- `recordDecision` substitui a pendência anterior com `provaEsgotada`, com `esperaProva` (da `main`) ou por head velho. A condição própria para a pendência de escopo da sessão saiu: toda rodada headless já carrega `provaEsgotada`, e a mutação que a removia não derrubou nenhum teste.
- `pontosDaProvaEsgotada` continua sem repetir a divergência que `ressalvas.js` já mostra, agora valendo em toda rodada.

A auto-revisão depois do merge acrescentou: a divergência no ponto de um pedido dito resolvido segura a retirada (`divergenciaNoPedido`); o botão Liberar PR do terminal; a recusa do Refazer com revisão local em curso; a autoanálise de novo recusada contra revisão automática ativa; a leitura dos intervalos pelo descritor aberto (alerta `js/file-system-race` do CodeQL); os testes da herança de production pelo caminho real (`provaDaHeranca` com a base do inventário), sem o auxiliar que só os testes usavam; e a retirada do campo `alcanceReavaliar`, que nada lia.

O desconto de dívida exige agora o intervalo medido pelo parser. Arquivo que não é JavaScript/TypeScript e ponto que não abre nó sintático (valor dentro de template literal) voltam a bloquear, o que é o lado seguro e está dito em `docs/REVIEW-GATES.md`.

A validação desta integração rodou em Windows 11 com Node 24.22.1; os números estão em "Validação e limites do ambiente". Os testes de processo Linux, excluídos na rodada anterior por causa do namespace de PIDs daquele executor, ficam a cargo da matriz do CI.

## Objeções e política da conta

`query-objections.js` é distribuído dentro de `lib`, junto das dependências. O prompt fornece executável, ambiente e argumentos estruturados, seguindo o contrato existente de leitura das fontes; não depende de `node` estar no PATH. A consulta herda a identidade GitHub da sessão e não publica.

Os recibos declarados têm `{tipo, id, impressao}`. A publicação aceita somente recibos que correspondem ao conteúdo atual. Id sem hash, corpo editado depois da leitura, comentário novo não declarado e formato inválido não dispensam a reconferência. Registros legados conservam a comparação compatível com o formato anterior.

Resposta do autor identificado não cria objeção independente; comentário de outro revisor, inclusive da própria conta revisora, continua contado. Falta de identidade não autoriza adivinhar quem é o autor.

Foram exercidas políticas `onCaveats = approve/wait` e `onReject = request_changes/wait`. A correção não altera defaults, limites de paralelismo, orçamento, isolamento por conta, exigência de CI no head ou configurações de mapa/coordenação. Uma espera escolhida pela conta continua sendo espera deliberada.

## Janela, diagnóstico e tamanho do estado

A causa da queda continua sem reprodução nativa. O diagnóstico novo é opt-in: `diagnosticoQuedas: true`, no arquivo de configuração, com reinício. O coletor define `crashDumps` em `~/.farol/diagnostico-quedas`, ou sob a raiz definida por `FAROL_HOME`, antes de iniciar, com `uploadToServer: false` e sem URL de destino. A chave não é uma preferência portável. Dumps existentes permanecem disponíveis para inspeção local; podem conter dados da memória.

Foi corrigido o tratamento de rejeição da Promise de `loadURL` na recuperação. Encerramento limpo ou saída intencional do app não dispara recarga. Os testes usam API injetada; não comprovam coleta nativa em Windows, estabilidade da janela nem causa raiz.

O levantamento de tamanho precisava de uma correção: o resumo de uso já tinha séries de 120 dias e exibia as 100 sessões mais recentes; o diário de consumo não estava limitado a essas 100 sessões. As decisões resolvidas já tinham teto de 3.000. O problema tratado é o volume enviado à tela, não uma demonstração de vazamento de memória.

Na fixture, usando os produtores e consumidores reais da UI:

| Projeção | Antes | Depois | Contexto da medição |
|---|---:|---:|---|
| `usage` | 461.784 bytes | 183.834 bytes | 120 dias, 12 modelos, dados sintéticos com campos esparsos. |
| `reviewActions` | 142.175 bytes | 2.427 bytes | 1.900 chaves históricas, 33 necessárias para o estado visível. |

São bytes de JSON sem compressão. Os testes comparam HTML, valores, ordem, séries e totais dos consumidores. A redução depende dos dados; não é um novo tamanho medido do `/api/state` do aparelho nem benchmark de CPU/RAM.

Campos numéricos exatamente zerados dos buckets das séries e metadados de sessão não usados pela tabela são omitidos da projeção. Ações são enviadas para PRs presentes nas listas, pendências e revisões recentes. O registro completo, a consulta de consumo, os limites de orçamento e a consulta histórica por chave permanecem disponíveis. A projeção não corta pendências visíveis por um teto arbitrário.

## Validação e limites do ambiente

A checagem final usou Node **24.22.1**. Os testes usam `FAROL_HOME` temporário e fronteiras externas simuladas; nenhum review real foi enviado para verificar o código.

| Verificação | Resultado |
|---|---|
| Integração com a `main` `1306111c` e auto-revisão, Windows 11 | `npm run check` com 1.255 arquivos; `npm run lint` sem regressão; suíte completa sem exclusão nenhuma: 7.725 testes, 7.618 aprovados, 107 skips condicionais da suíte (os de Linux e macOS, neste SO), zero falhas e zero cancelamentos; `npm run eng` com 12 de 12 regras acionadas executadas e aprovadas. |
| `npm run check` | Aprovado: 1.254 arquivos JavaScript conferidos após integrar a `main`. |
| `npm run lint` | Aprovado: gate de qualidade sem regressão e higiene sem apontamento. |
| Suíte final, com as quatro exclusões ambientais abaixo | 7.695 testes contabilizados: 7.613 aprovados, 82 skips condicionais da suíte, zero falhas/cancelamentos. Os quatro casos excluídos pelo argumento não entram nessa contagem. |
| Dívida/retomada/histórico/envelope/espera, após o ajuste da pendência | 67/67 aprovados. |
| Migração das esperas e política de PR próprio | 68/68 aprovados. |
| Fixtures de admissão/distribuição, incluindo recusa de UID 0 | 214/214 aprovados. |
| Desfecho com as políticas reais de `config.accounts` | 11/11 aprovados, sem dublês das funções puras de política. |
| `git diff --check` | Aprovado. |
| `npm run eng` | Aprovado: catálogo em dia, 12 regras acionadas/executadas (2 hard e 10 de julgamento), três violações estruturais já registradas absorvidas pelo baseline existente. |

A primeira execução sem filtro encontrou expectativas antigas da migração, a pendência de escopo que não era substituída após clique, fixtures dependentes do UID hospedeiro e quatro problemas ambientais. As expectativas foram atualizadas para o contrato corrigido; a pendência passou a ser substituída e ganhou teste; as fixtures foram isoladas. A execução final ocorreu depois dessas correções.

**Fixtures de UID:** seis arquivos adicionais reproduziram exatamente as mesmas 22 falhas na base intacta, em 117 testes. As fixtures pressupunham usuário comum, mas herdavam UID 0 do executor. A correção simula somente essa medição por caso, com restauração automática; produção, permissões e usuário real continuam intactos. A rodada dirigida dos oito arquivos envolvidos passou em 214/214 casos, incluindo dois testes explícitos que mantêm a recusa sob UID 0, sem reserva ou enfileiramento.

**Quatro casos ambientais excluídos da execução final:**

- `Linux: cancelar encerra também o CLI na sessão do pseudoterminal`
- `Linux: CLI que ignora TERM é forçado e recolhido pelo wrapper`
- `Linux: kernel sem children usa PPID e recolhe CLI que ignora TERM e EOF`
- `recursos reais incluem um filho Node da sessão e a coleta não muda concorrência`

O diagnóstico reproduziu `process.pid = 5`, mas `/proc/self/stat` mostrava PID `28512`; `/proc/5/stat` não existia. Um filho conhecido tinha PID local `14`, igualmente ausente do `/proc`. `ps -axo pid=,ppid=,rss=,time=,lstart=` falhou com `fatal library error, lookup self`. O pseudoterminal funcionava; a observação de processos estava em outro namespace.

Os dois arquivos de teste e os módulos correspondentes são idênticos à base. A base reproduziu as asserções de capacidade e fechamento da entrada; um fixture controlado nos dois checkouts confirmou que o fallback por PPID também não encontra o filho nesse ambiente. Somente os filhos sintéticos conhecidos foram encerrados. Não foram adicionados skips aos arquivos nem modificados os módulos de produção para ocultar essas falhas. Isso mantém uma limitação preexistente para Linux com `/proc` incompatível, a ser verificada em CI com namespace normal.

**Integração e configuração real:** a `main` atual acrescentou a autoanálise por agente. A revisão independente confirmou a permanência do guard de gasto antes da execução, a liberação de vaga após recusa e a separação do dedup da autoanálise. O merge posterior do PR #351 também preserva a nova primeira rodada, o índice entre PRs, o limite de inventário e a dispensa da recuperação quando uma pessoa já decidiu no mesmo head. Os conflitos foram resolvidos mantendo as lacunas duras de escopo, a retirada sem bloqueio por divergência, o recuo e a substituição da pendência por uma decisão nova. As três revisões de integração passaram em 86/86, 155/155 e 65/65 casos dirigidos, com sobreposição entre grupos; essas contagens não devem ser somadas como testes distintos. A projeção do estado não alimenta os freios de gasto nem elimina a informação lida pelo agente. Nos testes de desfecho, as políticas passaram a ser lidas de `config.accounts`: o caso `onClean = approve` e `onCaveats = wait` comprova que a ressalva escolhe a política correta.

**IPv6 e proxy do executor:** um teste novo da `main`, que acessa um motor em `::1`, falhou igualmente na base intacta e na branch. O listener e `node:http` funcionavam; `fetch` herdava `NODE_USE_ENV_PROXY=1` e o endereço entre colchetes não constava da exceção. Acrescentar `::1,[::1]` a `NO_PROXY` e `no_proxy`, preservando o restante e somente no processo de testes, fez o arquivo passar em 13/13 nas duas árvores. Não houve exclusão desse teste nem mudança no código de rede.

**Completude do relatório de testes:** neste executor, `--test-force-exit` produziu contagens variáveis e deixou resultados TAP ausentes, apesar de retornar zero. Sete arquivos contabilizaram 560 casos com a opção e 572 sem ela. O override já aceito pelo runner, `--no-test-force-exit`, manteve os limites de tempo e concorrência. A rodada após o PR #348 contém os 7.633 resultados distintos por ocorrência da união das duas rodadas anteriores, mais 11 resultados preexistentes que ambas haviam omitido. Todos os 7.644 anúncios daquela rodada têm resultado, sem omissão conhecida. Após incorporar o PR #351 e suas regressões de integração, a rodada final passou a 7.695 anúncios e 7.695 resultados, novamente sem falhas ou cancelamentos. As contagens com saída forçada ficam substituídas pelas execuções completas.

Comandos finais (os ajustes de ambiente valem somente para a execução da suíte):

```bash
npm run check
npm run lint
NO_PROXY="${NO_PROXY:+$NO_PROXY,}::1,[::1]" \
no_proxy="${no_proxy:+$no_proxy,}::1,[::1]" \
npm test -- --no-test-force-exit --test-reporter=tap --test-skip-pattern '^(Linux: (cancelar encerra também o CLI na sessão do pseudoterminal|CLI que ignora TERM é forçado e recolhido pelo wrapper|kernel sem children usa PPID e recolhe CLI que ignora TERM e EOF)|recursos reais incluem um filho Node da sessão e a coleta não muda concorrência)$'
npm run eng
git diff --check
```

A primeira tentativa de preparar o gate privado por HTTPS pediu credencial ausente no Git local. A conexão autorizada do GitHub permitiu recuperar os objetos originais de `eng-behaviour 0.17.0`, commit `63c8d65cfec69ecfb173825a48bba6509bd05328`. Foram conferidos os hashes de 205 blobs, 115 árvores e do commit assinado original; a árvore raiz é `19cdf98f903704c261a70d21a307d20b8efefef2`. A cópia rasa autêntica passou em `git fsck --full` e serviu de origem ao preparador original do Farol.

O preparador executou `pnpm install --frozen-lockfile` e o build real por `tsc`, e ele próprio gravou o carimbo. A configuração local não versionada do pnpm recusou o script de `esbuild`, dependência de testes que o build/CLI não usa; nenhum arquivo de fonte nem gate foi alterado. A conferência original aprovou versão, commit, árvore limpa e carimbo. Foram registradas 12 avaliações específicas para as 10 regras de julgamento, com fingerprints retornados pela API pública: três avaliações de responsabilidade única mantêm explicitamente as dívidas conhecidas de `review.js`, `decision.js` e `server.js`. O gate completo passou. Os ensaios nativos Windows/Electron permanecem pendentes da matriz de CI; a causa da queda não foi demonstrada.

## Fontes técnicas

- Código base fixado e testes de regressão desta branch.
- [Electron: crashReporter](https://www.electronjs.org/docs/latest/api/crash-reporter), especialmente configuração de `crashDumps` antes de iniciar e desativação do upload.
- [GitHub: compare two commits](https://docs.github.com/en/rest/commits/commits#compare-two-commits), incluindo o limite da lista de arquivos.
- [Evidência do compare real](github-compare-2026-11-06.json).
- [Contrato atualizado dos gates](../../REVIEW-GATES.md).
- [Configuração do diagnóstico e projeção da interface](../../CONFIGURATION.md).
