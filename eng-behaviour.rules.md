<!--
ARQUIVO GERADO por eng-behaviour. Nao edite a mao.
Cada regra abaixo e derivada do arquivo dela no catalogo do pacote, que e a fonte.
-->

# Regras aplicáveis

## core.abstraction.no-premature

Tipo: judgment

### Regra

Camada, campo, configuração ou ponto de extensão só passam a existir quando já existe chamada que deixa de funcionar sem eles. A pergunta aqui é se a peça deve existir, e não onde ela mora.

### Por quê

Abstração sem consumidor cobra leitura para sempre e não paga nada. A interface com uma implementação obriga quem depura a seguir a indireção para descobrir que ela sempre desemboca no mesmo lugar. O campo que ninguém lê precisa ser preenchido, migrado e mantido consistente em todo caminho que produz o registro. A chave de configuração que nunca muda de valor multiplica os caminhos que alguém considera ao explicar um comportamento, e nenhum deles é exercido. O mesmo vale para a constante criada por ritual: quando o literal não representa conceito com dono, dar nome a ele só insere um salto entre a leitura e o valor.

### Bom

O envio de notificação chama o serviço de e-mail direto, enquanto e-mail é o único canal. A interface de canal aparece junto com o segundo canal e nasce com as duas implementações.

### Ruim

Interface de canal de notificação com uma implementação, chave `notification.channel` que só assume um valor e ponto de extensão que nenhuma chamada alcança, tudo escrito antes de existir um segundo canal. Também é ruim `MAX_RETRIES = 3` extraído quando o três aparece uma vez, dentro do único ponto que decide sobre nova tentativa.

### Exceções

Ponto de extensão exigido por contrato externo, quando a fronteira precisa aceitar implementação de fora e a forma dela é acordada antes de a segunda implementação existir. Também fica de fora a costura criada para o comportamento poder ser exercido em teste, quando sem ela não haveria como observar o resultado: nesse caso a suíte é o consumidor concreto, e a costura só se justifica enquanto ela for.

### Como verificar

Não é verificável por ferramenta: contar implementações acusaria toda interface nova, inclusive a que já tem contrato externo esperando por ela, e nenhum contador sabe se o consumidor está a caminho ou é imaginado. Quem avalia responde três perguntas. Qual chamada que já existe no repositório deixa de funcionar se esta peça for removida. Se a resposta for nenhuma, o que se perde ao adiar a criação dela até a primeira chamada aparecer. E, quando a peça é um nome dado a um valor, qual conceito esse nome carrega além de repetir o literal. O agente avalia e registra a avaliação com fundamentação.
## core.convention.one-per-repository

Tipo: judgment

### Regra

Um repositório segue uma convenção. Convenção diferente, porém única e coerente, é aceitável. O defeito é a concorrência entre convenções dentro do mesmo repositório.

### Por quê

Convenção existe para que quem abre um arquivo já saiba onde procurar. Quando cada feature traz a própria gramática de nome, de organização de pasta ou de tratamento de erro, essa economia some: toda mudança começa reaprendendo o pedaço do repositório em que ela caiu, a revisão gasta o tempo dela discutindo forma em vez de comportamento, e ferramenta que dependa de padrão de nome passa a errar em parte do código. O custo não é a convenção escolhida ser diferente da preferência de quem chegou, e sim o repositório não ter uma. Por isso a convenção que alguém consideraria pior, aplicada em todo lugar, sai mais barata que duas boas convivendo.

### Bom

O repositório trata erro de borda de um jeito só, e a feature nova adota esse jeito mesmo quando quem escreve prefere outro. Trocar a convenção continua possível, e acontece como mudança declarada que reescreve os casos existentes, nunca como exceção local.

### Ruim

Três features, três formas de nomear o mesmo tipo de arquivo e três formas de devolver erro. Ler qualquer uma exige primeiro descobrir qual das três está em jogo, e a quarta feature escolhe por sorteio.

### Exceções

Migração declarada: enquanto a troca de uma convenção pela outra está em curso, as duas convivem, com o alvo e o critério de fim escritos onde a migração mora. Também fica de fora o pedaço cuja forma é imposta por ferramenta externa, como código gerado ou diretório com layout ditado pelo framework, que segue a convenção da ferramenta.

### Como verificar

