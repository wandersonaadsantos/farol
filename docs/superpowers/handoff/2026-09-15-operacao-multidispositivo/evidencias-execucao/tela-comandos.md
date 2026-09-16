# Evidência: repetir, iniciar e designar admin pela tela (e o motivo da espera)

Branch `md/tela-comandos`, cortada de `md/integracao` (`2238d5e`). Nada foi empurrado;
nenhum serviço real foi tocado (banco e identidade falsos, `FAROL_HOME` temporário, nenhuma
publicação no Firebase, nenhuma sessão de IA).

| SHA | O quê |
|---|---|
| `d567bfb` | defeito do head em `repetir` e em `iniciar` |
| `ef5d702` | o dado que faltava: commit no índice, fila do conjunto, executores do candidato e o motivo da espera publicado |
| `6ed931f` | tela: repetir, começar em um aparelho, designar como admin, nota da espera e CSS |
| `3100abe` | teste ponta a ponta entre dois engines com a tela real |
| `743cb64` | ajuste declarado do contrato das telas |
| `96334b9` | reforço antes das contraprovas (e um defeito a mais, achado por ele) |
| `6d7e014` | reforço dos dois pontos inertes da rodada de mutações |

## 1. O que passou a existir, e a fonte de cada dado

| Campo, rota ou função | Fonte |
|---|---|
| `recentReviews[].matTag` (índice cifrado) | `historico.indiceDe` sobre `decision.headSha`; o SHA não sobe |
| `sync.distribuicao.candidatos[{ itemId, prTag, matTag, acctTag, owner, desde, publicadores, atribuido, pr }]` | `anotarFilaDoConjunto` (`lib/engine/sync-candidatos.js`), a partir da fila que o agendador acabou de fundir mais a atribuição desta rodada; `pr` por `prDaTag` (nulo quando o catálogo não abre). Só existe no aparelho que agenda |
| `sync.distribuicao.esperando[].dev` e `.aparelhos[{ deviceId, motivo }]` | `rt.motivosDaEspera`, agora alimentado também pelo que o conjunto publicou |
| `POST /api/sync/transfer-targets` `{ itemId }` (a mesma rota, outra pergunta) | `executoresDoCandidato` lê `live/queue/{item}` (publicadores vivos e `acctTag` do item) e `motivoDoDestino` avalia cada aparelho, com `nao-publicou` novo |
| `live/assign/{item}/espera` `{ v, ttl, enc }` | veredito do agendador cifrado (`lib/engine/sync-espera.js`), escrito só pelo admin, só quando muda, com prazo de 4 minutos |
| `live/ack/{item}.detalhe` | motivo da admissão local (allowlist em `sync-distribuicao.js`) |
| motivos por aparelho (`sem-sinal`, `pausado`, `sem-vaga`, `recusou`) | `escolha.motivosPorAparelho`, PURA, na mesma ordem do filtro que decide |
| Funções puras novas | `acoesDaRevisao`, `repetirConfirmacao` (`compartilhado-historico.js`); `acoesDoCandidato`, `candidatosDoConjuntoHtml`, `inicioDialogo`, `inicioConfirmacao` (`compartilhado-posse.js`); `aparelhosDesignarAcao`, `aparelhosDesignarConfirmacao`, `aparelhosDesignacaoPendente` (`aparelhos.js`). Todas na fachada e na lista congelada |
| Tela | `repetirRevisao`, `iniciarCandidato` (`radar-compartilhado.js`), seção `#mdCandidatosWrap`; `designarAdmin`, `lerRecibosDaDesignacao` (`sistema-aparelhos.js`) |

**Três defeitos reais corrigidos, sem afrouxar gate nenhum:**

1. `repetir` conferia `pr.headSha` de um PR da fila, que a busca do GitHub não traz: todo
   repetir real voltava `head_mudou`. Passa pelo mesmo `headAtual` da tomada, e head que não
   dá para perguntar continua recusando.
2. `iniciar` comparava a tag com o head guardado no próprio candidato, o que não confere
   nada (commit novo cria item novo, e o antigo continua no mapa). O head é perguntado na
   hora, com o `headSha` do objeto deixado de fora de propósito.
3. O agendador montava a fila do conjunto com a leitura ANTERIOR à atribuição, então o item
   recém-colocado aparecia como esperando e o `iniciar` nele duplicaria o trabalho. Achado
   pelo reforço do item 3 das contraprovas.

Nenhum caminho novo escreve `manual` ou `requested` (a trava de fonte de
`test/sync-comandos-remoto.test.js` continua valendo, e a mutação M4 a exercita).

## 2. As provas

Vermelho antes da implementação: `verificacoes-saidas/tela-comandos-vermelho.txt`. Os testes
novos foram rodados contra a árvore do commit-base (`2238d5e`, extraída para fora do
worktree): **24 reprovações**, sendo 22 casos e 2 arquivos que nem carregam (importam
`sync-espera.js` e as funções puras novas). Os poucos casos novos que já passavam na base
guardam comportamento que já existia (recusa de head desconhecido, recusa por vaga,
enfileiramento que devolve código).

