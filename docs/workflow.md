# sqlgenerator workflow

The AI client (Claude Code or GitHub Copilot) generates SQL. The `sqlgenerator`
MCP server only supplies context and stores examples. Nothing in this workflow
connects to Db2 or executes SQL.

```mermaid
flowchart TD
    Q([User asks a business question]) --> D[AI: list_domains]
    D --> R[AI: get_business_rules / search_context]
    R --> S[AI: get_schema for candidate tables]
    S --> E[AI: search_reviewed_examples]
    E --> STALE{Example stale or<br/>conflicts with current rules?}
    STALE -- yes --> PREFER[Follow current rules and schema;<br/>mention the conflict]
    STALE -- no --> AMB
    PREFER --> AMB{Question or rules<br/>ambiguous?}
    AMB -- yes --> ASK[AI asks the user to clarify]
    ASK --> CLAR([User clarifies]) --> R
    AMB -- no --> GEN[AI generates read-only Db2 SQL<br/>using examples as patterns only]
    GEN --> OUT[AI returns interpretation, tables, rules,<br/>SQL, assumptions, source IDs, and<br/>'not executed' statement]
    OUT --> REV{User reviews the SQL}
    REV -- needs changes --> REVISE([User asks for revisions]) --> GEN
    REV -- runs it themselves<br/>outside this system --> OK
    REV -- acceptable --> OK{User explicitly asks<br/>to submit for reuse?}
    OK -- no --> DONE([Done: nothing stored])
    OK -- yes --> SUB[AI: submit_example_for_review]
    SUB --> PEND[(examples/pending/&lt;id&gt;.json<br/>status: pending)]
    PEND --> CLI[Human: npm run review -- show &lt;id&gt;]
    CLI --> DEC{Human decision in a terminal}
    DEC -- "approve: types APPROVE &lt;id&gt;" --> APP[(examples/approved/&lt;id&gt;.json<br/>validationStatus:<br/>human_reviewed_not_executed)]
    DEC -- "reject: reason + REJECT &lt;id&gt;" --> REJ[(examples/rejected/&lt;id&gt;.json<br/>kept for audit, never served)]
    DEC -- cancel --> PEND
    APP --> REUSE[Searchable on the next<br/>search_reviewed_examples call;<br/>no restart]
    REUSE -.example-reuse loop.-> E
    CTX[(context/ manifest, rules, DDL<br/>contextVersion bump)] -.marks older examples stale.-> STALE
```

## Loops

- **Clarification loop:** ambiguity → the AI asks → the user answers → the AI retrieves context again if needed.
- **Revision loop:** the user asks for changes → the AI regenerates with the same context rules.
- **Example-reuse loop:** a human-approved example becomes searchable immediately and informs later
  questions as a *pattern*. If `contextVersion` changes, the example is flagged
  `contextCheck.stale: true`, and current rules take precedence.

## What each status means

| Status | Where | Served by MCP? | Meaning |
|---|---|---|---|
| `pending` | `examples/pending/` | No | Submitted at the user's explicit request; awaiting human review |
| `approved` | `examples/approved/` | Yes | A human typed the confirmation phrase. **Not executed.** |
| `rejected` | `examples/rejected/` | No | Kept with reason and reviewer name for audit |
| demo seed | `examples/demo/` | No | Fictional practice record; `seed-demo` copies it to pending |
