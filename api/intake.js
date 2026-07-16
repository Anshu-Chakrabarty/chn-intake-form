/**
 * CHN Intake — server-side proxy to the GoHighLevel inbound webhook.
 * (Optional — the form in index.html now emails via FormSubmit directly.)
 */

const GHL_WEBHOOK_URL =
  process.env.GHL_WEBHOOK_URL ||
  "https://services.leadconnectorhq.com/hooks/5KlfHXZqugsbkXJAvQ9N/webhook-trigger/40f2cd06-1f28-4575-9dcf-014754988a04";

const MAX_BODY_BYTES = 64 * 1024;

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

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

  if (payload.chn_company_url) {
    res.status(200).json({ ok: true });
    return;
  }

  if (!hasContactKey(payload)) {
    res.status(422).json({ ok: false, error: "no_contact_key" });
    return;
  }

  if (payload.submission_status !== "complete") {
    payload.submission_status = "partial";
  }

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
