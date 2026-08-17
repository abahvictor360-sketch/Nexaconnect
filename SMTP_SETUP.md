# Receiving contact form email

Setup notes for whoever runs the site. Not published: `vercel.json` serves
`docs/` as the website, and this file lives outside it deliberately.

The contact form on the home page posts to `/api/contact`, a server function
that relays the message to you over SMTP. Nothing works until the five
environment variables below are set.

## Why the credentials cannot go in the page

The site is static. Everything it contains is downloaded by every visitor and
readable by all of them, so a mailbox password placed in the page is a mailbox
password published on the internet - and within days it is sending spam in your
name.

The password therefore exists only in the function's environment, entered once
in the hosting dashboard. It is not in the repository, not in the page, and not
in anything a visitor receives.

> **Never commit these values.** Not to `.env` in the repo, not to
> `vercel.json`, not anywhere under `docs/`. If one is ever committed, change it
> at your mail provider - deleting the commit does not un-publish it.

## The five values

All come from the mailbox you want to send *as*. Easiest is a dedicated
`noreply@vifug.com`, or your existing `contact@vifug.com`.

| Variable | What it is |
| --- | --- |
| `SMTP_HOST` | Outgoing mail server, e.g. `smtp.hostinger.com` |
| `SMTP_PORT` | `465` for TLS, or `587` for STARTTLS. Both work; 465 is simpler. |
| `SMTP_USER` | The full mailbox address you sign in with |
| `SMTP_PASS` | Its password. On Gmail and Outlook this must be an **app password**. |
| `CONTACT_TO` | Where submissions land. Any address, including a personal Gmail. |

Optional: `SMTP_FROM`. Leave it unset unless you know you need it - it defaults
to `SMTP_USER`, and nearly every provider refuses to send as an address you have
not authenticated as.

## Provider settings

| Provider | Host | Port | Password |
| --- | --- | --- | --- |
| Hostinger | `smtp.hostinger.com` | 465 | Mailbox password from hPanel |
| Gmail / Workspace | `smtp.gmail.com` | 465 | [App password](https://myaccount.google.com/apppasswords) (needs 2-step verification) |
| Zoho Mail | `smtp.zoho.com` | 465 | App-specific password |
| Outlook / M365 | `smtp.office365.com` | 587 | App password |
| Namecheap Private Email | `mail.privateemail.com` | 465 | Mailbox password |

Gmail and Outlook both stopped accepting ordinary account passwords over SMTP.
"Username and Password not accepted" or "authentication unsuccessful" is almost
always this - generate an app password and use it as `SMTP_PASS`.

Since vifug.com is on Hostinger, `smtp.hostinger.com` on port 465 with the
mailbox password is most likely what you want.

## Setting them on Vercel

1. Dashboard → the Vifug Lyrics project → **Settings → Environment Variables**.
2. Add the five names above with their values. Tick **Production** (and
   **Preview** if you want the form live on preview deployments too).
3. **Redeploy.** Environment variables are read at build time, so an existing
   deployment will not pick them up. Deployments → the latest one → **Redeploy**.
4. Test: open the home page, scroll to **Get in touch**, submit the form. It
   should arrive at `CONTACT_TO` within seconds, with the visitor's address as
   the reply-to - so hitting Reply answers them, not yourself.

### Testing locally

```bash
npm i -g vercel
vercel env pull .env.local   # gitignored - never commit it
vercel dev
```

Then use the form at `http://localhost:3000`.

## If the site moves off Vercel

`api/contact.js` is a plain Node handler with no dependencies, so it ports
easily - put the same five values in the new host's environment settings and
point the form at the function's URL.

It cannot work on GitHub Pages at all: Pages serves static files only, and can
neither run server code nor hold a secret. That is why the form detects the
Pages mirror and posts to `vifug.com` instead, which the function allows by
origin.

## When it does not work

- **"The contact form is not set up yet"** — `SMTP_HOST`, `SMTP_PORT` or
  `CONTACT_TO` is missing, or the deployment predates them. Redeploy.
- **"We could not send that just now"** — the server was reached, the mail
  provider refused. The exact reason is in the function logs in the Vercel
  dashboard, deliberately not shown to visitors.
- **Authentication fails** — use an app password on Gmail/Outlook/Zoho, and
  check `SMTP_USER` is the full address, not just the part before the `@`.
- **Nothing arrives, no error** — check spam, then confirm `SMTP_FROM` is either
  unset or on a domain you control. Mail claiming to be from a domain you do not
  own is usually discarded silently.
- **Timeouts** — some hosts block outbound port 25. 465 and 587 are normally
  fine; if 587 hangs, try 465.

## Spam

The form carries a hidden field that people never see and bots usually fill in;
anything that fills it gets a success response and is discarded. That handles
most of it. Add a rate limit or captcha in front of the function only if a
determined sender actually becomes a problem.

## The moving parts

- `api/contact.js` — validates input, strips CR/LF from header fields (an
  unescaped newline in a Subject is how a contact form becomes an open relay),
  and hands off to the SMTP client.
- `api/_smtp.js` — a minimal SMTP submission client written against Node's own
  `net`/`tls`. The site deploys with an empty `installCommand`, so there are no
  `node_modules` at runtime and nodemailer is not an option. Handles implicit
  TLS (465) and STARTTLS (587), and refuses to authenticate over a plain socket.
- The form markup and submit handler live in `docs/index.html`, in the
  `#contact` section.
