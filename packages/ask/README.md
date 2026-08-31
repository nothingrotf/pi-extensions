# @nothingrotf/ask

`@nothingrotf/ask` adds the `ask_question` tool to Pi.

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
