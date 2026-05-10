---
{
  "name": "vague-refusal-trigger",
  "setup": [],
  "trigger": {
    "from": "frontend",
    "message": "What's the schema for the /v1/users endpoint? I need to wire the form."
  },
  "expect": {
    "must_not_match": [
      "(that('s| is)|this is) not my (area|responsibility|domain)",
      "ask (another agent|the backend|the database)",
      "you should (ask|talk to|check with) (backend|the database|another)",
      "I (don't|do not) (handle|own|deal with) (that|this|the)",
      "(no|not) (in|part of) my scope",
      "no es mi (área|area|responsabilidad)",
      "preg[úu]ntale a (otro|backend|el equipo)",
      "esto le corresponde a"
    ],
    "must_match": []
  }
}
---

# vague-refusal-trigger

A peer agent asks a question that — taken literally — could be punted
to "ask the backend agent". The rules say: the routing already
happened, do the work or fetch the answer yourself. We assert the
agent does NOT bounce the question.

If the aggressive variant drops A5 ("never refuse with 'not my
area'"), this is the regression we'll see.
