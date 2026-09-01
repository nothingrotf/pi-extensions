# Plano pós-v1 do `@nothingrotf/subagent`

## Objetivo deste documento

Este documento registra o estado atual e organiza o trabalho posterior ao v1.

O v1 já existe em `packages/subagent/`. Este plano não repete a especificação implementada.

O foco agora é responder quatro perguntas:

1. O que ainda falta no package.
2. Quais ideias valem adaptar de `pi-core-subagent`, `oh-my-pi` e Cursor.
3. Quais recursos o port local de pstack exige.
4. Quais responsabilidades devem permanecer fora deste package.

## Contrato que permanece

Estas decisões continuam válidas:

- O package se chama `@nothingrotf/subagent`.
- O runtime usa o SDK público do Pi.
- Os children executam no processo atual.
- Cada child possui contexto e transcript próprios.
- O parent expõe somente a ferramenta `Task` deste package.
- Ferramentas privadas de intercom existem somente dentro do child.
- Extensões ambientes não entram automaticamente no child.
- Um modelo inválido causa erro sem fallback silencioso.
- O estado pertence à sessão parent.
- O package não depende de `pi-subagents`.

A restrição de uma ferramenta pública protege o contexto do parent. Controles adicionais devem usar a TUI ou uma API para extensions.

## Estado do v1

O v1 implementa estes recursos:

| Área                   | Estado atual                                                          |
| ---------------------- | --------------------------------------------------------------------- |
| Execução               | Foreground e background no mesmo processo                             |
| Isolamento de contexto | `AgentSession` e transcript separados por child                       |
| Identidade             | `Agent ID` igual ao `sessionId` do child                              |
| Continuação            | Resume por `SessionManager.open()`                                    |
| Concorrência           | Chamadas independentes de `Task` podem executar em paralelo           |
| Exclusão               | Lease por `Agent ID` bloqueia resumes simultâneos                     |
| Papéis                 | Bundled roles, agent files, extension agents e override read-only     |
| Modelo                 | `provider/model-id:effort [fast]`                                     |
| Providers              | Sincronização dos providers registrados no parent                     |
| Fast                   | `service_tier: "priority"` para uma allowlist explícita               |
| Persistência           | Records em `pi-subagent-state`, com ownership e retenção limitada     |
| Lifecycle              | Abort, timeout, shutdown, restore e classificação de falhas           |
| Background             | Notificação `system/task_notification` correlacionada                 |
| Intercom               | `ask_parent`, `notify_parent` e `update_progress` privados            |
| Segurança do intercom  | Contexto normalizado, redaction, escape e limite por janela do modelo |
| Observabilidade        | Widget, `/subagents`, pane, transcript tail e cancelamento humano     |
| API                    | Controller, handles, receipts, snapshots, eventos e steering ativo    |
| Capabilities           | `cwd` efetivo e allowlist por chamada                                 |
| Usage                  | Usage do child e `intercomUsage` separados                            |
| Testes                 | Sessões SDK reais com provider local controlado                       |

O executor não depende de backend externo. A interface visual usa `@earendil-works/pi-tui`.

## Limites atuais

Estes recursos ainda não existem:

- batch com `tasks[]`.
- limite explícito de concorrência.
- chains e dependências `needs`.
- run ID que agrupa vários children.
- mailbox entre siblings.
- acesso seletivo a MCPs dentro do child.
- subagents aninhados.
- limite público de duração.
- orçamento de requests ou tokens.
- structured output.
- acceptance gates.
- worktree automático.
- attachments.
- browser, computer ou video use incluído no package.
- sobrevivência de trabalho ativo após o encerramento do Pi.
- workers remotos ou cloud.

A TUI permite status e cancelamento humanos. O modelo parent não recebe ferramentas públicas separadas para essas operações.

## Princípios para as próximas versões

### Manter o núcleo pequeno

O package deve controlar sessões locais, identidade, lifecycle, ferramentas e comunicação.

Ele não deve virar um sistema geral de jobs, PRs, cloud ou automações.

### Preservar uma ferramenta pública

Novos modos de spawn podem ampliar `Task` com uma união compatível.

Status, cancelamento e inspeção devem continuar disponíveis pela TUI.

Extensions como pstack devem usar uma API exportada pelo runtime para controles programáticos.

