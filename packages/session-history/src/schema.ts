import { Type, type Static } from 'typebox'

const Limit50 = Type.Optional(Type.Integer({ minimum: 1, maximum: 50 }))
const Limit100 = Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
const Limit200 = Type.Optional(Type.Integer({ minimum: 1, maximum: 200 }))
const Cursor = Type.Optional(Type.String({ minLength: 1 }))
const DateFilter = Type.Optional(Type.String({ format: 'date-time' }))

const ListSchema = Type.Object(
  {
    action: Type.Literal('list'),
    include_current: Type.Optional(Type.Boolean()),
    include_children: Type.Optional(Type.Boolean()),
    created_after: DateFilter,
    created_before: DateFilter,
    limit: Limit50,
    cursor: Cursor,
  },
  { additionalProperties: false },
)

const SearchSchema = Type.Object(
  {
    action: Type.Literal('search'),
    query: Type.String({ minLength: 2, maxLength: 512 }),
    session_ids: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 50 })),
    include_current: Type.Optional(Type.Boolean()),
    include_children: Type.Optional(Type.Boolean()),
    roles: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 10 })),
    entry_types: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 20 })),
    created_after: DateFilter,
    created_before: DateFilter,
    limit: Limit50,
    cursor: Cursor,
  },
  { additionalProperties: false },
)

const ReadSchema = Type.Object(
  {
    action: Type.Literal('read'),
    session_id: Type.String({ minLength: 1 }),
    entry_id: Type.Optional(Type.String({ minLength: 1 })),
    cursor: Cursor,
    direction: Type.Optional(
      Type.Union([Type.Literal('before'), Type.Literal('after'), Type.Literal('around')]),
    ),
    limit: Limit100,
    view: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('audit')])),
    include_tool_payloads: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
)

const TimelineSchema = Type.Object(
  {
    action: Type.Literal('timeline'),
    session_id: Type.String({ minLength: 1 }),
    include_children: Type.Optional(Type.Boolean()),
    view: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('audit')])),
    limit: Limit200,
    cursor: Cursor,
  },
  { additionalProperties: false },
)

const ToolActivitySchema = Type.Object(
  {
    action: Type.Literal('tool_activity'),
    session_id: Type.String({ minLength: 1 }),
    include_children: Type.Optional(Type.Boolean()),
    tool_names: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 50 })),
    errors_only: Type.Optional(Type.Boolean()),
    limit: Limit200,
    cursor: Cursor,
  },
  { additionalProperties: false },
)

export const SessionHistorySchema = Type.Union([
  ListSchema,
  SearchSchema,
  ReadSchema,
  TimelineSchema,
  ToolActivitySchema,
])

export type SessionHistoryInput = Static<typeof SessionHistorySchema>