Não é verificável por ferramenta: o verificador precisaria conhecer a convenção antes de procurar desvio, e é justamente ela que não está escrita em lugar nenhum quando o problema existe. Quem avalia responde três perguntas. Para a decisão de forma que este código toma, existe precedente no repositório. Se existe e o código faz diferente, o que sustenta a divergência além de preferência. Se não existe, esta passa a ser a forma que vale para as próximas ocorrências, e alguém assume isso. Quando o repositório já mostra duas formas para a mesma decisão, o achado é sobre a concorrência entre elas, e não sobre a escolha do arquivo em revisão. O agente avalia e registra a avaliação com fundamentação.
## core.duplication.business-rule

Tipo: judgment

### Regra

Regra de negócio compartilhada tem uma fonte de verdade só.

### Por quê

Duplicação estrutural pequena é barata e às vezes correta enquanto não existe um segundo caso concreto. Regra de negócio duplicada é diferente: quando o mesmo invariante existe em quatro lugares, mudar o comportamento exige achar os quatro, e o que sobrar divergente vira bug silencioso que só aparece na borda que ninguém lembrou de atualizar.

### Bom

O limite de itens do plano nasce em uma constante nomeada, consumida pela validação, pela mensagem, pela regra de backend e pela interface.

### Ruim

O número dez escrito em quatro arquivos, com quatro mensagens diferentes explicando a mesma restrição.

### Exceções

Cópia deliberada em fronteira de sistema que precisa evoluir sem coordenação, quando a divergência é o objetivo e não o efeito colateral. A cópia declara isso onde ela mora.

### Como verificar

Não é verificável por ferramenta: distinguir invariante compartilhado de coincidência de valor exige entender o domínio, e comparar literais iguais não separa os dois. Quem avalia responde três perguntas. Que conceito do domínio este valor representa, e quem responde por ele. Se a regra mudar, todas as ocorrências mudam juntas, ou alguma continuaria com o valor antigo por decisão própria. E, quando elas mudam juntas, o que hoje garante que a última ocorrência seja encontrada. Ocorrências que mudam por decisões independentes são coincidência de valor, e não duplicação de regra. O agente avalia e registra a avaliação com fundamentação.
## core.file.single-responsibility

Tipo: judgment

### Regra

Um arquivo expressa uma responsabilidade que cabe em uma frase, sem "e também".

### Por quê

Arquivo que acumula assuntos esconde onde a mudança precisa acontecer. Quem procura o cálculo de imposto abre o arquivo de pedido e encontra junto o acesso ao banco, a montagem da resposta e o disparo do e-mail, e passa a ler tudo para ter certeza de que mexeu no lugar certo. O efeito seguinte é que mudança em qualquer um desses assuntos toca o mesmo arquivo, então conflito de merge, revisão e regressão passam a atravessar assuntos que não têm relação entre si, e quem revisa uma alteração de imposto precisa julgar diff de infraestrutura.

Tamanho é sintoma, não critério. Arquivo grande com uma responsabilidade clara se lê de ponta a ponta; arquivo curto que decide três assuntos diferentes já cobra o preço acima. Contar linha mede o sintoma e erra nos dois sentidos, reprovando o coeso e aprovando o disperso.

### Bom

O cálculo de imposto mora em um arquivo que contém a regra de imposto e nada mais. O arquivo do caso de uso chama esse cálculo, chama o repositório e devolve o resultado, e a frase que o descreve é "orquestra o fechamento do pedido".

### Ruim

O arquivo do pedido calcula imposto, monta SQL, formata moeda para a interface e decide quando enviar e-mail. A frase que o descreve só fica verdadeira com quatro "e também".

### Exceções

Arquivo cuja unidade declarada é o agrupamento e não o assunto: ponto de entrada que só reexporta, arquivo de configuração de ferramenta e código gerado, que responde ao gerador e não a quem lê. Também fica de fora a coesão que só parece múltipla, como um tipo com muitas operações sobre o mesmo estado, que é uma responsabilidade com muitos métodos.

### Como verificar

