// Checks the sign-in chain against the real Cognito user pool, one link at a time.
// Run from the frontend folder:   node scripts/check-signin.mjs you@example.com
// Then, to follow a real sign-in:  node scripts/check-signin.mjs you@example.com --real
//
// It reads .env.local, uses your AWS CLI login, and never prints a secret or a
// password. The sign-in test uses a deliberately wrong password: Cognito then
// answers "Incorrect username or password" if everything else is right, or
// names the part that is wrong.

import { createHmac } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const email = (process.argv.slice(2).find((a) => a.includes("@")) ?? "").trim().toLowerCase();
if (!email.includes("@")) {
  console.log("Usage: node scripts/check-signin.mjs you@example.com");
  process.exit(1);
}

// --- .env.local (same rules as Next.js: later lines win, quotes removed) ----
const env = {};
for (const raw of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const key = line.slice(0, line.indexOf("=")).trim();
  let value = line.slice(line.indexOf("=") + 1).trim();
  if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
  env[key] = value;
}
const poolId = env.COGNITO_USER_POOL_ID ?? "";
const clientId = env.COGNITO_CLIENT_ID ?? "";
const arn = env.COGNITO_CLIENT_SECRET_ARN ?? "";
const region = poolId.split("_")[0];
const ok = (text) => console.log(`  OK    ${text}`);
const bad = (text) => console.log(`  WRONG ${text}`);
const info = (text) => console.log(`        ${text}`);

console.log(`\nUser pool ${poolId || "(missing)"}, app client ${clientId || "(missing)"}, region ${region || "(missing)"}\n`);
if (!poolId || !clientId) process.exit(1);

const aws = (args) => execSync(`aws ${args} --region ${region} --output text`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const hash = (secret, username) => createHmac("sha256", secret).update(username + clientId).digest("base64");

// --- 1. The app client and its real secret -----------------------------------
let realSecret = "";
try {
  realSecret = aws(`cognito-idp describe-user-pool-client --user-pool-id ${poolId} --client-id ${clientId} --query UserPoolClient.ClientSecret`);
  if (!realSecret || realSecret === "None") bad("1. This app client has no secret (the backend expects one).");
  else ok("1. The app client exists in the pool and has a secret.");
} catch (error) {
  bad(`1. Could not read the app client: ${String(error.stderr || error.message).trim().split("\n").pop()}`);
  process.exit(1);
}

// --- 2. The secret the app actually uses (Secrets Manager) -------------------
let appSecret = "";
if (arn) {
  try {
    const { SecretsManagerClient, GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
    const out = await new SecretsManagerClient({ region: arn.split(":")[3] }).send(new GetSecretValueCommand({ SecretId: arn }));
    appSecret = (out.SecretString ?? "").trim();
    if (appSecret === realSecret) ok("2. The secret in Secrets Manager matches the app client.");
    else bad(`2. The secret in Secrets Manager is NOT this app client's secret (lengths ${appSecret.length} vs ${realSecret.length}).`);
  } catch (error) {
    bad(`2. Could not read COGNITO_CLIENT_SECRET_ARN from Secrets Manager: ${error.name}: ${error.message}`);
  }
} else {
  const plain = env.COGNITO_CLIENT_SECRET ?? "";
  appSecret = plain;
  if (plain === realSecret) ok("2. COGNITO_CLIENT_SECRET matches the app client.");
  else bad("2. No COGNITO_CLIENT_SECRET_ARN, and COGNITO_CLIENT_SECRET does not match the app client.");
}

// --- 3. The user --------------------------------------------------------------
let internal = "";
try {
  internal = aws(`cognito-idp admin-get-user --user-pool-id ${poolId} --username ${email} --query "[Username,UserStatus,Enabled]"`);
  const [name, status, enabled] = internal.split(/\s+/);
  internal = name;
  ok(`3. User found: status ${status}, enabled ${enabled}.`);
  if (status !== "CONFIRMED") info("   Not CONFIRMED yet: the first sign-in asks for a new password.");
  if (enabled !== "True") bad("   The user is disabled.");
} catch (error) {
  bad(`3. No user with that email: ${String(error.stderr || error.message).trim().split("\n").pop()}`);
}

// --- 4. A sign-in with a wrong password, the way the app signs in -------------
async function tryUserAuth(username, secret) {
  const response = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth" },
    body: JSON.stringify({
      AuthFlow: "USER_AUTH",
      ClientId: clientId,
      AuthParameters: { USERNAME: username, SECRET_HASH: hash(secret, username), PREFERRED_CHALLENGE: "PASSWORD", PASSWORD: "Not-the-password-1!" },
    }),
  });
  const body = await response.json().catch(() => ({}));
  return response.ok ? `no error (${body.ChallengeName ?? "tokens"})` : `${String(body.__type).split("#").pop()}: ${body.message}`;
}

