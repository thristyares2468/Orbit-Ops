-- A room code has to be unique across every instance that shares this database,
-- not just within one process. A single instance is the current deployment, but
-- local-only allocation quietly becomes wrong the moment a second one exists,
-- and a duplicate code sends a joining player to the wrong room.
--
-- Rows carry a lease rather than being deleted on shutdown: an instance that is
-- killed cannot clean up after itself, and a code that stayed claimed forever
-- would leak the space away.
CREATE TABLE IF NOT EXISTS active_room_codes (
  code varchar(6) PRIMARY KEY,
  instance_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS active_room_codes_expiry_idx ON active_room_codes (expires_at);
CREATE INDEX IF NOT EXISTS active_room_codes_instance_idx ON active_room_codes (instance_id);
