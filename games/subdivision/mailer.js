// Last updated: 19 July 2026
// mailer.js - transactional sender used for account verification/reset codes.
//
// Preferred Railway configuration without outbound SMTP:
//   BREVO_API_KEY, BREVO_FROM
// Optional:
//   EMAIL_REPLY_TO, MAIL_PROVIDER=brevo
//
// Resend configuration (requires an owned, verified sender domain):
//   RESEND_API_KEY, RESEND_FROM, MAIL_PROVIDER=resend
//
// SMTP fallback:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// Optional:
//   SMTP_SECURE=true, SMTP_STARTTLS=false, MAIL_PROVIDER=smtp.
//
// In local development without a provider, the message is logged. Production
// always rejects an unsent message instead of pretending delivery succeeded.

const net = require('net');
const tls = require('tls');

const BREVO_EMAIL_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const RESEND_EMAIL_ENDPOINT = 'https://api.resend.com/emails';
const MAIL_TIMEOUT_MS = 15000;

function envBool(name, fallback = false) {
  const value = String(process.env[name] || '').trim().toLowerCase();
  if (!value) return fallback;
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function smtpConfig() {
  const host = String(process.env.SMTP_HOST || '').trim();
  if (!host) return null;
  return {
    host,
    port: Number(process.env.SMTP_PORT || (envBool('SMTP_SECURE') ? 465 : 587)),
    secure: envBool('SMTP_SECURE', false),
    starttls: !envBool('SMTP_SECURE', false) && envBool('SMTP_STARTTLS', true),
    user: String(process.env.SMTP_USER || '').trim(),
    pass: String(process.env.SMTP_PASS || ''),
    from: String(process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@james-garden-care.local').trim()
  };
}

function brevoConfig() {
  const apiKey = String(process.env.BREVO_API_KEY || '').trim();
  if (!apiKey) return null;
  return {
    apiKey,
    from: String(process.env.BREVO_FROM || process.env.EMAIL_FROM || '').trim(),
    replyTo: String(process.env.EMAIL_REPLY_TO || '').trim(),
    endpoint: BREVO_EMAIL_ENDPOINT
  };
}

function resendConfig() {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return null;
  return {
    apiKey,
    from: String(process.env.RESEND_FROM || process.env.EMAIL_FROM || '').trim(),
    replyTo: String(process.env.EMAIL_REPLY_TO || '').trim(),
    endpoint: RESEND_EMAIL_ENDPOINT
  };
}

function requestedProvider() {
  const value = String(process.env.MAIL_PROVIDER || '').trim().toLowerCase();
  return ['brevo', 'resend', 'smtp'].includes(value) ? value : '';
}

function providerStatus() {
  const forced = requestedProvider();
  if (forced === 'brevo' || (!forced && process.env.BREVO_API_KEY)) {
    const cfg = brevoConfig();
    return {
      provider: 'brevo',
      configured: !!(cfg?.apiKey && cfg?.from),
      from: cfg?.from || '',
      reason: !cfg?.apiKey ? 'BREVO_API_KEY missing' : (!cfg.from ? 'BREVO_FROM missing' : '')
    };
  }
  if (forced === 'resend' || (!forced && process.env.RESEND_API_KEY)) {
    const cfg = resendConfig();
    return {
      provider: 'resend',
      configured: !!(cfg?.apiKey && cfg?.from),
      from: cfg?.from || '',
      reason: !cfg?.apiKey ? 'RESEND_API_KEY missing' : (!cfg.from ? 'RESEND_FROM missing' : '')
    };
  }
  if (forced === 'smtp' || (!forced && process.env.SMTP_HOST)) {
    const cfg = smtpConfig();
    return {
      provider: 'smtp',
      configured: !!(cfg?.host && cfg?.from),
      from: cfg?.from || '',
      reason: !cfg?.host ? 'SMTP_HOST missing' : ''
    };
  }
  return { provider: 'none', configured: false, from: '', reason: 'no mail provider variables found' };
}

function encodeAddress(value) {
  return String(value || '').replace(/[<>\r\n]/g, '').trim();
}

function envelopeAddress(value) {
  const safe = String(value || '').replace(/[\r\n]/g, '').trim();
  const bracketed = /<([^<>]+)>/.exec(safe);
  return encodeAddress(bracketed ? bracketed[1] : safe);
}

function parsedAddress(value) {
  const safe = String(value || '').replace(/[\r\n]/g, '').trim();
  const bracketed = /^(.*?)\s*<([^<>]+)>$/.exec(safe);
  return {
    name: encodeAddress(bracketed ? bracketed[1] : ''),
    email: envelopeAddress(safe)
  };
}

function dotStuff(text) {
  return String(text || '').replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

function safeIdempotencyKey(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_./:-]/g, '-')
    .slice(0, 256);
}

function resendErrorMessage(status, body) {
  const message = body && typeof body === 'object'
    ? (body.message || body.name || body.error)
    : body;
  return `Resend rejected email (${status})${message ? `: ${String(message).slice(0, 240)}` : ''}`;
}

function brevoErrorMessage(status, body) {
  const message = body && typeof body === 'object'
    ? (body.message || body.code || body.error)
    : body;
  return `Brevo rejected email (${status})${message ? `: ${String(message).slice(0, 240)}` : ''}`;
}

async function sendMailBrevo(cfg, message, fetchImpl = globalThis.fetch) {
  if (!cfg?.apiKey) throw new Error('BREVO_API_KEY is not configured');
  if (!cfg?.from) throw new Error('BREVO_FROM is not configured');
  if (typeof fetchImpl !== 'function') throw new Error('HTTP email transport is unavailable');

  const to = parsedAddress(message?.to);
  const sender = parsedAddress(cfg.from);
  const subject = String(message?.subject || '').replace(/[\r\n]/g, ' ').trim();
  if (!to.email) throw new Error('Email recipient is required');
  if (!sender.email) throw new Error('Email sender is required');
  if (!subject) throw new Error('Email subject is required');

  const payload = {
    sender: { email: sender.email, ...(sender.name ? { name: sender.name } : {}) },
    to: [{ email: to.email, ...(to.name ? { name: to.name } : {}) }],
    subject,
    textContent: String(message.text || '')
  };
  if (message.html) payload.htmlContent = String(message.html);
  const replyTo = parsedAddress(cfg.replyTo);
  if (replyTo.email) payload.replyTo = { email: replyTo.email, ...(replyTo.name ? { name: replyTo.name } : {}) };
  if (Array.isArray(message.tags) && message.tags.length) {
    payload.tags = message.tags.map(tag => {
      if (tag && typeof tag === 'object') return `${tag.name || 'mail'}:${tag.value || ''}`.replace(/[^A-Za-z0-9_.:-]/g, '-');
      return String(tag || '').replace(/[^A-Za-z0-9_.:-]/g, '-');
    }).filter(Boolean);
  }

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MAIL_TIMEOUT_MS);
    try {
      const response = await fetchImpl(cfg.endpoint || BREVO_EMAIL_ENDPOINT, {
        method: 'POST',
        headers: {
          'api-key': cfg.apiKey,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const raw = await response.text();
      let body = raw;
      try { body = raw ? JSON.parse(raw) : {}; } catch {}
      if (response.ok && body?.messageId) {
        return { ok: true, dev: false, provider: 'brevo', id: body.messageId };
      }
      const error = new Error(response.ok
        ? 'Brevo returned an invalid delivery response'
        : brevoErrorMessage(response.status, body));
      if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, 250));
        continue;
      }
      throw error;
    } catch (error) {
      lastError = error?.name === 'AbortError' ? new Error('Brevo request timed out') : error;
      if (attempt === 0 && (error?.name === 'AbortError' || error instanceof TypeError)) {
        await new Promise(resolve => setTimeout(resolve, 250));
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error('Brevo delivery failed');
}

async function sendMailResend(cfg, message, fetchImpl = globalThis.fetch) {
  if (!cfg?.apiKey) throw new Error('RESEND_API_KEY is not configured');
  if (!cfg?.from) throw new Error('RESEND_FROM is not configured');
  if (typeof fetchImpl !== 'function') throw new Error('HTTP email transport is unavailable');

  const to = String(message?.to || '').trim();
  const subject = String(message?.subject || '').replace(/[\r\n]/g, ' ').trim();
  if (!to) throw new Error('Email recipient is required');
  if (!subject) throw new Error('Email subject is required');

  const payload = {
    from: cfg.from,
    to: [to],
    subject,
    text: String(message.text || '')
  };
  if (message.html) payload.html = String(message.html);
  if (cfg.replyTo) payload.reply_to = cfg.replyTo;
  if (Array.isArray(message.tags) && message.tags.length) payload.tags = message.tags;

  const idempotencyKey = safeIdempotencyKey(message.idempotencyKey);
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MAIL_TIMEOUT_MS);
    try {
      const response = await fetchImpl(cfg.endpoint || RESEND_EMAIL_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const raw = await response.text();
      let body = raw;
      try { body = raw ? JSON.parse(raw) : {}; } catch {}
      if (response.ok && body?.id) {
        return { ok: true, dev: false, provider: 'resend', id: body.id };
      }
      const error = new Error(response.ok
        ? 'Resend returned an invalid delivery response'
        : resendErrorMessage(response.status, body));
      if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, 250));
        continue;
      }
      throw error;
    } catch (error) {
      lastError = error?.name === 'AbortError' ? new Error('Resend request timed out') : error;
      if (attempt === 0 && (error?.name === 'AbortError' || error instanceof TypeError)) {
        await new Promise(resolve => setTimeout(resolve, 250));
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error('Resend delivery failed');
}

function createReader(socket) {
  let buffer = '';
  const waiters = [];
  const responses = [];
  let responseLines = [];
  let terminalError = null;

  const onData = chunk => {
    buffer += chunk.toString('utf8');
    parse();
  };

  const fail = error => {
    terminalError = error instanceof Error ? error : new Error(String(error || 'SMTP connection closed'));
    while (waiters.length) waiters.shift().reject(terminalError);
  };
  const onTimeout = () => fail(new Error('SMTP timeout'));
  const onClose = () => {
    if (waiters.length) fail(new Error('SMTP connection closed before a complete response'));
  };
  socket.on('data', onData);
  socket.on('error', fail);
  socket.on('timeout', onTimeout);
  socket.on('close', onClose);

  function parse() {
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      let line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      responseLines.push(line);
      if (/^\d{3} /.test(line)) {
        responses.push(responseLines.join('\r\n'));
        responseLines = [];
      }
    }
    flush();
  }

  function flush() {
    while (waiters.length && responses.length) waiters.shift().resolve(responses.shift());
  }

  const read = () => new Promise((resolve, reject) => {
    if (terminalError) {
      reject(terminalError);
      return;
    }
    waiters.push({ resolve, reject });
    flush();
  });
  read.dispose = () => {
    socket.removeListener('data', onData);
    socket.removeListener('error', fail);
    socket.removeListener('timeout', onTimeout);
    socket.removeListener('close', onClose);
  };
  return read;
}

