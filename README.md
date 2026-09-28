This repository contains the Nexora Next.js workspace and a guarded FastAPI AI service.

## AI service

The API lives in `backend/` and exposes `GET /health` plus authenticated `POST /v1/chat`. It validates Supabase sessions, reserves usage atomically in Postgres, enforces per-user request and daily-token limits, and applies a global monthly spending ceiling. Groq is the primary provider and Gemini is the fallback; both are optional at deploy time.

The default controls are 10 requests per minute per user, 50,000 tokens per user per UTC day, a $25 monthly global ceiling, a 30-second provider timeout, and one retry before fallback. Configure them with the variables documented in `.env.example`.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
