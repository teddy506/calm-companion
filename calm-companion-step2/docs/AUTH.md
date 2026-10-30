# Auth og adgangskontrol (trin 2)

## Beslutninger (truffet i trin 2)
| Emne | Valg | Begrundelse |
|---|---|---|
| Arkitektur | BFF: API'et kører OIDC-flowet, browseren får kun en server-side session-cookie | Tokens når aldrig browseren (XSS kan ikke stjæle dem); sessioner kan tilbagekaldes straks |
| Udbydere | Generisk OIDC, konfigureret via miljø. Patienter: MitID-broker. Personale: SSO | Konkrete udbydere er stadig en åben beslutning (`PLAN.md`) |
| Roller | Appens egen brugerliste, ikke IdP-claims | Ens for MitID og SSO; MitID kender ikke roller |
| Kliniker↔patient | Care-team-links (in-memory nu, PostgreSQL i trin 3) | Datamodellen kommer i trin 3 |
| Admin og patientdata | Ingen adgang. Admin styrer kun brugere/links | GDPR art. 9 / dataminimering. Nødadgang bliver en separat, auditeret feature |

## Flow
1. `GET /auth/login/:provider` (`patient` | `staff`) → state, nonce, PKCE gemmes server-side (engangs, 10 min), bundet til browseren via `__Host-cc_login`-cookie → redirect til udbyderen.
2. `GET /auth/callback/:provider` → login-cookie, udbyder og state skal matche; `openid-client` validerer kode, PKCE og ID-token (signatur, iss, aud, exp, nonce).
3. `(udbyder, sub)` slås op i brugerlisten. Ukendt/inaktiv/rolle der ikke må bruge kanalen → 403, ingen session. (Onboarding/selvregistrering: trin 5.)
4. Ny session (`__Host-cc_session`, HttpOnly, Secure, SameSite=Lax). Kun SHA-256 af token gemmes. Inaktivitet 30 min, absolut 12 t.
5. `POST /auth/logout` sletter sessionen server-side.

CSRF: SameSite=Lax + alle POST/PUT/PATCH/DELETE kræver `Origin` = `PUBLIC_BASE_URL`.

## Adgangsregler (`authz/policy.ts`)
| Rolle | Patientdata |
|---|---|
| patient | kun egne |
| kliniker | kun tilknyttede patienter |
| admin | ingen |

Ikke-tilladt og ikke-eksisterende giver samme `404`, så id'er ikke kan enumereres. Forkert rolle giver `403`, intet login `401`.

## Nye endpoints – tjekliste
1. `preHandler: requireRole(...)` (rolle).
2. Ejerskab via `canAccessPatient` (eller tilsvarende regel) i handleren.
3. zod-validering af params/query/body (`.strict()`).
4. Tilføj en række i `MATRIX` i `src/routes/idor.test.ts` for hver aktør. Ellers fejler testen "dækker alle routes".

## Udestår
- Vælg MitID-broker og SSO-udbyder; registrér redirect-URI'er; læg client secrets i Secrets Manager.
- Integrationstest af `OpenIdClientProvider` mod en rigtig/mock OIDC-udbyder (i dag testes flowet mod en fake).
- Sessioner, brugere og care-team-links → PostgreSQL (trin 3). Login/logout/adgangsnægtelser → auditlog (trin 4).
- Onboarding af nye patienter (trin 5). Admin-UI til brugere/roller. Rate limiting specifikt på login (trin 12).