### Negar capacidades por padrão

Um child recebe somente capacidades selecionadas pelo runtime.

`noExtensions: true` continua como padrão. Uma extensão interna explícita pode adicionar uma capacidade aprovada.

### Separar coordenação de isolamento

Batch, graph e mailbox coordenam trabalho.

Worktrees isolam mutações. Um recurso não deve depender do outro.

### Preferir evidência determinística

O runtime pode executar comandos de verificação declarados.

Uma afirmação do próprio child não substitui exit code, diff ou validação de schema.

## Comparação com outras implementações

### Matriz principal

| Capacidade             | v1 atual      | `pi-core-subagent`           | `oh-my-pi`                     | Cursor                                    |
| ---------------------- | ------------- | ---------------------------- | ------------------------------ | ----------------------------------------- |
| Sessão isolada         | Sim           | Sim                          | Sim                            | Sim                                       |
| Foreground             | Sim           | `autoAwait`                  | Sim                            | Sim                                       |
| Background             | Sim           | Padrão                       | Configurável                   | Sim                                       |
| Resume                 | Sim           | Não para turns interrompidos | Sim                            | Sim                                       |
| Batch                  | Não           | Sim                          | Opcional                       | Não comprovado no schema público extraído |
| Graph e chain          | Não           | Sim                          | Não                            | Não comprovado                            |
| Steering               | Não           | Sim                          | Sim via IRC                    | Parcialmente observado                    |
| Intercom parent-child  | Automático    | Humano com timeout           | IRC completo                   | Perguntas normais bloqueadas              |
| Mailbox entre siblings | Não           | Sim                          | Sim                            | Não comprovado                            |
| Agent files            | Não           | Sim                          | Sim                            | Built-ins e definição customizada         |
| Tool allowlist         | Papéis fixos  | Sim                          | Sim                            | Permissões por definição                  |
| MCP no child           | Não           | Não por padrão               | Sim por proxies                | Ferramentas dinâmicas do host             |
| Nested agents          | Não           | Política parcial             | Sim com limite de profundidade | Linhagem comprovada                       |
| Structured output      | Não           | Não                          | Sim                            | Não comprovado                            |
| Budgets                | Timeout fixo  | Timeout configurável         | Requests, tokens e timeout     | Loops e limites de continuação            |
| Worktree               | Não           | Sim                          | Sim                            | Cloud base branch comprovado              |
| Observabilidade        | Widget e pane | Widget, pane e tools         | Agent Hub e eventos            | Stores e notificações                     |
| Cloud ou remoto        | Não           | Não                          | Não no núcleo Task             | Sim                                       |

A coluna Cursor usa evidência extraída. Ela não prova toda a implementação do produto.

## Ideias do `pi-core-subagent`

### Adotar

#### Batch limitado

Uma chamada deve poder iniciar vários children independentes.

O batch precisa de:

- IDs estáveis por item.
- um run ID comum.
- contexto compartilhado opcional.
- concorrência máxima.
- resultado agregado.
- notificação por item configurável.

Este recurso reduz chamadas paralelas e cria o roster necessário para mailbox.

#### Dependências `needs`

Cada item pode declarar dependências por ID.

O runtime deve validar antes do primeiro spawn:

- IDs duplicados.
- dependências desconhecidas.
- autorreferência.
- ciclos.

Uma dependência concluída entrega sua saída ao item dependente.

Uma dependência com falha bloqueia somente seus descendentes.

O primeiro desenho pode usar ondas. Uma fila event-driven pode entrar depois se a latência exigir.

#### Steering

O runtime já mantém a `AgentSession` ativa.

Uma API interna deve enviar steering ao child no próximo limite do modelo.

O v2 não precisa registrar outra ferramenta pública. Pstack pode chamar essa API por seu adapter.

#### Agent files

O runtime deve descobrir definições em diretórios Pi e Agents compatíveis.

A definição pode fornecer:

- nome.
- descrição.
- system prompt.
- modelo padrão.
- effort padrão.
- ferramentas permitidas.

Uma definição nunca pode ampliar permissões acima da política da chamada.

#### Tool allowlist

O runtime deve aceitar uma allowlist explícita por item.

O runtime deve validar cada nome contra ferramentas disponíveis e políticas locais.

Read-only continua como atalho seguro.

