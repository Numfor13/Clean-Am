// Cognito, called directly over its JSON API from the Next.js server.
//
// Why not Amplify in the browser: the backend's app client has a secret
// (backend/stacks/data_stack.py, generate_secret=True), and a secret cannot
// live in a browser. Every call here carries SECRET_HASH, computed on the
// server, and the tokens that come back go straight into httpOnly cookies.
//
// Sign-in uses Cognito's choice-based USER_AUTH flow, which the pool enables
// (AllowedFirstAuthFactors: password and SMS one-time code).

import { createHmac } from "node:crypto";
import { clientSecret, config } from "./config";
import { AuthError, type AuthErrorCode, type AuthProvider, type AuthStep, type SignUpInput } from "./auth-provider";
import type { Tokens } from "./session";

interface CognitoAuthResult {
  IdToken: string;
  AccessToken: string;
  RefreshToken?: string;
  ExpiresIn?: number;
}

interface CognitoAuthResponse {
  AuthenticationResult?: CognitoAuthResult;
  ChallengeName?: string;
  ChallengeParameters?: Record<string, string>;
  Session?: string;
  AvailableChallenges?: string[];
}

class CognitoApiError extends Error {
  type: string;
  constructor(type: string, message: string) {
    super(message);
    this.type = type;
  }
}

function endpoint(): string {
  return `https://cognito-idp.${config.cognito.region}.amazonaws.com/`;
}

async function call<T>(action: string, body: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(endpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new AuthError("SERVICE_ERROR", "The sign-in service could not be reached.", 503);
  }
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const type = String(payload.__type ?? "UnknownError").split("#").pop() ?? "UnknownError";
    const message = String(payload.message ?? payload.Message ?? "Sign-in failed.");
    throw translateError(new CognitoApiError(type, message));
  }
  return payload as T;
}

async function secretHash(username: string): Promise<string> {
  return createHmac("sha256", await clientSecret())
    .update(username + config.cognito.clientId)
    .digest("base64");
}

/** Cognito's error types -> this app's stable codes. */
function translateError(error: CognitoApiError): AuthError {
  const { type, message } = error;
  const map = (code: AuthErrorCode, status = 400) => new AuthError(code, message, status);

  if (type === "UserLambdaValidationException") {
    // "PreSignUp failed with error INVALID_PHONE: Use a Cameroonian number…"
    const match = /error ([A-Z_]+):/.exec(message);
    const code = match?.[1] as AuthErrorCode | undefined;
    const known: AuthErrorCode[] = ["INVALID_PHONE", "INVALID_USERNAME", "USERNAME_REQUIRED", "INVALID_EMAIL"];
    return code && known.includes(code) ? new AuthError(code, message) : map("INVALID_INPUT");
  }
  // Anything that is not a plain wrong password is logged with Cognito's own
  // words, so configuration mistakes show up in the server's terminal.
  const report = () => console.error(`[cognito] ${type}: ${message}`);
  switch (type) {
    case "NotAuthorizedException":
      if (/secret hash|client secret|client.*does not exist/i.test(message)) {
        report();
        // The app client's secret (COGNITO_CLIENT_SECRET or the ARN) does not
        // belong to COGNITO_CLIENT_ID: every sign-in would fail the same way.
        return new AuthError("SERVICE_ERROR", "Sign-in is misconfigured on the server (client secret). See the server log.", 500);
      }
      if (/disabled/i.test(message)) return map("ACCOUNT_SUSPENDED", 403);
      if (/attempts exceeded/i.test(message)) return map("TOO_MANY_ATTEMPTS", 429);
      if (/session/i.test(message)) return map("SESSION_EXPIRED", 401);
      if (!/incorrect username or password/i.test(message)) report();
      return map("WRONG_CREDENTIALS", 401);
    case "ResourceNotFoundException":
      report(); // wrong COGNITO_CLIENT_ID or user pool region
      return new AuthError("SERVICE_ERROR", "Sign-in is misconfigured on the server (app client). See the server log.", 500);
    case "UserNotFoundException":
      return map("WRONG_CREDENTIALS", 401);
    case "UserNotConfirmedException":
      return map("NOT_CONFIRMED", 403);
    case "UsernameExistsException":
      return map("PHONE_TAKEN", 409);
    case "AliasExistsException":
      return map(/email/i.test(message) ? "EMAIL_TAKEN" : "PHONE_TAKEN", 409);
    case "InvalidPasswordException":
      return map("WEAK_PASSWORD");
    case "CodeMismatchException":
    case "EnableSoftwareTokenMFAException":
      return map("WRONG_CODE");
    case "ExpiredCodeException":
      return map("CODE_EXPIRED");
    case "LimitExceededException":
    case "TooManyRequestsException":
    case "TooManyFailedAttemptsException":
      return map("TOO_MANY_ATTEMPTS", 429);
    case "CodeDeliveryFailureException":
    case "InvalidSmsRoleAccessPolicyException":
    case "InvalidSmsRoleTrustRelationshipException":
      return map("SMS_UNAVAILABLE", 503);
    case "InvalidParameterException":
      return map("INVALID_INPUT");
    default:
      report();
      return map("SERVICE_ERROR", 502);
  }
}

