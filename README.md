# CHN Intake — Vercel deployment (with server-side proxy)

This folder is a complete, deployable project:

```
chn-intake-vercel/
  index.html        the intake form (served at your domain root)
  api/
    intake.js       serverless proxy that forwards to the GHL webhook
  README.md         this file
```

The form POSTs to `/api/intake` on the same origin (no CORS). That function
forwards the payload to GoHighLevel server-side and keeps the webhook URL hidden.

---

## Deploy with the Vercel dashboard (no command line)

1. Put this whole folder in a **GitHub repo** (or drag-and-drop deploy — see below).
2. Go to https://vercel.com → **Add New → Project** → import the repo.
3. Framework preset: **Other**. Leave build/output settings empty (it's a static
   site plus serverless functions — no build step).
4. Before deploying, open **Environment Variables** and add:
   - Name: `GHL_WEBHOOK_URL`
   - Value: your GHL inbound webhook URL
   (Optional but recommended — the function has a fallback, but the env var is the
   clean place to store/rotate it.)
5. Click **Deploy**. When it finishes you'll get a URL like
   `https://chn-intake.vercel.app` — that's your live form.

### Drag-and-drop alternative (no GitHub)
Install the CLI once: `npm i -g vercel`, then from inside this folder run
`vercel` and follow the prompts. Run `vercel --prod` to promote to production.
Add the env var afterward in the dashboard, then redeploy.

---

## Test after deploy

1. Open your Vercel URL, fill the form with **fake data**, submit.
2. In GHL → **Execution logs**, confirm a `complete` run down the Complete branch.
3. Test a **partial**: type an email, then close the tab. A `partial` contact
   should appear (this now works because the beacon goes to your same-origin
   proxy, not to GHL directly).
4. Re-submit the same email → confirm the contact is **updated**, not duplicated.

## Notes
- The real GHL webhook URL is only in `api/intake.js` / the env var. It never
  appears in the page source.
- `api/intake.js` is where to add stronger validation, Turnstile verification,
  or rate-limiting for a health form (rate-limiting needs an external store such
  as Vercel KV / Upstash, since serverless functions are stateless).
- If you later embed the form on the CHN WordPress site instead of hosting the
  page here, change `GHL_INBOUND_WEBHOOK_URL` in the form from `/api/intake` to
  the **absolute** URL of this proxy (e.g. `https://chn-intake.vercel.app/api/intake`).
  The proxy already returns origin-reflected CORS headers to support that.
