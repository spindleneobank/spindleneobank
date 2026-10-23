create extension if not exists timescaledb;
--> statement-breakpoint
select create_hypertable('earning_events', 'ts', if_not_exists => true);
