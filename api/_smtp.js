"use strict";

/**
 * A minimal SMTP submission client.
 *
 * The landing page is deployed with no install step (vercel.json sets an empty
 * installCommand), so there are no node_modules at runtime and nodemailer is
 * not an option. SMTP submission is a small, stable line protocol, so the few
 * commands actually needed are implemented here directly against Node's own
 * tls/net modules. Nothing else is required to send a message.
 *
 * Supports both ways a provider offers submission:
 *   port 465 - implicit TLS, encrypted from the first byte
 *   port 587 - plain connection upgraded with STARTTLS before authenticating
 * Credentials are never sent over an unencrypted socket in either case.
 */

const net = require("node:net");
const tls = require("node:tls");

/** Wraps a socket so SMTP replies can be awaited one at a time. */
function reader(socket) {
  let buffer = "";
  let waiting = null;

  const tryResolve = () => {
    if (!waiting) return;
    // A reply is finished when its last COMPLETE line has a space (or nothing)
    // after the status code - "250 Ok". A hyphen there, "250-SIZE", marks a
    // continuation, so a multi-line EHLO must keep being read. Only complete
    // lines count: the tail of the buffer may be half a line still in flight.
    const lines = buffer.split("\n");
    const complete = lines.slice(0, -1);
    const last = complete.length ? complete[complete.length - 1].replace(/\r$/, "") : "";
    const match = /^(\d{3})(?: |$)/.exec(last);
    if (!match) return;

    const { resolve } = waiting;
    const text = buffer;
    waiting = null;
    buffer = "";
    resolve({ code: Number(match[1]), text });
  };

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    tryResolve();
  });

  return {
    /** Resolves with the next complete reply, or rejects on timeout/close. */
    next(timeoutMs = 15000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting = null;
          reject(new Error("The mail server stopped responding."));
        }, timeoutMs);
        waiting = {
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          },
        };
        tryResolve();
      });
    },
  };
}

function connectPlain(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(15000);
    socket.once("connect", () => resolve(socket));
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("Timed out connecting to the mail server."));
    });
    socket.once("error", reject);
  });
}

function connectTls(host, port, socket) {
  return new Promise((resolve, reject) => {
    const opts = { host, servername: host };
    if (socket) opts.socket = socket;
    else opts.port = port;
    const secure = tls.connect(opts);
    secure.setTimeout(15000);
    secure.once("secureConnect", () => resolve(secure));
    secure.once("timeout", () => {
      secure.destroy();
      reject(new Error("Timed out negotiating TLS with the mail server."));
    });
    secure.once("error", reject);
  });
}

/**
 * Send one message.
 *
 * `text` is the body. Header values are expected to be already free of CR/LF -
 * see sanitizeHeader in the handler; injecting a newline into a header is how
 * a contact form gets turned into an open relay for spam.
 */
async function sendMail(config, message) {
  const { host, port, user, pass, secure } = config;
  const useImplicitTls = secure !== undefined ? secure : Number(port) === 465;

  let socket = useImplicitTls
    ? await connectTls(host, Number(port))
    : await connectPlain(host, Number(port));
  let io = reader(socket);

  const say = async (line, expect) => {
    socket.write(line + "\r\n");
    const reply = await io.next();
    if (expect && !expect.includes(reply.code)) {
      throw new Error(`Mail server rejected "${line.split(" ")[0]}": ${reply.text.trim()}`);
    }
    return reply;
  };

  try {
    const greeting = await io.next();
    if (greeting.code !== 220) throw new Error(`Unexpected greeting: ${greeting.text.trim()}`);

    const ehloName = "vifug.com";
    await say(`EHLO ${ehloName}`, [250]);

    if (!useImplicitTls) {
      // Upgrade before authenticating - credentials must never cross a plain
      // socket, so a server that refuses STARTTLS is treated as a failure
      // rather than silently falling back.
      await say("STARTTLS", [220]);
      socket = await connectTls(host, Number(port), socket);
      io = reader(socket);
      await say(`EHLO ${ehloName}`, [250]);
    }

    if (user) {
      await say("AUTH LOGIN", [334]);
      await say(Buffer.from(user, "utf8").toString("base64"), [334]);
      await say(Buffer.from(pass || "", "utf8").toString("base64"), [235]);
    }

    await say(`MAIL FROM:<${message.from}>`, [250]);
    await say(`RCPT TO:<${message.to}>`, [250, 251]);
    await say("DATA", [354]);

    const headers = [
      `From: ${message.fromName ? `"${message.fromName}" ` : ""}<${message.from}>`,
      `To: <${message.to}>`,
      message.replyTo ? `Reply-To: <${message.replyTo}>` : null,
      `Subject: ${message.subject}`,
      `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: 8bit",
    ].filter(Boolean);

    // Dot-stuffing: a line that is just "." would otherwise end the message.
    const body = message.text.replace(/\r\n?|\n/g, "\r\n").replace(/^\./gm, "..");

    socket.write(headers.join("\r\n") + "\r\n\r\n" + body + "\r\n.\r\n");
    const stored = await io.next(20000);
    if (stored.code !== 250) throw new Error(`Message was not accepted: ${stored.text.trim()}`);

    await say("QUIT").catch(() => {});
  } finally {
    socket.destroy();
  }
}

module.exports = { sendMail };
