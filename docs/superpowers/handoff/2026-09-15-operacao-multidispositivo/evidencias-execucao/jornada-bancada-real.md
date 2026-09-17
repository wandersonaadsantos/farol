# Bancada com engines reais contra os emuladores oficiais (16/09/2026)

Três instâncias REAIS do Farol (`node server.js`, o código da branch de integração) rodando
ao mesmo tempo, cada uma com pasta de dados, identidade e porta próprias, ligadas aos
emuladores oficiais do Firebase com o arquivo de regras do commit carregado.

Só duas coisas são dublês, nas fronteiras externas: o `gh` (`bancada-real/gh-falso3.mjs`,
que responde consultas de leitura de PRs sintéticos e recusa qualquer postagem) e a sessão
de IA (`stub-sessao.cjs`, que fica viva 90 s e devolve prosa). Nenhum dos dois decide
distribuição, transferência, tomada, admissão, posse ou recibo: isso é o engine real.

## O ambiente

| peça | valor |
|---|---|
| emuladores | contêiner `farol-emuladores`, firebase-tools 15.30.1, Java 21, banco em 9000, auth em 9099 |
| projeto | `demo-farol`; as regras valem no espaço `demo-farol-default-rtdb`, que é o `projectId` configurado nos aparelhos |
| regras | `firebase/database.rules.json` do commit, carregado no emulador |
| usuário | `bancada@demo.local`, senha de teste, uid `nL0XoVGaMIHWWn8wtkfWsG9OKa0o`, criado no emulador |
| aparelhos | `real-a` (47301, admin inicial, autoReview desligado), `real-c` (47302), `real-d` (47303) |
| roteiro | `bancada-real/subir-bancada.sh` sobe os três, faz login e destrava o chaveiro |

## O que ficou provado

1. **Login, chaveiro e frota.** Os três entram com e-mail e senha no emulador de Auth,
   criam e abrem o chaveiro sob as regras reais e formam frota de 3 (`contract: 2`,
   `keyReady: true`).
2. **Admin e batimento.** `A` virou admin na geração 1 e o batimento assinado saiu no
   `live/control/beat`; os outros dois leram autoridade fresca.
3. **Coleta e publicação de candidato.** PR novo revelado pelo dublê do `gh`: `C` e `D`
   publicaram o MESMO item (mesmo PR, mesmo head) em `live/queue`, cada um como publicador,
   com o nome do owner cifrado.
4. **Agendamento e aceite.** O admin atribuiu em `live/assign` com assinatura e geração;
   o escolhido respondeu `aceita` em `live/ack` com o id da reserva de admissão, enfileirou
   pelo ramo local e executou a sessão; o outro viu o item como "esperando" com o motivo
   vindo do conjunto.
5. **Comandos e recibos.** O admin emitiu comando cifrado e assinado; o alvo aplicou,
   recusou com `nada_rodando` e gravou o recibo; o emissor leu o desfecho pela rota real.
6. **Designação de admin (item A do adendo).** O admin da geração 1 designou `C`; `C`
   aceitou com usuário e senha no emulador; a geração foi para 2, o recibo do comando saiu
   como `aplicado`, o batimento passou a ser de `C` e o admin anterior passou a receber
   `nao-e-admin` ao tentar comandar. Uma escrita de comando carimbada com a geração
   anterior é recusada pelas regras (401) e a mesma com a geração vigente entra (200),
   medido com credencial de USUÁRIO em `bancada-real/probe-geracao.mjs`.
7. **Espera por posse alheia (item B do adendo).** Reproduzido com o coletor real. Ver
   abaixo: era defeito do produto, não do simulador, e foi corrigido com teste.

7. **Transferência (7.C7b).** A tela oferece os destinos com o motivo de cada inapto
   (`dono-atual`, `sem-vaga`), o comando sai assinado, a origem encerra a sessão e o
   DESTINO passa a executar, inclusive quando ele não tinha publicado o candidato.
8. **Tomada (7.C8).** O comando com confirmação toma o lease vivo do outro aparelho: o
   tomador registra a evidência com geração e risco, o tomado registra a tomada sofrida e
   encerra a sessão dele (`verificacoes-saidas/bancada-real-transferencia-tomada.txt`).
9. **Panorama e Meus PRs de outro aparelho.** O terceiro aparelho lê o Panorama publicado
   por um e os Meus PRs publicados por outro, com os títulos abertos pelo catálogo cifrado,
   a origem e o estado de frescor.