Não é verificável por ferramenta, e limiar de linhas seria pior que verificação nenhuma: reprovaria arquivo coeso e longo e aprovaria arquivo curto que decide demais, ensinando a quebrar arquivo em pedaços arbitrários para caber no número. Quem avalia responde três perguntas. Qual frase única descreve o que este arquivo faz. Se a frase precisa de "e também" para ficar verdadeira, quais assuntos ela está juntando. E, para cada assunto, que motivo faria este arquivo mudar. Assuntos que mudam por motivos independentes são responsabilidades diferentes, e o número de linhas não entra no veredito. O agente avalia e registra a avaliação com fundamentação.
## core.locality.promote-on-real-reuse

Tipo: judgment

### Regra

Código específico mora ao lado de quem o usa. Ele sobe para área compartilhada quando existe um segundo consumidor concreto, e não antes.

### Por quê

Depósito compartilhado com um consumidor só cobra o preço do compartilhamento sem entregar o benefício. Quem lê a feature precisa procurar em dois lugares para montar a história inteira, e quem lê a área compartilhada encontra ali código que responde a um domínio que não conhece. Depois de promovido, o código passa a parecer contrato público: a mudança que o único dono real precisaria fazer nele vira negociação com consumidores que não existem, e o medo de quebrar alguém segura a alteração. Promover cedo entrega acoplamento imediato e reuso nenhum.

### Bom

`formatarNumeroDaFatura` nasce dentro do módulo de faturamento, que é quem a chama. Quando cobrança passa a precisar do mesmo formato pelo mesmo motivo, a função sobe para a área compartilhada junto com o segundo consumidor, no mesmo commit.

### Ruim

`formatarNumeroDaFatura` colocada em `shared/format` no primeiro dia, chamada só pela tela de faturamento. A pasta comum acumula regra de um domínio só, e ler faturamento passa a exigir dois diretórios.

### Exceções

Código cujo lugar é imposto por fora, quando o roteador, o empacotador ou o publicador de biblioteca exige caminho fixo: ali o lugar não é escolha de quem escreve, mesmo com um consumidor só. Também fica de fora o módulo que já nasce como contrato entre times, publicado e versionado, em que o consumidor de fora é o motivo de existir e é conhecido antes do código.

### Como verificar

Antes de decidir onde a peça mora, verifique se ela deveria existir: quando apagar a peça não quebra chamada nenhuma, o defeito é a existência dela, a pergunta sobre lugar não se coloca, e o caso sai daqui.

Não é verificável por ferramenta: contar imports diz quantos consumidores existem, e não se eles compartilham o mesmo motivo. Duas telas que hoje formatam igual por coincidência mudam separadas amanhã, e o import não mostra isso. Quem avalia responde três perguntas. Quantos consumidores este código tem hoje. Se tem mais de um, os dois mudariam juntos quando a regra mudar, ou a igualdade é só de formato. Se tem um só, o que a área compartilhada entrega aqui além da distância entre o código e quem o chama. O agente avalia e registra a avaliação com fundamentação.
## core.suppression.declared

Tipo: hard

### Regra

Todo supressor traz uma ficha: o identificador do que está sendo suprimido e o motivo, no mesmo comentário.

### Por quê

Supressor sem ficha apaga o problema e apaga junto o registro de que ele existiu. Quem encontra a linha meses depois não tem como saber se a supressão continua necessária, e a saída barata passa a ser deixar como está. Um teto sobre a quantidade de supressores controla volume e não responde nenhuma dessas perguntas: o que decide se a supressão pode sair é por que ela entrou.

### Bom

// eslint-disable-next-line no-console -- a saída deste comando é o próprio console
    console.log(resumo);

    // @ts-expect-error TS2345 -- a tipagem publicada declara string onde o runtime aceita número
    conecta(porta);

    // skip -- o ambiente de teste ainda não expõe o serviço de cobrança
    it.skip("cobra o cartão", cobrar);

### Ruim

// eslint-disable-next-line no-console
    console.log(resumo);

    /* eslint-disable */
    const codigo = 1;

    // prepara o ambiente
    it.skip("cobra o cartão", cobrar);

### Exceções

Não há exceção à ficha: supressor sem ela é acusação em qualquer arquivo que o repositório escreva.

