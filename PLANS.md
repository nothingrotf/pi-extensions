# Plano de evolução dos packages Pi

## 1. Objetivo e estado

Este documento consolida a comparação entre nossos packages e o repositório `IgorWarzocha/howaboua-pi-stuff`.
O objetivo é aproveitar mecanismos úteis sem substituir componentes locais que já resolvem o problema.

A análise recomenda melhorias, experimentos e exclusões.
A criação deste documento não autoriza a implementação integral do backlog, instalações, publicação ou mudanças de configuração.
PLAN-00, PLAN-05, PLAN-16, PLAN-20 e a fase PLAN-04a estão concluídos.
PLAN-17 e PLAN-18 estão concluídos, exceto os critérios marcados como pendentes.
Os demais itens permanecem pendentes. A seção 7 registra o estado de cada item.

### Referências da análise

| Referência                            | Revisão ou versão observada                          |
| ------------------------------------- | ---------------------------------------------------- |
| Repositório local                     | `6b9a1dd2aa9954feac08abdfaac4a7cb8631508c`           |
| Repositório externo                   | `b80aa3522e570ee6753fd5d90f6d3c940ac4d211`           |
| Packages locais                       | 14                                                   |
| Diretórios externos com manifest      | 36, incluindo bundles, skills e packages aposentados |
| Skills do `pstack`                    | 54 arquivos `SKILL.md`                               |
| Catálogo Pi local                     | `^0.99.1`                                            |
| SDK resolvido pelo package `subagent` | `0.99.1`                                             |
| Pi instalado no ambiente da análise   | `1.1.0`, runtime efetivo das extensões               |
| Ensaio de compatibilidade             | Catálogo `^1.1.0` em worktree temporário             |

Os links externos deste documento apontam para a revisão inspecionada.
Os caminhos locais correspondem à revisão local indicada acima.
O snapshot temporário usado na pesquisa não é uma dependência deste plano.

### Evidência disponível

- A análise cobriu os manifests e os READMEs dos dois conjuntos de packages.
- As recomendações principais incluem inspeção de implementação e contratos locais.
- O `tool-cost-cli` local executou uma medição com provider simulado.
- Nenhuma aplicação externa foi instalada ou executada.
- A análise comparativa não incluiu a execução da suíte completa.
- Testes citados como existentes foram inspecionados, não executados nessa análise.
- A pesquisa não comprova segurança integral, desempenho em produção ou disponibilidade dos serviços externos.
- A comparação entre Pi 0.99.1 e 1.1.0 usou changelogs, declarações de tipos e documentação dos dois pacotes instalados.
- Um worktree temporário executou `bun run check`, `bun run test` e o `tool-cost-cli` com o catálogo `^1.1.0`.
- O ensaio com 1.1.0 não alterou arquivos deste repositório.

## 2. Direção recomendada

A prioridade é melhorar seleção de contexto, decisões humanas e navegação de sessões longas.
Não é necessário importar outro framework de agentes.

Os mecanismos locais de execução, revisão e recuperação devem continuar como base.
As integrações novas devem usar APIs públicas do Pi e contratos pequenos entre packages.

Antes do backlog, alinhe o workspace ao runtime efetivo.
As extensões executam no Pi 1.1.0, mas checks, testes e medições usam o SDK 0.99.1.
Essa divergência escondeu quebras de testes, um defeito de contrato e medições obsoletas.

### Regras para qualquer implementação

- Preserve políticas de modelos, ferramentas permitidas e limites de autoridade.
- Preserve evidências executáveis e referências às fontes.
- Diferencie mensagens de agentes, decisões humanas e autorização de execução.
- Reutilize os recursos nativos de exposição, contexto, persistência e UI do Pi.
- Meça resultados antes de trocar padrões de funcionamento.
- Mantenha integrações específicas de provider opcionais.
- Preserve trust, recursos desabilitados e precedência de configuração.
- Evite dependências nativas quando a capacidade existente resolve o problema.
- Preserve licenças e atribuições aplicáveis ao adaptar código externo.
- Não trate quantidade de packages como medida de qualidade.

## 3. Inventário local e oportunidades

| Package                                                 | Capacidade atual                                                                    | Direção recomendada                                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [`ask`](packages/ask/README.md)                         | Perguntas múltiplas, seleção, texto livre, fila e respostas assíncronas.            | Acrescentar evidências, comentários, handoffs, retomada e RPC.                       |
| [`cloak`](packages/cloak/README.md)                     | Mascaramento configurável de resultados de `read`.                                  | Preservar o escopo e explicitar que não é uma barreira de segurança.                 |
| [`compact`](packages/compact/README.md)                 | Compactação determinística, enriquecimento opcional e recall com fontes.            | Avaliar checkpoints explícitos e navegação por marcadores sem substituir o padrão.   |
| [`fast-mode`](packages/fast-mode/README.md)             | Fast Mode orientado pelo catálogo e política compartilhada com subagentes.          | Reutilizar a política em presets, sem reimplementar o provider.                      |
| [`filetools`](packages/filetools/README.md)             | Leituras limitadas, seleção JSON, leitura multifile e patches atômicos.             | Integrar descoberta contextual sem assumir a propriedade das políticas.              |
| [`goal`](packages/goal/README.md)                       | Ciclo coder-reviewer, checks determinísticos, orçamento e convergência limitada.    | Integrar decisões humanas e experimentos de continuidade sem criar outro scheduler.  |
| [`hud`](packages/hud/README.md)                         | Rail, atividade, custos, cache observado, quota e renderização de Markdown/Mermaid. | Renderizar sem re-registrar ferramentas nativas e acrescentar previsão de cache.     |
| [`inline-skill`](packages/inline-skill/README.md)       | Autocomplete fuzzy e expansão de aliases pelo catálogo nativo.                      | Complementar com descoberta de skills pelo modelo, sem outro catálogo independente.  |
| [`loop`](packages/loop/README.md)                       | Agenda persistida, prompts recorrentes e watchers ligados à sessão.                 | Preservar a distinção entre automação da sessão e daemon independente.               |
| [`pstack`](packages/pstack/README.md)                   | Workflows, políticas, entrega gerenciada, revisão, gates e métricas.                | Reduzir custo fixo, integrar triagem e ampliar avaliações existentes.                |
| [`session-history`](packages/session-history/README.md) | Busca lexical, auditoria e paginação de sessões no escopo do projeto.               | Servir como base de proveniência para decisões e memória curada.                     |
| [`subagent`](packages/subagent/README.md)               | Tasks persistentes, isolamento de alterações, coordenação, intercom e painel.       | Avaliar exposição seletiva, conversas laterais e integrações opcionais de segurança. |
| [`tgrep`](packages/tgrep/README.md)                     | Busca textual fresca, com indexação opcional e limitações explícitas.               | Continuar como busca exata e alimentar descoberta contextual.                        |
| [`todo`](packages/todo/README.md)                       | Dependências, bloqueios, persistência e lembretes coordenados com perguntas.        | Integrar novos estados de decisão sem duplicar a gestão de tarefas.                  |

### Capacidades que não devem ser recriadas

- `subagent` já possui atividade, steering, cancelamento, árvore de jobs e comunicação entre agentes.
- `pstack` já exige evidências para critérios e prova executável de runtime.
- `goal` já impede aprovação quando checks falham ou verificações obrigatórias estão indisponíveis.
- `compact` já mantém checkpoints persistíveis e recuperação de evidência após retomada.
- `session-history` já pesquisa sessões anteriores do projeto.
- `ask` já permite trabalho independente enquanto uma resposta assíncrona fica pendente.
- `hud` já agrupa ferramentas e mostra atividade aninhada.
- `loop` já restaura agenda, mas não continua como daemon após encerrar Pi.

Referências de implementação:

- [`packages/subagent/src/intercom.ts`](packages/subagent/src/intercom.ts).
- [`packages/pstack/src/delivery.ts`](packages/pstack/src/delivery.ts), especialmente `complete` e `runtimeProof`.
- [`packages/goal/src/reviewer.ts`](packages/goal/src/reviewer.ts), especialmente `enforceAutomatedChecks`.
- [`packages/compact/src/compact.ts`](packages/compact/src/compact.ts).
- [`packages/compact/test/integration.test.ts`](packages/compact/test/integration.test.ts).

## 4. Inventário externo completo

A classificação indica utilidade para nosso projeto, não qualidade absoluta.
Sobreposição não significa equivalência de comportamento.

