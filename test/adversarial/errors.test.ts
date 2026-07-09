import { describe, expect, it } from 'vitest';
import { friendlyError } from '../../src/core/errors.js';
import { HttpError } from '../../src/core/http.js';

describe('friendlyError', () => {
  it('maps 401 and 403 to an unauthorized message', () => {
    expect(friendlyError(new HttpError(401, 'Unauthorized', 'http://x'))).toMatch(/Unauthorized/);
    expect(friendlyError(new HttpError(403, 'Forbidden', 'http://x'))).toMatch(/Forbidden/);
  });

  it('maps 404 to not found', () => {
    expect(friendlyError(new HttpError(404, 'Not Found', 'http://x'))).toMatch(/Not found/);
  });

  it('maps 429 to a rate-limit message', () => {
    expect(friendlyError(new HttpError(429, 'Too Many Requests', 'http://x'))).toMatch(/Too many/);
  });

  it('maps 5xx to a server error', () => {
    expect(friendlyError(new HttpError(503, 'Service Unavailable', 'http://x'))).toMatch(
      /Server error/,
    );
  });

  it('maps timeouts by error name', () => {
    const err = new Error('the operation was aborted');
    err.name = 'TimeoutError';
    expect(friendlyError(err)).toMatch(/timed out/);
  });

  it('maps an unresolved secret reference to a credentials message', () => {
    const err = new Error('could not resolve secret reference "env:GITHUB_TOKEN"');
    expect(friendlyError(err)).toMatch(/missing credentials/);
  });

  it('maps network error codes', () => {
    const refused = Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' });
    expect(friendlyError(refused)).toMatch(/Connection refused/);
    const notFound = Object.assign(new Error('dns failed'), { code: 'ENOTFOUND' });
    expect(friendlyError(notFound)).toMatch(/Host not found/);
  });

  it('falls back to the first line of an unknown error message', () => {
    expect(friendlyError(new Error('weird failure\nstack line 1'))).toBe('weird failure');
  });

  it('handles non-Error values', () => {
    expect(friendlyError('a bare string')).toBe('a bare string');
    expect(friendlyError(null)).toBe('An unknown error occurred');
  });
});
