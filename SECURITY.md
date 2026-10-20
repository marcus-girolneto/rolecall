# Security policy

Please report vulnerabilities in Rolecall privately through
[GitHub private vulnerability reporting](https://github.com/marcus-girolneto/rolecall/security/advisories/new).
Do not open a public issue. You will get an acknowledgement within 5 working days.

Rolecall runs your agent's tool code in tests. Point it only at test data (`target.kind: 'memory'`) or at a sandbox
you control; it refuses production-looking targets and requires `ROLECALL_ALLOW_LIVE=1` for anything outside memory.