| Package externo                          | Propósito                                                                    | Avaliação para nosso stack                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `pi-agent-board`                         | Canais, discussões persistentes, busca e visualizador web.                   | Avaliar histórico por assunto, não duplicar mensagens de status.                 |
| `pi-ask`                                 | Decisões, triagem de findings e handoffs humanos.                            | Incorporar mecanismos no `ask` existente.                                        |
| `pi-auto-trees`                          | Marcadores e fechamento incremental de explorações.                          | Avaliar UX sobre branches e compactação.                                         |
| `pi-better-skills-tool`                  | Descoberta progressiva de skills e referências.                              | Prioridade alta.                                                                 |
| `pi-browser`                             | Navegador autenticado por CDP e roteamento SSH.                              | Opcional, com sobreposição aos workflows de browser existentes.                  |
| `pi-cache-hit-predictor`                 | Previsão de cache ao trocar modelo ou esforço.                               | Melhoria pequena para `hud`, com incerteza explícita.                            |
| `pi-chatgpt-sites`                       | Gestão e publicação de ChatGPT Sites.                                        | Fora do foco, com dependência de APIs específicas e efeitos de produção.         |
| `pi-chill`                               | Agrupamento visual da atividade rotineira.                                   | Referência para `hud`, com sobreposição substancial. Código-fonte não publicado. |
| `pi-codex-conversion`                    | Adaptação ampla de ferramentas, prompts e contexto para Codex.               | Aproveitar contratos específicos, não importar o adaptador inteiro.              |
| `pi-codex-guardian`                      | Bloqueio ou revisão de chamadas conforme regras explícitas.                  | Inspiração para autorização por ação.                                            |
| `pi-codex-imagegen`                      | Geração e edição de imagens via Codex.                                       | Integração opcional, não prioridade do núcleo.                                   |
| `pi-codex-web-run`                       | Busca e navegação web via Codex.                                             | Integração opcional, sem substituir recursos já disponíveis no ambiente.         |
| `pi-dynamic-tools`                       | Comandos TOML através de Code Mode.                                          | Referência conceitual. Aposentado.                                               |
| `pi-explore-subagents`                   | Subagentes exclusivos de exploração.                                         | Já coberto em grande parte por `subagent`. Aposentado.                           |
| `pi-extensions`                          | Bundle geral de extensões.                                                   | Referência de distribuição, não uma capacidade nova.                             |
| `pi-gippity-control`                     | Voz e controle remoto por LAN.                                               | Nicho, com nova superfície de autenticação e rede.                               |
| `pi-gpt-switcher`                        | Atalhos de modelo, esforço e orçamento local de contexto.                    | Aproveitar presets, sem inventar capacidade do provider.                         |
| `pi-grok-realtime`                       | Voz Grok com delegação para a sessão Pi.                                     | Nicho, sem prioridade atual.                                                     |
| `pi-memories`                            | Candidatos de memória em inbox Markdown para revisão manual.                 | Aproveitar curadoria como experimento. Aposentado.                               |
| `pi-notes-compaction`                    | Notas locais, histórico e novas janelas de contexto.                         | Avaliar checkpoints, sem substituir compactação por notes-only.                  |
| `pi-pet`                                 | Companions animados para controle remoto.                                    | Fora do foco atual.                                                              |
| `pi-sandbox`                             | MicroVMs locais persistentes, templates e previews.                          | Possível backend futuro. Código-fonte não publicado.                             |
| `pi-semantic-grep`                       | Busca por embeddings e índice SQLite.                                        | Não substituir `tgrep`. Aposentado.                                              |
| `pi-shepherdr`                           | Orquestração persistente por Herdr.                                          | Sobreposição com `subagent`. Não adotar outro runtime agora.                     |
| `pi-skill-chrome-cdp`                    | Skill de inspeção e automação de Chrome.                                     | Sobreposição aos workflows de browser do `pstack`.                               |
| `pi-skill-code`                          | Skills de pesquisa, higiene, review e entrega.                               | Revisar diferenças pontuais, sem importar skills duplicadas.                     |
| `pi-skill-foundations`                   | Comunicação, instruções e manutenção de skills.                              | Sobreposição aos workflows existentes.                                           |
| `pi-skill-harness-and-agent-engineering` | Diagnóstico de sessões, ferramentas, prompts e cache.                        | Aproveitar métodos de avaliação e calibração.                                    |
| `pi-skill-omarchy-help`                  | Manutenção de estações Omarchy Quattro.                                      | Fora do escopo deste ambiente.                                                   |
| `pi-skills`                              | Bundle de skills compartilháveis.                                            | Referência de distribuição, com sobreposição ao `pstack`.                        |
| `pi-smart-btw`                           | Perguntas laterais assíncronas com inclusão explícita no contexto principal. | Boa melhoria de UX sobre `subagent`.                                             |
| `pi-stuff`                               | Bundle combinado de extensões e skills.                                      | Não instalar como solução para este plano.                                       |
| `pi-subagent-review`                     | Review isolado com seleção de diff e devolução de findings.                  | Aproveitar UX e triagem, preservando nosso runtime read-only.                    |
| `pi-subdir-agents`                       | Instruções aninhadas carregadas durante a descoberta.                        | Prioridade alta, com adaptação aos nossos formatos.                              |
| `pi-unicode-charts`                      | Gráficos Unicode em Markdown.                                                | Melhoria visual opcional para relatórios e benchmarks.                           |
| `pi-vent`                                | Registro de atritos recorrentes do workflow.                                 | Sobreposição conceitual com `reflect`. Aposentado.                               |

Fonte: [árvore de packages inspecionada][ext-packages] e [catálogo principal][ext-root].

## 5. Diferenças entre Pi 0.99.1 e 1.1.0

### Como as versões convivem hoje

- O workspace compila e testa contra o SDK `0.99.1` do catálogo.
- O Pi instalado executa as extensões com a versão `1.1.0`.
- O loader de extensões aplica aliases para `pi-coding-agent`, `pi-agent-core`, `pi-ai`, `pi-tui` e `typebox`.
- Esses aliases fazem cada package usar o runtime instalado, não a versão resolvida pelo workspace.
- Tasks do `subagent` e reviewers do `goal` criam sessões com o SDK do processo que os executa.
- Portanto, checks e testes validam uma versão diferente da versão executada.

Fonte: função `getAliases` em `dist/core/extensions/loader.js` do Pi 1.1.0.

### Ensaio de compatibilidade

Um worktree temporário trocou o catálogo de `^0.99.1` para `^1.1.0` e executou `bun install`.
Em seguida, o worktree executou os checks e os testes exigidos pelo repositório.

| Verificação     | Resultado com 1.1.0                                   | Causa                                                                                                            |
| --------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `bun run check` | Formatação aprovada e 2 erros de tipo em 1 arquivo.   | `Terminal` exige `setProgramStatus`. O dublê `SilentTerminal` de `hud/test/editor-border.test.ts` não o declara. |
| `bun run test`  | 2 falhas em 2.420 testes. 198 de 204 arquivos passam. | O codemode 1.0.0 lança erro ao ler um membro inexistente de `tools`. Dois testes sondam ferramentas dessa forma. |

Os testes afetados são `ask/test/codemode.test.ts` e o harness de `subagent/test/integration-harness.ts`.
O código de produção não usa as APIs removidas nem o padrão de sondagem quebrado.
A migração do workspace é pequena e deve preceder o restante do backlog.

### Mudanças incompatíveis e impacto local

| Mudança                                                                          | Versão | Impacto local                                                                                      |
| -------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| `pi-agent-core` deixou de exportar `harness`, `search`, `node` e telemetria.     | 1.0    | Nenhum. Os packages importam apenas `ThinkingLevel` e `AgentMessage`.                              |
| Ler um membro inexistente de `tools` lança erro. Use `"name" in tools`.          | 1.0.0  | Dois testes falham. Skills e prompts locais não usam o padrão antigo.                              |
| `Terminal.setProgramStatus` passou a ser obrigatório.                            | 1.1.0  | Um dublê de teste do `hud` deixa de compilar.                                                      |
| O provider `azure-openai-responses` passou a se chamar `azure`.                  | 1.0.3  | Nenhuma referência local.                                                                          |
| Allowlists de `tools` aceitam `*` e mantêm ferramentas MCP sem entradas `mcp__`. | 1.0.4  | Sem efeito atual, porque filhos e reviewers usam `noExtensions: true`. O invariante não tem teste. |
| `quietStartup` aceita `"header"` e muda o tipo de `getQuietStartup()`.           | 1.0.0  | Nenhum uso local.                                                                                  |
| `Home` e `End` movem só o cursor. O transcript usa `Ctrl+Home` e `Ctrl+End`.     | 1.0.3  | Nenhum handler local depende desses atalhos.                                                       |
| A TUI usa fullscreen por padrão.                                                 | 1.0.0  | Os testes passam, mas o `hud` inspeciona a estrutura interna de componentes nativos.               |
| A saída do codemode separa itens com `==> text N/M <==` e agrupa `console`.      | 1.1.0  | Nenhum parser local depende do formato anterior.                                                   |

### Protocolos e contratos novos

| Recurso                                                                   | Versão         | Contrato                                                                                                     |
| ------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------ |
| Program Status Protocol, OSC 7501                                         | 1.1.0          | Informa `working`, `blocked`, `done`, `error` e `idle`. `ctx.ui.custom` não marca `blocked`.                 |
| `agent_settled.aborted`                                                   | 1.1.0          | Distingue execução cancelada de execução concluída em eventos de sessão, extensão e JSON.                    |
| `durationMs` em eventos, contexto de renderização e mensagens persistidas | 1.1.0          | Mede `execute()` e respostas do modelo com relógio monotônico. Sessões antigas não possuem o campo.          |
| `outputPad` no contexto de renderização                                   | 1.1.0          | Renderers com `renderShell: "self"` aplicam o padding configurado.                                           |
| `pi.registerToolRenderer()`                                               | 1.0.1          | Escolhe renderers para qualquer ferramenta, inclusive não registrada, sem substituir a definição.            |
| `ToolNamespace.instructions` e `ToolLoadout.getPromptGuidelines()`        | 0.99.2 a 1.0.4 | Separa resumo e instruções longas e expõe guidelines para declarações ocultas.                               |
| `hiddenTools` e `formatSkillsForPrompt(..., "indirect")`                  | 1.0.4          | Ferramentas ocultas por `prepareLoadout` saem das regras. O hint de skills não nomeia leitor inacessível.    |
| `+name`, `-name`, padrões `*` e `disabledBuiltinExtensions`               | 0.99.2 a 1.1.0 | Ajusta a seleção padrão sem substituí-la e desliga built-ins de forma explícita.                             |
| Codemode enxuto                                                           | 1.0.0          | Usa cerca de 40% menos tokens de prompt e explica a recuperação de erros.                                    |
| Limites de saída do codemode                                              | 1.0.1          | Um script falha acima de 16 Mi caracteres ou 100 mil itens.                                                  |
| Imagens no codemode                                                       | 1.0.0 a 1.1.0  | Inclui `models.generateImages()`, arquivo temporário em `image()`, imagem em `tools.read()` e classificação. |
| Classificadores                                                           | 1.0.1 a 1.1.0  | Inclui Decisions API da OpenAI, Cloudflare Clef e modelos llama.cpp via `/v1/systemone`.                     |
| Ferramentas inline da Anthropic                                           | 1.0.1          | Ferramentas adicionadas ou redefinidas no meio da conversa preservam o cache do prefixo.                     |
| MCP                                                                       | 0.99.2 a 1.1.0 | Inclui conexão em segundo plano, `description`, overrides por projeto, CIMD, RFC 9207 e cancelamento OAuth.  |
| `samplingParamsByThinkingLevel`                                           | 1.0.2          | Define parâmetros de amostragem por nível de esforço em `models.json`.                                       |
| Custos por faixa de tamanho do prompt                                     | 1.1.0          | Corrige custos subestimados de prompts longos em vários providers.                                           |

