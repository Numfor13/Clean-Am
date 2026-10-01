// The sign-in operations the route handlers use, implemented against Amazon
// Cognito in cognito.ts.

import type { Tokens } from "./session";

export type AuthStep =
  | { kind: "tokens"; tokens: Tokens }
  | {
      kind: "challenge";
      challenge: "SMS_OTP" | "SMS_MFA" | "NEW_PASSWORD_REQUIRED" | "SOFTWARE_TOKEN_MFA";
      session: string;
      username: string;
      destination?: string;
    };

export interface SignUpInput {
  phone: string;
  password: string;
  username: string;
  email?: string;
  language: "en" | "fr";
}

export interface AuthProvider {
  signInWithPassword(identifier: string, password: string): Promise<AuthStep>;
  startSmsSignIn(phone: string): Promise<AuthStep>;
  answerSmsCode(username: string, session: string, code: string, challenge?: "SMS_OTP" | "SMS_MFA"): Promise<AuthStep>;
  answerNewPassword(username: string, session: string, newPassword: string): Promise<AuthStep>;
  /** The 6-digit code from an authenticator app (staff who turned on two-step verification). */
  answerMfaCode(username: string, session: string, code: string): Promise<AuthStep>;
  refresh(refreshToken: string, username: string): Promise<Tokens>;

  signUp(input: SignUpInput): Promise<{ session?: string; destination?: string }>;
  confirmSignUp(phone: string, code: string, session?: string): Promise<{ session?: string }>;
  /** Sign in straight after confirming, without asking for the password again. */
  signInAfterSignUp(phone: string, session: string): Promise<AuthStep>;
  resendSignUpCode(phone: string): Promise<{ destination?: string }>;

  forgotPassword(phone: string): Promise<{ destination?: string }>;
  confirmForgotPassword(phone: string, code: string, newPassword: string): Promise<void>;

  startEmailChange(accessToken: string, email: string): Promise<{ destination?: string }>;
  verifyEmail(accessToken: string, code: string): Promise<void>;

  signOut(refreshToken: string | undefined): Promise<void>;

  /** Two-step verification with an authenticator app (optional, offered to staff). */
  mfaEnabled(accessToken: string): Promise<boolean>;
  startMfaSetup(accessToken: string): Promise<{ secret: string }>;
  confirmMfaSetup(accessToken: string, code: string): Promise<void>;
  disableMfa(accessToken: string): Promise<void>;
}

/**
 * Stable, translatable error codes. The browser maps each to copy in both
 * languages (see lib/dict "auth.error.*").
 */
export type AuthErrorCode =
  | "WRONG_CREDENTIALS"
  | "NOT_CONFIRMED"
  | "ACCOUNT_SUSPENDED"
  | "PHONE_TAKEN"
  | "EMAIL_TAKEN"
  | "WEAK_PASSWORD"
  | "WRONG_CODE"
  | "CODE_EXPIRED"
  | "TOO_MANY_ATTEMPTS"
  | "INVALID_PHONE"
  | "INVALID_USERNAME"
  | "USERNAME_REQUIRED"
  | "INVALID_EMAIL"
  | "INVALID_INPUT"
  | "SESSION_EXPIRED"
  | "SMS_UNAVAILABLE"
  | "SERVICE_ERROR";

export class AuthError extends Error {
  code: AuthErrorCode;
  status: number;

  constructor(code: AuthErrorCode, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
