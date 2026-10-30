import * as client from "openid-client";
import type { OidcSettings } from "../config.js";

export type AuthRequest = { url: URL; state: string; nonce: string; codeVerifier: string };

export type LoginChecks = { state: string; nonce: string; codeVerifier: string };

/**
 * Det, appen behøver fra en OIDC-udbyder. Udbyder-neutral, så MitID-broker og SSO
 * kan vælges senere uden kodeændringer. Tests bruger en fake implementering.
 */
export interface OidcProvider {
  createAuthRequest(redirectUri: string): Promise<AuthRequest>;
  /** Validerer callback (state, PKCE, ID-token signatur/iss/aud/exp/nonce) og returnerer `sub`. */
  completeLogin(callbackUrl: URL, checks: LoginChecks): Promise<{ subject: string }>;
}

/** Authorization Code + PKCE via openid-client (certificeret OIDC-RP-bibliotek). */
export class OpenIdClientProvider implements OidcProvider {
  private config: Promise<client.Configuration> | undefined;

  constructor(private readonly settings: OidcSettings) {}

  private getConfig(): Promise<client.Configuration> {
    // Discovery hentes dovent og caches; fejl caches ikke.
    this.config ??= client
      .discovery(new URL(this.settings.issuer), this.settings.clientId, this.settings.clientSecret)
      .catch((err: unknown) => {
        this.config = undefined;
        throw err;
      });
    return this.config;
  }

  async createAuthRequest(redirectUri: string): Promise<AuthRequest> {
    const config = await this.getConfig();
    const codeVerifier = client.randomPKCECodeVerifier();
    const state = client.randomState();
    const nonce = client.randomNonce();
    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: "openid",
      response_type: "code",
      code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: "S256",
      state,
      nonce,
    });
    return { url, state, nonce, codeVerifier };
  }

  async completeLogin(callbackUrl: URL, checks: LoginChecks): Promise<{ subject: string }> {
    const config = await this.getConfig();
    const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: checks.codeVerifier,
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      idTokenExpected: true,
    });
    const sub = tokens.claims()?.sub;
    if (!sub) throw new Error("ID-token mangler sub");
    // Tokens bruges kun til at etablere identitet; de gemmes ikke og sendes aldrig til browseren.
    return { subject: sub };
  }
}