Há uma classe de falso positivo, e ela não se resolve com ficha. O reconhecimento de `.skip`, `.only`, `xit`, `fit`, `xdescribe` e `fdescribe` sai do nome escrito no código, e não de análise de tipo, então um objeto local chamado `test` com um método `skip`, invocado como `test.skip(...)`, é acusado sem que exista supressão nenhuma. Escrever ficha ali seria justificar o que não suprime, e a ADR-0009 rejeita isso pelo nome: catálogo de justificativa mentirosa é pior que nenhuma justificativa. A saída é renomear o símbolo local, que desfaz a colisão de nome e é a menor mudança possível. Quando renomear não for possível, o caso é defeito desta regra e vai registrado como defeito da regra, nunca como ficha nem como supressão da regra que proíbe suprimir.

O vocabulário fechado de motivos previsto na ADR-0009, com a válvula por referência verificável, não é exigido hoje. A própria decisão diz que a lista de motivos cresce por evidência e não por antecipação, e não existe ainda supressão real de onde extraí-la. Enquanto ela não existir, qualquer motivo de forma completa passa no verificador, e avaliar se o motivo presta continua sendo revisão humana.

### Como verificar

O verificador `suppression-declared` abre os arquivos de extensão `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs` e `.cjs`, fora dos diretórios que não são escritos no repositório, e trata duas formas de supressor. Arquivo de outra extensão não é aberto: um `.vue` ou um `.svelte` com supressor sem ficha passa sem ser visto.

Supressor que mora em comentário: `eslint-disable`, `eslint-disable-line`, `eslint-disable-next-line`, `@ts-expect-error`, `@ts-ignore` e `istanbul ignore`. `eslint-disable` só conta em comentário de bloco, que é a única forma que o ESLint honra; em comentário de linha ela não suprime nada. O marcador abre o comentário, como as próprias ferramentas exigem, e a ficha vem depois dele, na forma `<identificador> -- <motivo>`. O separador são dois ou mais traços cercados por espaço, a mesma forma que o ESLint já usa para a descrição de uma diretiva. Identificador vazio, motivo vazio ou ausência do separador é acusação.

Por convenção, o identificador é o nome da regra do ESLint, o código do erro do TypeScript ou o alcance do istanbul. O verificador não confere nada disso: ele confere que existe texto antes do separador. Perguntar se o nome corresponde a uma regra que existe exigiria a configuração de ESLint do repositório analisado, e o resto não tem lista fechada contra a qual comparar.

Supressor que mora em chamada: `.skip` e `.only` penduradas em `describe`, `it`, `test`, `context` ou `suite`, e as construções `xit`, `fit`, `xdescribe` e `fdescribe`, que pulam ou isolam pelo próprio nome. `.skip` e `.only` só contam quando a cadeia em que aparecem é invocada, seja depois do marcador, como em `it.skip.each([1])(...)`, seja antes dele, como em `it.each([1])(...).skip`; ler o símbolo como valor, em `const referencia = it.only`, não pula teste nenhum. Como não são comentário, a ficha dessas construções é o comentário da linha imediatamente acima, e ele precisa começar nomeando o marcador que justifica, na forma `// skip -- <motivo>` ou `// xit -- <motivo>`. Sem o nome, qualquer comentário já escrito ali passaria a valer como justificativa.

A decisão sai da forma e da posição, nunca do texto do motivo: o verificador confere que a ficha existe e está completa, e não se o motivo presta. A leitura sai da árvore do compilador TypeScript, então marcador citado em prosa no meio de um comentário, dentro de literal de string ou dentro de expressão regular não é supressor.
## core.testing.behavior-proof

Tipo: judgment

### Regra

Um teste precisa deixar de passar quando o comportamento que ele protege é removido.

### Por quê

Teste que continua verde depois que o comportamento sai não protege nada, e sai mais caro que a ausência dele: ocupa a linha de cobertura, entra na contagem verde e produz a confiança de que aquela área está guardada. A regressão que ele deveria pegar passa direto, e ninguém escreve teste onde já existe um. Isso acontece com o teste que exercita o código sem afirmar nada sobre o resultado, com o que afirma sobre o dublê que ele mesmo programou, e com o que espelha a implementação passo a passo, que quebra quando o código é reorganizado e não quebra quando o comportamento muda.

### Bom

O teste da regra de desconto chama o cálculo com uma entrada que atinge o limite e afirma o valor devolvido. Apagar a cláusula de limite no código de produção faz esse teste falhar, e a mensagem da falha diz qual valor mudou.

### Ruim