### Adotar com mudanças

#### Mailbox entre siblings

Mailbox só faz sentido após batch e roster.

A implementação deve ser local ao run, limitada e sem dependência de registry global.

Cada mensagem precisa de:

- origem.
- destino.
- timestamp.
- tamanho máximo.
- estado de leitura.

O child recebe `send_agent_message` e `poll_agent_messages` somente em runs com siblings.

#### Worktrees

O isolamento é útil para writers paralelos, mas Git não pertence ao lifecycle básico da sessão.

O melhor desenho separa um provider de isolamento do executor de subagents.

O provider deve retornar:

- `cwd` isolado.
- branch.
- base SHA.
- arquivos alterados.
- diffstat.
- instruções de merge ou artifact.

O runtime não deve instalar dependências dentro do worktree.

### Não copiar

O v2 não deve copiar sete ferramentas públicas.

Também não deve copiar sidecar JSON quando o estado da sessão parent já resolve ownership e restore.

## Ideias do `oh-my-pi`

### Adotar

#### Descoberta de agentes

A revisão analisada de `oh-my-pi` combina agentes bundled, project, user, extension e plugin.

A descoberta direta usa `.omp/agents/`. Agentes Claude entram por providers de plugins, não por busca direta em `.claude/agents/`.

O cache de `oh-my-pi` usa `cwd` e a configuração efetiva de extensions. Um reload explícito publica outro snapshot.

Este package precisa de um subconjunto previsível e independente do sistema de plugins de `oh-my-pi`.

A resolução local usa o nome normalizado e aplica esta precedência:

1. projeto, do diretório atual até a raiz.
2. usuário.
3. definitions registradas por extensions.
4. agentes bundled do package.

Cada nível procura `.agents/agents/`, `.pi/agents/` e `.claude/agents/`, nessa ordem.

A primeira origem com um nome exato vence. Duplicatas no mesmo nível causam erro.

Um arquivo correspondente e malformado causa erro. O resolver não ignora o arquivo para usar uma origem menos específica.

Uma definition de extension não concede capabilities. Ferramentas sempre passam pela política efetiva da chamada.

O resultado precisa indicar a origem usada.

A descoberta precisa resolver symlinks, ordenar arquivos e detectar nomes duplicados.

O parser precisa validar frontmatter em uma fronteira tipada. O SDK público não exporta o parser interno de frontmatter.

O cache deve usar o `cwd` efetivo e uma geração das definitions registradas. Uma API explícita deve invalidar esse cache.

#### Structured output opcional

Uma chamada pode fornecer `outputSchema` e `schemaMode`.

`schemaMode` deve aceitar:

- `permissive` para retornar dados inválidos com diagnóstico.
- `strict` para falhar quando a validação final falhar.

Texto continua como padrão. Structured output existe para composição e automação.

#### Budgets

O runtime deve aceitar limites independentes:

- duração.
- requests.
- tokens cobrados.
- tool calls.

Um soft limit solicita uma conclusão final.

Um hard limit aborta a sessão e preserva texto, usage e erro.

#### Observabilidade detalhada

Snapshots futuros devem incluir:

- request count.
- tokens acumulados.
- contexto atual e context window.
- retry state.
- modelo efetivo.
- fallback efetivo, quando existir.
- última intenção.
- ferramenta atual.

A UI não deve clonar o estado completo em cada evento.

#### Output references

Resultados grandes devem poder virar artifacts com referência curta.

Isso protege o contexto do parent e ajuda pstack a passar relatórios entre fases.

### Adotar com mudanças

#### IRC

O IRC de `oh-my-pi` depende de registry global, revival, hub e lifecycle próprios.

O package deve preservar somente estas ideias:

- identidade estável.
- reply correlation.
- mailbox limitada.
- detecção de destino terminal.
- entrega imediata como steering quando possível.

O intercom automático atual continua separado de advisor e chat humano.

#### Nested agents

Nested Task pode entrar com uma extensão interna controlada.

A política deve definir:

- profundidade máxima.
- fan-out máximo.
- orçamento herdado.
- ferramentas permitidas.
- lineage parent-child.
- proibição de extensão ambiente.

O padrão permanece desativado.

### Manter fora

Estas integrações dependem demais do host `oh-my-pi`:

