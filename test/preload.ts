// Unit-test preload: isolate Redis pub/sub channels per test process. Pub/sub is global to a Redis server (not
// per DB), so a dev api/worker or another agent's run on the same Redis would otherwise answer our requests.
process.env.SPINDLE_CHANNEL_PREFIX ??= `test:${process.pid}:`;
// Sampling real jobs for re-execution is off in tests unless a test turns it on.
process.env.SHADOW_RATE_BPS ??= '0';
// Most suites are not about the new-wallet credit limit (credit.test.ts is). Tests set it where they need it.
process.env.X402_NEW_PAYER_CREDIT_MICROS ??= '20000000';
