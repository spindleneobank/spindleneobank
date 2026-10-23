// Unit-test preload: isolate Redis pub/sub channels per test process. Pub/sub is global to a Redis server (not
// per DB), so a dev api/worker or another agent's run on the same Redis would otherwise answer our requests.
process.env.SPINDLE_CHANNEL_PREFIX ??= `test:${process.pid}:`;
