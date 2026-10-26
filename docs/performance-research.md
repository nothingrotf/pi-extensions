# Pesquisa de desempenho do pstack e do subagent

> O [ADR 0004](adr/0004-remove-managed-delivery.md) removeu o modo gerenciado. As referências a `pstack_deliver`, `pstack_delivery` e `bench:delivery` descrevem o estado anterior a essa decisão.

Data: 2026-10-10. Escopo: o tempo até uma issue gerenciada ficar aceita, e quantas issues por hora o sistema entrega. A pesquisa considera mudanças de qualquer tamanho, inclusive reescrita completa.

## Conclusões

1. O harness não é o gargalo. A mediana entre o fim de uma ferramenta e a próxima chamada de modelo é de 3 ms nos filhos e 14 ms nas raízes. Um filho leva 1,3 s até a primeira chamada. Reescrever o pi ou o runtime do subagent em outra linguagem não traria ganho mensurável.
2. O tempo vai para cinco lugares: espera por humano, o coordenador LLM, a vazão do modelo do dono, os gates do repositório e o retrabalho.
3. Na sessão de autopilot medida, 22% do tempo foi espera por resposta humana. O coordenador fez cerca de 1.600 turnos de Opus para 16 issues.
4. Numa tarefa folha, Opus 5.5 e Sonnet 5.5 terminaram em 9 a 17 s. O GPT-6.1-Sol, modelo atual de `feature` e `bug-fix`, levou de 48 a 67 s. A tarefa era pequena e cada configuração rodou duas vezes.
5. A recomendação é reescrever a camada de orquestração como um motor de entrega determinístico com várias issues em paralelo. O runtime do subagent, os workspaces de issue e o ledger continuam.
6. O pi-harness, o harness anterior, mediu 26 features reais. O retrabalho foi 56% do custo, e 83% dos bloqueios depois da primeira rodada vieram da correção anterior. No A/B dele, o Sonnet 5 levou 3,55 h e o Opus 2,76 h na mesma feature. O roteamento de modelo só deve mudar depois de um A/B numa issue real.
7. Medido depois das mudanças: o `pstack_gate` cortou a verificação de runtime de cerca de 130 s para 40 a 50 s. O `pstack_deliver` cortou a coordenação de 41 a 45 s para 30 a 32 s por issue. A revisão estática do Opus em `high` levou cerca de 30% menos que em `xhigh`, sem perda de aceite. A parede de uma issue continua dominada pelo dono e pela revisão estática.

## Método

| Fonte                                       | Conteúdo                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Sessões do pi, últimos 20 dias              | 156 sessões com `durationMs` por chamada: 30 raízes e 126 filhos, 14.085 chamadas de modelo |
| Autopilot `spice-target`, sessão `01a11da5` | 16 issues em 40,7 h, 72 filhos, coordenador em Opus 5.5 xhigh                               |
| Ledgers de entrega                          | 143 issues aceitas em 33 sessões coordenadoras                                              |
| Sondas de latência                          | `pi -p --mode json` sem ferramentas, 1 ou 2 execuções por modelo                            |
| Benchmark folha                             | A tarefa do `bench:delivery`, um único `pi -p`, 7 configurações, 2 execuções cada           |
| Benchmark de entrega                        | Resultado do PR #16, 3 execuções por braço                                                  |
| Fontes externas                             | TraceLab, Cognition, OpenAI, Anthropic, Cursor, LLMCompiler, Speculative Actions, pstack-t3 |
| `~/Workspaces/pi-harness`                   | Postmortem de 26 features, A/B de modelo numa feature real e código reaproveitável          |

Os scripts de análise ficaram em `/tmp/perf-research`, fora do repositório.

Limites:

- O `spice-target` gerou 749 das 1.581 sessões, então ele domina os números. É um repositório pesado, com gate completo de 8 a 10 minutos.
- Só as sessões recentes registram `durationMs`. Os ledgers antigos não têm tempo de modelo por filho.
- Ainda não existem sessões reais de entrega depois do PR #16.

## Onde o tempo vai

### Uma sessão real de autopilot

Sessão `01a11da5` no `spice-target`: 16 issues em 40,7 h.

| Componente                                         | Horas | Parcela |
| -------------------------------------------------- | ----: | ------: |
| Pelo menos um filho ativo                          |  25,8 |     63% |
| `AskQuestion` esperando o usuário, sem filho ativo |   9,1 |     22% |
| Modelo do coordenador, sem filho ativo             |   2,7 |      7% |
| `bash` do coordenador, sem filho ativo             |   2,1 |      5% |

- **Paralelismo:** a soma dos intervalos dos filhos é 35,1 h, sobre 25,8 h com algum filho ativo. A média é 1,36 filho ativo de cada vez.
- **Coordenador:** foram cerca de 1.600 turnos de Opus 5.5 xhigh, com 4,2 h de modelo e prompt mediano de 257 mil tokens.

Trabalho dos filhos por papel, somado nas 16 issues:

| Papel                  | Sessões |  Modelo | Ferramentas |  Testes |  Checks | Turnos |   Saída |
| ---------------------- | ------: | ------: | ----------: | ------: | ------: | -----: | ------: |
| Implementação          |      22 | 492 min |     485 min | 203 min | 212 min |  2.332 | 992 mil |
| Revisão técnica        |      12 | 186 min |       1 min |       0 |       0 |    476 | 784 mil |
| Verificação de runtime |      16 | 155 min |     193 min |  51 min |  91 min |    767 | 603 mil |
| Outros                 |      22 |  80 min |      18 min |   5 min |   4 min |    409 | 220 mil |

