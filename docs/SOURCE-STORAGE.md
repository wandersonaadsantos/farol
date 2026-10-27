# Armazenamento das fontes de revisão

O cache comum fica em `HOME/source-cache`, com um diretório por host, conta e identidade de repositório. A configuração `sourceCacheLimits` aceita:

| Campo | Padrão | Finalidade |
|---|---:|---|
| `maxBytes` | 2 GiB | Orçamento lógico por escopo |
| `reserveBytes` | 512 MiB | Piso de espaço livre por operação |
| `globalMaxBytes` | 4 GiB | Orçamento lógico agregado gerenciado |
| `globalReserveBytes` | 1 GiB | Piso global de espaço livre |
| `acquisitionReserveBytes` | 16 MiB | Reserva inicial e incremento para aquisição de tamanho desconhecido; margem adicional para checkout |
| `monitorIntervalMs` | 250 ms | Intervalo mínimo solicitado entre verificações de uma operação em andamento |

Valores devem ser inteiros positivos. Os defaults limitam a duplicação entre repositórios sem reservar RAM por review. O piso global deixa margem para o sistema e outras aplicações. O bloco de 16 MiB permite iniciar uma aquisição pequena sem prometer seu tamanho final; o intervalo de 250 ms evita uma varredura contínua. São escolhas iniciais de engenharia, configuráveis, e não conclusões de uma medição em repouso.

## O que entra na quota

Cada admissão reconcilia tamanhos lógicos de arquivos no cache privado. O inventário agrega envelopes de árvores e blobs, metadados, leases, catálogo, arquivos Git completos, packs, temporários de aquisição e arquivos parciais. Temporários reconhecidos por nome são apresentados separadamente; temporários com outros nomes permanecem incluídos no total da categoria que os contém. Materiais registrados nos leases entram inclusive quando estão pendentes de limpeza. Links e entradas especiais não são seguidos: inventário não verificável adia a aquisição.

A raiz `STATE_DIR/technical-review` também é observada automaticamente nas operações de armazenamento. Em testes isolados pode ser substituída por `materialRoot`. Diretórios com registro de posse do ciclo atual ou referência de fontes entram como material gerenciado mesmo antes do attach e depois de uma interrupção. Arquivos irmãos associados a esses diretórios, como registros e consumidores, também entram. Isso não autoriza sua remoção pelo cache.

Os diretórios sem registro gerenciado são apresentados como legados observados, separadamente e sem autorização de remoção. A observação de tamanho tem janela de 200 ms e até 10 mil entradas, com reuso por até 60 segundos; apresenta `bounded-lower-bound` e `complete:false` quando incompleta. A contagem de diretórios é atualizada, mas um tamanho em cache conserva seu instante de medição. O orçamento de 4 GiB **não** engloba retroativamente os legados. O piso de disco livre considera a ocupação deles e de outros programas no mesmo volume. Materiais externos não registrados, índices sintáticos em memória e alocação de diretórios são exclusões declaradas no inventário.

O índice sintático em memória não grava um índice adicional em disco. Envelopes de fontes persistidos entram em `objectCacheBytes`; arquivos desconhecidos dentro da raiz do cache continuam contados como não classificados.

## Admissão, interrupção e recuperação

Um lock exclusivo de arquivo serializa o livro global entre processos. Reservas são persistidas antes do trabalho e descontadas tanto da capacidade global quanto do espaço livre disponível. O lock por escopo continua protegendo seus escritores. Uma admissão ocupada ou com estado corrompido é adiada, preservando o material existente. Reserva de uma operação interrompida sem finalização permanece conservadora; idade ou PID ausente não autorizam seu descarte.

Fetch Git e checkout recebem o sinal combinado de cancelamento e do monitor. Durante crescimento desconhecido, a reserva é ampliada em blocos quando necessário. Se a quota ou o piso deixam de ser atendidos, o monitor cancela o subprocesso iniciado por aquela operação. Não há fila ilimitada de verificações: uma verificação lenta termina antes de iniciar a próxima. Falha e cancelamento reconciliam o que ficou escrito; parciais continuam contados e impedem outra admissão quando necessário. Falha ao reconciliar conserva a reserva durável. Outros consumidores e destinos não são removidos para concluir uma aquisição.