### Defeitos e lacunas locais

1. **Defeito no `hud`, corrigido:** `railTool` re-registrava `write`, `edit`, `bash`, `find` e `ls` e descartava `outputSchema`.
   - O `bash` nativo declara `output`, `truncated`, `full_output_path`, `exit_code` e `wall_time_seconds`.
   - Com o `hud` ativo, `describeTool('bash')` declarava `Promise<string>`.
   - Scripts codemode perdiam o código de saída estruturado. O defeito também existia com 0.99.1.
   - `railTool` agora preserva todos os campos nativos e substitui apenas os campos de renderização.
2. **Lacuna no `ask`:** perguntas usam `ctx.ui.custom`, que não marca `blocked` no OSC 7501.
   - Terminais e dashboards mostram `working` enquanto a sessão espera o usuário.
3. **Lacuna no `hud`, corrigida:** chamadas aninhadas mediam duração com `Date.now()`.
   - Após reload, a duração vem da diferença entre timestamps e inclui tempo fora de `execute()`.
4. **Lacuna no `pstack`, corrigida:** `session-metrics.ts` atribuía tempo só pelos intervalos entre entradas da sessão.
   - O runtime 1.1 grava `durationMs` medido em mensagens de assistant e de resultado de ferramenta.
5. **Lacuna em `goal` e `loop`, corrigida:** ambos detectavam cancelamento pela última mensagem com `stopReason: 'aborted'`.
   - `agent_settled.aborted` informa o resultado final, inclusive depois de retries e compactação.
6. **Lacuna no `filetools`, corrigida:** o `read` substituto devolvia a scripts apenas a contagem de imagens.
   - O `read` nativo do 1.0.4 devolve um bloco que `image()` aceita.

### Oportunidades por package

| Package           | Recurso do Pi 1.x                                                                       | Proposta                     |
| ----------------- | --------------------------------------------------------------------------------------- | ---------------------------- |
| `hud`             | `registerToolRenderer`, `durationMs`, `outputPad` e custos corrigidos.                  | PLAN-17 e PLAN-18.           |
| `ask`             | OSC 7501 e eventos `ui_prompt_start`.                                                   | PLAN-19.                     |
| `subagent`        | `hiddenTools`, `getPromptGuidelines`, modificadores de `tools` e built-ins desligáveis. | PLAN-00 e PLAN-02.           |
| `pstack`          | `durationMs` persistido e `tool-cost-cli` sob o SDK 1.1.                                | PLAN-01 e PLAN-18.           |
| `goal` e `loop`   | `agent_settled.aborted`.                                                                | PLAN-18.                     |
| `filetools`       | Bloco de imagem para scripts.                                                           | PLAN-20.                     |
| Descoberta        | `formatSkillsForPrompt(..., "indirect")`.                                               | PLAN-03.                     |
| `session-history` | `durationMs` e `thinkingLevel` nas mensagens.                                           | PLAN-18, conforme a demanda. |
| `compact`         | Nenhuma API nova de compactação. Durações gravadas ajudam a proveniência.               | PLAN-09, opcional.           |
| `fast-mode`       | `samplingParamsByThinkingLevel` não substitui service tier.                             | Sem ação.                    |

Fontes: `CHANGELOG.md`, `docs/` e `dist/**/*.d.ts` de `@earendil-works/pi-coding-agent`, `pi-agent-core`, `pi-ai`, `pi-tui`, `pi-codemode` e `pi-mcp` nas versões 0.99.1 e 1.1.0.

## 6. Medição local do custo fixo

O repositório já possui ferramentas para medir definições e comparar sessões.
Não é necessário criar outro medidor antes de testar exposição seletiva.

### Comando executado

```sh
bun packages/pstack/src/tool-cost-cli.ts \
  packages/subagent/src/index.ts \
  packages/pstack/src/index.ts \
  packages/ask/src/index.ts \
  packages/filetools/src/index.ts \
  packages/compact/src/index.ts \
  packages/session-history/src/index.ts \
  packages/todo/src/index.ts \
  packages/loop/src/index.ts \
  packages/tgrep/src/index.ts \
  packages/goal/src/index.ts
```

O ensaio usou dez extensões, ferramentas nativas e provider simulado.
O harness desabilitou skills, arquivos de contexto, temas e prompt templates.
A medição não representa a configuração completa desta sessão nem cada capability profile de um filho.

### Resultado observado

| SDK      | Modo codemode | Ferramentas declaradas | Caracteres de declarações | Caracteres de system prompt |  Total |
| -------- | ------------- | ---------------------: | ------------------------: | --------------------------: | -----: |
| `0.99.1` | `off`         |                     18 |                    36.982 |                       8.443 | 45.425 |
| `0.99.1` | `on`          |                     19 |                    49.982 |                       8.785 | 58.767 |
| `0.99.1` | `only`        |                      4 |                    27.472 |                       8.785 | 36.257 |
| `1.1.0`  | `off`         |                     18 |                    36.982 |                       8.459 | 45.441 |
| `1.1.0`  | `on`          |                     19 |                    39.259 |                       8.646 | 47.905 |
| `1.1.0`  | `only`        |                      4 |                    24.654 |                       6.065 | 30.719 |

As linhas de 1.1.0 são a baseline do PLAN-00, medida no workspace com o catálogo `^1.1.0`.
O runtime efetivo é 1.1.0, portanto as linhas de 0.99.1 servem apenas como histórico.
Com 1.1.0, `on` custa 5,4% mais que `off`. Com 0.99.1, a diferença era 29,4%.
Com 1.1.0, `only` reduz 35,9% dos caracteres frente a `on`.
O system prompt varia algumas dezenas de caracteres com o diretório e a data da execução.
Essas diferenças não comprovam redução equivalente de tokens, custo ou latência.
A medição também não comprova preservação da qualidade das tarefas.

O inventário estático encontrou 20 definições, com 40.739 caracteres entre definições e orientações individuais, nas duas versões.
O inventário registrado e o conjunto declarado ao modelo são medidas distintas.

| Ferramenta        | Caracteres da definição e orientações individuais |
| ----------------- | ------------------------------------------------: |
| `Task`            |                                             6.020 |
| `pstack_delivery` |                                             5.354 |
| `todo_write`      |                                             4.963 |
| `TaskControl`     |                                             4.512 |
| `session_history` |                                             3.845 |

Esses valores indicam onde investigar, não quais instruções remover.
Reduzir descrições sem medir regressões pode prejudicar o cumprimento dos contratos.

Fontes locais:

- [`tool-cost-cli.ts`](packages/pstack/src/tool-cost-cli.ts).
- [`tool-cost-session.ts`](packages/pstack/src/tool-cost-session.ts).
- [`tool-cost.ts`](packages/pstack/src/tool-cost.ts).
- [`session-metrics-cli.ts`](packages/pstack/src/session-metrics-cli.ts).

## 7. Backlog proposto

A coluna de proposta indica os itens concluídos. Critérios sem evidência continuam desmarcados.
Os esforços são estimativas relativas, não compromissos de prazo.
As decisões técnicas abertas devem ser resolvidas no escopo de cada implementação.

Os IDs permanecem estáveis. Itens novos recebem números posteriores, mesmo quando têm prioridade maior.

| ID      | Proposta                                                 | Prioridade                 | Esforço         | Dependências                                 |
| ------- | -------------------------------------------------------- | -------------------------- | --------------- | -------------------------------------------- |
| PLAN-00 | Alinhar o workspace ao Pi 1.1. Concluído.                | P0                         | Pequeno         | Nenhuma                                      |
| PLAN-01 | Estabelecer baseline de compatibilidade e avaliação.     | P0                         | Pequeno a médio | PLAN-00                                      |
| PLAN-02 | Selecionar exposição de ferramentas por profile.         | P1                         | Médio           | PLAN-01                                      |
| PLAN-03 | Descobrir skills e referências sob demanda.              | P1                         | Médio           | PLAN-01                                      |
| PLAN-04 | Evoluir decisões humanas no `ask`. PLAN-04a concluído.   | P1                         | Médio a alto    | PLAN-01                                      |
| PLAN-05 | Carregar instruções por diretório. Concluído.            | P1                         | Médio           | PLAN-01                                      |
| PLAN-06 | Mostrar previsão de cache e presets seguros.             | P2                         | Pequeno a médio | PLAN-01                                      |
| PLAN-07 | Oferecer conversas laterais controladas pelo usuário.    | P2                         | Médio           | PLAN-01                                      |
| PLAN-08 | Marcar e encerrar explorações por branch.                | P2                         | Médio           | PLAN-01                                      |
| PLAN-09 | Avaliar checkpoints explícitos e novas janelas.          | Experimental               | Médio a alto    | PLAN-01                                      |
| PLAN-10 | Avaliar memória durável com curadoria humana.            | Experimental               | Médio           | PLAN-01                                      |
| PLAN-11 | Autorizar operações pela ação exata.                     | P2, ou P1 conforme o risco | Alto            | PLAN-01                                      |
| PLAN-12 | Acrescentar discussões persistentes por assunto.         | Condicional                | Alto            | PLAN-01                                      |
| PLAN-13 | Executar trabalho não confiável em sandbox real.         | Condicional                | Muito alto      | PLAN-01 e definição da política de segurança |
| PLAN-14 | Avaliar esforço adaptativo com limites humanos.          | Experimental               | Médio           | PLAN-01                                      |
| PLAN-15 | Avaliar pequenas melhorias de apresentação.              | P3                         | Pequeno a médio | PLAN-01                                      |
| PLAN-16 | Corrigir inventário e contratos. Concluído.              | P1 documental              | Pequeno         | Nenhuma                                      |
| PLAN-17 | Renderizar o rail sem substituir ferramentas. Concluído. | P1, defeito corrigido      | Médio           | PLAN-00                                      |
| PLAN-18 | Usar tempos e cancelamentos medidos. Concluído.          | P2                         | Pequeno a médio | PLAN-00                                      |
| PLAN-19 | Reportar bloqueio durante perguntas humanas. Bloqueado.  | P2                         | Pequeno         | PLAN-00 e API pública do Pi                  |
| PLAN-20 | Devolver imagens a scripts no `filetools`. Concluído.    | P3                         | Pequeno         | PLAN-00                                      |