function tokensFrom(result: CognitoAuthResult): Tokens {
  return {
    idToken: result.IdToken,
    accessToken: result.AccessToken,
    refreshToken: result.RefreshToken,
    expiresIn: result.ExpiresIn,
  };
}

/** The name Cognito wants in later calls for this user. */
function challengeUser(response: CognitoAuthResponse, fallback: string): string {
  return response.ChallengeParameters?.USERNAME ?? response.ChallengeParameters?.USER_ID_FOR_SRP ?? fallback;
}

async function respond(
  challenge: string,
  username: string,
  session: string,
  answers: Record<string, string>,
): Promise<CognitoAuthResponse> {
  return call<CognitoAuthResponse>("RespondToAuthChallenge", {
    ClientId: config.cognito.clientId,
    ChallengeName: challenge,
    Session: session,
    ChallengeResponses: { USERNAME: username, SECRET_HASH: await secretHash(username), ...answers },
  });
}

function toStep(response: CognitoAuthResponse, username: string): AuthStep {
  if (response.AuthenticationResult) {
    return { kind: "tokens", tokens: tokensFrom(response.AuthenticationResult) };
  }
  const name = response.ChallengeName;
  if ((name === "SMS_OTP" || name === "SMS_MFA" || name === "NEW_PASSWORD_REQUIRED" || name === "SOFTWARE_TOKEN_MFA") && response.Session) {
    return {
      kind: "challenge",
      challenge: name,
      session: response.Session,
      username: challengeUser(response, username),
      destination: response.ChallengeParameters?.CODE_DELIVERY_DESTINATION,
    };
  }
  // Anything else (MFA setup, etc.) is not something this app offers.
  throw new AuthError("SERVICE_ERROR", `Unsupported sign-in step: ${name ?? "none"}`, 502);
}

async function startUserAuth(username: string, preferred: "PASSWORD" | "SMS_OTP", password?: string) {
  const params: Record<string, string> = {
    USERNAME: username,
    SECRET_HASH: await secretHash(username),
    PREFERRED_CHALLENGE: preferred,
  };
  if (password) params.PASSWORD = password;

  let response = await call<CognitoAuthResponse>("InitiateAuth", {
    AuthFlow: "USER_AUTH",
    ClientId: config.cognito.clientId,
    AuthParameters: params,
  });

  // If Cognito asks which factor to use instead of taking the preference,
  // answer it.
  if (response.ChallengeName === "SELECT_CHALLENGE" && response.Session) {
    const user = challengeUser(response, username);
    response = await respond("SELECT_CHALLENGE", user, response.Session, {
      ANSWER: preferred,
      ...(password ? { PASSWORD: password } : {}),
    });
  }
  return toStep(response, username);
}