Por issue, a implementação gasta 31 minutos de modelo e 30 minutos de ferramentas. Testes e checks ocupam 26 desses 30 minutos. Cada execução de `VITEST_MAX_WORKERS=2 bun run check` levou de 495 a 600 s.

### Retrabalho

Nos ledgers, cada issue aceita teve:

- 3 submissões de implementação na mediana, com média de 3,8. Uma delas, na mediana, voltou como `blocked` ou `wip`.
- 2 verificações de runtime na mediana.
- 68 minutos entre o primeiro evento do ledger e a aceitação, na mediana.

Cada rodada extra repete a revisão, a verificação e os gates.

A origem das rodadas, nos mesmos ledgers:

| Rodada de candidato revisado | Revisões | Achados bloqueantes novos | Revisões com pelo menos um |
| ---------------------------: | -------: | ------------------------: | -------------------------: |
|                            1 |      199 |                       110 |                         62 |
|                            2 |      140 |                         8 |                          8 |
|                            3 |       52 |                         6 |                          4 |
|                            4 |       27 |                         5 |                          3 |
|                    5 ou mais |       30 |                         1 |                          1 |

- **Achados novos depois da primeira rodada:** são raros. A espiral do pi-harness, em que cada correção cria novos bloqueios, não se repete aqui.
- **Retornos incompletos:** das 616 submissões de implementação, 193 voltaram como `wip` e 80 como `blocked`.
- **Causas desses retornos:** decisão externa em 82, ambiente em 76 e contrato de execução em 52. Outras 42 não têm classe, 12 omitiram um requisito e 9 perderam contexto.

O retrabalho vem mais de esperas por decisão, de ambiente e de atrito com o contrato do que da revisão.

Um limite de três rodadas rejeitadas teria disparado em 6 das 148 issues com revisão. As 6 foram aceitas depois, então o limite custa um diagnóstico nesses casos raros.

### Latência por chamada de modelo

Regressão sobre as chamadas reais: `duração = a + b × tokens de saída + c × tokens de prompt`.

| Modelo                  | Chamadas |  Fixo | Por 1.000 tokens de saída | Por 100 mil tokens de prompt |
| ----------------------- | -------: | ----: | ------------------------: | ---------------------------: |
| `gpt-6.1-sol:medium`    |    4.431 |   0 s |                    25,7 s |                        0,9 s |
| `claude-opus-5-5:xhigh` |    4.199 | 2,5 s |                     8,9 s |                           ~0 |
| `claude-opus-5:xhigh`   |      762 | 3,3 s |                    13,3 s |                           ~0 |
| `gpt-6.1-sol:xhigh`     |      358 | 3,1 s |                    32,6 s |                           ~0 |

O símbolo ~0 indica um coeficiente negativo ou abaixo do ruído.

Sondas sem ferramentas, com resposta de cerca de 350 a 700 tokens:

| Modelo                    | Primeiro token |         Vazão |
| ------------------------- | -------------: | ------------: |
| `gpt-6.1-sol` low, fast   |          2,0 s | 38 a 44 tok/s |
| `gpt-6.1-sol` low, padrão |          2,4 s | 23 a 29 tok/s |
| `gpt-6-luna` low, fast    |          2,7 s |      86 tok/s |
| `grok-4.7` (opencode-go)  |          2,1 s |      74 tok/s |
| `claude-opus-5-5` low     |          0,7 s |      90 tok/s |
| `claude-sonnet-5-5` low   |          0,8 s |     123 tok/s |
| `claude-haiku-5-5` low    |          0,8 s |     170 tok/s |

O fast mode da OpenAI está ativo e dá cerca de 1,6 vez mais vazão. O tamanho do prompt pesa pouco por causa do cache, com 97% de acerto. Os tokens de saída e o primeiro token dominam o tempo de cada chamada.

### Forma dos turnos

- **Uma ferramenta por turno:** 92% dos turnos dos filhos chamam exatamente uma ferramenta. A média é 1,04 chamada por turno.
- **Exploração:** 27% dos turnos dos filhos só leem, buscam ou listam arquivos.
- **Tempo de `bash` dos filhos:** testes ficam com 41%, checks com 35% e `sleep` com 12%. Uma execução de check leva 68 s em média, e uma de teste leva 46 s.
- **Prompt inicial de um filho:** 12 a 14 mil tokens no Sol e 37 a 38 mil tokens no Opus 5. O prompt mediano chega a 121 mil tokens nos filhos e a 206 mil nas raízes.

### O que não é gargalo

| Item                                         | Medida                                                            |
| -------------------------------------------- | ----------------------------------------------------------------- |
| Fim da ferramenta até a próxima chamada      | Mediana de 3 ms nos filhos e 14 ms nas raízes                     |
| Fim do modelo até o início da ferramenta     | Mediana de 2 a 33 ms. `Task` fica em 447 ms                       |
| Criação de um filho até a primeira chamada   | Mediana de 1,3 s                                                  |
| Partida do `pi -p` até a primeira requisição | 0,15 s sem extensões e 0,29 s com extensões                       |
| Transporte do Codex                          | WebSocket com `previous_response_id`, já reaproveitado por sessão |

Um efeito pequeno: o `pi -p` leva 3,1 s para sair depois da resposta quando o provedor é `openai-codex`. Com Anthropic e opencode-go, a saída leva menos de 0,7 s. Isso só afeta usos com subprocesso, como o `bench:delivery`.

## Experimento: modelo do dono numa tarefa folha