### PLAN-00. Alinhar o workspace ao Pi 1.1

**Problema:** o runtime executa 1.1.0, mas checks, testes e medições usam 0.99.1.
O ensaio da seção 5 encontrou dois testes quebrados e um dublê de teste incompatível.

**Escopo:**

- Atualize o catálogo raiz para `^1.1.0` e regenere `bun.lock`.
- Implemente `setProgramStatus` no dublê `SilentTerminal`.
- Troque sondagens `typeof tools.x` e `tools.x ? ... : ...` por `"x" in tools` nos testes.
- Adicione um teste que prove que Tasks e reviewers não recebem ferramentas MCP.
- Documente 1.1.0 como versão mínima suportada.
- Refaça a baseline de custo com o SDK atualizado.

**Critérios de aceite:**

- [x] `bun run check` e `bun run test` passam com o catálogo `^1.1.0`.
- [x] Nenhum package importa símbolos removidos de `pi-agent-core`.
- [x] Um teste falha se um Task read-only alcançar uma ferramenta MCP por codemode.
- [x] O `README.md` informa a versão mínima do Pi.
- [x] A seção 6 registra a baseline produzida com o catálogo atualizado.

**Evidência:**

- O catálogo raiz usa `^1.1.0`, e `bun.lock` resolve as versões 1.1.0.
- `SilentTerminal` em `hud/test/editor-border.test.ts` implementa `setProgramStatus`.
- `ask/test/codemode.test.ts` e `subagent/test/integration-harness.ts` usam `"name" in tools`.
- O teste `keeps configured MCP servers out of read-only codemode Tasks` configura servidores MCP global e de projeto.
- Esse teste falhou quando o filho carregou a extensão MCP e emitiu `session_start`, porque o servidor iniciou.
- O `README.md` e `docs/tooling.md` registram Pi 1.1.0 como versão mínima.

**Limites:** os peers continuam `*`, conforme `docs/package-conventions.md`, até uma decisão explícita.
Não adote APIs novas neste item. Cada adoção pertence ao item correspondente.

### PLAN-01. Compatibilidade e baseline

**Problema:** PLAN-00 alinha as versões, mas o backlog ainda não possui baselines nem limiares de decisão.
Vários candidatos externos exigem Pi 1.0 ou 1.1, e várias propostas dependem de APIs 1.x.
Sem limiares definidos antes da execução, os experimentos podem continuar sem conclusão.

**Escopo:**

- Registre as APIs 1.x exigidas por cada proposta.
- Congele baselines de declarações e tarefas representativas com o SDK 1.1.
- Defina, antes de cada experimento, o ganho mínimo e a regressão máxima aceitos.
- Reutilize os CLIs de custo e métricas existentes.
- Avalie métodos das skills externas de harness antes de criar novas ferramentas.

**Critérios de aceite:**

- [ ] O plano identifica as APIs 1.x usadas por cada proposta.
- [ ] A suíte executa contra a versão mínima declarada.
- [ ] Cada experimento possui baseline, configuração e critério de sucesso registrados.
- [ ] Cada experimento registra limiares numéricos antes da primeira execução.
- [ ] Benchmarks distinguem caracteres, tokens, latência, custo informado e qualidade da tarefa.

**Limites:** não mantenha uma matriz de várias versões do Pi.
O catálogo único e a ausência de lockfiles por package tornam essa matriz cara e pouco confiável.
Não atualize dependências apenas para satisfazer um pacote externo.

**Fontes:** [`package.json`](package.json), [`docs/tooling.md`](docs/tooling.md) e [skills de harness][ext-harness].

### PLAN-02. Exposição seletiva de ferramentas

**Achado:** os filhos usam codemode `on` e mantêm ferramentas diretas declaradas.
Com o SDK 1.1, `on` custa 5,4% mais que `off`, e `only` custa 35,9% menos que `on`.
O código externo oferece documentação sob demanda e anuncia mudanças de contratos sem reescrever o histórico inteiro.
O Pi 1.x já oferece `hiddenTools`, `ToolLoadout.getPromptGuidelines()` e o hint de skills `indirect`.

**Escopo:**

- Comece pela comparação entre `off`, `on` e `only` com o SDK 1.1.
- Avalie ferramentas diretas, `codemode` e `deferred` por capability profile.
- Preserve operações de coordenação e perguntas como `model-only`.
- Mantenha estável o conjunto autorizado durante resume.
- Avalie identificação de mudanças por conteúdo ou versão do contrato.
- Reutilize APIs nativas, sem criar outro executor JavaScript.
- Avalie modificadores `+name` e `-name` e `disabledBuiltinExtensions` para declarar a seleção dos filhos.

**Critérios de aceite:**

- [ ] Scripts não alcançam ferramentas removidas pela política read-only.
- [x] Ferramentas MCP não entram em Tasks pela semântica de allowlist do 1.0.4. O teste do PLAN-00 cobre o invariante.
- [ ] Scripts não passam a despachar Tasks ou responder decisões do coordenador.
- [ ] Descoberta não amplia permissões em sessões existentes.
- [ ] Reload e alterações permitidas de catálogo não deixam ajuda ou schemas obsoletos.
- [ ] A comparação registra custo fixo, chamadas de descoberta e conclusão das tarefas.
- [ ] Uma regressão de qualidade impede a troca do padrão.

**Riscos:** economia de declaração pode gerar mais turnos ou pior seleção de ferramentas.
A abordagem antiga de `pi-dynamic-tools` está aposentada.
Na Anthropic, ferramentas redefinidas no meio da conversa preservam o cache desde o Pi 1.0.1. Outros providers podem invalidar o prefixo.

**Fontes:** `codemodeExtension` em [`subagent/src/child.ts`](packages/subagent/src/child.ts), [prompt de ferramentas][ext-tool-prompt] e [atualizações de contratos][ext-tool-updates].

### PLAN-03. Skills e referências sob demanda

**Achado:** `inline-skill` já resolve autocomplete e expansão para o usuário.
A lacuna distinta é descoberta progressiva pelo modelo, incluindo referências específicas.
O `pstack` contém 54 skills, mas o Pi já carrega o corpo completo apenas quando necessário.
A oportunidade está no catálogo inicial e na seleção de referências, não em corrigir carregamento integral inexistente.

**Escopo:**

- Ofereça operações de descoberta, busca e leitura seletiva.
- Preserve o catálogo nativo como fonte de autoridade.
- Preserve `/skill:` e os aliases de `inline-skill`.
- Retorne caminhos de origem e instruções de continuação para resultados limitados.
- Defina como skills obrigatórias continuam visíveis.
- Decida entre um package pequeno de descoberta e uma capability compartilhada.
- Use `formatSkillsForPrompt(..., "indirect")` quando o leitor de arquivos só for acessível por script.

**Critérios de aceite:**

- [ ] Recursos desabilitados e `--no-skills` permanecem desabilitados.
- [ ] Um catálogo vazio não dispara descoberta alternativa sem autorização.
- [ ] Trust e precedência nativos permanecem válidos.
- [ ] Referências ambíguas exigem qualificação explícita.
- [ ] Paginação não perde texto nem divide incorretamente o encoding declarado.
- [ ] Tarefas continuam carregando as skills relevantes no ensaio comparativo.

**Risco concreto:** o fallback externo redescobre diretórios quando o catálogo carregado está vazio.
Esse comportamento não deve ser copiado literalmente.
O limite externo de 48 KiB é uma referência, não uma decisão para nosso contrato.

**Fontes:** [Better Skills][ext-skills], [registro][ext-skills-index], [discovery][ext-skills-discovery] e [`inline-skill/src/skills.ts`](packages/inline-skill/src/skills.ts).

### PLAN-04. Decisões humanas completas no `ask`

**Achado:** nosso `ask` já suporta respostas assíncronas.
Entretanto, o estado pendente é descartado na retomada e a implementação aceita apenas TUI.
O contrato atual também não separa evidências, comentários e handoffs humanos.

**Fases:** entregue e verifique cada fase separadamente.

1. **PLAN-04a, concluída:** persista perguntas pendentes com escopo de sessão e branch. Esta fase corrige um defeito atual.
2. **PLAN-04b:** acrescente contexto, evidências e comentário como campos aditivos do `AskQuestion`.
3. **PLAN-04c:** modele disposições de review e handoffs humanos e integre-os a `pstack`, `todo` e `goal`.
4. **PLAN-04d:** ofereça uma interação RPC compatível com as capacidades do cliente.