async function connectSmtp(cfg) {
  const socket = cfg.secure
    ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
    : net.connect({ host: cfg.host, port: cfg.port });
  await new Promise((resolve, reject) => {
    socket.once(cfg.secure ? 'secureConnect' : 'connect', resolve);
    socket.once('error', reject);
    socket.setTimeout(15000, () => {
      const error = new Error('SMTP connection timeout');
      socket.destroy(error);
      reject(error);
    });
  });
  return socket;
}

async function sendLine(socket, read, line, expected = /^2|^3/) {
  socket.write(`${line}\r\n`);
  const response = await read();
  if (expected && !expected.test(response)) throw new Error(`SMTP rejected ${line.split(' ')[0]}: ${response}`);
  return response;
}

async function sendMailSmtp(cfg, { to, subject, text }) {
  let socket = await connectSmtp(cfg);
  let read = createReader(socket);
  await read();
  await sendLine(socket, read, `EHLO ${cfg.host}`);
  if (cfg.starttls) {
    await sendLine(socket, read, 'STARTTLS');
    read.dispose?.();
    socket = tls.connect({ socket, servername: cfg.host });
    await new Promise((resolve, reject) => {
      socket.once('secureConnect', resolve);
      socket.once('error', reject);
      socket.setTimeout(15000, () => {
        const error = new Error('SMTP TLS timeout');
        socket.destroy(error);
        reject(error);
      });
    });
    read = createReader(socket);
    await sendLine(socket, read, `EHLO ${cfg.host}`);
  }
  if (cfg.user && cfg.pass) {
    await sendLine(socket, read, 'AUTH LOGIN', /^3/);
    await sendLine(socket, read, Buffer.from(cfg.user).toString('base64'), /^3/);
    await sendLine(socket, read, Buffer.from(cfg.pass).toString('base64'));
  }
  const fromHeader = String(cfg.from || '').replace(/[\r\n]/g, '').trim();
  const from = envelopeAddress(fromHeader);
  const rcpt = envelopeAddress(to);
  await sendLine(socket, read, `MAIL FROM:<${from}>`);
  await sendLine(socket, read, `RCPT TO:<${rcpt}>`);
  await sendLine(socket, read, 'DATA', /^3/);
  const headers = [
    `From: ${fromHeader}`,
    `To: ${rcpt}`,
    `Subject: ${String(subject || '').replace(/[\r\n]/g, ' ')}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    'X-Mailer: Orbit Ops Subdivision',
    ''
  ].join('\r\n');
  socket.write(`${headers}\r\n${dotStuff(text)}\r\n.\r\n`);
  const dataResponse = await read();
  if (!/^2/.test(dataResponse)) throw new Error(`SMTP DATA rejected: ${dataResponse}`);
  try { await sendLine(socket, read, 'QUIT', null); } catch {}
  socket.end();
}

async function sendMail(message) {
  const forced = requestedProvider();
  const brevo = brevoConfig();
  if (forced === 'brevo' || (!forced && brevo)) return sendMailBrevo(brevo || {}, message);

  const resend = resendConfig();
  if (forced === 'resend' || (!forced && resend)) return sendMailResend(resend || {}, message);

  const smtp = smtpConfig();
  if (forced === 'smtp' || (!forced && smtp)) {
    if (!smtp) throw new Error('SMTP_HOST is not configured');
    await sendMailSmtp(smtp, message);
    return { ok: true, dev: false, provider: 'smtp', id: null };
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Email provider is not configured; set BREVO_API_KEY and BREVO_FROM');
  }
  console.warn(`[mail:dev] no provider; would send to ${message.to}: ${message.subject}\n${message.text}`);
  return { ok: true, dev: true };
}

module.exports = {
  sendMail,
  sendMailBrevo,
  sendMailResend,
  sendMailSmtp,
  brevoConfig,
  resendConfig,
  smtpConfig,
  providerStatus,
  safeIdempotencyKey
};