A tarefa é a do `bench:delivery`: corrigir o limite do desconto, lançar `UnknownSkuError` e adicionar dois testes. Cada execução foi um único `pi -p` num repositório novo, com as extensões padrão. Um teste oculto conferiu o resultado. As 14 execuções passaram no teste oculto.

| Configuração               | Tempo total |    Modelo | Turnos | Custo de tabela |
| -------------------------- | ----------: | --------: | -----: | --------------: |
| `gpt-6.1-sol:high`, fast   |   54 e 64 s | 29 e 39 s |  6 e 8 | US$ 0,07 a 0,09 |
| `gpt-6.1-sol:medium`, fast |   52 e 67 s | 28 e 42 s | 8 e 11 | US$ 0,07 a 0,08 |
| `gpt-6.1-sol:low`, fast    |   48 e 62 s | 23 e 37 s | 7 e 13 | US$ 0,07 a 0,08 |
| `gpt-6-luna:medium`, fast  |   27 e 29 s | 23 e 25 s | 7 e 11 |       US$ 0,004 |
| `claude-haiku-5-5:medium`  |   38 e 38 s | 17 e 17 s |  5 e 6 |       US$ 0,005 |
| `claude-opus-5-5:medium`   |   13 e 17 s | 12 e 16 s |  4 e 4 | US$ 0,10 a 0,16 |
| `claude-sonnet-5-5:medium` |    9 e 11 s |  8 e 10 s |  4 e 5 | US$ 0,05 a 0,08 |

O que explica a diferença, pelas transcrições:

- Os três Sol e o Haiku rodaram `bun run setup` de novo, que leva 20 s, embora o banco já estivesse pronto. Opus, Sonnet e Luna rodaram só `bun test`.
- O Sol chamou `todo_write` de 2 a 5 vezes por execução, numa tarefa de dois passos. Opus e Sonnet não o chamaram.
- O Opus leu tudo num `bash`, editou os dois arquivos num `patch` e testou no mesmo turno.

Limites: a tarefa é pequena, cada configuração rodou duas vezes, e o experimento não mede a qualidade em tarefas difíceis. O custo é o preço de tabela que o pi registra. A cobrança real por assinatura pode ser outra.

## Experimento: modelo do dono em fixes reais

O `bench:delivery --task` repete dois fixes reais deste repositório, com o fluxo gerenciado inteiro:

- **`diagnosis-owner`:** o commit `16bb7e4`, em que o `next` passa a pedir um dono novo depois de um diagnóstico.
- **`workspace-setup`:** o commit `6b53028`, em que o setup do workspace ganha timeout, não espera serviços em segundo plano e guarda o commit base da branch.

Cada execução clona o repositório no pai do fix e segue os checkpoints sem rodadas forçadas. Depois, os testes do fix substituem os do candidato, e o comando de aceite precisa passar. Só o dono muda entre os braços. O coordenador, a revisão e a verificação usam a política padrão. As duas tarefas rodaram ao mesmo tempo na mesma máquina.

| Tarefa e braço              | Estado                       | Parede        | Dono        | Verificação | Custo           |
| --------------------------- | ---------------------------- | ------------- | ----------- | ----------- | --------------- |
| `diagnosis-owner`, Sol high | 2 aceitas                    | 450 e 847 s   | 177 e 441 s | 147 e 356 s | US$ 1,48 e 1,34 |
| `diagnosis-owner`, Opus 5.5 | 1 aceita, 1 `wip`            | 345 e 283 s   | 137 e 247 s | 135 s       | US$ 1,16 e 0,47 |
| `diagnosis-owner`, Sonnet   | 2 aceitas, uma com 2 rodadas | 1.870 e 606 s | 922 e 231 s | 888 e 326 s | US$ 2,60 e 1,35 |
| `workspace-setup`, Sol high | 2 aceitas                    | 601 e 1.155 s | 309 e 716 s | 171 e 394 s | US$ 1,50 e 1,61 |
| `workspace-setup`, Opus 5.5 | 2 aceitas                    | 528 e 945 s   | 241 e 305 s | 233 e 592 s | US$ 1,30 e 1,44 |
| `workspace-setup`, Sonnet   | 2 aceitas                    | 1.302 e 477 s | 268 e 237 s | 982 e 181 s | US$ 1,25 e 1,27 |

Todas as execuções aceitas passaram no aceite oculto. O que os dados mostram:

- **Dono:** o Sol foi o dono mais lento em 3 de 4 pares. A mediana do dono foi 375 s no Sol, 244 s no Opus e 253 s no Sonnet.
- **Falha do Opus:** o `wip` veio de um relatório com `kind: "diagnosis"` num papel `bug-fix`. A tarefa trata de diagnóstico, e o modelo confundiu o tipo do relatório. A correção de relatório proibia trocar o `kind`, e o coordenador não registrou a tentativa falha.
- **Variância:** a mesma configuração variou até 3 vezes entre duas execuções. Duas execuções não bastam para trocar a política.
- **Testes:** a suíte de `packages/pstack` levou 84 s numa máquina livre e de 150 a 240 s com as duas tarefas ao mesmo tempo. Donos e verificadores rodaram a suíte completa até 5 vezes por execução.
- **Timeouts:** várias dessas repetições vieram de um `bash` com timeout de 120 a 240 s, abaixo da duração da suíte. O agente repetiu o mesmo comando depois do timeout.

Correções feitas a partir desses dados:

