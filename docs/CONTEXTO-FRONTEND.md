# Contexto de frontend e modos de seleção

## Expectativas declaradas antes da bateria

A bateria usa fontes sintéticas congeladas em H/B/M. Relação sintática comprova que a
declaração está naquele arquivo; não comprova execução, correção de props ou contrato.
Resolver um caminho relativo explícito existente é evidência de dependência de arquivo.
Aliases, resolução sem extensão e chamadas CommonJS são candidatos que exigem confirmação.
Dependências dinâmicas e falhas do parser permanecem não resolvidas explicitamente.

| Caso | Evidência necessária | Limite esperado |
|---|---|---|
| JS/JSX, consumidor de componente e mudança de props | Import do componente e consumidor fora do patch recuperado | Uso sintático não prova compatibilidade das props |
| TS/TSX, hooks e contrato compartilhado | Caminhos hook → contrato e componente → hook, inclusive no M | Sem inferência de tipos, chamadas ou fluxo de dados |
| Imports somente de tipos | Relação preservada com natureza `type` | Não confundir com dependência de runtime |
| Alias configurado | Configuração e destino existente registrados | Candidato, sem executar config ou resolver plugins |
| Barrels, reexports e `export *` | Arestas consumidor → barrel → origem | `export *` não prova qual binding foi usado |
| CommonJS misturado com ESM | `require` literal como candidato; import estático como sintaxe | Binding `require` pode estar sombreado |
| Rename e delete | Relação antiga recupera consumidor mesmo sem destino no H | M é a comparação; B não o substitui |
| Alteração de resolução | Arquivos inalterados permanecem candidatos à investigação | Mudança de config não autoriza herdar validade automaticamente |
| Import dinâmico | Limitação explícita e caminho candidato quando literal | Expressão calculada fica não resolvida |
| Sintaxe inválida/não suportada | Arquivo permanece no mapa, fallback identificado e investigação ampliada | Nunca transformar falha em ausência de impacto |
| Conteúdo com efeitos de topo | Extração funciona; marcador externo não é criado | Somente parsing de texto, sem import, eval, execução ou resolução do projeto |

## Modos

`off` é o padrão. Os três modos mantêm a preparação comum de fontes e patches,
autorização, cache de conteúdo, gates e leitura verificável. O modo não promove
disponibilidade em cache a evidência de análise.

| Trabalho | off | observe | assist |
|---|---|---|---|
| Aquisição comum e cache de fontes | Sim | Sim | Sim |
| Construção do mapa sintático | Não | Sim | Sim |
| Seleção limitada de trechos | Não | Sim, só medição | Sim |
| Injeção dos trechos novos no prompt | Não | Não | Sim |
| Alterar herança pela seleção | Não | Não | Sim, conservadoramente |
| Falha do mapa/seleção | Não se aplica | Diagnóstico; prompt comum preservado | Fallback, sem bloco parcial e sem herdar validade pelo mapa |

Os testes comparam os prompts completos de `off` e `observe` nos dois fluxos,
mantendo fontes, contexto comum e resultado do provedor iguais. Métricas observacionais
podem diferir; payload de publicação, decisão e herança devem permanecer iguais.

## Limites de memória

O teto de 4 MiB contabiliza a serialização UTF-8 das análises sintáticas retidas no
cache do processo principal. Não inclui objetos JS, chaves, textos enviados ao worker,
AST transitória, heap do worker, runtime ou cache de fontes. Não representa a RAM total.
Não há índice sintático persistido; após reinício a análise é refeita sobre fontes
congeladas ou cache de conteúdo disponível.

## Parser escolhido e custo observado

O parser V8 anterior não lê JSX/TSX no Node 22.12 e não conserva relações somente
de tipos. A bateria confirmou uma lacuna material para frontend. Foi adotado
`@babel/parser` **7.28.5 exato**, usado somente para gerar AST, sem Babel core,
transpilação, bundler, resolução de plugins ou execução de fontes. Os plugins de
gramática TS e JSX são recursos internos do parser. O worker deixou de precisar de
`--experimental-vm-modules`.

Metadados oficiais do npm: parser 7.28.5 tem cerca de 1,99 MB descompactado;
`@babel/types` 7.28.5 acrescenta cerca de 2,75 MB e dois helpers pequenos.
O lock resolvido nesta entrega inclui `@babel/types` 7.29.11, também cerca de 2,75 MB;
essa versão estava presente na instalação npm das primeiras medições. O bundle do
parser não a carrega em runtime.
TypeScript 5.9.3 completo teria cerca de 23,6 MB. Babel 8.0.8 exige Node 22.18 ou
24.11 e não atende ao mínimo 22.12. O parser 7.28.5 declara Node >=6.0.
Fontes: [parser 7.28.5](https://registry.npmjs.org/@babel/parser/7.28.5),
[types 7.28.5](https://registry.npmjs.org/@babel/types/7.28.5),
[TypeScript 5.9.3](https://registry.npmjs.org/typescript/5.9.3),
[parser 8.0.8](https://registry.npmjs.org/@babel/parser/8.0.8).

Medição pontual reproduzível com `node tools/medir-parser-frontend.js`, 120 arquivos
TSX sintéticos, Windows x64, sem modelo. Valores são observações locais, não promessa
de consumo de uma revisão real:

| Runtime | Primeira análise | Outra análise, mesmos blobs autorizados | Cache serializado | Heap do worker após parse | Pico RSS do processo |
|---|---:|---:|---:|---:|---:|
| Node 22.12.0 | 71,97 ms, 120 parses | 0,40 ms, zero parses | 59.900 bytes | 10,41 MB | 67.900 KiB |
| Node 24.15.0 | 62,89 ms, 120 parses | 0,34 ms, zero parses | 59.900 bytes | 11,24 MB | 74.776 KiB |

CPU e RSS incluem o processo inteiro e suas threads. Heap antes/depois é uma amostra
do isolate, não o pico. Outra conta refaz os 120 parses; outro processo também começa
frio. A medição usa uma análise distinta com caminhos renomeados para demonstrar
reuso por autorização/blob/extensão. As primeiras medições carregaram o pacote npm
em diretório temporário com `NODE_PATH`; a junction do checkout pessoal não foi
alterada. A validação de distribuição encontrou que upgrades podem preservar
`node_modules` antigos e preparam apenas Electron. Por isso o runtime usa o bundle
oficial CJS **512.279 bytes**, copiado byte a byte para
`assets/third-party/babel-parser/dist/parser.cjs`, com licença MIT e manifesto
SHA-256. Esse é o caminho canônico, sem fallback npm. Source maps, declarações e
`@babel/types` não são necessários no runtime. A dependência de desenvolvimento e
o lock servem à reprodução/verificação do asset. O pacote npm completo permanece
apenas como custo comparativo; o custo de distribuição efetivo é bundle, licença
e manifesto. As medições iniciais acima precedem essa troca de carregador; os
gates focados e o benchmark são repetidos no checkpoint com o asset e identificados
no pacote de evidências.

O grafo registra declaração de import/reexport e caminho candidato, sem inferir
compatibilidade de props, contrato de hooks, binding usado por `export *` ou chamadas.
Aliases suportam o JSON simples de tsconfig/jsconfig na raiz; JSONC, `extends`,
package exports, plugins de bundler e resolução dependente de ambiente continuam
exigindo investigação. CommonJS sombreado e import calculado nunca viram prova de
ausência. Falha sintática mantém o arquivo, candidatos textuais marcados e amplia
referências de investigação sob os mesmos limites de seleção.