**Escopo:**

- Acrescente contexto e evidências separados do enunciado.
- Permita comentário junto de uma opção selecionada.
- Modele disposições de review como corrigir, adiar e rejeitar.
- Modele handoffs humanos como concluído ou impossível de concluir.
- Persista perguntas pendentes com escopo de sessão e branch.
- Ofereça uma interação RPC compatível com as capacidades do cliente.
- Integre resultados aos findings do `pstack` e aos bloqueios de `todo` e `goal`.

**Critérios de aceite:**

- [x] Reload e retomada restauram apenas perguntas ainda pendentes na branch ativa.
- [x] Respostas atrasadas não resolvem solicitações canceladas ou substituídas.
- [ ] Recusa, adiamento, cancelamento e conclusão permanecem distintos.
- [ ] Um agente supervisor não confirma uma ação exclusivamente humana.
- [ ] RPC funciona sem depender de componentes terminais customizados.
- [ ] Print e JSON retornam indisponibilidade explícita quando não há cliente interativo.
- [ ] Lembretes não continuam trabalho bloqueado por decisão humana.
- [ ] A compatibilidade com o formato atual de `AskQuestion` fica documentada e testada.

**Evidência da PLAN-04a:**

- O `ask` grava a entrada `ask-question-settled` quando um formulário assíncrono termina ou o usuário o cancela.
- `session_start` e `session_tree` reabrem formulários assíncronos da branch ativa sem essa entrada.
- `ask/test/lifecycle.test.js` cobre retomada, reload, cancelamento, navegação na árvore e modo print.
- Uma sessão real retomada em tmux reabriu o formulário. Após Esc, a entrada foi gravada e a nova retomada não reabriu o formulário.

**Integração com review:** selecione diff ou merge-base explicitamente.
Verifique findings antes de pedir sua disposição ao usuário.
Reutilize nosso runtime read-only em vez do subprocesso externo.

**Risco externo:** o child de review inspecionado não configura uma allowlist restrita.
A instrução de não editar aparece no prompt, não equivale à nossa remoção de ferramentas mutáveis.

**Fontes:** [`ask/src/domain.ts`](packages/ask/src/domain.ts), handler `session_start` em [`ask/src/index.ts`](packages/ask/src/index.ts), [Ask externo][ext-ask] e [child de review][ext-review-child].

### PLAN-05. Instruções incrementais por diretório

**Achado:** o Pi carrega contexto do diretório inicial e de seus ancestrais.
Explorar outro subdiretório não equivale a iniciar uma sessão dentro dele.
O loader externo acrescenta instruções novas ou alteradas durante a descoberta.

**Escopo:**

- Implemente um loader transversal pequeno.
- Entregue a cadeia de instruções da parte externa para a interna.
- Evite reconstruir o system prompt a cada diretório explorado.
- Persista a deduplicação na branch correta.
- Integre `read`, `grep`, `find`, `ls` e chamadas aninhadas suportadas.
- Adapte o contrato ao nosso `read({ paths })` e aos resultados estruturados.
- Defina suporte a variantes nativas de arquivos de instrução.

**Critérios de aceite:**

- [x] Leituras multifile carregam as cadeias correspondentes sem duplicatas.
- [x] Conteúdo alterado pode ser reapresentado sem reapresentar arquivos idênticos.
- [x] Symlinks, caminhos externos e worktrees respeitam o limite definido.
- [x] Listagens não carregam indiscriminadamente instruções de todos os filhos.
- [x] Chamadas aninhadas recebem o mesmo tratamento das chamadas diretas.
- [x] Instruções descobertas não autorizam retroativamente uma operação já executada.
- [ ] O loader respeita o modelo nativo de trust e o escopo das instruções. O código consulta `isProjectTrusted()`, mas nenhum teste cobre um projeto não confiável.

**Estado:** implementado no package [`subdir-context`](packages/subdir-context/README.md).

**Decisões:**

- Os nomes e a ordem dos arquivos seguem o Pi: `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md` e `CLAUDE.MD`.
- Só diretórios abaixo do diretório da sessão contam. Caminhos e symlinks que saem dele não carregam nada.
- Além das ferramentas de leitura, `write`, `edit` e `patch` também carregam a cadeia. `bash` não carrega.
- A entrega usa uma mensagem customizada depois dos resultados do turno, sem reconstruir o system prompt.
- Um arquivo com conteúdo igual a um arquivo já carregado pelo Pi é ignorado. Isso cobre a cópia do `AGENTS.md` em worktrees aninhados.
- Tasks do `subagent` não carregam a extensão, porque os filhos usam `noExtensions`.

**Evidência:**

- `subdir-context/test/session.test.ts` executa sessões reais do Pi com provider simulado.
- Os testes cobrem cadeia externa para interna, repetição, `paths` do `filetools`, codemode, retomada com arquivo alterado, symlinks, cópias e `--no-context-files`.
- Uma sessão real em tmux carregou a extensão e mostrou a linha `Loaded instructions: packages/hud/AGENTS.md`.
- O caminho completo com um modelo real não foi executado, para evitar custo.

**Risco concreto:** o código externo reconhece `path`, mas não o formato multifile `paths`.
A descoberta externa ocorre após o resultado da ferramenta.
A implementação futura deve evitar alegações de proteção prévia que esse momento não garante.

**Fontes:** [Subdir Agents][ext-subdir], [extração de caminhos][ext-subdir-source] e [`filetools/README.md`](packages/filetools/README.md).

### PLAN-06. Cache e presets seguros

**Achado:** o `hud` mostra a proporção de cache observada na branch.
O predictor externo estima reutilização ao trocar provider, API, modelo ou esforço.
Ele não conhece expiração, eviction ou os bytes reais do prefixo enviado ao provider.

**Escopo:**

- Mostre previsão apenas como informação visual.
- Separe previsão e uso real informado pelo provider.
- Invalide previsões após compactação e mudanças relevantes de contexto.
- Avalie presets configuráveis usando registry e autenticação nativos.
- Reutilize `fast-mode` para a política de service tier.
- Considere as ferramentas inline da Anthropic do Pi 1.0.1 ao prever cache após mudanças de ferramentas.
- Use os custos por faixa de prompt corrigidos no Pi 1.1.0 como referência de custo informado.

**Critérios de aceite:**

- [ ] A UI identifica estimativas como estimativas.
- [ ] Ausência de histórico aparece como desconhecida, não como economia garantida.
- [ ] Compactação, troca de branch e mudança de ferramentas não preservam certeza indevida.
- [ ] A previsão não adiciona mensagens ao contexto do modelo.
- [ ] Presets não substituem políticas obrigatórias de Tasks.
- [ ] Nenhum preset aumenta artificialmente a capacidade declarada do provider.

**Risco concreto:** o switcher externo sobrescreve `contextWindow` com um valor configurado.
Essa mudança altera o orçamento local, não a capacidade real do serviço.

**Fontes:** `buildCacheLabel` em [`hud/src/format.ts`](packages/hud/src/format.ts), [predictor][ext-cache] e [switcher][ext-switcher-source].

### PLAN-07. Conversas laterais controladas pelo usuário

**Achado:** `/btw` oferece perguntas paralelas sem colocar automaticamente suas respostas no contexto principal.
Isso difere de uma Task normal e do `ask_parent` consultivo entre agentes.

**Escopo:**

- Reutilize `subagent` para conversas laterais independentes.
- Ofereça ações de abrir, continuar, cancelar, descartar e incluir resposta.
- Mantenha a inclusão no contexto principal como escolha explícita.
- Defina capacidades mínimas para cada conversa lateral.
- Registre uso e custo separadamente.

**Critérios de aceite:**

- [ ] Perguntas laterais não alteram o contexto principal antes da inclusão.
- [ ] Slots independentes não bloqueiam uns aos outros.
- [ ] Cancelamento e descarte encerram o trabalho correspondente.
- [ ] Retomada preserva conteúdo exibível sem injeção automática.
- [ ] A inclusão registra origem e não transforma a resposta em autorização.
- [ ] Modelos respeitam a política configurada, sem aliases hardcoded.

**Fonte:** [Smart BTW][ext-btw].

### PLAN-08. Marcadores e fechamento de exploração

**Achado:** Auto Trees marca uma posição, resume o trecho posterior e retorna ao marcador com o resultado útil.
Essa higiene de exploração difere da compactação automática por limite de contexto.

**Escopo:**

- Avalie comandos equivalentes a orientar, marcar e encerrar uma exploração.
- Use navegação e persistência nativas de branches.
- Preserve links para evidências omitidas do resumo.
- Mantenha a orientação inicial sem implementação implícita.

**Critérios de aceite:**

- [ ] O marcador automático só aparece quando o agente realmente termina suas continuações.
- [ ] Marcadores acompanham a branch correta após retomada e navegação.
- [ ] Labels existentes não são sobrescritos sem intenção explícita.
- [ ] Cancelamento ou falha de resumo não perde a posição original.
- [ ] Requisitos, decisões e justificativas continuam recuperáveis.
- [ ] Encerrar uma exploração não cria commit, publicação ou mudança de escopo implicitamente.

**Fonte:** [Auto Trees][ext-trees].

### PLAN-09. Checkpoints explícitos e renovação de contexto

**Achado:** Notes Compaction exige evidência de persistência e conclusão do checkpoint antes de certas renovações de contexto.
O modo notes-only normalmente abre uma janela sem gerar resumo.
Nossa compactação já é persistente, portanto a proposta é uma alternativa experimental.

**Escopo:**

- Avalie checkpoints explícitos de decisões, pendências e referências.
- Preserve o compilador determinístico como padrão ou fallback.
- Exija evidência de gravação e conclusão do turno antes da transição.
- Avalie alertas de orçamento sem copiar limiares externos automaticamente.
- Reutilize o histórico salvo em vez de criar outro transcript.

