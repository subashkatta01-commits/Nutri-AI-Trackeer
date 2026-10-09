# Nutri-AI-Tracker

An app that analyses the food you eat, reports its carbs, protein, fats and calories,
and suggests what to add to your diet based on your selected fitness category.

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

Meal analysis is handled server-side by `POST /api/analyze-meal`. Two providers are
supported, selected with the `AI_PROVIDER` env var (`groq` is the default):

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

See `.env.example` for the full list. `AI_PROVIDER`, the matching API key, and the
matching model are the only values required to start.