- Um papel de implementação agora sempre registra `kind: "implementation"`. O pstack normaliza o campo antes da validação.
- Uma tentativa gerenciada que falha agora traz no resultado o comando `pstack_delivery record` exato.
- O pacote de entrega pede checks focados primeiro, uma suíte completa por vez e um timeout acima da duração esperada.
- O arquivo `child-bootstrap.test.js` ocupava 84 s da suíte do pstack sozinho. Ele virou seis arquivos, e a suíte caiu para 33 s.
- No subagent, `integration.test.ts` levava 150 s. Ele virou oito arquivos, e o arquivo mais lento caiu para 33 s. Os arquivos de isolamento e coordenação também foram divididos.

A suíte inteira do repositório quase não mudou: de 151 para 143 s. Ela já ocupa a CPU: 656 s de usuário e 494 s de sistema em 147 s, com 10 núcleos. O tempo de sistema vem sobretudo de processos `git` e de cópias de workspace. Um cenário de workflow sozinho chama o `git` 137 vezes.

Uma segunda rodada repetiu o Sol e o Opus depois das correções do pstack. Os clones continuam no commit antigo, então a divisão dos testes não entra nessa medida.

| Medida                                   | Primeira rodada | Segunda rodada |
| ---------------------------------------- | --------------- | -------------- |
| Execuções aceitas                        | 7 de 8          | 8 de 8         |
| Rodadas de correção                      | 0               | 0              |
| Suítes completas por execução            | 2,5             | 2,6            |
| Timeouts de `bash` em suíte completa     | 4               | 0              |
| Tempo em suítes completas por execução   | 373 s           | 307 s          |
| Verificação de runtime, mediana e máximo | 233 e 592 s     | 168 e 233 s    |
| Parede das execuções aceitas, mediana    | 601 s           | 621 s          |
| Dono, mediana do Sol e do Opus           | 375 e 244 s     | 275 e 376 s    |

- **Confiabilidade:** as correções eliminaram a falha de contrato e os timeouts. A cauda da verificação de runtime caiu de 592 para 233 s.
- **Parede:** a mediana não mudou. O tempo do dono varia mais que o efeito das correções.
- **Modelo do dono:** nas execuções aceitas das duas rodadas, a mediana do dono foi 306 s no Sol e 305 s no Opus. Os dados não justificam trocar a política de `bug-fix`.
- **Suítes completas:** o número por execução não caiu. O dono e o verificador rodam a suíte, cada um uma ou duas vezes. Um serviço de gates por SHA de árvore é a alavanca para esse custo.

## Experimento: serviço de gates

O `pstack_gate` roda suítes, checks e builds com cache pela árvore do workspace. O [ADR 0002](adr/0002-tree-keyed-gates.md) descreve o desenho. O A/B comparou o commit `4e73660`, sem a ferramenta, com o `ee33737`, com ela. Cada braço rodou 3 vezes por tarefa, em sequência e intercalado, com a política padrão.

| Tarefa e braço           | Aceitas | Parede, mediana | Verificação de runtime | Execução de agentes | Comandos longos | Custo    |
| ------------------------ | ------- | --------------- | ---------------------- | ------------------- | --------------- | -------- |
| `diagnosis-owner`, base  | 3 de 3  | 442 s           | 134 s                  | 546 s               | 2 e 202 s       | US$ 1,42 |
| `diagnosis-owner`, gates | 3 de 3  | 431 s           | 41 s                   | 425 s               | 1 e 88 s        | US$ 1,32 |
| `workspace-setup`, base  | 3 de 3  | 592 s           | 131 s                  | 673 s               | 2 e 179 s       | US$ 1,59 |
| `workspace-setup`, gates | 2 de 3  | 647 s           | 50 s                   | 639 s               | 1 e 85 s        | US$ 1,87 |

Todas as execuções passaram no aceite oculto. O que os dados mostram:

- **Verificação:** o verificador reaproveitou a suíte do dono em todas as execuções. A verificação de runtime caiu de 131 a 134 s para 41 a 50 s.
- **Parede:** a mediana quase não mudou. A revisão estática do Opus 5 xhigh, de 160 a 420 s, ficou sozinha no caminho crítico.
- **CPU:** a execução de agentes caiu de 5% a 22%. Isso conta mais quando várias issues rodam ao mesmo tempo.
- **Falha:** uma execução terminou como `candidate`. O revisor estático repetiu um critério com o mesmo resultado, e a correção que removeu a repetição contou como mudança de veredito. O `next` pedia outra revisão, mas o preflight exigia o reparo do relatório, e o coordenador parou.

Correções feitas a partir dessa falha:

- O pstack junta entradas repetidas de critério ou achado que têm o mesmo veredito, antes da validação. Entradas repetidas que discordam ainda são rejeitadas.
- O `next` agora tem o passo `repair`, que nomeia o relatório a reparar. O `next` e o preflight concordam.

O reaproveitamento de gates não muda a parede de uma issue enquanto a revisão estática for o caminho crítico. O ganho dele está na CPU e na vazão de várias issues.

As chamadas de `git` do isolamento também foram medidas. A preparação de cada tentativa leva cerca de 0,5 s em todas as execuções, menos de 0,5% da parede. Reduzir essas chamadas não muda o tempo de entrega.

## Experimento: motor de entrega

O `pstack_deliver` segue o `next` em código. O coordenador abre a issue, chama o motor uma vez e lê o checkpoint final. O [ADR 0003](adr/0003-delivery-engine.md) descreve o desenho. O A/B comparou o braço `workspace`, em que o coordenador segue o `next` à mão, com o braço `engine`. Os dois braços rodaram o commit `7b8bb01`, com o mesmo brief, os mesmos critérios e os mesmos prompts de revisão. Cada braço rodou 3 vezes por tarefa, em sequência e intercalado.

A sobrecarga de coordenação é a parede menos o caminho crítico dos agentes: dono, a revisão mais longa e a preparação.