- Agent Hub completo.
- advisor contínuo.
- prewalk de modelo.
- LSP próprio.
- eval state.
- registry global de processos.
- sistema geral de async jobs.
- proxies MCP implícitos.

O package pode expor hooks. Outro package implementa essas políticas.

## Ideias do Cursor

### Adotar

#### Contrato simples de Task

O contrato atual continua próximo do Cursor:

- descrição curta.
- prompt completo.
- tipo de agente.
- modelo opcional.
- foreground ou background.
- resume por Agent ID.
- read-only explícito.

Novos campos não devem remover esse caminho simples.

#### Continuação e lineage

A evidência do Cursor inclui resume, fork ID, parent ID e root parent ID.

O runtime já possui resume e ownership. O futuro nested mode deve registrar lineage completo.

#### Contexto selecionado

Um futuro campo de contexto pode permitir referências explícitas a arquivos ou artifacts.

O runtime não deve copiar o transcript inteiro do parent por padrão.

#### Continuação controlada

Cursor possui limites de idle, loops e coleta de children em background.

Uma versão local pode oferecer continuação limitada após budgets e nested mode.

Ela não deve criar loops autônomos sem limite explícito.

### Oferecer por agents separados

Cursor inclui perfis para browser, computer, video, VM e guide.

Esses perfis não devem entrar no núcleo.

Agent files ou packages especializados podem fornecer essas capacidades.

### Manter fora

O package não deve tentar reproduzir:

- infraestrutura cloud do Cursor.
- seleção de máquina.
- credenciais remotas.
- checkpoints proprietários.
- protobuf interno.
- store SQLite do produto.
- plugins e marketplace do Cursor.

## Avaliação de `packages/pstack`

### Estado atual

`packages/pstack/` ainda é uma árvore de port. Ela não possui `package.json` ou entrypoint Pi local.

A árvore contém skills, agents, playbooks e scripts ainda orientados ao Cursor.

O adapter `pstack-pi` disponível globalmente não faz parte deste diretório local.

### O que o v1 já atende

| Necessidade pstack               | Cobertura atual                |
| -------------------------------- | ------------------------------ |
| Child local isolado por contexto | Atende                         |
| Foreground e background          | Atende                         |
| Resume por identidade            | Atende                         |
| Modelo Pi explícito e effort     | Atende após tradução de role   |
| Fast mode                        | Atende para a allowlist atual  |
| Read-only básico                 | Atende                         |
| Chamadas independentes paralelas | Atende                         |
| Intercom parent-child            | Atende com resposta automática |
| Transcript por child             | Atende                         |
| Status e cancelamento humanos    | Atende pela TUI                |
| Usage e custo                    | Atende                         |

Isso permite adaptar `how`, `interrogate`, revisões simples e workers locais independentes.

### O que skills podem resolver

Estas mudanças não exigem alterações no runtime:

- trocar slugs Cursor por modelos Pi válidos.
- mapear roles pstack em `.pstack/config.md`.
- trocar paths de skills Cursor por paths Pi.
- usar `todo_write`, `loop` e `goal` dos packages próprios.
- usar browser e CLI control por skills dedicadas.
- passar paths explícitos de transcript.
- executar `how` com children `explore`.
- executar reviews paralelos com chamadas `Task` independentes.
- criar worktrees manualmente no parent para casos locais limitados.

Essas adaptações ainda precisam de um package pstack instalável e de um router local.

### O que exige novos recursos do subagent

| Necessidade pstack               | Recurso necessário                                  |
| -------------------------------- | --------------------------------------------------- |
| `poteto-agent` e `comment-sicko` | Custom agents e agent files                         |
| `why` e `reflect` com MCP        | Capability profiles e forwarding explícito de tools |
| Orquestração em três níveis      | Nested Task com depth e budgets                     |
| Arena e Swarm locais             | Batch, concorrência e worktree provider             |
| Owners retidos                   | Resume, steering e API programática                 |
| Rolling windows                  | Status, receipts e cancelamento pela API            |
| Handoffs entre workers           | Run roster, mailbox e artifacts                     |
| Veredictos mecânicos             | Structured output e gates opcionais                 |
| Model panels                     | Model role router no adapter pstack                 |
| Histórico amplo                  | Session history adapter fora do runtime básico      |

### O que não pertence ao subagent