**Critérios de aceite:**

- [ ] Falha, abort ou checkpoint obsoleto preserva o contexto anterior.
- [ ] A nova janela não perde prompts pendentes, anexos ou opções de execução.
- [ ] Notas mantêm proveniência, escopo e distinção entre fatos e interpretações.
- [ ] Retomada e fork recuperam o checkpoint correto.
- [ ] O experimento compara continuidade real, trabalho repetido e ações sem suporte.
- [ ] A adoção não depende apenas de um score sintético curto.

**Evidência local:** a avaliação existente não demonstrou ganho de acurácia do enriquecimento híbrido.
Os três modos acertaram 24 de 24 respostas em um ensaio sintético pequeno.
O modo híbrido acrescentou contexto e latência, portanto o padrão determinístico permanece justificado nesse recorte.
Esse resultado não prova equivalência em sessões longas.

**Riscos externos:** SQLite nativo, notas em texto puro e dependência da qualidade das notas.
O lookup remoto também possui restrições de provider e portabilidade.
Não há motivo demonstrado para importar essas dependências apenas para obter checkpoints.

**Fontes:** [Notes Compaction][ext-notes], [validação de notas frescas][ext-fresh-notes] e [avaliação local](packages/compact/evaluation/README.md).

### PLAN-10. Memória durável com curadoria humana

**Achado:** histórico pesquisável não equivale a memória durável promovida para instruções.
O package aposentado `pi-memories` escreve candidatos em uma inbox Markdown e solicita revisão manual.

**Escopo:**

- Avalie uma inbox de candidatos com referências às sessões de origem.
- Diferencie memória de projeto e preferência global.
- Exija aprovação humana antes da promoção para instruções permanentes.
- Reutilize `session-history` e `compact_recall` para validar candidatos.
- Defina retenção, deduplicação e tratamento de dados sensíveis.

**Critérios de aceite:**

- [ ] Candidatos não entram automaticamente no system prompt ou em `AGENTS.md`.
- [ ] A origem e o escopo permanecem disponíveis durante a revisão.
- [ ] Informações sensíveis são excluídas ou exigem decisão explícita.
- [ ] Contradições e mudanças posteriores podem invalidar candidatos antigos.
- [ ] Uma falha de extração não bloqueia indefinidamente o encerramento.
- [ ] O custo adicional de extração fica visível e limitado.

**Limite:** não adotar embeddings ou uma base vetorial sem demonstrar necessidade.
O pacote externo aposentado serve como referência de fluxo, não como dependência.

**Fonte:** [Memories][ext-memories].

### PLAN-11. Autorização vinculada à ação exata

**Achado:** allowlists e worktrees não avaliam todos os argumentos perigosos antes da execução.
Guardian vincula a aprovação à ação pendente e rejeita respostas obsoletas.
O package externo não oferece proteção quando nenhuma regra está configurada.

**Escopo:**

- Comece por políticas determinísticas para operações explicitamente sensíveis.
- Diferencie bloqueio, confirmação humana e revisão consultiva por modelo.
- Vincule aprovações aos argumentos preparados e ao contexto relevante.
- Inclua chamadas aninhadas na política.
- Defina como regras globais e regras confiáveis do projeto se combinam.
- Torne falhas de política e ausência de proteção visíveis.

**Critérios de aceite:**

- [ ] Mudanças de argumentos, política, sessão ou branch invalidam aprovações antigas.
- [ ] Timeout, erro ou resposta inválida não autoriza a ação protegida.
- [ ] Aprovação de um wrapper não autoriza qualquer efeito futuro de seus filhos.
- [ ] Nenhum agente pode desligar a proteção para concluir a própria tarefa.
- [ ] Regras de projeto não removem restrições globais silenciosamente.
- [ ] Custos e envio de contexto para revisão externa exigem configuração explícita.
- [ ] O contrato declara quais efeitos não são interceptados.

**Classificadores:** o Pi 1.x oferece Decisions API, Cloudflare Clef e modelos llama.cpp como classificadores.
Um classificador pode servir como revisão consultiva barata, mas não substitui bloqueio determinístico nem decisão humana.
O uso exige configuração explícita, porque transmite argumentos e contexto ao provider.

**Riscos:** regex não interpreta shell e pode ter custo computacional alto.
O Guardian externo usa revisão Codex específica, OAuth ChatGPT e contexto potencialmente sensível.
A camada não intercepta efeitos arbitrários de extensões e não substitui sandbox.

**Fontes:** [Guardian][ext-guardian] e `createChildSession` em [`subagent/src/child.ts`](packages/subagent/src/child.ts).

### PLAN-12. Discussões persistentes por assunto

**Achado:** já existem mensagens entre agentes, decisões do coordenador e painéis de atividade.
A novidade do board é manter canais, threads e busca além de uma troca pontual.

**Escopo:**

- Avalie um arquivo de decisões e blockers pesquisável por assunto.
- Publique apenas informação que muda o trabalho de outro agente.
- Preserve identidade, origem, escopo e estado de resolução.
- Considere um visualizador humano somente leitura.
- Evite iniciar servidor apenas para usar a ferramenta de agentes.

**Critérios de aceite:**

- [ ] Posts não concedem autoridade nem substituem `request_parent`.
- [ ] Busca e paginação permanecem limitadas e preservam cursores.
- [ ] Sessões ou projetos sem vínculo não recebem conteúdo automaticamente.
- [ ] O viewer não permite mutações ou seleção arbitrária de arquivos.
- [ ] Markdown recebe sanitização e recursos externos não vazam dados silenciosamente.
- [ ] Tokens e links de acesso são tratados como segredos.
- [ ] Retenção e exclusão de arquivos ficam documentadas.

**Custos externos:** SQLite, assets de browser, sanitização e autenticação de acesso.
A implementação observada usa WAL e respostas ajustadas a 8.000 bytes.
Esses valores são referências, não decisões locais.

**Fonte:** [Agent Board][ext-board].

### PLAN-13. Sandbox real para código não confiável

**Achado:** worktree isola alterações do repositório, não o sistema operacional.
`readonly` remove ferramentas mutáveis, mas não transforma extensões em código não confiável isolado.
`cloak` mascara leituras e não protege shell, busca, prompts ou arquivos no disco.

**Escopo:**

- Defina primeiro quais ameaças e operações precisam de isolamento.
- Avalie um backend opcional de execução em microVM ou ambiente equivalente.
- Controle mounts, credenciais, rede, recursos e ciclo de vida.
- Distinga ambientes preparados, instâncias e checkpoints de disco.
- Integre artefatos e resultados ao contrato de Task existente.

**Critérios de aceite:**

- [ ] O ambiente não recebe home, credenciais, SSH agent ou sockets do host por padrão.
- [ ] A política de rede possui garantias e limites verificáveis.
- [ ] Cancelamento encerra os processos abrangidos pelo contrato.
- [ ] Destruição exige identificação explícita da instância.
- [ ] Falhas de setup não publicam templates aparentemente válidos.
- [ ] Previews distinguem disponibilidade, readiness e autenticação.
- [ ] Crash e checkpoint possuem semântica documentada e testada.
- [ ] Suporte a Linux e macOS depende de verificação real em cada plataforma.

**Custos externos:** Gondolin, QEMU, imagens, Node 24, Python e gestão de processos persistentes.
O README externo relata testes de integração em Linux x86_64, mas não validação em macOS.
Os hooks HTTP observados não comprovam confinamento completo de rede.
Previews locais externos não possuem autenticação.
A parada persiste disco, não memória ou processos em execução.

**Limite:** não importar esse subsistema antes de demonstrar demanda concreta.

**Fontes:** [Sandbox][ext-sandbox], [`cloak/README.md`](packages/cloak/README.md) e [`subagent/README.md`](packages/subagent/README.md).

### PLAN-14. Esforço adaptativo limitado

**Achado:** o controle externo permite ajustar esforço sem baixar do piso escolhido pelo usuário.
A restauração só ocorre quando a configuração ainda corresponde à alteração aplicada pelo agente.

**Escopo:**

- Avalie o comportamento apenas como opção experimental.
- Preserve a escolha humana como limite mínimo.
- Detecte mudanças manuais antes de restaurar valores.
- Exclua Tasks com seletores obrigatórios incompatíveis.
- Registre cada alteração e seu impacto observado.
- Use o `thinkingLevel` gravado nas mensagens de assistant do Pi 1.x para auditar mudanças.

**Critérios de aceite:**

- [ ] O mecanismo não substitui `pstack-models` nem muda o modelo autorizado.
- [ ] Mudanças humanas posteriores prevalecem sobre restauração automática.
- [ ] Troca de sessão, provider ou modelo descarta baselines incompatíveis.
- [ ] Uso adicional permanece visível e limitado.
- [ ] A avaliação mede qualidade e latência, não apenas redução de esforço.

**Fonte:** [controle de esforço externo][ext-reasoning].

### PLAN-15. Melhorias pequenas de apresentação

**Achado:** `hud` já fornece agrupamento, atividade aninhada, Markdown e Mermaid em terminal.
Chill e Unicode Charts oferecem referências de apresentação, não justificam outro dono da UI.

**Escopo opcional:**

- Avalie um modo visual mais discreto sobre o rail existente.
- Preserve erros e pedidos de decisão claramente acessíveis.
- Avalie gráficos Unicode para relatórios de uso e benchmarks.
- Preserve os renderers e o texto original quando o formato não for suportado.
- Substitua inspeções estruturais de componentes internos por APIs públicas quando o Pi oferecer equivalentes, como `outputPad`.

**Critérios de aceite:**

