# CLEAN-AM backend

Serverless backend for CLEAN-AM, written with the AWS CDK in Python.

```
backend/
  app.py              CDK entry point: creates the two stacks
  cdk.json            tells the CDK to run app.py
  requirements.txt    aws-cdk-lib, constructs
  stacks/
    data_stack.py     stateful: DynamoDB tables, photo bucket, Cognito, secrets
    api_stack.py      stateless: API Gateway, Lambda functions, email queue, alarms
  src/                the Lambda code (every function gets this folder)
    common.py         shared helpers: responses, caller identity, tokens, validation
    ...one file per function, listed below
```

## Two stacks

Following the AWS CDK best-practice of separating stateful from stateless
resources:

| Stack | Holds | Safe to destroy? |
|---|---|---|
| `CleanAm-<Stage>-Data` | 6 tables, photo bucket, Cognito user pool (with its sign-in domain and optional Google sign-in), guest-token and client secrets, first admin | No (in prod its data is retained) |
| `CleanAm-<Stage>-Api` | REST API, 11 functions, notification queue + dead-letter queue, alarms | Yes: redeploy any time |

## Functions (one per box in the architecture diagram)

| File | Routes | Who |
|---|---|---|
| `presign_upload.py` | `POST /uploads/presign`, `POST /guest/uploads/presign` | citizen, guest |
| `report_submit.py` | `POST /reports`, `POST /guest/reports`, `POST /me/claim-guest-reports` | citizen, guest |
| `report_list.py` | `GET /reports`, `GET /reports/me` | staff, citizen |
| `report_detail.py` | `GET /reports/{report_id}` | staff, owner |
| `report_status_update.py` | `PATCH /reports/{report_id}/status` | staff |
| `flag_citizen.py` | `POST /reports/{report_id}/flag`, `GET /citizens/flagged`, `GET /citizens/{id}`, `POST /citizens/{id}/suspend`, `POST /citizens/{id}/reinstate` | staff; citizen routes admin only |
| `employee_admin.py` | `POST/GET /employees`, `GET/DELETE /employees/{employee_id}` | admin |
| `public_info.py` | `GET /public/stats`, `POST /guest/session`, `GET/PATCH /me` | anyone / signed in |
| `notification_sender.py` | reads the SQS queue, sends SES email | — |
| `guest_authorizer.py` | checks `Authorization: Guest <token>` on `/guest/*` | — |
| `cognito_triggers.py` | Cognito's pre-sign-up, custom-message, post-confirmation and pre-token-generation triggers | — |

Staff means Employee or Admin (an Admin can do everything an Employee can).

## How a request flows

1. The Next.js server calls the API with the user's Cognito ID token (or a
   guest token on `/guest/*`). The browser never calls the API directly.
2. API Gateway checks the token (Cognito authorizer, or `guest_authorizer`)
   before any function runs.
3. The function reads who is calling from `requestContext.authorizer`, never
   from the request body, applies the rules, and returns JSON.
4. Slow work (email) goes on the SQS queue; `notification_sender` sends it and
   retries failures. After 3 failures a message goes to the dead-letter queue,
   which has an alarm.

Photos never pass through the API: `presign_upload` returns a 5-minute S3
upload link, and views use 1-hour download links.

## Rules worth knowing

- **Sign-in:** citizens use their +237 phone number (SMS code to confirm);
  email is optional. Citizens can also use **Continue with Google** when it is
  switched on (below); a Google account always becomes a citizen. Staff sign
  in with email. Passwords: 8+ characters with upper, lower, digit and symbol.
- **Two-step verification (staff, optional):** each employee or admin can
  turn on an authenticator app (Google Authenticator, Microsoft
  Authenticator...) from **Security** in the app. The pool's MFA is
  `OPTIONAL`, so no one is forced. Cognito also keeps SMS allowed as a second
  factor (a pool with SMS sign-in codes requires it), but the app only ever
  switches on authenticator codes; if an SMS second step ever appears, the
  sign-in screens handle it.
- **Reports:** photo, location (inside Cameroon) and quarter are required.
  Citizens can send 5 reports per 10 minutes, guests 3 per hour. A second open
  report within 50 m in 24 h needs `confirm_duplicate: true`.
- **Status:** Pending → In Progress → Done (Done can reopen to In Progress).
  Two crew members cannot change the same report at once.
- **Flags:** at 5 flags a citizen becomes eligible for suspension, which an
  admin decides; a guest is blocked automatically. When a guest registers,
  their reports and flags move into the new account.