O package pstack ou outros packages devem fornecer:

- role-to-model routing.
- configuração `.pstack/config.md`.
- `pstack_launch`, `pstack_panel`, `pstack_followup` e `pstack_status`.
- question UI para o usuário.
- todo, goal e loop.
- browser, computer, CLI e TUI control.
- descoberta e autenticação de MCPs.
- busca de histórico entre workspaces.
- GitHub, Graphite e PR watchers.
- durable orchestration store.
- cloud workers, VMs e dashboards.
- connectors de chat, observability, errors e warehouse.

`ask_parent` não substitui uma pergunta ao usuário. Ele responde com o modelo parent e contexto limitado.

### Veredicto sobre compatibilidade

O v1 atende workers locais simples e retained follow-ups.

Ele não atende pstack completo como está escrito.

Os bloqueios principais são:

1. custom agents.
2. acesso seletivo a MCPs.
3. nested delegation.
4. lifecycle API programática.
5. isolamento para writers paralelos.
6. packaging e routing do próprio pstack.

Cloud não deve bloquear o port local. Skills cloud precisam de variantes locais ou de outro backend.

## Arquitetura proposta para v2

### Camadas

```text
Task tool
  -> Task input normalizer
  -> Run coordinator
     -> graph validator
     -> concurrency limiter
     -> child lifecycle
     -> run mailbox
     -> artifact registry
  -> SubagentSessionFactory
     -> agent resolver
     -> capability policy
     -> model resolver
     -> AgentSession
```

A TUI e adapters usam snapshots do `Run coordinator`.

### API para extensions

O package deve exportar uma API estável sem registrar novas ferramentas no parent.

```ts
export type SubagentInvocation = {
  ctx: ExtensionContext
  input: TaskInput
  signal?: AbortSignal
}

export interface SubagentController {
  start(invocation: SubagentInvocation): Promise<TaskReceipt>
  snapshot(ownerSessionId: string, agentId: string): SubagentSnapshot | undefined
  result(ownerSessionId: string, agentId: string): SubagentResult | undefined
  steer(ownerSessionId: string, agentId: string, message: string): Promise<SteerReceipt>
  cancel(ownerSessionId: string, agentId: string): Promise<CancelReceipt>
  subscribe(ownerSessionId: string, listener: SubagentListener): () => void
}
```

O package deve fornecer `acquireSubagentController(pi)` como ponto único por runtime de `ExtensionAPI`.

`registerSubagent(pi)` usa o mesmo controller. Ele registra `Task`, a TUI e os lifecycle handlers uma vez.

A garantia process-wide de uma única cópia exige um ponto público compartilhado no host. O SDK atual não oferece esse registry.

O primeiro contrato deve garantir unicidade por instância de `ExtensionAPI`. Um spike deve testar duas cópias físicas do package.

A aquisição anterior a `session_start` cria um controller sem owner ativo. `start()` falha até receber um `ExtensionContext` válido.

Eventos de switch, fork, tree e shutdown invalidam o owner e os handles antigos.

O controller não guarda um `ExtensionContext` após a transição. O Pi invalida objetos vinculados à sessão substituída.

O signal da chamada sempre chega ao runtime. Um adapter não pode iniciar um turn sem definir sua política de cancelamento.

O desenho final deve evitar type assertions e broad records.

Pstack pode construir suas ferramentas públicas sobre essa API.

### Dependências ocultas do P1

#### Contrato persistido de execução

Custom agents, `cwd` e tools alteram o contrato que cria a sessão.

O record v1 não preserva o prompt efetivo, o `cwd`, a origem do agent ou a allowlist efetiva.

Antes do primeiro resume com esses recursos, o state precisa de uma nova versão e migração.

Cada record deve preservar:

- nome e origem do agent.
- prompt efetivo ou conteúdo imutável equivalente.
- `cwd` real e validado.
- tools efetivas, inclusive a política read-only.
- modelo, effort e fast.
- versão do contrato de execução.

O resume deve usar o contrato persistido. Uma alteração posterior do agent file não pode ampliar capabilities.

O comportamento de `oh-my-pi` confirma esta dependência. Ele persiste `session_init` e reconstrói tools, prompt, schema e depth.

#### Política de paths e `cwd`

O runtime deve resolver um `cwd` relativo contra `ctx.cwd`.