O teste chama o cálculo, verifica que não lançou exceção e confere que o repositório dublê recebeu a chamada esperada. Apagar a cláusula de limite não muda nada disso, e a suíte segue verde com a regra fora do ar.

### Exceções

Teste cujo objeto declarado é o contrato e não a regra: o que prova que a chamada externa sai no formato acordado protege esse formato, e falha quando o formato muda, ainda que nenhuma regra de negócio esteja em jogo. Também fica de fora o teste de fumaça declarado como tal, cujo comportamento protegido é a aplicação subir e responder.

### Como verificar

Não é verificável por ferramenta no caso geral: teste de mutação chega perto, e ainda assim não sabe qual comportamento aquele teste dizia proteger, que é o que dá sentido ao veredito, além de tratar como equivalente o mutante que ninguém queria matar. Quem avalia responde três perguntas por teste. Qual comportamento este teste afirma proteger. Qual a menor alteração no código de produção que o faria falhar. E se essa alteração remove comportamento observável ou apenas reorganiza a implementação. Teste sem resposta para a segunda pergunta não protege nada; teste que só falha na terceira protege a forma do código, e não o comportamento.

Um caso sai daqui com veredito já dado, e é o único. Quando o teste está dentro da suíte de ponta a ponta que o repositório declara e o que o faz não falhar é o módulo que ele mesmo substituiu, a `core.testing.e2e-without-mocks` já acusa, automaticamente, com arquivo e linha. O defeito é um só, e dar veredito aqui também produziria dois vereditos sobre o mesmo teste, um automático e um registrado à mão. O caso segue para lá e esta regra não repete a chamada. O que continua sendo objeto desta regra naquele mesmo arquivo é tudo que a outra não enxerga: o teste que exercita sem afirmar nada e o que espelha a implementação passo a passo, que a suíte de ponta a ponta produz com a mesma facilidade que qualquer outra.

O agente avalia e registra a avaliação com fundamentação.
## core.testing.coverage-under-mocked-strategy

Tipo: judgment

### Regra

Quando a suíte de unidade optou por isolar extensivamente a dependência com dublê, o alvo de cobertura dela é total.

Cobertura total não é sinônimo de teste bom. Ela mede alcance, não qualidade: diz que a linha foi executada por algum teste, e não diz que algum teste falharia se o comportamento daquela linha sumisse. Uma suíte inteira de testes que chamam o código e não afirmam nada chega a cem por cento. O alvo aqui é consequência de uma escolha já feita, e não uma medida de saúde.

### Por quê

O isolamento extensivo é uma troca. Paga-se com teste preso à forma da implementação, com refatoração que quebra teste sem quebrar comportamento, e com contrato do colaborador congelado no dublê. Compra-se, em troca, que exercitar qualquer caminho fica barato, rápido e determinístico: não há banco para preparar, rede para esperar nem estado para limpar entre um caso e outro.

Deixar caminho descoberto nessa suíte é pagar o preço e não levar a mercadoria. O ramo de erro que ninguém testou é justamente o que era caro de produzir com a dependência real e virou trivial com o dublê, que responde a exceção sob demanda. Quando ele fica de fora, o argumento que justificava toda a estratégia deixa de valer, e o que resta é uma suíte acoplada à implementação e ainda assim incompleta.

O antecedente importa tanto quanto o consequente. Uma suíte que exercita as dependências de verdade tem motivo legítimo para deixar caminho descoberto, porque produzir aquela condição custa caro de fato, e cobrar total dela seria cobrar por uma escolha que ela não fez.

### Bom

A suíte de unidade do serviço de cobrança dubla o repositório e o cliente do provedor, e cobre os três desfechos: pagamento aprovado, recusado e tempo limite. Cada teste afirma o que saiu da função. Produzir o tempo limite custa uma linha, porque o dublê existe para isso, e o caminho fica coberto pelo mesmo motivo que a estratégia foi adotada.

### Ruim

A mesma suíte dubla tudo e testa só o caminho feliz, deixando recusa e tempo limite sem nenhum teste. É o caso que esta regra julga: o alcance não corresponde à estratégia declarada.

Há um segundo defeito que costuma andar junto e não se decide aqui. A suíte cobre os três desfechos chamando a função dentro de um `expect(...).not.toThrow()`, chega a cem por cento e não falharia se qualquer um dos três passasse a devolver a coisa errada. O alcance está satisfeito, e o que falta é prova. Quem responde por isso é a `core.testing.behavior-proof`; o que o caso mostra aqui é que atingir o alvo desta regra não basta.

