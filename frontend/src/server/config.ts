// Server-only configuration. Nothing here is exposed to the browser: none of
// these variables carry the NEXT_PUBLIC_ prefix.

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

const apiUrl = env("CLEAN_AM_API_URL").replace(/\/+$/, "");
const userPoolId = env("COGNITO_USER_POOL_ID");

export const config = {
  apiUrl,
  cognito: {
    // A pool ID starts with its region ("us-east-1_AbC123"), so a mistyped
    // COGNITO_REGION can never send sign-ins to the wrong region.
    region: (/^([a-z]{2}(?:-[a-z]+)+-\d)_/.exec(userPoolId)?.[1] ?? env("COGNITO_REGION")) || "eu-west-1",
    userPoolId,
    clientId: env("COGNITO_CLIENT_ID"),
    /** Local development only. In AWS, use the ARN below instead. */
    clientSecret: env("COGNITO_CLIENT_SECRET"),
    /** CleanAm-Dev-Data output WebClientSecretArn: read at runtime from Secrets Manager. */
    clientSecretArn: env("COGNITO_CLIENT_SECRET_ARN"),
    /** CleanAm-Dev-Data output CognitoDomain, e.g. https://clean-am-dev-123456.auth.eu-west-1.amazoncognito.com */
    domain: env("COGNITO_DOMAIN").replace(/\/+$/, ""),
  },
  /** Set only when Google is configured on the user pool (backend -c googleClientId=...). */
  googleSignIn: env("GOOGLE_SIGN_IN").toLowerCase() === "true",
  secureCookies: process.env.NODE_ENV === "production",
};

export function assertConfig(): void {
  const missing = [
    ["CLEAN_AM_API_URL", config.apiUrl],
    ["COGNITO_USER_POOL_ID", config.cognito.userPoolId],
    ["COGNITO_CLIENT_ID", config.cognito.clientId],
    ["COGNITO_CLIENT_SECRET_ARN (or COGNITO_CLIENT_SECRET)", config.cognito.clientSecretArn || config.cognito.clientSecret],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(`CLEAN-AM is not configured. Missing: ${missing.join(", ")}. See .env.example.`);
  }
}

// ---------------------------------------------------------------------------
// The Cognito app client secret
//
// NFR-SEC-02: credentials live in Secrets Manager. The Next.js server reads
// the secret once per server instance (with Amplify's compute role in AWS, or
// your AWS CLI login locally) and keeps it in memory; only its ARN is
// configuration. When the ARN is set it always wins; a plain
// COGNITO_CLIENT_SECRET is only a fallback for machines without AWS access.
// ---------------------------------------------------------------------------
let secretPromise: Promise<string> | null = null;
let warned = false;

export function clientSecret(): Promise<string> {
  const { clientSecret: plain, clientSecretArn: arn } = config.cognito;
  if (!arn) {
    if (plain && /[\s"']/.test(plain) && !warned) {
      warned = true;
      console.error("[config] COGNITO_CLIENT_SECRET contains spaces or quotes, so it cannot be a Cognito client secret. Paste only the secret itself.");
    }
    if (plain) return Promise.resolve(plain);
  } else if (plain && !warned) {
    warned = true;
    console.warn("[config] COGNITO_CLIENT_SECRET is ignored because COGNITO_CLIENT_SECRET_ARN is set.");
  }
  if (!secretPromise) {
    secretPromise = loadClientSecret().catch((error) => {
      secretPromise = null; // try again on the next request
      console.error(`[config] Could not read the client secret from Secrets Manager (${String(error?.name ?? error)}). ` +
        "Check your AWS login (aws sts get-caller-identity) and COGNITO_CLIENT_SECRET_ARN.");
      throw error;
    });
  }
  return secretPromise;
}

async function loadClientSecret(): Promise<string> {
  const arn = config.cognito.clientSecretArn;
  if (!arn) throw new Error("COGNITO_CLIENT_SECRET_ARN is not set. See .env.example.");
  const { SecretsManagerClient, GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
  // arn:aws:secretsmanager:<region>:<account>:secret:<name>
  const region = arn.split(":")[3] || config.cognito.region;
  const result = await new SecretsManagerClient({ region }).send(new GetSecretValueCommand({ SecretId: arn }));
  const value = (result.SecretString ?? "").trim();
  if (!value) throw new Error("The Cognito client secret in Secrets Manager is empty.");
  return value;
}
