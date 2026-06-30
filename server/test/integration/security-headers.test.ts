import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { makeTestWorld } from '../helpers.js';

describe('security headers', () => {
  it('omits upgrade-insecure-requests and HSTS when cookieSecure is false (plain-HTTP testing)', async () => {
    // makeTestWorld() defaults cookieSecure to false, matching how it's run
    // over plain HTTP in tests/local dev — these headers would otherwise make
    // browsers rewrite every asset request to https:// and fail outright.
    const world = makeTestWorld();
    const res = await request(world.app).get('/api/health');
    expect(res.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('sets upgrade-insecure-requests and HSTS when cookieSecure is true (HTTPS deployment)', async () => {
    const world = makeTestWorld({ cookieSecure: true });
    const res = await request(world.app).get('/api/health');
    expect(res.headers['content-security-policy']).toContain('upgrade-insecure-requests');
    expect(res.headers['strict-transport-security']).toContain('max-age=');
  });
});
