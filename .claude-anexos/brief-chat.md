# Brief para o Claude Design: o chat do PR, legível no celular, com id e exportação

**Para quem:** o Claude Design. Este brief descreve **estados, dados e ações**, não layout.
O desenho decide onde e como; a implementação começa depois dele.

**Pedido do dono (26/09/2026):** "melhore a responsividade do chat, mostre a conversa inteira
sem essa quebra estranha, no celular fica tão espremido que nem dá pra ler. Outro ponto
importante é eu conseguir copiar o id do chat e exportar esse chat completo pra análise
externa, com os metadados como data e hora com base no horário de Brasília."

**Regras de sempre (as mesmas do brief B2):** texto em português e sem travessão; tema claro e
escuro com contraste AA; foco visível e teclado; desktop largo (1280 px ou mais) e celular
estreito (360 a 400 px) sem rolagem horizontal da página; alvo de toque de 44 px; dados
sintéticos ("acme-exemplo", "Ana Exemplo"); nada de biblioteca, fonte ou ícone remoto; falha não
se disfarça de vazio; menções navegáveis (PR leva ao PR no GitHub). Vocabulário visual do app
atual (`ui/app.css`: `--surface`, `--surface-2`, `--border`, `--accent`, `--info`, `--muted`,
`.btn`, `.pill`), o mesmo que os quadros do B2 copiaram em `comum.css`.

## Onde isso vive hoje

O chat não é aba: é um painel que abre por cima de qualquer tela, pelo botão de conversa de um
PR (Radar, Revisões recentes, Meus PRs) ou pela busca de URL.

- **Computador:** painel fixo à direita, `min(460px, 92vw)` de largura, altura inteira. No app
  Electron, o cabeçalho reserva 150 px à direita para os controles da janela (minimizar,
  maximizar, fechar), que ficam por cima do painel.
- **Abaixo de 720 px:** vira folha que sobe de baixo, 86% da altura, com uma alça no topo.
- **Partes:** cabeçalho (chave do PR, link "abrir PR", botão fechar), lista de mensagens, linha
  de atividade (o que o Claude está fazendo agora, uma linha só), campo de texto com Enviar e
  Parar.
- **Mensagens:** as suas à direita, texto puro; as do Claude à esquerda, em Markdown renderizado
  (títulos, listas, negrito, código em linha, blocos de código, tabelas, links); as do Farol ao
  centro, pequenas ("geração interrompida por você", "falha: ...").

## O defeito que motivou (medido no código, não é gosto)

Cada resposta do Claude aparece **cortada, com uma barra de rolagem própria dentro do balão**
(a captura do dono mostra duas respostas assim, uma embaixo da outra). A causa: a lista é uma
coluna flex e o balão herda `max-height: 480px; overflow: auto` do estilo de relatório
(`.report`), então o navegador ENCOLHE cada balão para caber e cria uma rolagem dentro de cada
um. No celular a folha é mais baixa e o efeito piora até ilegível.

**O que o desenho precisa garantir:** a conversa rola como UMA coisa só; nenhuma mensagem tem
rolagem própria na vertical; mensagem longa aparece inteira. A única rolagem horizontal
aceitável é a de um bloco de código ou tabela largos, dentro deles mesmos, nunca a página.

## O que a tela precisa permitir

1. **Ler a conversa inteira** no computador e no celular, incluindo respostas longas com
   títulos, listas aninhadas, blocos de código e tabelas.
2. **Copiar o id da sessão do Claude** da conversa. É um UUID
   (`0c5d0945-0d49-4567-895b-4d50408b418d`), o mesmo que `claude --resume <id>` usa, e é o que o
   dono cita para análise externa. Precisa dizer o que é (não um número solto).
3. **Exportar a conversa completa** num arquivo. O engine já entrega (ver "Dados") o arquivo em
   Markdown e o mesmo conteúdo em JSON; o desenho decide se a tela oferece os dois ou só o
   Markdown, e como (baixar, copiar, ou ambos). No celular (navegador no Android, via Termux)
   baixar arquivo pode não ser natural: copiar o conteúdo é o plano B que precisa existir.
4. **Continuar conversando** sem perder nada disso: o campo de texto, Enviar, Parar e a linha de
   atividade seguem existindo.