- [ ] A apresentação não muda o contexto do modelo nem o conteúdo persistido.
- [ ] Teclado, terminais estreitos e preferência de movimento continuam funcionais.
- [ ] Erros e bloqueios humanos não desaparecem dentro de agrupamentos genéricos.
- [ ] Código incompleto ou inválido mantém seu conteúdo legível.
- [ ] Não existe disputa de registro entre `hud` e outra extensão visual.

**Risco concreto:** Chill oculta certos textos por igualdade de conteúdo.
Isso pode ocultar uma mensagem idêntica escrita manualmente pelo usuário.
Esse comportamento não deve ser copiado literalmente.

**Fontes:** [Chill][ext-chill], [Unicode Charts][ext-charts] e [`hud/README.md`](packages/hud/README.md).

### PLAN-16. Documentação e contratos

**Achado:** `inline-skill` existe, mas não aparece na tabela principal do `README.md`.
Há divergência externa entre versões mínimas anunciadas em READMEs e versões exigidas em manifests.
Better Skills é um exemplo dessa diferença para Codex Conversion.

**Escopo:**

- Acrescente `inline-skill` ao inventário principal.
- Documente a versão mínima do Pi e o efeito dos aliases do loader de extensões.
- Documente diferenças entre ferramentas registradas, declaradas e acessíveis por scripts.
- Documente a distinção entre isolamento de alterações, read-only, aprovação e sandbox.
- Registre contratos de eventos entre packages com versão e ciclo de vida.
- Documente capacidades opcionais e comportamento quando estão ausentes.
- Revise bundles somente se houver demanda de instalação simplificada.

**Critérios de aceite:**

- [x] O inventário principal corresponde aos packages distribuídos.
- [x] Limites de segurança permanecem explícitos nas páginas pertinentes.
- [x] Protocolos novos possuem exemplos, ownership e regras de cleanup.
- [x] Não existe cópia divergente de uma política já mantida em outro arquivo.
- [x] Documentação não promete compatibilidade ou disponibilidade sem evidência.

**Evidência:** o `README.md` lista `inline-skill` e aponta para [`docs/integration-contracts.md`](docs/integration-contracts.md).
Esse documento descreve visibilidade de ferramentas, limites de isolamento, canais de eventos e capacidades opcionais.

**Fontes:** [`README.md`](README.md), [`docs/package-conventions.md`](docs/package-conventions.md) e [APIs externas][ext-apis].

### PLAN-17. Rail do `hud` sem substituir ferramentas nativas

**Achado:** o `hud` re-registra `write`, `edit`, `bash`, `find` e `ls` apenas para desenhar o rail.
O wrapper `railTool` copia campos selecionados e descarta `outputSchema`.
Com o `hud` ativo, scripts recebem `Promise<string>` de `tools.bash()` em vez do resultado estruturado nativo.
O re-registro também torna o `hud` dono de definições que pertencem ao Pi e descarta silenciosamente campos novos.

**Escopo:**

- Corrija primeiro a perda de `outputSchema` com um teste de regressão. Concluído.
- Migre o desenho do rail para `pi.registerToolRenderer()`. Concluído.
- Remova o re-registro das ferramentas nativas quando o renderer cobrir os mesmos estados. Concluído.
- Use `context.durationMs` e `context.outputPad` no renderer. `durationMs` concluído.
- Preserve o comportamento com o rail desligado.

**Critérios de aceite:**

- [x] Com o `hud` ativo, `describeTool('bash')` declara o tipo estruturado nativo.
- [x] Um teste prova que o `hud` não registra nenhuma ferramenta nativa.
- [x] Sessões retomadas mostram o rail para chamadas antigas, inclusive de ferramentas ainda não registradas.
- [x] Outra extensão que registra a mesma ferramenta não perde sua definição por causa do `hud`.
- [ ] Os valores 0 e 1 de `outputPad` produzem layout consistente.

**Evidência:** `registerRailRenderers` escolhe renderers por nome, inclusive para ferramentas sem registro.
Uma sessão real retomada em tmux mostrou linhas `Ran` e `Edited` no rail com o resolver.

**Pendência:** os renderers do rail devolvem componentes vazios, então `outputPad` não os afeta.
O critério de `outputPad` depende do layout das entradas do rail e ainda não foi verificado com os dois valores.

**Fontes:** `registerRailRenderers` em [`hud/src/rail-tools.ts`](packages/hud/src/rail-tools.ts).

### PLAN-18. Tempos e cancelamentos medidos pelo runtime

**Achado:** `hud`, `pstack`, `goal` e `loop` inferem dados que o Pi 1.1 já registra.
O `hud` usa `Date.now()` e diferenças entre timestamps.
O `session-metrics.ts` atribui tempo pelos intervalos entre entradas.
O `goal` e o `loop` procuram `stopReason: 'aborted'` na última mensagem de assistant.

**Escopo:**

- No `hud`, use `durationMs` de eventos e mensagens. Mantenha a estimativa só para sessões antigas.
- No `pstack`, some `durationMs` de mensagens e identifique cada valor como medido ou inferido.
- No `goal` e no `loop`, use `agent_settled.aborted` como fonte do cancelamento.
- Avalie expor durações e `thinkingLevel` em `session-history`.

**Critérios de aceite:**

- [x] Sessões sem `durationMs` continuam com valores inferidos e identificados como inferidos.
- [ ] Relatórios separam tempo medido, tempo inferido e espera. Medido e inferido estão separados. Espera ainda não.
- [x] Um cancelamento durante retry ou compactação pausa `loop` e `goal` como um abort comum.
- [x] Um run concluído não é tratado como cancelado.
- [x] O plano de latência em `PLAN.md` pode ser recalculado com tempos medidos.

**Evidência:** em uma sessão real de 280 minutos, o intervalo entre entradas atribuiu 4,9 minutos ao modelo.
Os valores medidos pelo Pi somaram 19,7 minutos de modelo e 27,6 minutos de ferramentas.
O intervalo entre entradas atribuiu 0,0 minuto às ferramentas. Portanto, a inferência anterior não é confiável para sessões 1.1.
`session-history` ainda não expõe durações nem `thinkingLevel`.

**Fontes:** [`hud/src/index.ts`](packages/hud/src/index.ts), [`hud/src/rail-tools.ts`](packages/hud/src/rail-tools.ts), [`session-metrics.ts`](packages/pstack/src/session-metrics.ts), [`goal/src/index.ts`](packages/goal/src/index.ts) e [`loop/src/index.ts`](packages/loop/src/index.ts).

### PLAN-19. Status de bloqueio durante perguntas humanas

**Achado:** o Pi 1.1 marca `blocked` para `select`, `confirm`, `input` e `editor`, mas não para `ctx.ui.custom`.
O `AskQuestion` usa `ctx.ui.custom`. Terminais compatíveis mostram `working` enquanto a sessão espera o usuário.
Não existe API pública de extensão para marcar um diálogo customizado como bloqueante.
O `ask` já emite `herdr:blocked` para uma extensão externa do Herdr. Esse canal não alcança o OSC 7501.

**Estado:** bloqueado até o Pi oferecer uma API pública.

**Escopo:**

- Reproduza o comportamento com `PI_PROGRAM_STATUS=1` e um terminal compatível.
- Proponha ao Pi uma API pública, como uma opção de bloqueio em `ctx.ui.custom`.
- Não escreva OSC 7501 diretamente nem use o reporter interno do modo interativo.
- Defina se perguntas assíncronas pendentes marcam `blocked`.

**Critérios de aceite:**

- [ ] Enquanto um `AskQuestion` síncrono espera, o terminal recebe `blocked` com `kind: "question"`.
- [ ] Perguntas assíncronas não marcam `blocked` enquanto o agente continua trabalhando.
- [ ] A mensagem reportada usa um título genérico e não expõe o conteúdo da pergunta.
- [ ] Sem API pública, o item permanece bloqueado e documentado.

**Fonte:** seção Program status de `docs/terminal-setup.md` do Pi 1.1.0.

### PLAN-20. Imagens em leituras por script no `filetools`

**Achado:** o `read` do `filetools` substitui o nativo e declara `outputSchema` próprio.
Scripts recebem apenas a contagem de imagens. O `read` nativo do 1.0.4 devolve um bloco que `image()` aceita.

**Escopo:**

- Avalie um campo aditivo com blocos de imagem no `ReadOutputSchema`.
- Preserve o contrato atual de `files`, `unread` e `value`.
- Respeite limites de saída e configurações de bloqueio de imagens.

**Critérios de aceite:**

- [x] Um script mostra uma imagem lida com `tools.read()` sem uma segunda leitura.
- [x] Chamadas diretas pelo modelo mantêm o comportamento atual.
- [x] O tamanho da saída do script continua limitado.

**Evidência:** cada registro de arquivo com imagens recebe `imageBlocks`. O campo é opcional e aditivo.
O teste `returns image blocks that a script can show` chama `image()` com o bloco devolvido.
Os limites de saída do codemode continuam valendo, e o conteúdo enviado ao modelo não mudou.

**Fonte:** `ReadOutputSchema` em [`filetools/src/read.ts`](packages/filetools/src/read.ts).

## 8. Ordem de execução sugerida

### Etapa 0. Alinhar o runtime e preparar evidências

PLAN-00 e PLAN-16 estão concluídos.
Execute PLAN-01 em seguida. Defina corpus, baselines e limiares antes de escolher APIs novas.
PLAN-01 exige decisões humanas sobre limiares e autorização para benchmarks pagos.

### Etapa 1. Reduzir contexto fixo e corrigir donos de ferramentas

Execute PLAN-02 e PLAN-03 como mudanças separadas. PLAN-17 está concluído.
Isso permite atribuir ganhos e regressões ao mecanismo correto.

### Etapa 2. Melhorar decisões e contexto local