### Exceções

Código que só existe por exigência do compilador, como o `default` de um `switch` exaustivo que nenhuma entrada válida alcança, fica de fora: escrever teste para ele exige forjar um estado que o sistema de tipos já impede.

Adaptador fino sobre biblioteca externa, que não decide nada e só repassa argumento, também: o teste dele com o colaborador dublado prova que a chamada foi repassada, que é o teste da biblioteca escrito no repositório errado. O caminho ali é ser exercitado pela suíte de integração.

Fica de fora, ainda, o trecho marcado com supressor de cobertura que tem ficha, nos termos da `core.suppression.declared`: a decisão de não cobrir foi tomada e assinada, e a discussão passa a ser sobre a ficha.

### Como verificar

Não é verificável por ferramenta hoje, e a razão é específica: verificar exigiria ler um relatório de cobertura em caminho declarado pelo repositório consumidor, e nenhum consumidor declara isso. Criar o campo de declaração agora seria configuração sem chamada que dependa dela, que a `core.abstraction.no-premature` deste mesmo catálogo proíbe. A regra é candidata a promoção a hard quando o primeiro consumidor concreto aparecer, e nesse dia o antecedente continua vindo de declaração, nunca de inferência sobre o código (ADR-0008).

Encontrar `vi.mock` espalhado pela suíte não responde a pergunta: mock pontual de relógio ou de rede instável é legítimo por esta mesma constituição, e confundi-lo com estratégia de isolamento acionaria o limiar mais duro do pacote por palpite.

Quem avalia responde três perguntas. A suíte de unidade isola extensivamente a dependência com dublê, ou o dublê é pontual. Se isola, qual caminho do código sob teste nenhum teste alcança, e o que ainda custa caro em exercitá-lo agora que a dependência já está dublada. E, para o caminho que está coberto, existe teste que falharia se aquele comportamento fosse removido, ou a linha só foi executada.

O veredito desta regra sai das duas primeiras, que são sobre alcance. A terceira existe para encaminhar, e não para condenar aqui: quando a resposta é que a linha só foi executada, o alcance está satisfeito e o defeito é de prova, que é o objeto da `core.testing.behavior-proof`. O caso segue para lá com a resposta já escrita. Fazer a chamada nas duas regras produziria dois vereditos sobre o mesmo teste, e é o que esta divisão existe para evitar.

É também o que impede o alvo de virar um número perseguido por si. Cobertura conquistada com teste que não afirma nada satisfaz a métrica desta regra e não satisfaz a suíte. O agente avalia e registra a avaliação com fundamentação.
## core.testing.e2e-without-mocks

Tipo: hard

### Regra

Arquivo dentro da suíte de ponta a ponta que o repositório declara não chama mock de módulo.

### Por quê

Um teste de ponta a ponta existe para provar que as peças se encaixam quando ninguém as segura. Trocar um módulo do meio do caminho por um dublê remove exatamente a costura que ele deveria provar, e o que sobra é um teste caro, lento e frágil que exercita menos do que um teste de unidade honesto exercitaria.

O prejuízo não é só o caminho perdido. O teste continua verde quando a integração quebra, e continua ocupando o lugar dela: ninguém escreve um segundo teste de integração onde já existe um verde, e a falha que ele deveria pegar chega em produção com a suíte inteira passando. O dublê também congela o contrato no formato que quem escreveu o teste imaginou, então uma mudança de resposta do outro lado passa despercebida até alguém abrir o serviço real.

O argumento de que um teste verde com o comportamento fora do ar sai mais caro que teste nenhum é o mesmo da `core.testing.behavior-proof`, e é de propósito: esta regra é o recorte dele que dá para verificar por ferramenta. A fronteira entre as duas está na seção de como verificar.

### Bom

O teste da jornada de compra sobe a aplicação, aponta para o banco de teste e para o gateway em modo sandbox, e faz o pedido inteiro pela mesma porta que o usuário usa. O relógio entra por parâmetro na composição da aplicação, o que fixa a data sem trocar módulo nenhum. Se o gateway mudar o formato da resposta, esse teste falha.

