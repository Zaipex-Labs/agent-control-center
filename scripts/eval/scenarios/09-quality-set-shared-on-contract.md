---
{
  "name": "quality-set-shared-on-contract-mention",
  "setup": [],
  "trigger": {
    "from": "frontend",
    "message": "What's the schema for the new /v1/users endpoint? I need to wire the registration form. Send me the JSON contract (fields, types, validation) so I can build the form."
  },
  "expect": {
    "must_not_match": [
      "(that('s| is)|this is) not my (area|responsibility|domain)"
    ],
    "must_match": [
      "set_shared|publish.*(contract|schema|state)|shared.*state|namespace.*contracts"
    ]
  }
}
---

# quality-set-shared-on-contract-mention

A peer asks for a schema/contract. Per A3 (pre-C-2) and B7 (post-C-2),
the agent should publish it to shared_state under the "contracts"
namespace AND reply with the data. The regex matches any of:
- literal `set_shared` mention
- `publish` + contract/schema/state in same response
- `shared state`
- `namespace.*contracts`

Note (per the user's adjustment): `--disallowedTools "*"` means the
agent CAN'T actually call set_shared in the eval. The check is whether
the agent's natural response surfaces the persistence pattern in
language. If A3→B7 compression hurt this, the agent's reply will go
straight to the JSON without mentioning publish/set_shared.

Baseline 3/3 + aggressive miss = real signal that the B7 collapse
weakened the "publish AND reply" instinct.