PLAN-04a, PLAN-05 e PLAN-18 estão concluídos.
Avance PLAN-19 assim que existir uma API pública do Pi.
Execute PLAN-04b a PLAN-04d depois da fase de persistência.
Preserve os contratos existentes de `ask`, `todo`, `goal` e capabilities.

### Etapa 3. Melhorar a experiência de sessões longas

Avalie PLAN-06, PLAN-07 e PLAN-08.
Escolha a ordem conforme a frequência real de trocas de modelo, perguntas laterais e explorações descartáveis.

### Etapa 4. Experimentar continuidade

Avalie PLAN-09 e PLAN-10 com corpus separado e exemplos de várias compactações consecutivas.
Não troque o padrão determinístico antes de demonstrar benefício.

### Etapa 5. Expandir somente conforme a demanda

Considere PLAN-11, PLAN-12 e PLAN-13 quando o uso justificar seus custos operacionais.
Antecipe PLAN-11 se operações sensíveis já fizerem parte do fluxo autorizado.
Mantenha PLAN-14 e PLAN-15 opcionais. PLAN-20 está concluído.

## 9. O que não adotar agora

| Item                                   | Motivo                                                                   | Condição para reconsiderar                                             |
| -------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `pi-codex-conversion` inteiro          | Sobreposição com APIs nativas e acoplamento amplo a Codex.               | Necessidade específica sem solução menor.                              |
| Outro runtime de agentes por Herdr     | Coordenação, persistência e UI já existem localmente.                    | Demanda comprovada por processos externos ou operação entre máquinas.  |
| Notes-only como compactação padrão     | Continuidade depende da qualidade das notas.                             | Avaliação de tarefas reais demonstra benefício sem perda de evidência. |
| Embeddings substituindo `tgrep`        | Novos custos, índice potencialmente obsoleto e possível envio de código. | Busca semântica opcional resolve falhas concretas da busca lexical.    |
| Packages aposentados como dependências | Ausência de manutenção futura anunciada.                                 | Adoção independente com ownership explícito e escopo menor.            |
| Voz, pets e Omarchy                    | Baixo alinhamento com os problemas atuais.                               | Pedido de produto específico.                                          |
| ChatGPT Sites                          | Integração específica com efeitos de publicação e produção.              | Escopo separado com autorização e avaliação de segurança.              |
| Outro browser próprio                  | Sobreposição aos workflows existentes e custo de manutenção.             | Lacuna reproduzível em uma interface necessária.                       |
| Bundle completo externo                | Aumenta sobreposição e superfície de integração.                         | Não previsto para este plano.                                          |

Web e imagegen são opções de integração, não ausências comprovadas no ambiente atual.
Ferramentas disponíveis na sessão podem vir de outras extensões e não pertencem necessariamente a este repositório.

## 10. Riscos e limites transversais

### Segurança e autoridade

- Extensões executam com permissões do processo Pi.
- Uma aprovação por modelo não representa automaticamente uma decisão humana.
- Mensagens de board e memória são dados, não instruções de autoridade superior.
- Ferramentas read-only e worktrees não oferecem isolamento de sistema operacional.
- Aprovações antigas não devem autorizar argumentos ou contextos novos.
- Ausência de regras deve aparecer como ausência de proteção.

### Privacidade

- Histórico, notas, boards e checkpoints podem conter dados sensíveis.
- Embeddings e reviewers externos podem transmitir código ou contexto.
- Links de viewers podem conceder acesso ao histórico.
- Persistência em texto puro não equivale a criptografia.
- Templates de ambientes não devem conter credenciais.

### Custo e desempenho

- Caracteres não são tokens.
- Menos declarações podem exigir mais chamadas de descoberta.
- Previsões de cache não comprovam cache efetivo.
- Mudanças de contexto podem invalidar prefixos conforme o provider.
- Chamadas de memória, review e conversas laterais acrescentam uso.
- Timers, servidores e watchers exigem cleanup e limites de recursos.

### Compatibilidade e manutenção

- READMEs podem divergir de manifests e implementação.
- Os aliases do loader fazem as extensões executarem com o Pi instalado, não com o SDK do workspace.
- Checks e testes só valem para usuários quando o catálogo corresponde à versão mínima suportada.
- Peers `*` não impedem a instalação em versões do Pi sem as APIs 1.x adotadas.
- Prefira APIs públicas a patches de prototypes ou internals.
- Evite dois providers de compactação competindo pelo mesmo ciclo.
- Evite dois donos de uma ferramenta ou renderer.
- Não copie assertions, tipos amplos ou atalhos incompatíveis com nossas regras TypeScript.

## 11. Estratégia de verificação

### Antes de implementar

- Reproduza o comportamento atual na menor interface representativa.
- Use a interface real quando a mudança atravessar integração ou UI.
- Registre limitações quando essa interface não estiver disponível.
- Defina evidências necessárias antes de escrever a solução.

### Matriz funcional mínima

| Superfície      | Casos exigidos conforme o recurso                                     |
| --------------- | --------------------------------------------------------------------- |
| Ciclo da sessão | Startup, reload, retomada, fork, navegação e shutdown.                |
| Execução        | Sucesso, erro, abort, timeout e resposta atrasada.                    |
| Contexto        | Compactação, overflow, janela nova e proveniência.                    |
| Ferramentas     | Chamada direta, codemode, chamada aninhada e ferramenta desabilitada. |
| Autoridade      | Read-only, política de modelo, decisão humana e escopo do projeto.    |
| Persistência    | Deduplicação, estado obsoleto, recuperação e corrupção.               |
| UI              | TUI, RPC quando aplicável, print, JSON, teclado e largura reduzida.   |
| Recursos        | Cleanup, processos órfãos, memória, filas e limites de saída.         |

### Avaliação de qualidade e eficiência

- Compare o mesmo conjunto de tarefas com baseline congelado.
- Registre sucesso, omissões, trabalho repetido e ações sem suporte.
- Registre chamadas de ferramentas, descobertas e volume de saída.
- Registre tokens, cache informado, custo informado e latência separadamente.
- Use corpus de avaliação separado dos exemplos usados para ajustar o comportamento.
- Use sessões reais sanitizadas somente com autorização para sua transmissão.
- Não use apenas uma execução ou score sintético curto para mudar padrões.

### Verificações do repositório

Use Bun para dependências e Vite+ para formatação, checks e testes.
Execute os checks focados no comportamento alterado.
Antes de cada commit, execute os comandos exigidos:

```sh
bun run check
bun run test
```

Não execute benchmarks pagos apenas porque aparecem neste documento.
Registre custo esperado, escopo e autorização antes de transmitir sessões ou executar avaliações externas.

### Critério geral de conclusão

Uma proposta só termina quando seus critérios possuem evidência verificável.
Relatórios de agentes não substituem execução quando o critério exige comportamento em runtime.
Falhas e limitações permanecem explícitas, sem reduzir os critérios para declarar conclusão.

## 12. Decisões ainda abertas

- A versão 1.1.0 será a versão mínima suportada? A recomendação é sim, porque é o runtime efetivo.
- Os peers continuam `*` ou declaram a versão mínima?
- A descoberta de skills terá package próprio ou capability compartilhada?
- Quais skills precisam permanecer anunciadas em todos os contextos?
- Quais campos do `AskQuestion` devem ser aditivos ou versionados?
- Quais operações exigem bloqueio, confirmação humana ou revisão consultiva?
- Existe demanda suficiente para board persistente além do intercom atual?
- Quais tarefas realmente precisam de sandbox de sistema operacional?
- Que ganho mínimo de qualidade ou eficiência justifica cada mudança de padrão?
- Quais dados podem entrar em memória durável e por quanto tempo?

Essas perguntas não bloqueiam a documentação do plano.
Cada implementação deve resolver apenas as decisões que alteram materialmente seu resultado.

## 13. Fontes externas fixadas

Os links abaixo usam a revisão inspecionada, não a branch móvel `main`.

[ext-packages]: https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages
[ext-root]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/README.md
[ext-harness]: https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages/pi-skill-harness-and-agent-engineering
[ext-tool-prompt]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages/pi-codex-conversion/src/tools/code-mode/custom-tool-prompt.ts
[ext-tool-updates]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages/pi-codex-conversion/src/adapter/code-mode/toolkit-updates.ts
[ext-skills]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages/pi-better-skills-tool/README.md
[ext-skills-index]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages/pi-better-skills-tool/index.ts#L22-L38
[ext-skills-discovery]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages/pi-better-skills-tool/src/discovery.ts#L214-L243
[ext-ask]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages/pi-ask/README.md
[ext-review-child]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages/pi-subagent-review/src/subagent.ts#L26-L73
[ext-subdir]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages/pi-subdir-agents/README.md
[ext-subdir-source]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages/pi-subdir-agents/src/core/subdir.ts#L67-L103
[ext-cache]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages/pi-cache-hit-predictor/src/predictor.ts
[ext-switcher-source]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages/pi-gpt-switcher/codex-model-shortcuts.ts#L58-L94
[ext-btw]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages/pi-smart-btw/README.md
[ext-trees]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages/pi-auto-trees/README.md
[ext-notes]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages/pi-notes-compaction/README.md
[ext-fresh-notes]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages/pi-notes-compaction/src/fresh-notes.ts#L8-L94
[ext-memories]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages/pi-memories/README.md
[ext-guardian]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages/pi-codex-guardian/README.md
[ext-board]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages/pi-agent-board/README.md
[ext-sandbox]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages/pi-sandbox/README.md
[ext-reasoning]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages/pi-codex-conversion/src/adapter/auto-reasoning.ts#L25-L64
[ext-chill]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages/pi-chill/README.md
[ext-charts]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/packages/pi-unicode-charts/README.md
[ext-apis]: https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/b80aa3522e570ee6753fd5d90f6d3c940ac4d211/docs/extension-apis.md