| Prova | Onde |
|---|---|
| repetir utilizável, corpo exato, execução e recibo | `test/sync-comandos-tela.test.js`: "repetir pela tela: o índice traz o commit, o corpo sai exato, o dono aplica e a tela lê o recibo" (corpo `{ alvo, tipo: 'repetir', args: { prTag, matTag } }`) |
| repetir indisponível com motivo | "repetir indisponível: revisão sem commit no índice, e admin sem sinal fresco, cada um com o motivo"; "repetir sem confirmação não sai"; puros em `test/ui-pure-comandos-tela.test.js` |
| repetir com estado mudado | "o head muda entre a escolha e a execução" (`head_mudou`); "o admin perde a autoridade antes de o dono ler" (`autoridade`) |
| iniciar utilizável, corpo exato, execução e recibo | "iniciar pela tela: a fila do conjunto, os executores pela rota, o corpo exato, a execução e o recibo" (`{ itemId }` e `{ alvo, tipo: 'iniciar', args: { prTag, matTag } }`) |
| iniciar indisponível com motivo | sem vaga; sem credencial da conta do item; publicação vencida; atribuição viva; admin sem sinal; escolha forjada |
| iniciar com estado mudado | "a vaga some entre a escolha e a execução" (`sem_vaga`); "o head muda entre a escolha e a execução" (`head_mudou`); executor: `test/sync-comandos-remoto.test.js` |
| designar utilizável, pendente e recibo | "designar pela tela: pedido enviado, pendente até a senha lá, e o recibo fecha a pendência" (`{ alvo, tipo: 'designar-admin', args: {} }`), com a promoção só pela senha no destino |
| designar indisponível e recusado | "designar indisponível: admin sem sinal fresco..."; "a recusa no destino chega à tela como recusa" |
| designar com estado mudado | "o admin perde a autoridade antes de o destino ler" (`autoridade`, chip "ignorou a designação") |
| motivo da espera (divergência 5) | `test/sync-espera.test.js` (13 casos: veredito cifrado, escrito só quando muda, vencido não vale, transplantado não abre, atribuição viva nomeada, recusa com detalhe, detalhe por allowlist, leitura sem candidato) e, ponta a ponta, "o motivo da espera chega a quem publicou..." no arquivo da tela |
| regras do banco | `test/sync-rules-contrato.test.js`: "live/assign/$item/espera: forma, prazo curto e envelope; a atribuição sobe por cima dele" |

Ajustes declarados de teste antigo: `sync-comandos-remoto` (dublê de `engine.headSha`),
`sync-historico` (chaves do índice), `sync-candidato` (`semAparelho` ganha `aparelhos`),
`contrato-telas` (projeção ganha `candidatos`).

## 3. Contraprovas por mutação

Script `verificacoes-saidas/tela-comandos-mutacoes.cjs` (59 mutações, limite de 4 minutos por
rodada, restauração conferida por sha256).

- Rodada 1 (`verificacoes-saidas/tela-comandos-mutacoes-1.txt`): 59 mutações, **57
  reprovaram**, 2 inertes, todas restauradas byte a byte.
- As duas inertes eram asserção fraca, e foram reforçadas (`6d7e014`): "designar sem
  confirmação" estava sendo segurada pela guarda do admin (o snapshot da tela ainda era o do
  admin sem sinal), e a leitura de recibo em curso não tinha caso nenhum. A segunda agora
  prova a ORDEM em que as duas consultas respondem.
- Rodada 2 (`verificacoes-saidas/tela-comandos-mutacoes-2.txt`): M57 e M58 reprovaram.
- Antes da rodada 1, quatro pontos que passariam em branco foram reforçados (`96334b9`), e um
  deles era defeito de verdade (a fila do conjunto sem a atribuição da rodada).
- A árvore de código terminou limpa nas duas rodadas (`git status` sem arquivo de produção
  modificado).

## 4. Gates

| Comando | Código | Saída |
|---|---|---|
| `npm run check` (rodada 1) | 0, 565 arquivos | `tela-comandos-check-1.txt` |
| `npm run lint` (rodada 1) | 0, sem regressão (a baseline não subiu) | `tela-comandos-lint-1.txt` |
| `npm test` (antes do ajuste declarado do contrato) | **1**: 4246 testes, 1 falha | `tela-comandos-test-1.txt` |
| `npm test` (rodada 1) | 0: 4246 testes, 4218 passam, 28 pulados | `tela-comandos-test-2.txt` |
| `npm run check` (final, `6d7e014`) | 0, 565 arquivos | `tela-comandos-check-2.txt` |
| `npm run lint` (final) | 0, sem regressão | `tela-comandos-lint-2.txt` |
| `npm test` (final) | 0: 4249 testes, 4221 passam, 0 falham, 28 pulados | `tela-comandos-test-3.txt` |

`npm run eng` não foi rodado: ele mora no pre-push, e nada foi empurrado.

## 5. O que ficou de fora, e a dependência concreta

- **Recibo depois do prazo do comando.** A regra do banco exige que o nó do comando ainda
  exista para o recibo entrar (`commandReceipts/$cmd` casa `dev` com `commands/$cmd/alvo`).
  Uma designação aceita depois do TTL de 15 minutos não conseguiria publicar o recibo no
  Firebase real. A tela já não mente (diz "sem recibo até X", e não "recusado"), mas a
  correção é da C6 e exige mudar a regra ou o prazo, com publicação no console.
- **Jornada visual.** Nenhuma instância do app subiu: não há captura de tela. Depende de
  rodar o Farol com dois aparelhos reais.
- **Teste com Firebase real.** As regras novas foram geradas e travadas em teste, mas não
  publicadas: a publicação é manual, do dono.