### Ruim

O mesmo arquivo com `vi.mock("../src/gateway.js")` no topo. A jornada passa a rodar contra um gateway que sempre responde o que o teste programou, e nenhuma das falhas que ele existia para pegar, campo renomeado, tempo limite, resposta de recusa, chega a acontecer.

### Exceções

Dependência que não pode ser exercitada de fora, como o provedor externo que cobra por chamada ou não tem ambiente de teste, é caso real e não é resolvida por mock de módulo dentro do arquivo de teste. A saída é o substituto entrar como parte do ambiente, com um serviço falso levantado ao lado e endereçado por configuração: para o código sob teste ele continua sendo o módulo real, alcançado pela mesma porta, e o que muda é para onde a porta aponta.

Quando o arquivo prova outra coisa que não a jornada completa, a correção também não é o dublê: é ele sair da suíte de ponta a ponta declarada e passar a ser o que já é.

### Como verificar

A regra depende de declaração e não roda sem ela. O repositório consumidor lista em `e2eDirs`, no `eng-behaviour.json`, os diretórios em que a suíte de ponta a ponta mora, relativos à raiz. Sem o campo, o verificador não examina nada e diz o que declarar, em vez de adivinhar (ADR-0008). O que faz a declaração ser necessária é que nome de arquivo não diz o que o teste faz: o mesmo `pedido.spec.ts` é unidade em um repositório e jornada completa em outro, e uma heurística por sufixo acusaria o teste de unidade que legitimamente dubla o que precisa dublar.

Dentro dos diretórios declarados, o verificador `e2e-without-mocks` abre todo arquivo de código, fora dos diretórios que não são escritos no repositório. Arquivo auxiliar entra junto com o que tem nome de teste, e por um motivo de conteúdo: o dublê escrito no arquivo que a suíte importa vale para todos os testes que o importam, e é ali que o efeito é mais amplo.

A leitura é pela árvore do compilador TypeScript, e o que ela procura são onze escritas, nomeadas uma a uma: `vi.mock`, `vi.doMock`, `vi.importMock`, `vitest.mock`, `vitest.doMock`, `vitest.importMock`, `jest.mock`, `jest.doMock`, `jest.setMock`, `jest.unstable_mockModule` e `jest.requireMock`. As três de `vitest` repetem as três de `vi` porque o pacote exporta os dois nomes como o mesmo utilitário. Cada uma conta como achado próprio, com a linha em que está.

Três exigências delimitam o que casa. Precisa ser chamada, e não leitura do símbolo: `const referencia = vi.mock` não substitui módulo nenhum. O objeto precisa ser o identificador escrito ali, e não o fim de uma cadeia maior, o que deixa de fora `ferramentas.vi.mock(...)`, cujo dono é outro. E a leitura é da árvore, e não do texto, o que deixa de fora a citação em comentário e dentro de literal de string.

Fica de fora, e é limitação conhecida do verificador, tudo que não tem essa forma escrita: o utilitário importado com outro nome, como `import { vi as v }`, a chamada embrulhada em função local do próprio repositório, e a API equivalente de qualquer biblioteca de teste fora dessas duas. O verificador também não olha o que a suíte injeta por parâmetro, porque ali não há troca de módulo, e essa é a forma que a regra considera correta.

Esta regra dá o veredito sobre uma coisa só: substituição de módulo dentro da suíte de ponta a ponta declarada. A pergunta geral, se um teste protege o comportamento que ele diz proteger, é da `core.testing.behavior-proof`, e ela não dá segundo veredito sobre o arquivo que esta aqui já acusou, porque o defeito é um só e seriam dois vereditos sobre o mesmo teste. O que fica com ela, no mesmo arquivo, é o que este verificador não enxerga: o teste que exercita sem afirmar nada e o que espelha a implementação. É a mesma divisão que a `core.testing.coverage-under-mocked-strategy` e a `core.testing.unit-mock-minimal` já aplicam com aquela regra.

