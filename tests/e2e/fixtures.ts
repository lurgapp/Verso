import { createHash, randomUUID } from 'node:crypto';
import { test as base } from '@playwright/test';

const runIdentity = randomUUID();

// Local tests get separate TEST-NET identities so one scenario cannot exhaust
// another scenario's rate limit. Public ingress always overwrites this header.
export const test = base.extend({
  extraHTTPHeaders: async ({ baseURL, extraHTTPHeaders }, use, info) => {
    const host = new URL(baseURL ?? 'http://127.0.0.1:3000').hostname;
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return use(extraHTTPHeaders);
    const digest = createHash('sha256').update(`${runIdentity}:${info.testId}:${info.retry}:${info.repeatEachIndex}`).digest('hex');
    const address = `2001:db8:${digest.slice(0, 24).match(/.{4}/g)!.join(':')}`;
    await use({ ...extraHTTPHeaders, 'X-Real-IP': address });
  },
});
