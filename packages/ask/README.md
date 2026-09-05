# @nothingrotf/ask

`@nothingrotf/ask` adds the `AskQuestion` tool to Pi.

The form supports multiple questions, single selection, multiple selection, and a freeform `Other` answer.

## Install

```sh
pi install npm:@nothingrotf/ask
```

Restart Pi after installation.

## Tool input

```json
{
  "title": "Implementation choices",
  "questions": [
    {
      "id": "language",
      "prompt": "Which language?",
      "options": [
        { "id": "ts", "label": "TypeScript" },
        { "id": "py", "label": "Python" }
      ],
      "allowMultiple": false
    },
    {
      "id": "features",
      "prompt": "Which features?",
      "options": [
        { "id": "tests", "label": "Tests" },
        { "id": "docs", "label": "Documentation" }
      ],
      "allowMultiple": true
    }
  ]
}
```

Set `runAsync` to `true` to return before the user answers.

Pi delivers the later answer as a session message and starts a follow-up turn.
If the user skips an async form, Pi delivers its rejection with the next user prompt. It does not start another turn.

## Controls

- Use Up and Down to select an option.
- Use Left and Right to select a question.
- Use Space to toggle an option.
- Use Enter to select, advance, or submit.
- Use Escape to skip the complete form.
- Type when `Other` is active to provide a freeform answer.

The tool adds `Other` to every question.

The tool removes a duplicate final option such as `Other`, `Something else`, or a labeled variant.

## Results

A successful answer contains one item for each question.

```json
{
  "questionId": "features",
  "selectedOptionIds": ["tests", "docs"],
  "freeformText": ""
}
```

A freeform answer uses `freeformText`. The sentinel option ID never appears in `selectedOptionIds`.

Print mode and JSON mode reject questions because no interactive form exists.

## Outstanding questions

Ask publishes `ask:state` on Pi's shared event bus:

```json
{ "version": 1, "pending": 2, "paused": false }
```

`pending` counts open and queued forms, including `runAsync`. Answered, skipped, failed, and aborted forms are removed.

`paused` means that the user skipped or aborted a form. The next user message clears it. Headless rejection does not set it.

The `ask:state:request` event requests the current snapshot. Session start, tree navigation, and shutdown clear the state. They also discard old queued forms and late async completions.

Historical tool results do not restore the state because those forms are no longer open.

Todo uses this optional protocol to avoid reminders while questions are outstanding or the user has skipped a form. Neither package requires the other.

## TUI

The call frame shows a pending status line and one labelled section per question with marker bullets. The result frame shows the ask glyph and the chosen markers:

```text
? Ask 1 question
[lang] options:2
Which language?
 ◉ TypeScript
 ○ Python
```

Multi-select questions use `☑` and `☐`. A custom answer shows a `✔` line. A cancelled question shows a `⚠ Cancelled` line.
