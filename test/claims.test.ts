import assert from 'node:assert/strict';
import test from 'node:test';
import { claimsFromPayloadSegment, claimsFromToken, secondsRemaining } from '../src/core/claims.js';

const b64url = (text: string): string =>
  Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const segmentOf = (claims: unknown): string => b64url(JSON.stringify(claims));

test('reads userId out of the nested payload string', () => {
  const segment = segmentOf({
    role: 'ACCESS',
    exp: 1_800_000_000,
    payload: JSON.stringify({ userId: 220750396, grantType: 'password' }),
  });
  assert.deepEqual(claimsFromPayloadSegment(segment), {
    userId: '220750396',
    grantType: 'password',
    role: 'ACCESS',
    exp: 1_800_000_000,
  });
});

test('reads a base64-encoded nested payload', () => {
  const segment = segmentOf({
    role: 'ACCESS',
    exp: 1,
    payload: b64url(JSON.stringify({ user_id: 42, grant_type: 'google' })),
  });
  const claims = claimsFromPayloadSegment(segment);
  assert.equal(claims?.userId, '42');
  assert.equal(claims?.grantType, 'google');
});

test('top-level claims win over the nested payload', () => {
  const segment = segmentOf({ userId: 7, payload: JSON.stringify({ userId: 9 }) });
  assert.equal(claimsFromPayloadSegment(segment)?.userId, '7');
});

test('missing fields come back as null, not invented', () => {
  const segment = segmentOf({ jti: 'abc' });
  assert.deepEqual(claimsFromPayloadSegment(segment), {
    userId: null,
    grantType: null,
    role: null,
    exp: null,
  });
});

test('garbage segments return null instead of throwing', () => {
  assert.equal(claimsFromPayloadSegment('!!!not-base64!!!'), null);
  assert.equal(claimsFromPayloadSegment(b64url('not json')), null);
  assert.equal(claimsFromToken('only-one-part'), null);
});

test('claimsFromToken takes the middle segment of a three-part token', () => {
  const token = `header.${segmentOf({ role: 'ACCESS', payload: JSON.stringify({ userId: 5 }) })}.signature`;
  assert.equal(claimsFromToken(token)?.userId, '5');
});

test('secondsRemaining counts down from exp', () => {
  const claims = { userId: null, grantType: null, role: null, exp: 1_000 };
  assert.equal(secondsRemaining(claims, 400_000), 600);
  assert.equal(secondsRemaining({ ...claims, exp: null }, 400_000), null);
});