O callback de `execFile` após aborto não comprova o término de todos os descendentes Git. Por isso fetch e checkout registram proteção no lease e no material **antes** de iniciar o subprocesso. Aborto, timeout com código ausente, maxBuffer ou outro encerramento não confirmado mantêm proteção e reserva pendentes. A limpeza verifica essa condição antes de qualquer remoção, também consultando a referência do cache quando disponível. Mesmo se não houver espaço para gravar o diagnóstico posterior, a proteção inicial permanece. Erro Git normal com saída numérica, como exit 128, finaliza a proteção e libera sua reserva normalmente.

Enquanto houver processo Git sem término confirmado, novas admissões globais são adiadas e os consumidores existentes continuam preservados. Idade, PID ausente ou callback de aborto, sozinhos, não recuperam esse bloqueio. A recuperação automática exige uma de duas provas do sistema operacional: o boot é posterior à interrupção (v2.78.1), ou, no mesmo boot, o processo do Farol dono da operação terminou (PID ausente ou reaproveitado, conferido pela data de criação) e nenhum processo da família Git iniciado antes da interrupção continua vivo (v2.78.5). A segunda prova existe porque o Farol pode reiniciar sem o Windows reiniciar, e a trava ficava sem saída até o próximo boot. O limite dela: um Git órfão que tenha iniciado depois da interrupção, com o pai já encerrado, não é distinguido de um Git independente. Isso custa disponibilidade: é necessária intervenção explícita depois de provar o término da árvore de processos e reconciliar os materiais, reservas e registros privados. Esta rodada não fornece um comando automático para descartar essas provas. Um processo de teste descendente que continua escrevendo depois do callback verifica essa fronteira; somente processos criados pela própria fixture são encerrados.

Sob pressão, a admissão pode recuperar envelopes JSON catalogados de outro escopo sem nenhum lease ativo ou incerto, adquirindo seu lock de escritor sem aguardar. Objetos pendentes ficam preservados. A recuperação global não remove bare caches Git inativos nem materiais; portanto pode adiar mesmo havendo espaço potencialmente recuperável nessas categorias. O mecanismo existente por escopo ainda pode remover seu Git privado somente antes de prepará-lo e comprovando ausência de consumidores Git. Nunca são removidos legados para cumprir quota.

## Precisão e limites

`git count-objects -v` mede apenas objetos, com arredondamento em KiB. Esse valor é conservado como `gitObjectEstimateBytes` para diagnóstico. Após fetch, checkout e liberação, o tamanho Git é reconciliado com os metadados dos arquivos de todo o bare cache; `precision: logical-file-size` distingue essa medida da estimativa anterior. O inventário global também observa packs temporários e parciais enquanto crescem.

O total usa tamanho lógico de arquivo e deduplica hardlinks dentro de cada escopo, quando o filesystem fornece identidade. Não é uma quota física do sistema operacional: compressão, arquivos esparsos, clusters, diretórios e hardlinks entre escopos impedem equivalência exata. A reserva de disco verifica tanto a raiz do cache quanto a raiz de materialização, quando esta existe. Reservas simultâneas são descontadas conservadoramente de ambas, inclusive quando um `materialRoot` customizado está em outro volume.

O monitor é amostrado. Uma gravação ou processo externo pode ultrapassar o orçamento ou reduzir o espaço livre entre duas verificações, e a própria reconciliação pode levar mais que o intervalo configurado. A escrita dos pequenos registros de contabilidade também pode ocorrer depois da última amostra. Não existe garantia de overshoot físico zero. Ao detectar a condição, o Farol interrompe o novo trabalho, registra a interrupção e conserva a integridade e a contabilidade dos materiais existentes. Nada dessa manutenção roda a cada atualização da interface.