export const cognitoProvider: AuthProvider = {
  signInWithPassword(identifier, password) {
    return startUserAuth(identifier, "PASSWORD", password);
  },

  startSmsSignIn(phone) {
    return startUserAuth(phone, "SMS_OTP");
  },

  async answerSmsCode(username, session, code, challenge = "SMS_OTP") {
    // SMS_OTP is a sign-in by code; SMS_MFA is a code after the password.
    const answer: Record<string, string> = challenge === "SMS_MFA" ? { SMS_MFA_CODE: code } : { SMS_OTP_CODE: code };
    return toStep(await respond(challenge, username, session, answer), username);
  },

  async answerMfaCode(username, session, code) {
    return toStep(await respond("SOFTWARE_TOKEN_MFA", username, session, { SOFTWARE_TOKEN_MFA_CODE: code }), username);
  },

  async answerNewPassword(username, session, newPassword) {
    return toStep(await respond("NEW_PASSWORD_REQUIRED", username, session, { NEW_PASSWORD: newPassword }), username);
  },

  async refresh(refreshToken, username) {
    const response = await call<CognitoAuthResponse>("InitiateAuth", {
      AuthFlow: "REFRESH_TOKEN_AUTH",
      ClientId: config.cognito.clientId,
      AuthParameters: { REFRESH_TOKEN: refreshToken, SECRET_HASH: await secretHash(username) },
    });
    if (!response.AuthenticationResult) throw new AuthError("SESSION_EXPIRED", "Please sign in again.", 401);
    return tokensFrom(response.AuthenticationResult);
  },

  async signUp(input: SignUpInput) {
    const attributes = [
      { Name: "phone_number", Value: input.phone },
      { Name: "preferred_username", Value: input.username },
      { Name: "custom:language", Value: input.language },
    ];
    if (input.email) attributes.push({ Name: "email", Value: input.email });

    const response = await call<{ Session?: string; CodeDeliveryDetails?: { Destination?: string } }>("SignUp", {
      ClientId: config.cognito.clientId,
      SecretHash: await secretHash(input.phone),
      Username: input.phone,
      Password: input.password,
      UserAttributes: attributes,
    });
    return { session: response.Session, destination: response.CodeDeliveryDetails?.Destination };
  },

  async confirmSignUp(phone, code, session) {
    const response = await call<{ Session?: string }>("ConfirmSignUp", {
      ClientId: config.cognito.clientId,
      SecretHash: await secretHash(phone),
      Username: phone,
      ConfirmationCode: code,
      ...(session ? { Session: session } : {}),
    });
    return { session: response.Session };
  },

  async signInAfterSignUp(phone, session) {
    const response = await call<CognitoAuthResponse>("InitiateAuth", {
      AuthFlow: "USER_AUTH",
      ClientId: config.cognito.clientId,
      Session: session,
      AuthParameters: { USERNAME: phone, SECRET_HASH: await secretHash(phone) },
    });
    return toStep(response, phone);
  },

  async resendSignUpCode(phone) {
    const response = await call<{ CodeDeliveryDetails?: { Destination?: string } }>("ResendConfirmationCode", {
      ClientId: config.cognito.clientId,
      SecretHash: await secretHash(phone),
      Username: phone,
    });
    return { destination: response.CodeDeliveryDetails?.Destination };
  },

  async forgotPassword(phone) {
    const response = await call<{ CodeDeliveryDetails?: { Destination?: string } }>("ForgotPassword", {
      ClientId: config.cognito.clientId,
      SecretHash: await secretHash(phone),
      Username: phone,
    });
    return { destination: response.CodeDeliveryDetails?.Destination };
  },

  async confirmForgotPassword(phone, code, newPassword) {
    await call("ConfirmForgotPassword", {
      ClientId: config.cognito.clientId,
      SecretHash: await secretHash(phone),
      Username: phone,
      ConfirmationCode: code,
      Password: newPassword,
    });
  },

  async startEmailChange(accessToken, email) {
    const response = await call<{ CodeDeliveryDetailsList?: { Destination?: string }[] }>("UpdateUserAttributes", {
      AccessToken: accessToken,
      UserAttributes: [{ Name: "email", Value: email }],
    });
    return { destination: response.CodeDeliveryDetailsList?.[0]?.Destination };
  },

  async verifyEmail(accessToken, code) {
    await call("VerifyUserAttribute", { AccessToken: accessToken, AttributeName: "email", Code: code });
  },

  async mfaEnabled(accessToken) {
    const user = await call<{ UserMFASettingList?: string[] }>("GetUser", { AccessToken: accessToken });
    return (user.UserMFASettingList ?? []).includes("SOFTWARE_TOKEN_MFA");
  },

  async startMfaSetup(accessToken) {
    const result = await call<{ SecretCode: string }>("AssociateSoftwareToken", { AccessToken: accessToken });
    return { secret: result.SecretCode };
  },

  async confirmMfaSetup(accessToken, code) {
    const result = await call<{ Status?: string }>("VerifySoftwareToken", {
      AccessToken: accessToken,
      UserCode: code,
      FriendlyDeviceName: "CLEAN-AM",
    });
    if (result.Status !== "SUCCESS") throw new AuthError("WRONG_CODE", "That code did not match.");
    await call("SetUserMFAPreference", {
      AccessToken: accessToken,
      SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
    });
  },

  async disableMfa(accessToken) {
    await call("SetUserMFAPreference", {
      AccessToken: accessToken,
      SoftwareTokenMfaSettings: { Enabled: false, PreferredMfa: false },
    });
  },

  async signOut(refreshToken) {
    if (!refreshToken) return;
    try {
      await call("RevokeToken", {
        Token: refreshToken,
        ClientId: config.cognito.clientId,
        ClientSecret: await clientSecret(),
      });
    } catch {
      // Signing out locally still succeeds; the token expires on its own.
    }
  },
};