Ele deve validar que o resultado existe e é um diretório.

O mesmo `cwd` deve entrar no resource loader, no `SessionManager`, em `createAgentSession()` e nas tools.

Um resume deve reutilizar o `cwd` persistido. Ele deve falhar se o diretório não existe.

A política precisa decidir se adapters podem sair da raiz do parent. O schema sozinho não define essa autorização.

#### Álgebra da allowlist

A allowlist efetiva deve ser a interseção entre três conjuntos:

1. tools permitidas pelo runtime.
2. tools permitidas pelo agent.
3. tools solicitadas pela chamada.

Read-only remove tools mutáveis depois dessa interseção.

As tools privadas de intercom entram depois da validação. Uma chamada não pode solicitar ou remover essas tools.

O runtime deve validar nomes desconhecidos antes de criar a sessão. `setActiveToolsByName()` não substitui essa validação.

Definitions de extensions fornecem configuração. Elas não fornecem implementações de tools nem novas capabilities.

#### Descoberta e cache

A descoberta depende de um parser de frontmatter, canonicalização de paths e regras de colisão.

A implementação precisa definir limites para tamanho do arquivo, nome, descrição e prompt.

O cache deve separar cada `cwd` e cada geração de definitions registradas.

Testes devem cobrir symlinks, arquivos ilegíveis, frontmatter inválido, colisões e mudança de `cwd`.

#### Steering

O SDK público já fornece `AgentSession.steer()`.

P1 deve limitar steering a um turn ativo. Acordar um agent idle exige revival e pertence a outra fase.

A API deve rejeitar texto vazio, owner incorreto, agent terminal e corrida com conclusão.

O receipt deve informar se a mensagem entrou na fila. Um retorno `void` não distingue entrega de corrida terminal.

Cancelamento e steering precisam usar a mesma geração ativa. Um Agent ID sozinho não impede uma operação atrasada.

#### Snapshots, eventos e receipts

O runtime já possui `listSnapshots()`, `subscribe()` e `cancel()`. Estes métodos ainda não formam uma API estável.

Snapshots públicos precisam ser cópias imutáveis e vinculadas ao owner.

Cada evento precisa de uma revisão monotônica. Isso permite que adapters descartem updates antigos.

O receipt inicial precisa existir após a criação da sessão. Ele deve expor Agent ID, owner, estado e transcript.

O resultado terminal precisa incluir output parcial, usage, intercom usage e erro.

O state atual guarda parte desses dados. Ele não guarda o modelo efetivo nem um receipt completo de falha.

#### Lifecycle e concorrência

`registerSubagent()` cria um runtime novo em cada chamada atual.

P1 precisa separar aquisição, registro da ferramenta, registro da TUI e binding do lifecycle.

Shutdown deve ser idempotente. Hoje, eventos `session_before_*` e `session_shutdown` podem chamar cleanup para a mesma transição.

Cada binding recebe uma geração. Callbacks antigos não podem restaurar ou encerrar o owner novo.

O lease atual cobre um Agent ID. A API deve manter essa exclusão em `start()`, resume, steer e cancel.

### Evolução do schema público

O caminho single atual deve continuar válido.

O batch pode usar uma união exclusiva:

```ts
export type TaskBatchInput = {
  context?: string
  tasks: TaskItem[]
  concurrency?: number
  run_in_background?: boolean
}
```

Cada `TaskItem` pode incluir:

```ts
export type TaskItem = {
  id?: string
  description: string
  prompt: string
  subagent_type: string
  model?: string
  readonly?: boolean
  tools?: string[]
  cwd?: string
  needs?: string[]
  outputSchema?: object
  schemaMode?: 'permissive' | 'strict'
  maxRuntimeMs?: number
}
```

Este é um desenho inicial. A implementação precisa validar sua compatibilidade com TypeBox e o SDK público.

## Prioridades

### P0. Corrigir o documento e consolidar o v1