Há uma limitação conhecida na conferência do caminho declarado, e ela não é desta regra nem deste verificador: em sistema de arquivos que ignora caixa, o diretório declarado com a caixa trocada passa pela conferência e não casa arquivo nenhum depois, e a regra sai limpa tendo examinado zero unidade. O comportamento é o mesmo para todo campo de diretório declarado, e está descrito uma vez no `docs/arquitetura.md` do repositório do pacote `eng-behaviour`, na seção sobre o que o exit 0 do `audit` significa. Esse caminho é de lá, e não deste repositório: quem lê este recorte está num repositório consumidor, que não tem esse arquivo. Repetir o parágrafo aqui e na regra irmã obrigaria a achar os dois para mudar um comportamento só.
## core.testing.unit-mock-minimal

Tipo: judgment

### Regra

Em teste de unidade, o dublê entra pela dependência que não dá para exercitar de verdade sem destruir o determinismo ou o propósito do teste. Onde a dependência real cabe, ela entra.

### Por quê

Dublê tem preço, e o preço é pago em toda leitura futura. Ele prende o teste à forma como o código chama a dependência, e não ao resultado: renomear um método, trocar a ordem de duas chamadas ou reunir duas consultas em uma quebra o teste sem que nada observável tenha mudado. Quem herda a suíte aprende que refatorar custa caro e para de refatorar.

Pior que o custo é o teste que passa a provar outra coisa. Quando o dublê é programado com a resposta e o teste termina afirmando que ele foi chamado, o que ficou provado é que o teste chamou o próprio dublê. Se aquela dependência podia ter sido exercitada de verdade, o comportamento que o teste diz proteger nunca foi exercido, e a regra `core.testing.behavior-proof` é violada por dentro, com a suíte verde.

E o dublê apaga o contrato. A implementação real do colaborador muda de assinatura, de exceção ou de formato de retorno, e o dublê continua respondendo o que respondia no dia em que foi escrito. O teste só volta a falhar quando alguém, meses depois, abre o código real.

### Bom

O teste do cálculo de juros usa a implementação real de arredondamento e a real de tabela de faixas, que são puras, rápidas e determinísticas, e dubla só o relógio, porque o resultado depende da data de hoje. A afirmação é sobre o valor devolvido. Trocar a regra de faixa faz esse teste falhar.

### Ruim

O mesmo teste dubla o arredondamento e a tabela de faixas, programa o retorno de cada um e termina afirmando que o arredondamento recebeu `(100, 2)`. Ele passa mesmo se a fórmula do juro estiver errada, e quebra se alguém decidir arredondar uma vez no fim em vez de duas no meio, que é a mudança que ninguém deveria ter medo de fazer.

### Exceções

Fonte de não determinismo é motivo técnico legítimo, e aparece o tempo todo: relógio, gerador de identificador, sorteio. Sem substituí-los não existe afirmação estável para escrever.

Efeito colateral que sai do processo também é: chamada de rede, escrita em disco, envio de mensagem, cobrança em provedor externo. Aqui o dublê não é comodidade, é a única forma de o teste ser executável em qualquer máquina e a qualquer hora.

Condição difícil de produzir de propósito entra pelo mesmo argumento: o tempo limite do cliente HTTP, o disco cheio, a segunda tentativa depois de uma falha intermitente. Provocar a falha real ali custaria mais do que a garantia que ela dá.

Dependência ainda não implementada, com contrato já acordado, é o quarto caso: o dublê ocupa o lugar até a implementação chegar, e a data em que ele deixa de ser necessário é conhecida.

Fora desses, custo de montar o objeto real quase nunca é motivo técnico: costuma ser sintoma de que a dependência exige mundo demais para nascer, e o defeito está lá, não no teste.

### Como verificar

Não é verificável por ferramenta: contar dublês por arquivo diria quantos existem, e nunca se cada um tinha motivo. A suíte com um dublê legítimo e a suíte com um dublê por comodidade têm exatamente a mesma forma, e o que separa as duas é a resposta a uma pergunta sobre a dependência substituída, que não está escrita no código.

Quem avalia responde três perguntas por dublê. Qual propriedade a dependência real destruiria neste teste: determinismo, executabilidade em qualquer máquina, ou o próprio propósito do que está sendo medido. Se a resposta for nenhuma, o que se perde ao usar a implementação real aqui. E, ao final, qual afirmação do teste deixaria de passar se o comportamento sob teste fosse removido: quando a única resposta é que o dublê foi chamado, o teste não prova o que diz provar, e o caso segue para a `core.testing.behavior-proof`.

O agente avalia e registra a avaliação com fundamentação.
