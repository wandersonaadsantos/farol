# Jornada na bancada de dois e três aparelhos, 16/09/2026 à noite

Validação das lacunas fechadas na rodada final (transferir, tomar, iniciar, repetir, decidir,
cancelar, designar admin, Panorama e Meus PRs remotos, nome dos PRs), na aplicação isolada, com
as camadas reais do Farol. Tudo foi percorrido pelo navegador embutido, no aparelho A, que é o
app de verdade (`node server.js`) com `FAROL_HOME` isolado.

## 1. A bancada e a fronteira do que é simulado

Scripts guardados em `bancada/`, para refazer:

| Peça | O que é | Simulado? |
|---|---|---|
| `bancada.mjs` | serve o dublê do Realtime Database e o dublê do login (os mesmos dos testes) nas portas 47290 e 9099, que o Farol usa quando o banco é http local | **sim**: o banco não aplica as regras de segurança do Firebase |
| aparelho A | o app real, porta 47201, `FAROL_HOME=bancada-a`, com `node --import gh-falso.mjs` e `FAROL_HEADLESS_CMD=node stub-sessao.cjs` | GitHub e sessão de IA simulados (abaixo); engine, rotas, tela e sincronização são os reais |
| `gh-falso.mjs` | troca `io.run` só no processo de A: a busca "pedido a mim" devolve um PR sintético, o token é texto falso, o head é fixo; todo o resto falha com "não simulado" | **sim**: nada sai da máquina, nada é postado |
| `stub-sessao.cjs` | o comando de sessão headless de A: fica 90 s vivo e devolve prosa (revisão não concluída) | **sim**: nenhuma sessão de modelo existe |
| `aparelho-simulado.mjs` | aparelhos C (origem) e D (destino): um `Engine` real, sem UI, rodando o relógio real da visão compartilhada (`ciclo`) contra o banco de teste | sessão, GitHub, `decide` e `cancelSession` só registram; a posse é adquirida pelo mesmo `syncAdmit` de uma sessão real, e a vaga de admissão é devolvida como o engine faz |

Os três "aparelhos" são processos na mesma máquina. **Nada disto vale como validação física em
Termux ou em dois aparelhos reais.** Confirmado durante a tomada: o único filho do processo de A
era o `cmd.exe` do stub; nenhum `claude.exe` foi aberto pelo Farol.

## 2. O que foi percorrido, e o desfecho

| Jornada | Caminho na tela | Desfecho observado |
|---|---|---|
| Chave do conjunto | Sistema > Sincronização, senha errada e depois certa | recusa com o motivo do engine e campo limpo; depois "pronta" |
| Tornar admin | Sistema > Aparelhos | "este aparelho é o admin, geração 1" |
| Nome dos PRs | Radar, "Precisa de você" e "Em outros aparelhos" | PR nomeado pelo catálogo, com título e autor; ações indisponíveis dizem por quê (sem admin, admin sem sinal) |
| Transferir, inelegível | "Transferir" no andamento | lista com cada motivo: "sem credencial desta conta", "é o aparelho que roda a análise agora", "sem vaga" |
| Transferir, elegível | "Transferir para Notebook de viagem", confirmação | recibo `aplicado`; a origem encerrou a sessão (e soltou a posse) e o destino recebeu e começou; o andamento passou a mostrar o destino |
| Tomar | "Tomar para este aparelho" no andamento do destino | aviso lido da posse real ("duplicidade provável"), confirmação, recibo `aplicado`, "Tomadas feitas por este aparelho" com geração 2; A abriu só a sessão do stub |
| Repetir | "Revisões de todos os aparelhos", "Ver revisão" e "Repetir" | corpo aberto sob demanda; três desfechos na mesma jornada: `recusado` ("aquele aparelho não conhece o PR", o PR tinha saído da busca de lá), `ignorado` ("o admin estava sem sinal fresco", logo depois de a origem reiniciar) e, com o PR de volta e o sinal visto, `aplicado` com a análise enfileirada na origem |
| Decidir | "Decidir no Desktop da sala…", Aprovar | recibo `aplicado`; a origem recebeu `decide(p-1, approve)` |
| Cancelar | "Cancelar" no andamento, confirmação | recibo `aplicado`; o destino encerrou a sessão |
| Iniciar | "Esperando colocação no conjunto", "Começar em um aparelho…" | indisponível com motivo enquanto o distribuidor esperava um aceite; depois, lista com os inaptos ("não publicou este candidato") e o apto; recibo `aplicado`; o destino recebeu e começou |
| Designar admin | Aparelhos, "Designar como admin" | confirmação que diz o que acontece e o que não acontece; "designação pendente" até o recibo (ninguém digitou a senha no destino) |
| Panorama remoto | Radar > Panorama | "4 PRs: 1 deste aparelho e 3 de 1 outro", com origem, hora e só leitura |
| Meus PRs remoto | Radar > Meus PRs | "1 PR: 0 deste aparelho e 1 de 1 outro", ramo, estado de merge de lá e merge desabilitado |
| Estreito, 390 px | Radar e Aparelhos, com diálogo aberto | `scrollWidth == 390`, nenhum botão abaixo de 44 px, diálogo dentro da largura |

## 3. Defeitos que a jornada achou, todos corrigidos com teste vermelho e contraprova

| Defeito | Correção |
|---|---|
| abrir a chave não reescrevia a presença: por até 5 min os outros viam o aparelho "sem chave", e a lista local também | `a7faa9d`, `6e32bbe` |
| com a lista de aparelhos velha, o portão da frota recusava o giro inteiro, e o admin ficava sem batimento | `7217b83` (relê a frota, no máximo uma vez por minuto) |
| erro na coleta do GitHub pulava a sincronização | `a95d3c9` |
| andamento recém-começado mostrava ", Opus 5" | `1457606` |
| o recibo só aparecia com um snapshot novo do estado | `1be5807` |
| o aviso da tomada mostrava o código "provavel" | `e3132b2` |
| aparelho sem a lista de uma conta publicava lista vazia por cima da dos outros (e, com a correção anterior, o arranque a frio faria o mesmo) | `24ee0fb` |
| revisões de outros aparelhos ficavam sem nome, porque o catálogo não tinha os PRs que já saíram da fila | `43adc9a` |

## 4. Observações medidas, sem correção nesta rodada

- **Autoridade depois de reiniciar o admin:** 99 a 304 s até o batimento contar como fresco. Por
  desenho, o primeiro valor lido depois de conectar não prova que o admin está vivo, e o
  batimento sai a cada 2 min. A tela diz "o admin está sem sinal fresco" nesse intervalo.
- **Aparelho novo na lista de quem já tem frota:** aparece no carimbo seguinte (até 5 min). A
  releitura acelerada só acontece quando o portão recusa.
- **Comandos enviados somem ao reiniciar o app:** o registro é local e em memória; o recibo
  continua no banco.
- **Recusas "alheio" repetidas no destino simulado:** o simulador republica o candidato a cada
  giro; no engine real, a recusa por posse alheia vira espera local de 120 s e o PR não é
  republicado enquanto ela vale. Nenhuma sessão de IA é aberta nas duas situações.
- A captura de tela do navegador embutido às vezes mostra a página deslocada para baixo; o DOM
  confirma o topo no lugar (`elementFromPoint` e `getBoundingClientRect`). Por isso a
  evidência desta jornada é textual.
