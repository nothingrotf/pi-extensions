import { RuleTester } from 'oxlint/plugins-dev'
import { test } from 'vite-plus/test'

import { noAsyncContextEnterWithRule } from './no-async-context-enter-with.ts'

test('rejects AsyncLocalStorage.enterWith', () => {
  new RuleTester().run('no-async-context-enter-with', noAsyncContextEnterWithRule, {
    valid: [
      {
        filename: 'src/nestjs/RequestScope.ts',
        code: 'requestScope.run(store, () => next.handle());',
      },
      {
        filename: 'src/nestjs/RequestScope.ts',
        code: 'const store = requestScope.getStore();',
      },
      {
        filename: 'src/editor/mode.ts',
        code: 'editor.enterWith(mode);',
      },
      {
        filename: 'src/editor/mode.ts',
        code: 'import { AsyncLocalStorage } from "node:async_hooks"; const requestScope = new AsyncLocalStorage(); function edit(requestScope: Editor) { requestScope.enterWith(mode); }',
      },
    ],
    invalid: [
      {
        filename: 'src/nestjs/RequestScope.ts',
        code: 'import { AsyncLocalStorage } from "node:async_hooks"; const requestScope = new AsyncLocalStorage(); requestScope.enterWith(store);',
        errors: [{ messageId: 'enterWith' }],
        output: null,
      },
      {
        filename: 'src/nestjs/RequestScope.ts',
        code: 'import { AsyncLocalStorage as Storage } from "node:async_hooks"; new Storage().enterWith(store);',
        errors: [{ messageId: 'enterWith' }],
        output: null,
      },
    ],
  })
})
