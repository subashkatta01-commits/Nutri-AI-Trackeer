# Nutri-AI-Tracker

An app that analyses the food you eat, reports its carbs, protein, fats and calories,
and suggests what to add to your diet based on your selected fitness category.

## Progress features

The Insights view summarizes recurring macro gaps across logged weekdays and
weekends. Weight Progress can show a 30-day linear-regression forecast with a
95% prediction range after at least three check-ins spanning 14 days.

The Nutrition Coach answers questions using a limited summary of the signed-in
user's recent 30-day meals, nutrition targets, profile preferences, and recent
weight check-ins. That summary is sent to the configured AI provider; the coach
is for general nutrition information, not medical advice.

## Setup

```bash
npm install
cp .env.example .env   # then fill in your API key
npm start
```

The app runs on `http://localhost:3001` by default (override with `PORT`). When the
frontend is served from a separate local origin, the server allows ports 3000 and
5500 on `localhost` and `127.0.0.1`. Set `CORS_ORIGIN` to a comma-separated list
of exact origins to use a different allowlist, for example
`CORS_ORIGIN=http://localhost:5173`.

## AI provider

Meal analysis and the Nutrition Coach are handled server-side using the selected
AI provider (`groq` is the default):

| Provider | Env var | Key | Notes |
| --- | --- | --- | --- |
| Groq | `groq` (default) | `GROQ_API_KEY` | Used with `GROQ_MODEL`; must be a vision-capable model to analyse photos |
| Google Gemini | `gemini` | `GEMINI_API_KEY` | Used with `GEMINI_MODEL` |

An unrecognised `AI_PROVIDER` value is not fatal: the server logs a warning and falls
back to `groq` rather than crashing.

To see which models your Groq key can actually reach:

```bash
curl -H "Authorization: Bearer $GROQ_API_KEY" https://api.groq.com/openai/v1/models
```

If meal photos are rejected or the model list is empty, the account has no
vision-capable model enabled and `GROQ_MODEL` needs to point at one that is.

## Environment variables

See `.env.example` for the full list. `AUTH_SECRET` and the selected AI
provider's API key are required to start; `PORT` and model names are optional.
Signup email verification also requires `BREVO_API_KEY` and `MAIL_FROM_EMAIL`;
the server starts without them, but signup returns a configuration error until
mail delivery is configured.

`AUTH_SECRET` must be a random value of at least 32 bytes. Existing accounts
using the previous SHA-256 password format are upgraded to bcrypt after their
next successful login. Access tokens are signed HS256 tokens that expire
after 12 hours, so users with older numeric tokens must sign in again.

Signup sends a six-digit code that expires after 10 minutes. Email is sent
through Brevo's HTTPS API, so configure `BREVO_API_KEY`, `MAIL_FROM_EMAIL` (a
sender verified in Brevo), and optionally `MAIL_FROM_NAME`. Verification
attempts and resends are rate-limited. Node.js 18 or newer is required for the
built-in `fetch` used to call Brevo.

Login is limited to 10 attempts per IP per 15 minutes and signup to 5 attempts
per IP per hour. In production, set `CORS_ORIGIN` to exact HTTPS origins. The
server rejects plain HTTP and sends HSTS; when TLS terminates at a reverse proxy,
set `TRUST_PROXY=true` so Express can verify the forwarded HTTPS connection.