const secretForTest = appSecret || realSecret;
const byEmail = await tryUserAuth(email, secretForTest);
const expected = /Incorrect username or password/i.test(byEmail);
(expected ? ok : bad)(`4. Sign-in by email with the app's secret -> ${byEmail}`);
if (!expected && internal && internal !== email) {
  info(`   Same test with the internal username -> ${await tryUserAuth(internal, secretForTest)}`);
}
if (!expected && appSecret && appSecret !== realSecret) {
  info(`   Same test with the app client's real secret -> ${await tryUserAuth(email, realSecret)}`);
}
if (!expected || !process.argv.includes("--real")) {
  console.log(expected
    ? "\nEverything up to the password is right. Next: node scripts/check-signin.mjs " + email + " --real\n"
    : "\nPaste this whole output into the chat.\n");
  process.exit(0);
}

// --- 5. With the real password: what Cognito asks for next (typed, not shown) --
const password = await new Promise((resolve) => {
  process.stdout.write("\n  Type the password (it will not be shown), then Enter: ");
  const stdin = process.stdin;
  let typed = "";
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  stdin.on("data", function onKey(key) {
    for (const ch of key) {
      if (ch === "\r" || ch === "\n") {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.removeListener("data", onKey);
        process.stdout.write("\n");
        return resolve(typed.trim());
      }
      if (ch === "\u0003") process.exit(1);
      if (ch === "\u0008" || ch === "\u007f") typed = typed.slice(0, -1);
      else typed += ch;
    }
  });
});

async function call(action, body) {
  const response = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}` },
    body: JSON.stringify(body),
  });
  const out = await response.json().catch(() => ({}));
  return response.ok ? out : { error: `${String(out.__type).split("#").pop()}: ${out.message}` };
}
const describe = (out) => out.error ? out.error
  : out.AuthenticationResult ? "tokens issued (sign-in complete)"
  : `challenge ${out.ChallengeName}; parameters: ${JSON.stringify(Object.keys(out.ChallengeParameters ?? {}))}` +
    (out.ChallengeParameters?.USERNAME ? ` USERNAME=${out.ChallengeParameters.USERNAME}` : "") +
    (out.ChallengeParameters?.USER_ID_FOR_SRP ? ` USER_ID_FOR_SRP=${out.ChallengeParameters.USER_ID_FOR_SRP}` : "") +
    (out.AvailableChallenges ? `; available: ${out.AvailableChallenges.join(", ")}` : "");

const start = () => call("InitiateAuth", {
  AuthFlow: "USER_AUTH", ClientId: clientId,
  AuthParameters: { USERNAME: email, SECRET_HASH: hash(secretForTest, email), PREFERRED_CHALLENGE: "PASSWORD", PASSWORD: password },
});
const first = await start();
info(`5. Real password, InitiateAuth -> ${describe(first)}`);
if (first.ChallengeName && first.Session) {
  // Answer it the way the app does (username from the challenge, else the email),
  // then with the internal username, to see which one Cognito accepts.
  for (const [label, user] of [["email", first.ChallengeParameters?.USERNAME ?? first.ChallengeParameters?.USER_ID_FOR_SRP ?? email], ["internal username", internal]]) {
    if (!user) continue;
    const fresh = label === "email" ? first : await start();
    if (!fresh.Session) continue;
    const answers = fresh.ChallengeName === "SELECT_CHALLENGE" ? { ANSWER: "PASSWORD", PASSWORD: password }
      : fresh.ChallengeName === "PASSWORD" ? { PASSWORD: password } : null;
    if (!answers) { info(`   (not answering ${fresh.ChallengeName} automatically)`); break; }
    const next = await call("RespondToAuthChallenge", {
      ClientId: clientId, ChallengeName: fresh.ChallengeName, Session: fresh.Session,
      ChallengeResponses: { USERNAME: user, SECRET_HASH: hash(secretForTest, user), ...answers },
    });
    info(`   Answered with USERNAME=${label === "email" ? user : "internal (" + user + ")"} -> ${describe(next)}`);
  }
}
console.log("\nPaste this whole output into the chat.\n");