- **Email:** status updates only go to a verified email; phone-only citizens
  follow their reports in the app. Staff invitations are sent by Cognito.

## Deploy

```bash
python -m venv venv
venv\Scripts\activate          # Windows (source venv/bin/activate elsewhere)
pip install -r requirements.txt
cdk bootstrap                  # once per account and region
cdk deploy --all -c seedAdminEmail=you@example.com -c sesSenderEmail=you@example.com
```

Options (`-c name=value`): `stage` (default `dev`), `frontendUrl` (default
`http://localhost:3000`), `seedAdminEmail`, `seedAdminName`, `sesSenderEmail`,
`resendAdminInvite` (below),
and for Google sign-in `googleClientId`, `googleSecretArn` and optionally
`cognitoDomainPrefix`.

**New temporary password for the first admin.** Cognito emails one when the
Data stack is first created. For another (lost email, or the 7 days ran out),
deploy with a new word each time:

```bash
cdk deploy --all -c seedAdminEmail=you@example.com -c resendAdminInvite=again1
```

Cognito only resends while the admin has not yet chosen their own password.
After that, use **Forgot your password?** in staff sign-in.

Copy the outputs into the frontend's `.env.local`: `ApiUrl` from the Api stack;
`UserPoolId`, `UserPoolClientId`, `WebClientSecretArn` and `CognitoDomain`
from the Data stack.

The Data stack also creates a Cognito sign-in domain,
`clean-am-<stage>-<last 6 digits of your account>`. Domain prefixes are
unique across AWS, so if that one is taken pass `-c cognitoDomainPrefix=...`.

### Google sign-in (optional)

1. [Google Cloud console](https://console.cloud.google.com/) → APIs & Services
   → OAuth consent screen: set it up (External, app name CLEAN-AM).
2. Credentials → Create credentials → OAuth client ID → Web application.
   Authorised redirect URI: the `CognitoDomain` output followed by
   `/oauth2/idpresponse`, e.g.
   `https://clean-am-dev-123456.auth.eu-west-1.amazoncognito.com/oauth2/idpresponse`
   (deploy once without Google to get it).
3. Keep the client secret in Secrets Manager, never in code: Secrets Manager
   console → **Store a new secret** → *Other type of secret* → key
   `client_secret`, value the Google client secret → name it
   `clean-am/dev/google-oauth`. Copy the secret's ARN.
4. Deploy with the client ID and that ARN (one line):

   ```bash
   cdk deploy --all -c googleClientId=1234-abc.apps.googleusercontent.com -c googleSecretArn=arn:aws:secretsmanager:eu-west-1:123456789012:secret:clean-am/dev/google-oauth-AbCdEf
   ```

5. In the frontend set `COGNITO_DOMAIN` and `GOOGLE_SIGN_IN=true`.

Pass the same two `-c` values on every later deploy (or add them to the
`context` block in `cdk.json`; neither is a secret), or Google is switched
off again. The app client's callback URL is
`<frontendUrl>/api/auth/google/callback` (plus `http://localhost:3000/...`
outside prod).

**Coming from the earlier five-stack version?** Delete the old stacks first,
newest first (each waits for the one before). Two of them share names with the
new stacks, so deploying on top of them would fail:

```bash
for s in Api Notifications Auth Storage Data; do
  aws cloudformation delete-stack --stack-name CleanAm-Dev-$s
  aws cloudformation wait stack-delete-complete --stack-name CleanAm-Dev-$s
done
```

(Or delete them in that order in the CloudFormation console.) Then deploy.

## Before go-live

1. **SNS SMS:** leave the SMS sandbox, raise the monthly spend limit (it
   starts at USD 1), and confirm delivery to Cameroon (+237). Until then only
   sandbox-verified phones receive codes.
2. **SES:** verify the sender address and request production access. Until
   then email only reaches verified addresses.
3. **Cognito email:** staff invitations use Cognito's built-in sender, limited
   to 50 emails a day. For more, configure the user pool to send through SES.
4. Deploy with `-c stage=prod -c frontendUrl=https://your-site`. In prod,
   tables, the bucket and the user pool are kept if a stack is deleted.
5. **Google:** publish the OAuth consent screen (while it is "Testing" only
   listed test users can sign in) and add the prod `CognitoDomain` redirect
   URI to the Google client.
6. **Lost authenticator:** an admin switches a staff member's two-step
   verification off with
   `aws cognito-idp admin-set-user-mfa-preference --user-pool-id <UserPoolId> --username <their email> --software-token-mfa-settings Enabled=false,PreferredMfa=false`.