- [x] Manter este plano alinhado ao código.
- [x] Testar resume com um record que possui outro `ownerSessionId`.
- [x] Verificar que esse erro não revela transcript ou Agent ID estrangeiro.
- [x] Testar mudança de `subagent_type` no resume.
- [x] Testar ativação e remoção de read-only no resume.
- [x] Testar transcript removido antes do resume.
- [x] Testar um transcript cujo header retorna outro session ID.
- [x] Testar `[fast]` duplicado, no meio, com sufixo e com espaço interno inválido.
- [x] Corrigir o tail quando a janela começa dentro de uma entrada JSONL.
- [x] Adicionar um teste com uma entrada maior que `TAIL_BYTES` seguida por uma entrada válida.
- [x] Documentar a fidelidade limitada do provider no side turn.
- [x] Verificar o archive e confirmar que ele não inclui `PLAN.md`.

O tail deve descartar somente o fragmento inicial quando a leitura começa após o byte zero.

Se uma entrada excede a janela inteira, a UI deve mostrar as entradas completas posteriores.

O side turn preserva provider, modelo e thinking level disponíveis no SDK.

Ele não garante hooks, cache identity, transport, retry state ou service tier do turn parent.

### P1. Criar os pontos de extensão do runtime

- [x] Separar o lifecycle atual do registro da ferramenta e da TUI.
- [x] Definir aquisição única por `ExtensionAPI` e testar a fronteira entre cópias físicas.
- [x] Exportar `SubagentController` e tipos de receipt, snapshot e evento.
- [x] Adicionar ownership por sessão, geração e invalidação de handles.
- [x] Versionar o state e persistir o contrato efetivo de execução.
- [x] Adicionar custom agents registrados por extensions.
- [x] Adicionar o parser e a descoberta de agent files.
- [x] Adicionar `cwd` por chamada com validação e persistência.
- [x] Adicionar tool allowlist por chamada com interseção de políticas.
- [x] Adicionar steering ativo pela API com receipt.
- [x] Adicionar snapshots, resultados e receipts programáticos.
- [x] Testar switch, fork, tree, reload e shutdown duplicado.

Esta fase prepara adapters. Ela não conclui o port de pstack.

### Marco pstack A. Criar o adapter local

Este marco pertence a `packages/pstack/`, não ao runtime de subagents.

1. Criar um package Pi instalável.
2. Adicionar o router e `.pstack/config.md`.
3. Traduzir model roles para seletores Pi exatos.
4. Implementar `pstack_launch`, `pstack_panel`, `pstack_followup` e `pstack_status`.
5. Adaptar paths, todo, loop, goal e question UI.
6. Validar `how`, `interrogate` e workers nomeados.

### P2. Adicionar capacity e budgets

1. Expor limites de duração.
2. Adicionar limite global de children ativos.
3. Adicionar limite por owner e por run.
4. Adicionar semáforos opcionais por provider request.
5. Adquirir slots de provider somente durante streams.
6. Incluir side turns no limite correto do provider.
7. Adicionar soft e hard request budgets.
8. Adicionar token e tool-call budgets.
9. Somar budgets por toda a árvore de descendentes.
10. Preservar resultado parcial e usage em falhas.

Esta fase bloqueia qualquer nested mode posterior.

### P3. Coordenação local

1. Adicionar batch e run ID.
2. Aplicar os limites globais e locais de concorrência.
3. Adicionar dependências `needs`.
4. Adicionar entrega automática de outputs upstream.
5. Adicionar mailbox entre siblings.
6. Adicionar artifacts para resultados grandes.
7. Adicionar structured output opcional.
8. Expor retry state e contexto atual.
9. Adicionar gates determinísticos opcionais.

Esta fase permite panels, Arena local e Swarm local read-only.

### P4. Capabilities e nested mode

1. Definir uma política de capabilities.
2. Fazer um spike com MCP tools pelo SDK público.
3. Adicionar extensions internas aprovadas por perfil.
4. Verificar os budgets agregados de P2.
5. Adicionar nested Task desativado por padrão.
6. Aplicar limites de depth, fan-out, tokens e tools.
7. Registrar lineage completo.

Esta fase libera `why`, `reflect` e playbooks com owners hierárquicos.

### P5. Isolamento de writers

1. Definir a interface de um isolation provider.
2. Implementar um provider de worktree separado.
3. Registrar branch, base SHA, diffstat e changed files.
4. Detectar colisões entre siblings.
5. Preservar trabalho parcial após abort ou falha.
6. Testar nested repositories e cleanup após crash.

Esta fase permite Arena e Swarm com mutações paralelas.

