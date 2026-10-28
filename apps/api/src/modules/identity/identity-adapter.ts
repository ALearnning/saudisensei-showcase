export const IDENTITY_ADAPTER = Symbol("IDENTITY_ADAPTER");

export interface VerifiedIdentity {
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  mfaVerified: boolean;
}

// Business modules never consume Auth0 SDK objects, claims, or management APIs.
export interface IdentityAdapter {
  verifyAccessToken(token: string): Promise<VerifiedIdentity>;
}
