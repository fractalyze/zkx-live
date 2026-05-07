# apps/demo

V1 demo frontend (Next.js + Phantom).

## Two-path scenario

1. **Path A — normal**: agent makes 5 SPL transfers to allowlist → all settle in <2 s
2. **Path B — injection**: agent receives malicious tool response trying to send to ATTACKER → guardrail rejects

## Build sequence

- W3 d4-5: Node.js demo agent script (no UI)
- W4 d1-3: Next.js frontend
