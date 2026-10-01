# CLEAN-AM frontend

The web app for CLEAN-AM: the public site, guest and citizen reporting (phone
first), the council crew workspace and the admin console. Next.js 15 (App
Router, server-side rendering), deployed on AWS Amplify Hosting.

| Who | Screens | Layout |
|---|---|---|
| Everyone | Landing, sign in (phone, SMS code or Google), register, SMS code, forgot / reset password, offline | Phone and desktop |
| Guest (no account) | Guest home, report waste, report submitted | Phone first |
| Citizen | Home, report waste, report submitted, my reports, report detail, profile, suspended | Phone only |
| Employee | All reports, report detail, flag a report, first sign-in, sign-in security (two-step verification) | Phone and desktop |
| Admin | Employees, create employee, flagged citizens (plus the crew workspace) | Desktop |

## Run it on your computer

Needs Node.js 20.9 or newer.

The app always talks to the deployed backend, so deploy that first
(`backend/README.md`).

```bash
cd frontend
npm install
cp .env.example .env.local     # then fill it in (below)
npm run dev                    # http://localhost:3000
```

After `cdk deploy`, copy these stack outputs into `.env.local`:

| Variable | From |
|---|---|
| `CLEAN_AM_API_URL` | `CleanAm-Dev-Api` output `ApiUrl` |
| `COGNITO_USER_POOL_ID` | `CleanAm-Dev-Data` output `UserPoolId` (its prefix is the region) |
| `COGNITO_CLIENT_ID` | `CleanAm-Dev-Data` output `UserPoolClientId` |
| `COGNITO_CLIENT_SECRET_ARN` | `CleanAm-Dev-Data` output `WebClientSecretArn`; read with your AWS CLI login |
| `COGNITO_DOMAIN` | `CleanAm-Dev-Data` output `CognitoDomain` |
| `GOOGLE_SIGN_IN` | `true` once the backend has Google set up (backend README) |

If a setting is missing, sign-in and the API answer with an error and the
`npm run dev` terminal names what is missing. Cognito problems (for example a
client secret that belongs to another app client) are printed there as
`[cognito] ...`.

`http://localhost:3000` is already allowed by the API's CORS rules and the
Cognito callback URLs for non-prod stages.

## How it talks to AWS

```
Browser ──> Next.js server ──> Cognito (sign-in, sign-up, SMS codes)
                 │         └─> API Gateway ──> Lambda ──> DynamoDB
                 │
Browser ──────────────────────> S3 (the photo itself, on a 5-minute presigned URL)
```

- **The browser never holds a token.** The Cognito app client has a secret, so
  every Cognito call is made by the Next.js server (`src/server/cognito.ts`),
  and the ID, access and refresh tokens go into httpOnly cookies. Page scripts
  call `/api/backend/...`, a proxy that attaches the token server-side and
  refreshes it when it has expired.
- **The client secret lives in Secrets Manager** (SRS NFR-SEC-02). The backend's
  data stack copies it into a secret; the server reads it once at runtime using
  `COGNITO_CLIENT_SECRET_ARN` (locally, with your AWS CLI login). A plain
  `COGNITO_CLIENT_SECRET` is only a fallback when no ARN is set.
- **Google sign-in** is Cognito's hosted OAuth flow with PKCE:
  `/api/auth/google` sends the browser to Cognito (straight on to Google),
  Cognito returns to `/api/auth/google/callback`, and the server swaps the
  code for tokens using the client secret. The tokens end up in the same
  httpOnly cookies as a password sign-in.
- **Two-step verification** is optional and offered to staff only
  (`/staff/security`). Setting it up shows a QR code and a setup key for an
  authenticator app; after that, sign-in asks for the app's code after the
  password.
- **Guests** get a signed guest token from `/guest/session`, kept in an
  httpOnly cookie for a year. When that browser signs in to a citizen account,
  its guest reports are moved into the account automatically
  (`/me/claim-guest-reports`) and the guest cookie is dropped.
- **Photos** are resized in the browser (max 1600 px, JPEG) before upload, so
  a report costs a few hundred KB on a mobile connection, then PUT straight to
  S3. Only the S3 key goes to the API.
- **Maps** are OpenStreetMap tiles through Leaflet: no API key. If location is
  off, people tap the map or drag the pin instead.
- Every state-changing request carries an `X-CAM-CSRF` header that a
  cross-site form cannot send; the proxy rejects requests without it.
