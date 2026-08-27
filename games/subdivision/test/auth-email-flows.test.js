// Last updated: 19 July 2026
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const dbJs = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
const authJs = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

assert.match(dbJs, /CREATE TABLE IF NOT EXISTS account_email_codes/, 'database should persist email verification and reset codes');
assert.match(dbJs, /purpose IN \('register', 'password_reset', 'email_change'\)/, 'email codes should be scoped to register, password reset, and email change');
assert.match(dbJs, /ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT true/, 'existing accounts should remain verified by default');
assert.match(dbJs, /ALTER TABLE accounts ADD COLUMN IF NOT EXISTS recovery_code_ciphertext TEXT/, 'existing accounts should gain encrypted recovery-code storage');
assert.match(dbJs, /ALTER TABLE accounts ADD COLUMN IF NOT EXISTS healthshot_used BOOLEAN NOT NULL DEFAULT false/, 'accounts should persist first healthshot use');
assert.match(dbJs, /async function updatePassword/, 'database should update passwords');
assert.match(dbJs, /async function updateEmail/, 'database should update verified emails');

assert.match(authJs, /const mailer = require\('\.\/mailer'\)/, 'auth should send codes through mailer.js');
assert.match(authJs, /Account security code[\s\S]*?idempotencyKey: `account-code\/\$\{purpose\}\/\$\{recordId\}`/, 'account codes should include branded HTML and delivery idempotency');
assert.match(authJs, /async function register\(data, conn\)[\s\S]*?pendingVerification: true/, 'registration should send a verification code before account creation');
assert.match(authJs, /async function confirmRegistration\(data, conn\)[\s\S]*?db\.createAccount[\s\S]*?db\.createSession/, 'code confirmation should create the account and session');
assert.match(authJs, /function newRecoveryCode\(\)[\s\S]*?crypto\.randomInt/, 'password recovery should use random account recovery codes');
assert.match(authJs, /function encryptRecoveryCode[\s\S]*?aes-256-gcm/, 'recovery codes should be encrypted at rest');
assert.match(authJs, /async function getOwnRecoveryCode[\s\S]*?getOrCreateRecoveryCode/, 'account settings should provide the account recovery code');
assert.match(authJs, /async function getAdminRecoveryCode[\s\S]*?getOrCreateRecoveryCode/, "administrators should be able to retrieve a player's recovery code without storing it as plaintext");
assert.match(authJs, /async function confirmPasswordReset[\s\S]*?getAccountForRecovery[\s\S]*?updatePasswordAndRecoveryCode/, 'password resets should require account recovery details and rotate the recovery code');
assert.match(authJs, /async function changePassword/, 'auth should support logged-in password changes');
assert.match(authJs, /async function changePassword[\s\S]*?updatePasswordAndRecoveryCode[\s\S]*?recoveryCode: nextRecoveryCode/, 'logged-in password changes should rotate and return the recovery code');
assert.match(authJs, /async function confirmEmailChange[\s\S]*?normalizeRecoveryCode[\s\S]*?updateEmailAndRecoveryCode[\s\S]*?recoveryCode: nextRecoveryCode/, 'email changes should require and then rotate the recovery code');
assert.doesNotMatch(authJs, /async function confirmEmailChange[\s\S]*?verifyEmailCode\(\{ purpose: 'email_change'/, 'email changes should not use emailed verification codes');
assert.match(authJs, /async function requestEmailChange/, 'auth should retain protocol-compatible email-change validation for older clients');
assert.match(authJs, /async function confirmEmailChange/, 'auth should confirm email changes using account recovery');

assert.match(serverJs, /'authConfirmRegister'[\s\S]*?'authGetRecoveryCode'[\s\S]*?'authConfirmPasswordReset'[\s\S]*?'authRequestEmailChange'[\s\S]*?'authConfirmEmailChange'/, 'server should route account recovery packet types');
assert.match(serverJs, /authAdminGetRecoveryCode[\s\S]*?isAdminUser\(client\)[\s\S]*?auth\.getAdminRecoveryCode/, 'server should restrict player recovery lookup to administrators');
assert.match(serverJs, /send\(client, 'authNotice'/, 'server should send auth notices for email-code steps');
assert.match(serverJs, /send\(client, 'accountNotice'/, 'server should send account notices for logged-in account changes');
assert.match(serverJs, /const EMAIL_AUTH_GRACE_MS = 15 \* 60 \* 1000[\s\S]*?function scheduleAuthTimeout[\s\S]*?if \(result\.pendingVerification \|\| result\.noticeOnly\)[\s\S]*?scheduleAuthTimeout\(client, EMAIL_AUTH_GRACE_MS\)/, 'email verification and reset flows should keep the unauthenticated socket alive for the full code window');
assert.match(serverJs, /db\.markHealthshotUsed\(client\.accountId\)/, 'server should persist first healthshot use');

assert.ok(indexHtml.includes('id="verify-form"'), 'login UI should include registration code verification');
assert.ok(indexHtml.includes('id="password-reset-form"'), 'login UI should include password reset');
assert.ok(indexHtml.includes('id="reset-recovery-code"'), 'login UI should request a recovery code');
assert.ok(indexHtml.includes('id="btn-account-recovery-code"'), 'account menu should expose recovery-code viewing');
assert.ok(indexHtml.includes('id="btn-admin-recovery-lookup"'), 'admin accounts should expose the player recovery-code lookup');
assert.match(indexHtml, /function requestOwnRecoveryCode\(\)[\s\S]*?authGetRecoveryCode/, 'account menu should load the recovery code over the authenticated socket');
assert.match(indexHtml, /function confirmAccountEmailChange\(\)[\s\S]*?recoveryCode[\s\S]*?authConfirmEmailChange/, 'account email form should submit the recovery code');
assert.doesNotMatch(indexHtml, /Sending email code/, 'account email UI should not offer emailed verification');
assert.ok(indexHtml.includes('id="btn-account-change-password"'), 'account menu should expose password change');
assert.ok(indexHtml.includes('id="btn-account-change-email"'), 'account menu should expose email change');
assert.ok(indexHtml.includes('id="btn-account-settings"'), 'account overview should collapse security actions behind Account settings');
assert.ok(indexHtml.includes('id="account-settings-panel"'), 'Account settings should open a dedicated action drawer');
assert.match(indexHtml, /function showAccountSettings\(open\)/, 'account settings drawer should have an explicit controller');
const accountIdentity = indexHtml.match(/<div class="account-identity">([\s\S]*?)<div class="account-meta" id="account-menu-meta">/)?.[1] || '';
assert.ok(accountIdentity.includes('id="btn-account-settings"'), 'Account settings should remain in the original account identity position');
assert.ok(!accountIdentity.includes('id="btn-change-username"') && !accountIdentity.includes('id="btn-account-change-password"'), 'individual account actions should not clutter the account overview');
assert.match(indexHtml, /function renderHealthshotWeaponRow\(\)[\s\S]*?Health Shot/, 'healthshot should render in the weapon HUD');
assert.doesNotMatch(indexHtml, /Healthshot ready - press X/, 'healthshot prompt should use the current keybind instead of hardcoded X');
assert.match(indexHtml, /healthshot: 'KeyX'[\s\S]*?\['healthshot', 'Health Shot'\][\s\S]*?data-bind="\$\{action\}"/, 'the controls page should expose a persistent Health Shot keybind');
assert.match(indexHtml, /if \(experimentalMenuEnabled && isAuthed\) \{[\s\S]*?showExperimentalPanel\(settingsMenu, 'btn-settings', returnScreen\)/, 'in-game settings should use the scrollable pause overlay layout');

console.log('auth-email-flows: email code auth, account security, and healthshot persistence verified.');
