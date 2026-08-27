// Last updated: 19 July 2026
const assert = require('assert');
const http = require('http');
const net = require('net');
const {
  sendMail,
  sendMailBrevo,
  sendMailResend,
  sendMailSmtp,
  providerStatus,
  brevoConfig,
  resendConfig,
  smtpConfig
} = require('../mailer');

async function withResendServer(responses, run) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
      });
      const reply = responses[Math.min(requests.length - 1, responses.length - 1)];
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(server.address().port, requests); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

async function withSmtpServer(run) {
  const commands = [];
  const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    socket.write('220-local test server\r\n220 ready\r\n');
    let buffer = '';
    let readingData = false;
    socket.on('data', chunk => {
      buffer += chunk;
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n');
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        commands.push(line);
        if (readingData) {
          if (line === '.') {
            readingData = false;
            socket.write('250 accepted\r\n');
          }
          continue;
        }
        if (line.startsWith('EHLO ')) socket.write('250-localhost\r\n250 SIZE 1048576\r\n');
        else if (line.startsWith('MAIL FROM:') || line.startsWith('RCPT TO:')) socket.write('250 ok\r\n');
        else if (line === 'DATA') { readingData = true; socket.write('354 send data\r\n'); }
        else if (line === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(server.address().port, commands); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

(async () => {
  await withResendServer([{ status: 201, body: { messageId: 'brevo_test_123' } }], async (port, requests) => {
    const result = await sendMailBrevo({
      apiKey: 'xkeysib-test',
      from: "James Garden Care <accounts@example.test>",
      replyTo: 'Support <support@example.test>',
      endpoint: `http://127.0.0.1:${port}/v3/smtp/email`
    }, {
      to: 'Player <player@example.test>',
      subject: 'Verify account',
      text: 'Your code is 123456',
      html: '<p>Your code is <strong>123456</strong></p>',
      tags: [{ name: 'account_action', value: 'register' }]
    });
    assert.deepStrictEqual(result, { ok: true, dev: false, provider: 'brevo', id: 'brevo_test_123' });
    assert.strictEqual(requests.length, 1);
    assert.strictEqual(requests[0].headers['api-key'], 'xkeysib-test');
    assert.deepStrictEqual(requests[0].body.sender, { email: 'accounts@example.test', name: "James Garden Care" });
    assert.deepStrictEqual(requests[0].body.to, [{ email: 'player@example.test', name: 'Player' }]);
    assert.deepStrictEqual(requests[0].body.replyTo, { email: 'support@example.test', name: 'Support' });
    assert.strictEqual(requests[0].body.htmlContent, '<p>Your code is <strong>123456</strong></p>');
    assert.deepStrictEqual(requests[0].body.tags, ['account_action:register']);
  });

  await withResendServer([
    { status: 503, body: { message: 'temporary outage' } },
    { status: 201, body: { messageId: 'brevo_retry_123' } }
  ], async (port, requests) => {
    const result = await sendMailBrevo({
      apiKey: 'xkeysib-retry', from: 'accounts@example.test', replyTo: '',
      endpoint: `http://127.0.0.1:${port}/v3/smtp/email`
    }, { to: 'player@example.test', subject: 'Reset password', text: 'Your code is 654321' });
    assert.strictEqual(result.id, 'brevo_retry_123');
    assert.strictEqual(requests.length, 2, 'transient Brevo API failures should retry once');
  });

  let brevoNetworkAttempts = 0;
  const brevoNetworkResult = await sendMailBrevo({
    apiKey: 'xkeysib-network', from: 'accounts@example.test', replyTo: '',
    endpoint: 'https://example.test/v3/smtp/email'
  }, { to: 'player@example.test', subject: 'Verify account', text: 'Your code is 123456' }, async () => {
    brevoNetworkAttempts += 1;
    if (brevoNetworkAttempts === 1) throw new TypeError('temporary network failure');
    return new Response(JSON.stringify({ messageId: 'brevo_network_retry_123' }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  });
  assert.strictEqual(brevoNetworkResult.id, 'brevo_network_retry_123');
  assert.strictEqual(brevoNetworkAttempts, 2, 'transient Brevo network failures should retry once');

  await withResendServer([{ status: 200, body: { id: 'email_test_123' } }], async (port, requests) => {
    const result = await sendMailResend({
      apiKey: 're_test_key',
      from: "James Garden Care <accounts@mail.example.test>",
      replyTo: 'support@example.test',
      endpoint: `http://127.0.0.1:${port}/emails`
    }, {
      to: 'player@example.test',
      subject: 'Verify account',
      text: 'Your code is 123456',
      html: '<p>Your code is <strong>123456</strong></p>',
      idempotencyKey: 'account-code/register/42',
      tags: [{ name: 'account_action', value: 'register' }]
    });
    assert.deepStrictEqual(result, { ok: true, dev: false, provider: 'resend', id: 'email_test_123' });
    assert.strictEqual(requests.length, 1);
    assert.strictEqual(requests[0].method, 'POST');
    assert.strictEqual(requests[0].url, '/emails');
    assert.strictEqual(requests[0].headers.authorization, 'Bearer re_test_key');
    assert.strictEqual(requests[0].headers['idempotency-key'], 'account-code/register/42');
    assert.deepStrictEqual(requests[0].body.to, ['player@example.test']);
    assert.strictEqual(requests[0].body.reply_to, 'support@example.test');
    assert.strictEqual(requests[0].body.html, '<p>Your code is <strong>123456</strong></p>');
    assert.deepStrictEqual(requests[0].body.tags, [{ name: 'account_action', value: 'register' }]);
  });

  await withResendServer([
    { status: 503, body: { message: 'temporary outage' } },
    { status: 200, body: { id: 'email_retry_123' } }
  ], async (port, requests) => {
    const result = await sendMailResend({
      apiKey: 're_retry_key',
      from: 'Accounts <accounts@mail.example.test>',
      replyTo: '',
      endpoint: `http://127.0.0.1:${port}/emails`
    }, {
      to: 'player@example.test',
      subject: 'Reset password',
      text: 'Your code is 654321',
      idempotencyKey: 'account-code/password_reset/43'
    });
    assert.strictEqual(result.id, 'email_retry_123');
    assert.strictEqual(requests.length, 2, 'transient Resend failures should retry once');
    assert.strictEqual(requests[0].headers['idempotency-key'], requests[1].headers['idempotency-key']);
  });

  await assert.rejects(
    sendMailResend({ apiKey: 're_test', from: 'accounts@mail.example.test' }, { subject: 'Verify', text: 'Code' }),
    /Email recipient is required/
  );
  await assert.rejects(
    sendMailResend({ apiKey: 're_test', from: 'accounts@mail.example.test' }, { to: 'player@example.test', text: 'Code' }),
    /Email subject is required/
  );

  await withSmtpServer(async (port, commands) => {
    await sendMailSmtp({
      host: '127.0.0.1', port, secure: false, starttls: false,
      user: '', pass: '', from: 'James Garden Care <no-reply@example.test>'
    }, {
      to: 'player@example.test',
      subject: 'Verify account',
      text: 'Your code is 123456'
    });
    assert(commands.some(line => line === 'EHLO 127.0.0.1'), 'EHLO should complete after a multiline reply');
    assert(commands.some(line => line === 'MAIL FROM:<no-reply@example.test>'), 'display-name senders should use a valid envelope address');
    assert(commands.some(line => line === 'From: James Garden Care <no-reply@example.test>'), 'display-name senders should be preserved in the message header');
    assert(commands.some(line => line === 'Subject: Verify account'), 'message body should be delivered');
    assert(commands.some(line => line === 'MIME-Version: 1.0'), 'message should contain MIME headers');
  });

  const environmentNames = [
    'NODE_ENV', 'MAIL_PROVIDER', 'BREVO_API_KEY', 'BREVO_FROM', 'RESEND_API_KEY', 'RESEND_FROM', 'EMAIL_FROM',
    'EMAIL_REPLY_TO', 'SMTP_HOST', 'SMTP_STARTTLS'
  ];
  const previousEnvironment = Object.fromEntries(environmentNames.map(name => [name, process.env[name]]));

  process.env.SMTP_HOST = 'smtp.example.test';
  delete process.env.SMTP_STARTTLS;
  assert.strictEqual(smtpConfig().starttls, true, 'STARTTLS should default on for port 587 style SMTP');
  process.env.SMTP_STARTTLS = 'false';
  assert.strictEqual(smtpConfig().starttls, false, 'SMTP_STARTTLS=false should explicitly disable upgrading');

  process.env.RESEND_API_KEY = 're_configured';
  process.env.RESEND_FROM = "James Garden Care <accounts@mail.example.test>";
  delete process.env.MAIL_PROVIDER;
  assert.strictEqual(resendConfig().apiKey, 're_configured');
  assert.deepStrictEqual(providerStatus(), {
    provider: 'resend',
    configured: true,
    from: "James Garden Care <accounts@mail.example.test>",
    reason: ''
  });

  process.env.BREVO_API_KEY = 'xkeysib_configured';
  process.env.BREVO_FROM = "James Garden Care <accounts@example.test>";
  assert.strictEqual(brevoConfig().apiKey, 'xkeysib_configured');
  assert.deepStrictEqual(providerStatus(), {
    provider: 'brevo',
    configured: true,
    from: "James Garden Care <accounts@example.test>",
    reason: ''
  });

  delete process.env.BREVO_API_KEY;
  delete process.env.BREVO_FROM;
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
  delete process.env.SMTP_HOST;
  process.env.NODE_ENV = 'production';
  await assert.rejects(
    sendMail({ to: 'player@example.test', subject: 'Reset', text: 'code' }),
    /Email provider is not configured/
  );
  for (const name of environmentNames) {
    if (previousEnvironment[name] === undefined) delete process.env[name];
    else process.env[name] = previousEnvironment[name];
  }

  console.log('mailer tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
