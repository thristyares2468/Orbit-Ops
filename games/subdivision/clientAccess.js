'use strict';

const crypto = require('crypto');

const CANOPY_CLIENT_PROTOCOL = 'canopy-client-v1';
const CANOPY_KEY_PROTOCOL_PREFIX = 'canopy-key.';

function expectedCredentialProtocol(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) return '';
  return `${CANOPY_KEY_PROTOCOL_PREFIX}${Buffer.from(key, 'utf8').toString('base64url')}`;
}

function requestedProtocols(request) {
  return String(request?.headers?.['sec-websocket-protocol'] || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function timingSafeTextEqual(left, right) {
  const leftDigest = crypto.createHash('sha256').update(String(left || '')).digest();
  const rightDigest = crypto.createHash('sha256').update(String(right || '')).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function isAuthorizedCanopyClient(request, apiKey) {
  const expected = expectedCredentialProtocol(apiKey);
  if (!expected) return true;
  const protocols = requestedProtocols(request);
  return protocols.includes(CANOPY_CLIENT_PROTOCOL) &&
    protocols.some(protocol => timingSafeTextEqual(protocol, expected));
}

function selectCanopyProtocol(protocols) {
  if (protocols.has(CANOPY_CLIENT_PROTOCOL)) return CANOPY_CLIENT_PROTOCOL;
  return protocols.values().next().value || false;
}

module.exports = {
  CANOPY_CLIENT_PROTOCOL,
  expectedCredentialProtocol,
  isAuthorizedCanopyClient,
  requestedProtocols,
  selectCanopyProtocol,
  timingSafeTextEqual
};