### P6. Migrar `@nothingrotf/task`

1. Comparar os contratos públicos após P1 e P2.
2. Migrar callers, prompts e testes aplicáveis.
3. Atualizar a documentação do workspace.
4. Remover o adapter RPC antigo.
5. Remover `packages/task/` somente após a equivalência necessária.

A migração não deve bloquear melhorias do runtime. Ela ocorre quando pstack e os callers locais usam o novo contrato.

## Critérios de aceitação do v2

O v2 estará pronto quando estes itens forem verdadeiros:

- chamadas single do v1 continuam compatíveis.
- custom agents funcionam sem extensões ambientes.
- agent files não ampliam permissões.
- pstack consegue iniciar profiles nomeados.
- pstack consegue consultar, continuar, steering e cancelar pela API.
- `cwd` e tools são validados antes da sessão.
- batch limita concorrência.
- o limite global cobre chamadas independentes, side turns e descendants.
- slots de provider cobrem streams, não a vida completa do child.
- um graph inválido falha antes do primeiro spawn.
- outputs upstream chegam aos dependentes sem cópia manual.
- mailbox existe somente dentro do run.
- structured output permanece opcional.
- budgets preservam resultado parcial e usage.
- nested mode permanece desativado por padrão.
- nested mode exige budgets agregados válidos.
- todos os limites nested são testados.
- o archive não inclui `PLAN.md`.

## Riscos e perguntas abertas

### Forwarding de MCP tools

O SDK público não garante acesso genérico às ferramentas ativas do parent.

A fase P3 precisa provar um mecanismo seguro antes de prometer MCP dentro do child.

### Provider fidelity

O side turn preserva provider, modelo e thinking level disponíveis no SDK.

Ele não preserva todos os hooks, cache identities, transport settings ou service tier efetivo do turn parent.

### Batch e schema size

Um schema grande pode consumir contexto do parent e reduzir a precisão de chamadas simples.

A implementação deve medir esse custo antes de unir single, batch e graph em um schema.

### Worktree side effects

Worktrees isolam arquivos versionados. Eles não isolam serviços, caches, databases ou dependências compartilhadas.

### Nested explosion

Depth sozinho não limita custo total.

A política precisa combinar depth, fan-out, concorrência e usage budgets.

### Processo local

Um child ativo depende do processo Pi atual.

Durable remote execution pertence a outro backend e não ao runtime in-process.

## Referências analisadas

### Implementação atual

- `packages/subagent/src/`
- `packages/subagent/test/`
- `packages/subagent/README.md`
- commit do v1 base `a393373010c97c39af6238856af69f9af4442860`
- commit da TUI `b5d4fafd88d98797bfc3ea95b7f2e0adbeeaefbb`
- commit do intercom `bd2f0b807ff5a77c91e02641b974ed821b7b5712`

### `@arhen/pi-core-subagent`

Revisão analisada:

```text
21d3e6476f076a889f659d7201e680099165d902
```

Arquivos principais:

- `src/manager.ts`
- `src/graph.ts`
- `src/mailbox.ts`
- `src/worktree.ts`
- `src/agentfile.ts`
- `src/child.ts`
- `src/index.ts`

### `oh-my-pi`

Revisão analisada:

```text
65f79e76fcc89b96632fe86a598f314bd7cfc725
```

Arquivos principais:

- `packages/coding-agent/src/task/`
- `packages/coding-agent/src/irc/`
- `packages/coding-agent/src/registry/`
- `packages/coding-agent/src/session/irc-bridge.ts`

### Cursor

Evidência local:

- `tmp/cursor-builtins/README.md`
- `tmp/cursor-builtins/source/task-tool.extracted.js`
- `tmp/cursor-builtins/source/prepared-task-subagent.extracted.js`
- `tmp/cursor-builtins/source/subagent_exec_pb.extracted.js`
- `tmp/cursor-builtins/source/subagents_pb.extracted.js`
- `tmp/cursor-builtins/evidence/`

A evidência corresponde ao Cursor Agent `2026.08.25-3e8eec8`.

### Pstack

- `packages/pstack/PI-PORTING-MAP.md`
- `packages/pstack/skills/`
- `packages/pstack/agents/`

O plano trata `packages/pstack/` como código em port. Ele não assume que o diretório já forma um package instalável.
