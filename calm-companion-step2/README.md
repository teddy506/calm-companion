# Calm Companion

Fra demo til produktion. Læs `CLAUDE.md` og `docs/PLAN.md` først.

## Kom i gang
```bash
cp .env.example .env
npm install            # opretter package-lock.json (commit den)
npm run dev:db         # lokal PostgreSQL
npm test
npm run dev -w @cc/api
```

## Før første commit
1. Læg PRD'en i `docs/PRD.md`.
2. `git init`, commit lockfilen, og slå secret scanning og Dependabot til på GitHub.
3. Sæt branch protection på `main`: kræv grøn CI.
4. Infra: `cd infra/terraform && terraform init -backend=false && terraform validate`.