- Route guards in `src/middleware.ts` only decide which screens to show. The
  API checks the token on every request, so a tampered cookie can never read
  someone else's data.

## Deploy on AWS Amplify Hosting

1. Push the repository (with `frontend/` and `backend/`) to GitHub, and commit
   the `package-lock.json` that `npm install` created.
2. Amplify console → **Create new app** → GitHub → pick the repo and branch.
   Tick **My app is a monorepo** and set the root directory to `frontend`.
   Amplify reads `frontend/amplify.yml`.
3. **Environment variables** (App settings): `AMPLIFY_MONOREPO_APP_ROOT=frontend`,
   `CLEAN_AM_API_URL`, `COGNITO_REGION`, `COGNITO_USER_POOL_ID`,
   `COGNITO_CLIENT_ID`, and `COGNITO_CLIENT_SECRET_ARN` (`CleanAm-Dev-Data` output
   `WebClientSecretArn`). Do **not** add `COGNITO_CLIENT_SECRET` here. For
   Google sign-in also `COGNITO_DOMAIN` and `GOOGLE_SIGN_IN=true`.
4. **Compute role** (App settings → IAM roles): give the app a role that can
   read the secret:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": "secretsmanager:GetSecretValue",
       "Resource": "<WebClientSecretArn>"
     }]
   }
   ```

5. Deploy, then redeploy the backend with the site's address so CORS, the
   Cognito callback URLs and the links in emails point at it:

   ```bash
   cdk deploy --all -c frontendUrl=https://main.xxxxxx.amplifyapp.com
   ```

Amplify only exposes environment variables to the Next.js server at runtime
if they are written into `.env.production` during the build; `amplify.yml`
does that for the `CLEAN_AM_*`, `COGNITO_*` (except the secret) and
`GOOGLE_SIGN_IN` variables only.

## Install as an app (phones and computers)

The site is an installable web app (PWA), so there is nothing to publish in
an app store and one codebase serves both. People choose: keep using it in
the browser, or install it and it opens full screen from the home screen.

- **Android, Chrome, Edge:** the home screens show an **Install the app**
  card (staff find it in the user menu). The browser's own menu has
  "Install app" / "Add to Home screen" too.
- **iPhone / iPad:** Safari has no install button for sites to trigger, so
  the card explains: Share → "Add to Home Screen".
- The installed app opens at `/app`, which sends each person to their own
  home (citizen home, crew reports, admin console).
- `public/sw.js`, the service worker, shows `/offline` when there is no
  connection and keeps build files and images for faster starts. It never
  stores pages or API answers, so no one's reports stay on a shared phone.
  It only runs in production builds (`npm run build && npm start`).
- Installing needs HTTPS (Amplify provides it) or `localhost`.
- Icons are in `public/icons`; the manifest is `src/app/manifest.ts`.

## Project layout

```
src/
  app/            routes (thin: each page renders a screen)
    api/auth/       sign-in, sign-up, codes, passwords, two-step setup,
                    Google sign-in, sign-out (server)
    api/backend/    proxy to API Gateway (server)
    api/guest/      guest identity (server)
    styles/         tokens.css (design tokens), base, components, shell, pages
  screens/        one file per area: Landing, Auth, Home, SubmitReport,
                  Citizen, Staff, Admin
  components/     shared UI: forms, report cards, map, shells, icons,
                  install-the-app and offline (pwa.tsx)
  lib/            browser-safe code: API client, i18n, formatting, types
    dict/           every string in English and French
  server/         server-only: config, Cognito, Google OAuth, session cookies, proxy
  middleware.ts   sends each role to its part of the app
```

## Languages

Every string is in `src/lib/dict/en.ts` and `fr.ts` (same keys; a missing
French key falls back to English). The choice is kept in a `cam_lang` cookie
and, for signed-in citizens, saved to their profile. French runs 15–60% longer,
so buttons size to their content; check both languages at 360 px wide after
changing a layout.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server on port 3000 |
| `npm run build` | Production build (also type-checks) |
| `npm start` | Serve the production build |
| `npm run typecheck` | TypeScript only |

## Before launch

- Replace the placeholder contact details in `src/lib/site.ts` (footer and
  the suspended screen) with the council's real ones.
- The photos in `public/images` are crops from the design comps. Swap them
  for real photographs of Buea before going public.
- OpenStreetMap's public tile server is fine for a pilot. For heavy traffic,
  switch the tile URL in `src/components/MapView.tsx` to a hosted tile
  provider.
