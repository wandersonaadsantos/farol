# Brief para o Claude Design: controlar o celular pelo computador

**Para quem:** o Claude Design. Este brief descreve **estados, dados e ações**, não layout. O
desenho decide onde e como, e pode reorganizar as telas do conjunto de aparelhos à vontade.

**Pedido do dono (28/09/2026):** "O aparelho admin é o mais capaz, e por isso eu uso ele com
frequência. Pelo aparelho admin eu quero ver e tomar decisões do que acontece no meu celular,
pois quero deixar ele no canto sem mexer nele, e tomar todas as decisões e atualizar a fila do
celular pelo computador também. Se precisar redesenhar a tela, sem problemas."

**Regras de sempre:** texto em português e sem travessão; tema claro e escuro com contraste AA;
foco visível e teclado; desktop largo (1280 px ou mais) e estreito (360 a 400 px) sem rolagem
horizontal da página; alvo de toque de 44 px; dados sintéticos ("acme-exemplo", "Ana Exemplo",
"Celular da Ana"); nada de biblioteca, fonte ou ícone remoto; **falha não se disfarça de vazio**
(carregando, falhou e vazio são três estados diferentes); menções navegáveis (PR leva ao PR no
GitHub, pessoa leva ao perfil, sempre com foto). Vocabulário visual do app atual, anexado em
`app.css`: `--surface`, `--surface-2`, `--border`, `--accent`, `--info`, `--muted`, `.btn`,
`.pill`, `.card`, `.sync-chip`.

## Quem usa e como

- **O computador é o admin do conjunto.** É onde o dono passa o dia. Ele também revisa a própria
  fila (a aba Radar, sub-aba "Pra mim", seção "Sua fila", com o botão Revisar em cada PR).
- **O celular é um executor.** Fica no canto, ligado, revisando os PRs pedidos à conta do GitHub
  dele. O dono não quer tocar nele.
- Pode haver mais de um executor (um notebook velho, outro celular). O desenho precisa funcionar
  com um, dois ou três aparelhos, e com nenhum além do admin.

## Onde as coisas vivem hoje (a captura anexa é o estado atual)

Abas de topo: Radar, Entregas, Time, Consumo, Sistema. No Radar, sub-abas "Pra mim", "Meus PRs"
e "Panorama". Em "Pra mim", abaixo de "Sua fila", o admin vê, uma embaixo da outra:

1. **Precisa de você em todos os aparelhos:** pendências de outros aparelhos. Cada card traz o
   aparelho, o PR, veredito e motivos, "Decidir no X…", "Ver review completo" e "Marcar como visto".
2. **Em outros aparelhos:** revisões rodando agora, com etapa, tempo, modelo, as últimas linhas
   de atividade, Cancelar e Transferir.
3. **Esperando colocação no conjunto:** itens da distribuição, com "Começar em um aparelho…".
4. **Revisões de todos os aparelhos:** o histórico, com "Ver revisão" e "Repetir".

Em Sistema > Aparelhos: lista de aparelhos (nome, sistema, versão, visto por último),
renomear, aposentar, designar admin e a **Política** de cada aparelho (pausar, teto de revisões
ao mesmo tempo, tipos de operação).

O problema: tudo isso fala de **operações soltas**. Não existe um lugar que responda "o que está
acontecendo no meu celular e o que eu faço com ele".

## O que a tela precisa permitir

Tudo pelo computador, sem tocar no celular:

1. **Ver o celular de relance:** se está vivo, o que está fazendo agora, o que espera por mim.
2. **Ver a fila do celular inteira**, PR a PR, com o estado de cada um e o porquê.
3. **Mexer na fila:** revisar agora, destravar o que parou, ignorar, restaurar, ocultar, mostrar.
4. **Decidir** o que o celular revisou (já existe; precisa morar junto com o resto do celular).
5. **Acompanhar ao vivo** as revisões rodando lá, e cancelar ou transferir (já existe).
6. **Ver o estado do aparelho:** pausado, ocupação, IA pronta, versão, consentimento, falhas
   recentes. Pausar e retomar (já existe na Política).
7. **Mudar a configuração da conta do celular:** revisar sozinho, silenciar, e o que fazer ao
   aprovar, com ressalvas e ao reprovar.
8. **Saber o que aconteceu com cada coisa que mandou:** um comando vai pelo banco e o celular
   aplica no ciclo dele (até uns 10 s). Enviado, aplicado, recusado (com o motivo em português)
   e vencido são estados diferentes.

## Dados de cada parte

### O aparelho