| Tarefa e braço                 | Aceitas | Rodadas | Parede, mediana | Sobrecarga, mediana | Turnos do coordenador | Custo    |
| ------------------------------ | ------- | ------- | --------------- | ------------------- | --------------------- | -------- |
| `diagnosis-owner`, coordenador | 3 de 3  | 1, 1, 1 | 403 s           | 45 s                | 12                    | US$ 1,29 |
| `diagnosis-owner`, motor       | 3 de 3  | 1, 1, 1 | 421 s           | 32 s                | 8                     | US$ 1,17 |
| `workspace-setup`, coordenador | 3 de 3  | 1, 1, 1 | 602 s           | 41 s                | 14                    | US$ 1,41 |
| `workspace-setup`, motor       | 3 de 3  | 1, 1, 2 | 814 s           | 30 s                | 8                     | US$ 1,97 |

Todas as execuções passaram no aceite oculto. O que os dados mostram:

- **Sobrecarga:** o motor cortou a coordenação de 41 a 45 s para 30 a 32 s por issue, e os turnos do coordenador de 12 a 14 para 8. Uma segunda rodada não aumentou a sobrecarga do motor.
- **Parede:** a diferença de parede vem do dono e do revisor, não do motor. O dono variou de 286 a 647 s e a revisão estática de 173 a 492 s na mesma tarefa.
- **Contexto real:** o benchmark começa cada coordenador com contexto vazio. Na sessão de autopilot, cada turno do coordenador carregava 257 mil tokens de prompt, então o ganho do motor ali é maior.

Três rodadas de medição foram descartadas:

- Na primeira, o motor e o coordenador davam prompts diferentes aos revisores. O verificador do motor testava cada critério com checks executáveis e achou um caminho real que o fix original não cobria. Isso custou uma rodada a mais em todas as execuções do motor. Agora o benchmark e o motor usam o mesmo `reviewPrompt`.
- Em outra, o Mac dormiu 2 h 40 min no meio de uma execução. A fila agora roda com `caffeinate`.
- Uma execução do motor no `workspace-setup` precisou de 2 rodadas por um defeito de protocolo, descrito abaixo.

O defeito: o revisor estático omitiu o `failureClass` num relatório `candidate` com critérios `pending` e achados não bloqueantes. O pstack só inferia `none` quando todos os critérios passavam. A correção acrescentou o campo, mas o pstack tratou a semântica original como indisponível e forçou `wip`. O `wip` virou uma rodada de correção do dono para achados não bloqueantes. Correções feitas:

- O pstack infere `failureClass: none` para um `candidate` ou `accepted` sem critério `fail` ou `blocked` e sem achado bloqueante aberto.
- Uma correção que só acrescenta o `failureClass` mantém o veredito original.

## Experimento: esforço da revisão estática

A revisão estática do Opus 5 xhigh ficou no caminho crítico depois do serviço de gates. O A/B trocou só o seletor de `code review` por `anthropic/claude-opus-5:high`, no braço `engine` do mesmo commit, com 3 execuções por tarefa.

| Tarefa e esforço         | Aceitas | Rodadas | Revisão estática              | Parede, mediana | Custo    |
| ------------------------ | ------- | ------- | ----------------------------- | --------------- | -------- |
| `diagnosis-owner`, xhigh | 3 de 3  | 1, 1, 1 | 185, 213 e 260 s              | 421 s           | US$ 1,17 |
| `diagnosis-owner`, high  | 3 de 3  | 1, 1, 1 | 125, 163 e 177 s              | 413 s           | US$ 1,11 |
| `workspace-setup`, xhigh | 3 de 3  | 1, 1, 2 | 173, 331 e 492 s em 2 rodadas | 814 s           | US$ 1,97 |
| `workspace-setup`, high  | 3 de 3  | 1, 1, 1 | 162, 212 e 244 s              | 520 s           | US$ 1,29 |

Nas 11 revisões de uma rodada com xhigh do A/B do motor, nos dois braços, a mediana foi 241 s. Com high, foi 170 s, cerca de 30% menos. Todas as execuções com high passaram no aceite oculto. Nenhuma execução dos dois esforços precisou de correção por achado da revisão estática, então o experimento não mede a perda de achados. A política de modelos é do usuário e continua igual. A recomendação é trocar `code review` para `high` e acompanhar as rodadas de correção.

## Referências externas

