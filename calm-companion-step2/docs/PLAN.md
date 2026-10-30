# Byggeplan

Trin (ét ad gangen, med tests):
1. Repo, CI, scanning, IaC-skelet (dette skelet)
2. Auth (OIDC), RBAC (patient/klinikker/admin), IDOR-tests
3. Datamodel + krypteringslag (envelope encryption, crypto-shredding)
4. Auditlog (hash-kæde + ekstern WORM)
5. Onboarding og samtykke (versioneret, kan trækkes tilbage)
6. Sikkerhedsvagt (fail-closed) + red-team-suite (krise, traume, uden for scope, prompt injection)
7. Eskalationsmotor: SLA-tilstandsmaskine (T+0 notifikation, T+5 backup, T+10 leder, T+15 SLA-brud), `POST /escalations/:id/ack`, signerede webhooks med retry/idempotens/dead-letter, watchdog
8. Samtale og hukommelse
9. Øvelser og vurderinger (GAD-7, PHQ-9, alliancepuls)
10. Tjek-ind (maks. 1 om dagen, pause)
11. Klinikvisning og dashboard
12. Hærdning (headers, rate limiting) og ekstern pentest

## Åbne beslutninger
- Cloud-udbyder (skelet antager AWS eu-north-1)
- Login: MitID-broker og klinikernes SSO
- LLM-udbyder med EU-hosting
- Klinisk ansvarlig, der godkender øvelser og sikkerhedsprompter