10. **Autenticação, recusa e recuperação.** Senha errada no login, senha errada no
    chaveiro e e-mail desconhecido são recusados com o mesmo código e não derrubam o que já
    estava conectado; a senha certa reconecta e reabre o chaveiro
    (`verificacoes-saidas/bancada-real-autenticacao.txt`).

## Os defeitos que a bancada revelou

Nenhum deles aparecia na suíte, porque os testes construíam o caso já resolvido.

| # | defeito | correção |
|---|---|---|
| 1 | O PR do caminho automático chega ao `enqueueHeadless` SEM head (o head só é lido dentro do `runHeadlessReview`), e o candidato precisa dele: a publicação devolvia `forma` e **a primeira revisão de um PR novo nunca distribuía** | `publicarComHead`: quem distribui lê o head antes de publicar; `knownHead` do relançamento manda |
| 2 | Vaga de admissão reservada no aceite ficava presa quando o enfileiramento não levava o item (saída de cena, duplicado): com teto 1 o aparelho recusava toda atribuição seguinte por `sem_vaga`, sem nada rodando | `enfileirarDaDistribuicao` devolve a vaga quando o item não entra |
| 3 | Os quatro caminhos que pedem a senha de novo seguiam usando o ID token do login. As regras exigem senha RECENTE (`auth_time` + 5 min) para trocar o admin e para limpar dados: **designar admin falhava sempre** depois de alguns minutos de sessão, com a mensagem errada ("outro aparelho virou admin") | a fonte de token adota a entrada da re-autenticação |
| 4 | A atribuição fica viva no banco até o prazo, e era reavaliada a cada giro: a resposta era reescrita a cada dez segundos e a **espera nunca vencia**; um aparelho chegava a recusar por falta de vaga uma atribuição que ele mesmo tinha aceitado | cada atribuição é respondida uma vez, por (revisão, prazo) |
| 5 | O passo 9 do anexo S3 (FECHAR E LIMPAR) não existia: o item seguia vivo depois da sessão, o agendador atribuía de novo quando a atribuição vencia e o **mesmo head rodava outra vez**, gastando uma sessão por rodada | `67686d2` |
| 6 | Transferir para um aparelho que não publicara o candidato voltava `aplicado` e **o PR nunca chegava lá**; depois, a sessão encerrada pela transferência **fechava o item**, apagava o registro com a preferência e a origem estacionava o PR como "cancelada por você" | `7d4e7e1`, `d411b31`, `7d8a8b3` |
| 7 | A **tomada era impossível** sob as regras publicadas: a regra do nó permitia, a do campo `deviceId` não tinha o ramo, e escrita direta no campo não roda a validação do pai. O app dizia "Firebase indisponível" | `8d36289` |
| 8 | O aparelho TOMADO não percebia: o tratamento da tomada no batimento era inalcançável, e a sessão dele seguia até o fim, gastando o provedor duas vezes | `0b4bce0` |
| 9 | `live/control/revokedBefore` era gravado e **nenhuma regra o consultava**: a revogação não cortava nada, embora o contrato C1 definisse a cláusula NR | `379235d` |
| 10 | 401 do banco era sempre transitório, então o aparelho recusado ficava **em laço**, com a tela dizendo "conectado" | `0424ab8` |

O defeito 4 é exatamente o caso das republicações repetidas do item B. Amostragem antes da
correção (`esperaAte` andando a cada giro, e `aceita` virando `recusada sem_vaga` no item
que o próprio aparelho tinha aceitado) e depois (uma resposta por atribuição, espera
estável, dois PRs novos aceitos um por aparelho) estão em
`verificacoes-saidas/bancada-real-espera-antes.txt` e `-depois.txt`.

## Limites desta bancada

- A sessão de IA é dublê: o que se prova aqui é o ciclo do Farol (vaga, lease, fila,
  recibo), não a qualidade de uma revisão.
- O GitHub é dublê: nada é postado, e a coleta parte de PRs sintéticos.
- Latência entre aparelhos físicos, Termux e provedor real continuam fora, como combinado.

- **O corte de sessões não é reproduzível ponta a ponta aqui.** O emulador de Auth carimba
  `auth_time` por USUÁRIO (o último login por senha da conta), e não por sessão: qualquer
  aparelho que renove o token depois do login da revogação herda a hora nova e escapa do
  corte. No Firebase real o `auth_time` é da sessão. O que ficou provado aqui é a regra (o
  executor recusa um token mintado antes do corte, com espera real de `auth_time`) e o
  comportamento do app diante do 401 (casos (c2) e (c3) de `test/sync-engine.test.js`). A
  confirmação no projeto do dono continua pendente, como o contrato C1 já declarava.