- Nome ("Celular da Ana"), sistema ("Android"), versão do Farol ("2.64.2"), visto por último.
- Vivo: visto nos últimos 3 minutos. Sem sinal: mais que isso. Aposentado: fora da frota.
- Aceita comandos do admin: sim ou não. **Sem isso nenhuma ação remota funciona**, e ligar só se
  faz no próprio celular, uma vez (Sistema > Aparelhos > "Aceitar políticas e comandos do admin").
- Pausado pelo admin: sim ou não. Revisões ao mesmo tempo: teto (1 a 4) e ocupadas agora.
- IA pronta (Claude Code instalado e logado): sim ou não.
- Contas do GitHub nele, com token válido ou não.
- Até 3 falhas recentes: tipo ("limite do plano", "credencial expirada", "falhou ao abrir a
  sessão"), quando e em qual PR.
- Versão antiga: aparelho que ainda não publica a fila nem aceita os comandos novos. A tela
  precisa dizer "atualize o Farol no celular" em vez de mostrar uma fila vazia.

### A fila do celular

Um PR por linha, com repositório, número, título, autor (com foto), conta, quando foi pedido e
o **estado**:

| estado | frase curta de exemplo | ações possíveis |
|---|---|---|
| esperando | "na fila, a revisão automática vai pegar" | revisar agora, ignorar |
| sem automática | "a conta não revisa sozinha" | revisar agora, ignorar, ligar a automática da conta |
| revisando | "revisando agora, 2 min, lendo o diff" | cancelar, transferir, ver ao vivo |
| decidir | "revisado: aprovar, 3 motivos" | decidir, ver review completo |
| estacionado | "parou: falhou 3 vezes seguidas, ontem 14:10" | revisar agora (destrava) |
| retry | "esperando nova tentativa depois de falha de rede" | revisar agora |
| saiu de cena | "outra pessoa pegou este PR" | revisar agora (o celular pode recusar, e diz por quê) |
| limite do plano | "assinatura no limite até 18:00" | nenhuma até o reset |
| espera do grupo | "teto de consumo do grupo segura" | nenhuma |
| visto | "já revisado" | revisar de novo |
| ignorado | "não volta para a fila" | restaurar |

Contagens por estado ajudam: quantos esperando, quantos pedindo decisão, quantos parados.

### A configuração da conta do celular

Por conta, com os mesmos textos da tela local de Contas: revisar sozinho (sim/não), silenciada
(sim/não), aprovável sem ressalvas ("aprova sozinho" ou "espera você aprovar"), aprovável com
ressalvas ("aprova e destaca as ressalvas" ou "espera você aprovar"), com blocker ("espera você
(padrão)" ou "reprova sozinho (posta pedir mudanças)"). A tela mostra o valor atual (o que o celular publicou) e deixa trocar. **Ligar a
aprovação automática à distância é permitido** (decisão do dono), mas a tela precisa deixar
claro que o celular vai postar sozinho no GitHub dali em diante.

## Estados obrigatórios (cada um desenhado)

- Nenhum outro aparelho no conjunto (só o admin).
- Um celular vivo, aceitando comandos, com fila cheia (8 a 12 PRs em estados variados).
- O mesmo celular sem aceitar comandos: tudo visível, ações desabilitadas com o motivo e onde
  ligar.
- Celular sem sinal há 2 horas: a fila mostrada é a última conhecida, com a idade dela.
- Celular em versão antiga.
- Carregando a primeira leitura; leitura que falhou; fila vazia de verdade.
- Um comando em cada estado: enviado, aplicado, recusado ("outra pessoa pegou este PR, e lá o
  Farol saiu de cena"), vencido.
- Confirmação antes de ligar a aprovação automática da conta do celular.
- Dois executores (celular e notebook), para ver como a tela escala.
- Largura estreita (360 px) de pelo menos a fila e o painel do aparelho.

## Perguntas que o desenho responde

- Onde mora o "meu celular": aba nova, sub-aba do Radar, página por aparelho em Sistema? A
  "Sua fila" do próprio computador continua onde está.
- As seções atuais do conjunto ("Precisa de você…", "Em outros aparelhos", "Esperando
  colocação", "Revisões de todos os aparelhos") ficam, se fundem na visão por aparelho ou somem?
- Como a fila se agrupa e filtra por estado.
- Onde aparecem o retorno de cada comando e o histórico dos que foram enviados.

## Entrega esperada

Quadros dos estados acima e um `HANDOFF.md` com a marcação, o CSS com os tokens do app e o texto
exato de cada estado e de cada botão.