| Fonte                                                                                                                                                            | Achado                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [TraceLab](https://syfi.cs.washington.edu/blog/2026-06-25-tracelab/), cerca de 4.300 sessões de Claude Code e Codex                                              | Cada pedido executa 8,8 passos e 10,8 chamadas de ferramenta. Uma geração leva cerca de 13 s e uma ferramenta cerca de 18 s. Entre pedidos, o usuário leva 46,7 min em média                                                 |
| [SWE-grep](https://cognition.com/blog/swe-grep)                                                                                                                  | A busca agêntica costuma levar de 10 a 20 turnos seriais. Com 8 chamadas paralelas por turno, 4 turnos bastam. Mais de 60% do primeiro turno ia para buscar contexto                                                         |
| [SWE-1.5](https://cognition.com/blog/swe-1-5)                                                                                                                    | 950 tok/s na Cerebras. A Cognition precisou reescrever ferramentas do harness porque elas viraram gargalo                                                                                                                    |
| [Codex-Spark](https://openai.com/index/introducing-gpt-5-3-codex-spark/) e [WebSockets](https://openai.com/index/speeding-up-agentic-workflows-with-websockets/) | Mais de 1.000 tok/s. O WebSocket deixou o loop do agente 40% mais rápido. A sonda mostrou que a conta ChatGPT não tem acesso ao Spark                                                                                        |
| [Fast mode da Anthropic](https://platform.claude.com/docs/en/build-with-claude/fast-mode)                                                                        | Até 2,5 vezes mais tokens por segundo no Opus 5.5, a US$ 8 e US$ 40 por milhão de tokens. A sonda mostrou que a conta precisa de créditos de uso                                                                             |
| [Cursor Composer](https://prod.cursor.com/blog/composer)                                                                                                         | Cerca de 200 tok/s, apresentado como 4 vezes mais rápido que modelos comparáveis                                                                                                                                             |
| [LLMCompiler](https://proceedings.mlr.press/v235/kim24y.html)                                                                                                    | Planejar chamadas independentes em paralelo deu de 1,8 a 3,7 vezes menos latência que ReAct                                                                                                                                  |
| [Speculative Actions](https://arxiv.org/abs/2510.04371)                                                                                                          | Prever a próxima ação acertou até 55% e reduziu a latência em cerca de 20%                                                                                                                                                   |
| [Dynamic workflows do Claude Code](https://code.claude.com/docs/en/workflows)                                                                                    | Um script orquestra os subagentes. O modelo não decide cada passo                                                                                                                                                            |
| [pstack-t3, live run de 2026-10-06](https://github.com/creedants/pstack-t3/blob/main/docs/live-runs.md)                                                          | 4 issues em 109 min, com 3 donos em paralelo no Grok 4.7 Build Fast e 4 verificadores paralelos de outras famílias. A primeira issue entrou em 13 min. A quarta precisou de 5 rodadas, e um design de 69 linhas levou 17 min |

O pstack-t3 parece mais rápido por três motivos. Ele trabalha várias issues ao mesmo tempo, usa um dono rápido e roda num repositório Python pequeno. Ele também sofre com rodadas sem limite e com o custo da fase de design.

## Evidência do pi-harness

O `~/Workspaces/pi-harness` é o harness anterior, com commits de julho a setembro de 2026. Ele roda uma feature por vez, com um runner determinístico e um worker por feature. Ele não serve de referência de velocidade: as últimas features no `hibou` levaram de 2,0 a 3,8 h. O valor dele está nos dados e nas peças prontas.

### Dados do postmortem

`docs/08-run-postmortem.md` mede 26 features no `sotaq` e no `hibou`: 418 sessões, 206 h e US$ 1.263.

| Achado                                         | Medida                                                                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Retrabalho e verificação                       | 56% do custo. A primeira passada custou 44%                                                                                              |
| Rodadas de revisão                             | 4 por feature, com até 18 rodadas numa feature de 20,6 h                                                                                 |
| Origem dos bloqueios depois da primeira rodada | 83% vieram da correção da rodada anterior, em 64 achados classificados                                                                   |
| Causas da espiral                              | Rodadas sem limite, revisão só do delta da correção, prosa de ADR tratada como bloqueio, sensor de mutação e memória de uma única rodada |
| Contexto                                       | 96,9% dos tokens eram leitura de cache. Os workers leram os mesmos 7 documentos 1.557 vezes                                              |

O padrão é compatível com as nossas 3 submissões por issue. Os nossos ledgers ainda não registram a origem de cada achado. Essa classificação é o próximo dado a coletar.

### A/B de modelo numa feature real

O pi-harness repetiu uma feature com o mesmo contrato congelado, o mesmo commit base e o mesmo plano.

| Braço                  | Assertions |  Tempo | Turnos |  Tokens |  Custo |
| ---------------------- | ---------: | -----: | -----: | ------: | -----: |
| Opus, esforço medium   |      21/21 | 2,76 h |    500 |  60,7 M | US$ 43 |
| Sonnet 5, esforço high |      21/21 | 3,55 h |    879 | 175,7 M | US$ 52 |

O modelo mais rápido por token levou 29% mais tempo porque precisou de 75% mais turnos. O esforço também mudou entre os braços. Esse resultado limita o experimento folha deste relatório.

### Peças reaproveitáveis

| Peça                                            | Arquivo                                                        | Uso no pstack                                                                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocolo A/B numa feature real                 | `scripts/eval-ab.sh`, `scripts/run-metrics.py`                 | Repetir uma issue real do `spice-target` com outra configuração. Isso supre o benchmark com gate pesado que falta                                   |
| Gate determinístico na fronteira de tarefa      | `src/commit-gate.ts`                                           | O motor roda o gate rápido, e não o modelo. Um gate vermelho devolve a mesma tarefa com o fim do erro                                               |
| Detector de zero testes                         | `src/gate-output.ts`                                           | Barra o falso verde de um comando que não coleta testes. O pi-harness registrou 6 casos                                                             |
| Limite de rodadas e rodada extra explícita      | `GATE_ROUND_CAP` e `grantGateRound` em `src/feature-runner.ts` | Limita as correções. Uma rodada extra exige um defeito de correção demonstrável                                                                     |
| Piso de severidade e ledger de achados julgados | `skills/harness-code-review`, `synthesis-r<N>.json`            | Só correção, segurança e contrato bloqueiam. Um achado já julgado não volta                                                                         |
| Contexto reinjetado a cada turno                | `src/context-inject.ts`                                        | Entrega ao dono os critérios e os achados abertos sem releitura. Conteúdo repetido vira uma linha                                                   |
| Guards em `tool_call`                           | `src/guards.ts`                                                | Bloqueiam uma ação proibida e dizem o que fazer. Exemplo para nós: rodar `setup` de novo num workspace pronto                                       |
| Revisor concorrente, só no desenho              | `docs/09-v2-design.md`, seção 3.5                              | Um advisor lê o delta do transcript e corrige o dono no turno em que o defeito nasce. Isso ataca a espiral na origem, com risco de custo e de ruído |

O que não copiar:

- A execução de uma feature por vez. O nosso alvo é paralelismo entre issues.
- O sensor de mutação como bloqueio. Ele fabricou bloqueios em linhas novas de correção.
- Workers como subprocesso RPC. O nosso subagent já roda no mesmo processo.

## Modelo de latência

Para uma issue:

```text
T_issue = espera_humana + coordenação
        + Σ rodadas [ turnos × (primeiro_token + tokens_saída / vazão) + gates ]
        + revisão e verificação no caminho crítico
```

Para um lote de issues:

```text
vazão = issues em paralelo / T_issue
```

As alavancas atuam assim:

| Termo                  | Valor medido                                                            | Alavanca                                                                            |
| ---------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Espera humana          | 22% da sessão                                                           | A fila de perguntas não bloqueia, e o motor segue com outras issues                 |
| Coordenação            | ~1.600 turnos de Opus, 4,2 h                                            | Um motor em código executa o `next`. O LLM só decide exceções                       |
| Turnos                 | 146 turnos de implementação por issue, 92% com uma ferramenta           | Chamadas paralelas, pacote de contexto e menos bookkeeping                          |
| Primeiro token e vazão | Sol: 2 s e 40 tok/s. Opus 5.5: 0,7 s e 90 tok/s                         | Rotear o modelo por fase com base em medição                                        |
| Gates                  | 26 min de testes e checks por issue. O gate completo leva de 8 a 10 min | Loop interno rápido, um gate completo por árvore e cache pelo SHA da árvore         |
| Rodadas                | 3 submissões por issue                                                  | O dono roda os gates e o checklist da revisão antes de submeter. Rodadas têm limite |
| Paralelismo            | 1,36                                                                    | Várias issues com governador de recursos e fila de landing                          |

## Alavancas por impacto

|   # | Alavanca                                                                                                                       | Efeito esperado                                                                                                                                  | Esforço | Risco                                    |
| --: | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ---------------------------------------- |
|   1 | Nunca bloquear em humano. Perguntas entram numa fila, a issue fica `blocked` e o motor segue                                   | Remove até 22% do tempo de parede                                                                                                                | Baixo   | Baixo                                    |
|   2 | Motor de entrega determinístico no lugar do coordenador LLM                                                                    | Remove a maior parte de cerca de 100 turnos de coordenador por issue, cada um com 257 mil tokens de prompt                                       | Médio   | Médio                                    |
|   3 | Roteamento de modelos medido por fase                                                                                          | Na tarefa folha, o dono ficou 4 a 5 vezes mais rápido. No A/B do pi-harness, o Sonnet levou 29% mais tempo que o Opus                            | Baixo   | Médio, por causa da qualidade e do custo |
|   4 | Serviço de gates com cache pelo SHA da árvore e gate completo em segundo plano                                                 | Corta a maior parte dos 26 min de testes e checks por issue. O verificador reaproveita o resultado                                               | Médio   | Baixo                                    |
|   5 | Várias issues em paralelo, com governador de CPU e fila de landing                                                             | Multiplica a vazão. O limite é a CPU dos gates                                                                                                   | Alto    | Médio                                    |
|   6 | Menos turnos: contexto reinjetado por turno, chamadas paralelas, nenhum `todo_write` em folhas e guard contra `setup` repetido | De 30% a 50% menos turnos, segundo o SWE-grep                                                                                                    | Baixo   | Baixo                                    |
|   7 | Menos retrabalho: limite de rodadas, piso de severidade, ledger de achados julgados e autoverificação do dono                  | No pi-harness, 83% dos bloqueios depois da primeira rodada vieram da correção anterior. Passar de 3 para 2 submissões elimina uma rodada inteira | Médio   | Baixo                                    |
|   8 | Saída menor na revisão: relatório estruturado e esforço `high`                                                                 | A revisão gerou 784 mil tokens de saída em 12 sessões                                                                                            | Baixo   | Baixo                                    |
|   9 | Fast mode da Anthropic no Opus                                                                                                 | Até 2,5 vezes mais tokens por segundo                                                                                                            | Baixo   | Depende de créditos e custo              |
|  10 | Execução especulativa                                                                                                          | Cerca de 20% em loops previsíveis                                                                                                                | Alto    | Alto                                     |

## Opções de arquitetura

### A. Ajustes sem reescrita

Mudar a política de modelos, as regras dos skills e os briefs. Inclui as alavancas 1, 3, 6, 7 e 8. É barato, mas o coordenador LLM continua no caminho crítico.

### B. Reescrever a orquestração (recomendada)

Um motor de entrega determinístico, escrito em TypeScript dentro do pacote `pstack`, assume o papel do coordenador:

```text
fila de issues ──> escalonador ──> máquina de estados por issue
                    │                 workspace → implementar → gates → revisão ∥ verificação
                    │                 → corrigir (resume do dono) → landing
                    ├── governador de recursos (slots de CPU para gates)
                    ├── serviço de gates (cache por tree SHA, logs compartilhados)
                    ├── pool de agentes (roteamento de modelo por fase e medição)
                    ├── fila de perguntas (nunca bloqueia uma issue alheia)
                    └── fila de landing (rebase, gate da árvore final, merge)
```

| Componente         | Base atual                                                        | O que muda                                                                                          |
| ------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Máquina de estados | `packages/pstack/src/delivery-next.ts` já calcula o próximo passo | Um executor em código segue o `next`, sem um turno de LLM por transição                             |
| Workspace de issue | `packages/pstack/src/delivery-workspace.ts`                       | Continua igual, e cada issue em paralelo tem a sua worktree                                         |
| Agentes            | `Task` e o runtime em `packages/subagent`                         | Continuam iguais, chamados pelo motor e não pelo modelo                                             |
| Gates              | O dono e o verificador rodam `bun run check` por conta própria    | Um serviço roda o gate por SHA de árvore, guarda o resultado e serve o log aos agentes              |
| Ledger             | `pstack_delivery` com receipts                                    | Continua sendo a fonte da verdade e registra cada transição do motor                                |
| Decisões           | O coordenador decide tudo                                         | O motor chama um LLM só para triagem: achado fora de escopo, design contestado ou limite de rodadas |

O usuário fala com uma sessão normal do pi. Ela inicia e consulta o motor por uma ferramenta e recebe eventos de conclusão. Isso segue o modelo dos dynamic workflows e do `brigade.py`.

### C. Reescrita total, com novo runtime ou outra linguagem

Não recomendada. O harness responde em milissegundos, e o subagent cria um filho em 1,3 s. Um runtime novo em Rust ou Go não muda nenhum termo dominante do modelo de latência. Ele também custaria a integração com o pi, as extensões e o ledger.

## Metas e medição

| Métrica                               | Hoje                                                                                                  | Meta da opção B (projeção) |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------- |
| Tempo até aceito por issue, p50       | 68 min depois do primeiro evento no `spice-target`. Cerca de 150 min por issue na sessão de autopilot | 25 a 40 min                |
| Issues por hora num lote              | Cerca de 0,4 na sessão de autopilot                                                                   | 4 a 8 vezes mais           |
| Turnos de coordenador por issue       | ~100                                                                                                  | Menos de 5                 |
| Submissões de implementação por issue | 3                                                                                                     | 2 ou menos                 |
| Espera humana no caminho crítico      | 22%                                                                                                   | 0                          |

As metas são projeções a partir dos componentes medidos, não medições. Cada alavanca precisa de prova no benchmark antes de virar padrão:

1. Adicionar `--owner <model>` ao `bench:delivery` para medir o roteamento com o fluxo inteiro.
2. Portar o protocolo do `eval-ab.sh`: repetir uma issue real, com o mesmo commit base e os mesmos critérios, em duas configurações.
3. Criar um fixture com gate pesado, de 3 a 5 minutos, e com 3 issues independentes. O fixture atual não reproduz o custo de gate do `spice-target`.
4. Comparar os braços `workspace` e `engine` com 3 execuções cada, como no PR #16.

## Sequência sugerida

1. **Ajustes rápidos, em dias:**
   - Medir o roteamento com `--owner` e com um A/B numa issue real.
   - Trocar a política só se o A/B real confirmar o ganho e a qualidade.
   - Limitar as rodadas, aplicar o piso de severidade e manter um ledger de achados julgados.
   - Bloquear com um guard o `setup` repetido num workspace pronto.
   - Proibir `AskQuestion` bloqueante no autopilot.
   - Encurtar os relatórios de revisão.
   - Tirar o `todo_write` dos briefs de folha.
   - Pedir ao dono que rode os gates antes de submeter.
2. **Serviço de gates:** criar o cache por SHA de árvore, o gate completo em segundo plano e o reaproveitamento pelo verificador. O `commit-gate.ts` e o `gate-output.ts` do pi-harness servem de base.
3. **Motor de uma issue:** um executor do `next` em código, com triagem por LLM só nas exceções.
4. **Motor de várias issues:** o escalonador, o governador de recursos, a fila de perguntas e a fila de landing.
5. **Opcional:** fast mode da Anthropic, se houver créditos, e um subagente de contexto rápido no padrão do SWE-grep.

Os passos 2 a 4 pedem um ADR antes do código, como o ADR 0001.

### Estado em 2026-10-11

Feito na branch `perf/delivery-first-steps`:

- O ledger pede um diagnóstico depois de três rodadas de revisão rejeitadas.
- A revisão segue um piso de severidade e não reabre um achado julgado sem evidência nova.
- Um guard bloqueia o `setup` repetido num workspace pronto.
- O autopilot pergunta de forma assíncrona e segue com o trabalho independente.
- O `bench:delivery` repete fixes reais com `--task`, compara donos com `--owner`, revisores com `--reviewer`, commits com `--revision` e o motor com `--arms workspace,engine`.
- Um papel de implementação sempre registra `kind: "implementation"`, e uma tentativa falha traz o comando de registro.
- O pacote de entrega pede uma suíte completa por vez e um timeout suficiente.
- As suítes do pstack e do subagent foram divididas em arquivos paralelos.
- O `pstack_gate` roda os gates com cache pela árvore, conforme o ADR 0002.
- O `pstack_deliver` roda o loop de entrega em código, conforme o ADR 0003. Ele roda várias issues em paralelo.
- O protocolo junta entradas repetidas de relatório, tem o passo `repair` e infere `failureClass: none` para revisões que adiam a execução.

Decisões:

- O `todo_write` continua nos briefs de folha só para escopos de vários passos.
- As chamadas de `git` do isolamento continuam iguais, porque custam menos de 0,5% da parede.
- A política de modelos é do usuário e não mudou. Os dados recomendam `code review` em `high`.

Pendente:

- Medir várias issues em paralelo num fixture com gate pesado.
- Medir o efeito do limite de rodadas e do piso de severidade em entregas reais.
- Encurtar os relatórios de revisão.
