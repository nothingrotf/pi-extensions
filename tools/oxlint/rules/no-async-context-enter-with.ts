import { defineRule } from '@oxlint/plugins'
import type { ESTree, Scope, Variable } from '@oxlint/plugins'

function importedName(specifier: ESTree.ImportDeclarationSpecifier): string | null {
  if (
    specifier.type !== 'ImportSpecifier' ||
    specifier.imported.type !== 'Identifier' ||
    specifier.imported.name !== 'AsyncLocalStorage'
  ) {
    return null
  }
  return specifier.local.name
}

function resolvedVariable(scope: Scope, name: string): Variable | null {
  let current: Scope | null = scope
  while (current !== null) {
    const variable = current.set.get(name)
    if (variable !== undefined) {
      return variable
    }
    current = current.upper
  }
  return null
}

export const noAsyncContextEnterWithRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow AsyncLocalStorage.enterWith; it mutates the ambient async context frame with no restore point.',
    },
    messages: {
      enterWith:
        '`enterWith()` binds a store to the ambient async context frame and nothing restores it, so unrelated background work that resumes there adopts the store. Scope the store with `run(store, fn)` at the boundary instead.',
    },
  },
  createOnce(context) {
    const constructors = new Set<Variable>()
    const instances = new Set<Variable>()
    const resolve = (identifier: ESTree.IdentifierReference): Variable | null =>
      resolvedVariable(context.sourceCode.getScope(identifier), identifier.name)

    return {
      Program() {
        constructors.clear()
        instances.clear()
      },
      ImportDeclaration(node) {
        if (node.source.value !== 'node:async_hooks' && node.source.value !== 'async_hooks') {
          return
        }
        const variables = context.sourceCode.getDeclaredVariables(node)
        for (const specifier of node.specifiers) {
          const name = importedName(specifier)
          const variable = variables.find((candidate) => candidate.name === name)
          if (variable !== undefined) {
            constructors.add(variable)
          }
        }
      },
      VariableDeclarator(node) {
        if (
          node.id.type !== 'Identifier' ||
          node.init?.type !== 'NewExpression' ||
          node.init.callee.type !== 'Identifier'
        ) {
          return
        }
        const constructor = resolve(node.init.callee)
        if (constructor === null || !constructors.has(constructor)) {
          return
        }
        const name = node.id.name
        const variable = context.sourceCode
          .getDeclaredVariables(node)
          .find((candidate) => candidate.name === name)
        if (variable !== undefined) {
          instances.add(variable)
        }
      },
      CallExpression(node) {
        const callee = node.callee
        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.property.type !== 'Identifier' ||
          callee.property.name !== 'enterWith'
        ) {
          return
        }
        const instance = callee.object.type === 'Identifier' ? resolve(callee.object) : null
        const constructor =
          callee.object.type === 'NewExpression' && callee.object.callee.type === 'Identifier'
            ? resolve(callee.object.callee)
            : null
        if (
          (instance !== null && instances.has(instance)) ||
          (constructor !== null && constructors.has(constructor))
        ) {
          context.report({ node, messageId: 'enterWith' })
        }
      },
    }
  },
})