## Estados obrigatórios

| estado | quando | o que a tela diz |
|---|---|---|
| carregando | abriu o painel, a conversa ainda não chegou | carregando, sem piscar vazio |
| vazio | PR sem conversa | o convite que existe hoje ("Converse com o Claude sobre ..."); copiar id e exportar não aparecem ou aparecem desabilitados com o motivo |
| sem sessão ainda | há mensagem sua, mas o Claude ainda não respondeu a primeira vez | o id não existe ainda: dizer isso, não mostrar botão que copia nada |
| respondendo | a resposta está sendo gerada | a linha de atividade e o indicador de digitação; exportar agora sai com a resposta marcada "ainda sendo gerada" (o engine já marca), e o desenho decide se avisa antes |
| id copiado / falha ao copiar | clicou em copiar | confirmação curta; se a área de transferência recusar (navegador sem permissão, comum no celular), mostrar o id selecionável para copiar à mão |
| exportado / falha ao exportar | clicou em exportar | confirmação com o nome do arquivo; falha com motivo ("não há conversa deste PR para exportar", ou a rota falhou), nunca um arquivo vazio |
| conversa maior que a janela | mais de 100 mensagens | a tela mostra as últimas 100; dizer isso e que a exportação traz todas |
| conversa no teto de retenção | 200 mensagens guardadas | o Farol guarda as 200 mais recentes; o arquivo já avisa; a tela pode avisar também |
| falha na conversa | mensagem do Farol "falha: ..." | como hoje, legível, sem esconder o motivo |

## Dados reais para o desenho (sintéticos)

- Cabeçalho: `acme-exemplo/app#42`, link para o PR.
- Id: `0c5d0945-0d49-4567-895b-4d50408b418d`.
- Uma pergunta sua curta ("refaça o review com opus, tem alguma diferença de resultado com
  relação ao modo auto?").
- Uma resposta do Claude longa: parágrafo, lista numerada com negrito, uma lista com código em
  linha (`useMiaChatReal.ts`, `5c54547`), um bloco de código de umas 8 linhas com uma linha mais
  larga que o celular, e uma tabela de 3 colunas.
- Uma mensagem do Farol: "geração interrompida por você".
- Nome do arquivo exportado: `farol-chat-acme-exemplo-app-42-2026-09-26-1306.md`.
- Cabeçalho do arquivo exportado (o que já sai do engine, para o desenho mostrar uma prévia se
  quiser):

```
# Conversa do Farol: acme-exemplo/app#42

Horários no horário de Brasília (America/Sao_Paulo), com o fuso explícito em cada linha.

| campo | valor |
|---|---|
| PR | acme-exemplo/app#42 |
| Link | https://github.com/acme-exemplo/app/pull/42 |
| Id da sessão do Claude | `0c5d0945-0d49-4567-895b-4d50408b418d` |
| Conversa iniciada em | 2026-09-26 13:06:12 -03:00 |
| Exportada em | 2026-09-26 14:06:12 -03:00 |
| Mensagens | 3 |
| Versão do Farol | 2.62.22 |

---

### Você · 2026-09-26 13:06:12 -03:00

refaça o review com opus ...
```

## O que já está pronto no engine (não precisa desenhar)

- `GET /api/chat/export?key=<owner/repo#N>` devolve `{ ok, nome, markdown, json }` ou
  `{ ok: false, error }`. A conversa inteira guardada, os metadados acima, o horário de cada
  mensagem em Brasília com o fuso explícito (e em ISO no JSON), e segredo colado na conversa
  sai mascarado, porque o arquivo vai para fora do app.
- `GET /api/chat` passou a trazer `sessionId` (ou `null`) e `createdAt` junto das mensagens.

## Celular

A folha precisa caber em 360 px e ser LEGÍVEL: texto da resposta no tamanho de leitura, sem
balão estreito espremendo a resposta (hoje o balão ocupa no máximo 92% de uma folha já estreita).
As ações novas (copiar id, exportar) não podem roubar a altura da conversa nem empurrar o campo
de texto para fora da tela quando o teclado abre. A alça e o fechar continuam alcançáveis com o
polegar.
