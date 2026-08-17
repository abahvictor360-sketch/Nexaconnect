"use strict";

/**
 * Contact form endpoint.
 *
 * The landing page is a static site, so it cannot hold SMTP credentials -
 * anything shipped to the browser is public, and a mail password in page
 * source is a mail password on the open internet. This function is the only
 * place the credentials exist, read from environment variables that live in
 * the hosting dashboard and never in the repository.
 *
 * Required environment variables:
 *   SMTP_HOST   smtp.hostinger.com, smtp.gmail.com, …
 *   SMTP_PORT   465 (implicit TLS) or 587 (STARTTLS)
 *   SMTP_USER   the full mailbox address you authenticate as
 *   SMTP_PASS   its password, or an app password where the provider requires one
 *   CONTACT_TO  where submissions should land
 * Optional:
 *   SMTP_FROM   envelope/From address. Defaults to SMTP_USER, which is what
 *               most providers require - sending as an address you have not
 *               authenticated as is normally refused or lands in spam.
 */

const { sendMail } = require("./_smtp");

/** Origins allowed to post here: the Vercel site and the GitHub Pages mirror. */
const ALLOWED_ORIGINS = [
  "https://vifug.com",
  "https://www.vifug.com",
  "https://abahvictor360-sketch.github.io",
];

/**
 * Strip anything that could start a new header line.
 *
 * A contact form that drops a visitor's raw input into a Subject or From is
 * how open relays happen: a newline followed by "Bcc:" turns one message into
 * a thousand. Control characters go too.
 */
function sanitizeHeader(value, max = 200) {
  return String(value || "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254;
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // A contact form has no reason to be large; refuse rather than buffer.
    if (size > 64 * 1024) throw new Error("too large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("bad json");
  }
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });

  let body;
  try {
    body = await readJson(req);
  } catch {
    return res.status(400).json({ error: "Could not read the form data." });
  }

  // Honeypot: a field hidden from people and irresistible to bots. Answer 200
  // so the bot believes it worked and does not come back to try again.
  if (body.website) return res.status(200).json({ ok: true });

  const name = sanitizeHeader(body.name, 100);
  const email = sanitizeHeader(body.email, 254);
  const subject = sanitizeHeader(body.subject, 150) || "Message from the Vifug Lyrics site";
  const message = String(body.message || "").slice(0, 8000).trim();

  if (!name) return res.status(400).json({ error: "Please tell us your name." });
  if (!isEmail(email)) return res.status(400).json({ error: "That email address does not look right." });
  if (message.length < 10) return res.status(400).json({ error: "Please write a little more so we can help." });

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, CONTACT_TO, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !CONTACT_TO) {
    // Deliberately vague to the visitor, specific in the logs: the person
    // filling in the form cannot fix a missing environment variable.
    console.error("[contact] SMTP is not configured - set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and CONTACT_TO.");
    return res.status(503).json({ error: "The contact form is not set up yet. Please email us directly." });
  }

  const from = SMTP_FROM || SMTP_USER;
  const text = [
    `Name:    ${name}`,
    `Email:   ${email}`,
    `Subject: ${subject}`,
    "",
    message,
    "",
    "-- ",
    "Sent from the contact form on vifug.com",
  ].join("\n");

  try {
    await sendMail(
      { host: SMTP_HOST, port: SMTP_PORT, user: SMTP_USER, pass: SMTP_PASS },
      {
        from,
        fromName: "Vifug Lyrics site",
        to: CONTACT_TO,
        // Replying in a mail client goes to the visitor, not to yourself.
        replyTo: email,
        subject: `[Vifug] ${subject}`,
        text,
      },
    );
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[contact] send failed:", err && err.message);
    return res.status(502).json({ error: "We could not send that just now. Please try again, or email us directly." });
  }
};
