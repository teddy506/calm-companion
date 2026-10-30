# Calm Companion – projektregler for Claude Code

Produkt: AI-baseret angstcoach (mellem sessioner). Se `docs/PRD.md` (krav) og `docs/demo/calm-companion-demo.html` (UI og adfærd).
Dette er sundhedsdata (GDPR art. 9). Sikkerhed og klinisk sikkerhed går forud for hastighed.

## Arbejdsmåde
- Byg ét trin ad gangen efter `docs/PLAN.md`. Skriv tests sammen med koden. Ingen trin er færdigt uden grønne tests.
- Kør før hver commit: `npm run lint && npm run typecheck && npm test`.
- Små commits. Én feature pr. PR.

## Hårde regler
- Ingen secrets, nøgler eller rigtige persondata i kode, tests, logs eller repo. Brug miljø/secrets manager. Testdata er syntetisk.
- Al input valideres med zod. Alle endpoints tjekker rolle OG ejerskab (IDOR-test pr. endpoint).
- Sikkerhedsvagten er fail-closed: fejl/timeout = behandl som mulig risiko og send til menneske. Den kører før hvert coach-svar og må ikke kunne omgås fra klienten.
- Coachen giver aldrig metode-/dosis-oplysninger, diagnoser eller medicinråd. Traume og psykose-tegn går til menneskelig behandling.
- Logs og auditlog indeholder aldrig samtaleindhold. Auditlog er kun-tilføjelse med hash-kæde og ekstern WORM-lagring.
- Fritekst krypteres på feltniveau (nøgle pr. patient). Metadata til forespørgsler ligger pseudonymiseret i klartekst. Ingen søgning i krypteret fritekst.
- Ændringer i infrastruktur sker kun via Terraform.

## Struktur
- `apps/api`: Fastify + TypeScript (+ PostgreSQL senere)
- `apps/web`: React (Vite), oprettes i trin 5+
- `infra/terraform`: miljø, KMS, WORM-auditbucket, secrets-containere
- `docs/`: PRD, plan, demo
