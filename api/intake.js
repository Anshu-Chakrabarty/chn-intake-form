/**
 * CHN Intake — server-side proxy to the GoHighLevel inbound webhook.
 *
 * WHY THIS EXISTS
 * The browser cannot POST directly to the GHL webhook without hitting a
 * wildcard-CORS block (GHL replies `Access-Control-Allow-Origin: *`, which the
 * browser refuses for the credentialed sendBeacon used by partial capture).
 * The form therefore POSTs to THIS function on the same origin (no CORS), and
 * this function forwards the payload to GHL server-to-server (no CORS at all).
 *
 * It also:
 *   - keeps the real GHL webhook URL out of the page source (server-side only),
 *   - is the place to add validation / rate-limiting for a health form,
 *   - returns proper CORS headers (reflecting the origin, never a bare wildcard)
 *     so the form also works if you later embed it on a DIFFERENT domain and
 *     point it at this proxy's absolute URL.
 *
 * DEPLOY NOTE
 * Set the GHL webhook as an environment variable in Vercel named GHL_WEBHOOK_URL
 * (Project → Settings → Environment Variables). The fallback below lets it work
 * out of the box, but the env var is the clean, rotatable place for it.
 */

const GHL_WEBHOOK_URL =
  process.env.GHL_WEBHOOK_URL ||
  "https://services.leadconnectorhq.com/hooks/5KlfHXZqugsbkXJAvQ9N/webhook-trigger/40f2cd06-1f28-4575-9dcf-014754988a04";

// Reasonable ceiling for a JSON intake payload (~35 fields + free-text notes).
const MAX_BODY_BYTES = 64 * 1024; // 64 KB

function setCors(req, res) {
  const origin = req.headers.origin;
  // Reflect the caller's origin (correct for credentialed requests; a bare "*"
  // is what broke the direct-to-GHL path). Same-origin calls send no Origin.
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// Read the raw request body regardless of how Vercel parsed it. sendBeacon
// sends a Blob (application/json); fetch sends a JSON string. Handle all cases.
function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === "object") return resolve(req.body);
    if (typeof req.body === "string" && req.body.length) {
      try { return resolve(JSON.parse(req.body)); } catch (e) { return reject(new Error("bad_json")); }
    }
    let data = "";
    let tooBig = false;
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY_BYTES) { tooBig = true; req.destroy(); }
    });
    req.on("end", () => {
      if (tooBig) return reject(new Error("too_big"));
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error("bad_json")); }
    });
    req.on("error", () => reject(new Error("stream_error")));
  });
}

function hasContactKey(p) {
  return !!(
    (p.email && String(p.email).trim()) ||
    (p.phone && String(p.phone).trim()) ||
    (p.emergency_contact_phone && String(p.emergency_contact_phone).trim())
  );
}

export default async function handler(req, res) {
  setCors(req, res);

  // Preflight — respond OK so the browser proceeds. (Same-origin skips this.)
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  let payload;
  try {
    payload = await readBody(req);
  } catch (e) {
    const code = e.message === "too_big" ? 413 : 400;
    res.status(code).json({ ok: false, error: e.message });
    return;
  }

  // --- Lightweight server-side validation (add more as compliance requires) ---
  // 1) Honeypot: the form leaves this empty; a filled value means a bot.
  if (payload.chn_company_url) {
    // Silently accept so the bot gets no signal, but forward nothing to GHL.
    res.status(200).json({ ok: true });
    return;
  }
  // 2) Must have something to key a lead on, or there's nothing for GHL to do.
  if (!hasContactKey(payload)) {
    res.status(422).json({ ok: false, error: "no_contact_key" });
    return;
  }
  // 3) Normalise the routing field so the GHL branch logic is never surprised.
  if (payload.submission_status !== "complete") {
    payload.submission_status = "partial";
  }
  // (Place to add: rate-limiting via a KV/Redis store keyed on IP, allow-list of
  //  fields, Turnstile token verification, etc. Serverless is stateless, so
  //  durable rate-limiting needs an external store — see Vercel KV / Upstash.)

  // --- Forward to GHL server-side (no CORS applies to server-to-server) ---
  try {
    const ghlRes = await fetch(GHL_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (ghlRes.ok) {
      res.status(200).json({ ok: true });
    } else {
      const text = await ghlRes.text().catch(() => "");
      res.status(502).json({ ok: false, error: "ghl_rejected", status: ghlRes.status, detail: text.slice(0, 500) });
    }
  } catch (e) {
    res.status(504).json({ ok: false, error: "ghl_unreachable" });
  }
}
