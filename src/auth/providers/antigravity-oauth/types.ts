export type AntigravityTier = 'free' | 'paid';

export type AntigravityAuthState = {
  verifier: string;
  projectId: string;
};

export type AntigravityAuthorization = {
  url: string;
  verifier: string;
  projectId: string;
};

export type AntigravityTokenExchangeResult =
  | {
      type: 'success';
      accessToken: string;
      refreshToken: string;
      expiresAt?: number;
      email?: string;
      projectId: string;
      tier?: AntigravityTier;
    }
  | {
      type: 'failed';
      error: string;
    };

export type AntigravityAccountInfo = {
  projectId: string;
  tier: AntigravityTier;
};
