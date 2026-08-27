-- Step 3 of docs/moving-the-database-to-neon.md
-- Paste into Neon's SQL Editor, connected to the `subdivision` database, AFTER
-- the game has booted against it once and built its own schema.

-- 3a. Reach the Railway database from inside Neon.
CREATE EXTENSION IF NOT EXISTS postgres_fdw;
CREATE SCHEMA IF NOT EXISTS railway_src;

-- Fill these four in from Railway -> Postgres -> Variables -> DATABASE_PUBLIC_URL,
-- which reads postgresql://USER:PASSWORD@HOST:PORT/DBNAME
CREATE SERVER railway FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (host 'HOST', port 'PORT', dbname 'DBNAME', sslmode 'require');
CREATE USER MAPPING FOR CURRENT_USER SERVER railway
  OPTIONS (user 'USER', password 'PASSWORD');

-- 3b. Expose Railway's tables read-only inside Neon.
IMPORT FOREIGN SCHEMA public FROM SERVER railway INTO railway_src;

-- 3c. Copy the rows. Ordered so a child row never lands before its parent,
-- and idempotent, so re-running after a failure resumes rather than duplicates.
INSERT INTO public.accounts SELECT * FROM railway_src.accounts ON CONFLICT DO NOTHING;
INSERT INTO public.active_game_rooms SELECT * FROM railway_src.active_game_rooms ON CONFLICT DO NOTHING;
INSERT INTO public.app_migrations SELECT * FROM railway_src.app_migrations ON CONFLICT DO NOTHING;
INSERT INTO public.bans SELECT * FROM railway_src.bans ON CONFLICT DO NOTHING;
INSERT INTO public.case_inventory SELECT * FROM railway_src.case_inventory ON CONFLICT DO NOTHING;
INSERT INTO public.chat_logs SELECT * FROM railway_src.chat_logs ON CONFLICT DO NOTHING;
INSERT INTO public.cross_server_auth_handoffs SELECT * FROM railway_src.cross_server_auth_handoffs ON CONFLICT DO NOTHING;
INSERT INTO public.cross_server_game_invites SELECT * FROM railway_src.cross_server_game_invites ON CONFLICT DO NOTHING;
INSERT INTO public.custom_cases SELECT * FROM railway_src.custom_cases ON CONFLICT DO NOTHING;
INSERT INTO public.daily_challenge_claims SELECT * FROM railway_src.daily_challenge_claims ON CONFLICT DO NOTHING;
INSERT INTO public.daily_challenge_progress SELECT * FROM railway_src.daily_challenge_progress ON CONFLICT DO NOTHING;
INSERT INTO public.daily_challenge_templates SELECT * FROM railway_src.daily_challenge_templates ON CONFLICT DO NOTHING;
INSERT INTO public.daily_stats SELECT * FROM railway_src.daily_stats ON CONFLICT DO NOTHING;
INSERT INTO public.daily_weapon_kills SELECT * FROM railway_src.daily_weapon_kills ON CONFLICT DO NOTHING;
INSERT INTO public.devices SELECT * FROM railway_src.devices ON CONFLICT DO NOTHING;
INSERT INTO public.friendships SELECT * FROM railway_src.friendships ON CONFLICT DO NOTHING;
INSERT INTO public.ip_events SELECT * FROM railway_src.ip_events ON CONFLICT DO NOTHING;
INSERT INTO public.news_messages SELECT * FROM railway_src.news_messages ON CONFLICT DO NOTHING;
INSERT INTO public.recent_player_encounters SELECT * FROM railway_src.recent_player_encounters ON CONFLICT DO NOTHING;
INSERT INTO public.sessions SELECT * FROM railway_src.sessions ON CONFLICT DO NOTHING;
INSERT INTO public.skin_collection_unlocks SELECT * FROM railway_src.skin_collection_unlocks ON CONFLICT DO NOTHING;
INSERT INTO public.skin_inventory SELECT * FROM railway_src.skin_inventory ON CONFLICT DO NOTHING;
INSERT INTO public.skin_loadouts SELECT * FROM railway_src.skin_loadouts ON CONFLICT DO NOTHING;
INSERT INTO public.skin_market_listings SELECT * FROM railway_src.skin_market_listings ON CONFLICT DO NOTHING;
INSERT INTO public.skin_trade_requests SELECT * FROM railway_src.skin_trade_requests ON CONFLICT DO NOTHING;
INSERT INTO public.stats SELECT * FROM railway_src.stats ON CONFLICT DO NOTHING;
INSERT INTO public.trade_up_transactions SELECT * FROM railway_src.trade_up_transactions ON CONFLICT DO NOTHING;
INSERT INTO public.violations SELECT * FROM railway_src.violations ON CONFLICT DO NOTHING;
INSERT INTO public.weekly_challenge_rotations SELECT * FROM railway_src.weekly_challenge_rotations ON CONFLICT DO NOTHING;
INSERT INTO public.account_email_codes SELECT * FROM railway_src.account_email_codes ON CONFLICT DO NOTHING;
INSERT INTO public.case_market_listings SELECT * FROM railway_src.case_market_listings ON CONFLICT DO NOTHING;
INSERT INTO public.case_openings SELECT * FROM railway_src.case_openings ON CONFLICT DO NOTHING;
INSERT INTO public.skin_market_bids SELECT * FROM railway_src.skin_market_bids ON CONFLICT DO NOTHING;

-- 3d. Restart the id counters past the copied rows. Without this the first new
-- account collides with an imported one.
SELECT setval(pg_get_serial_sequence('public.accounts', 'id'), COALESCE((SELECT MAX(id) FROM public.accounts), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.account_email_codes', 'id'), COALESCE((SELECT MAX(id) FROM public.account_email_codes), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.bans', 'id'), COALESCE((SELECT MAX(id) FROM public.bans), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.skin_inventory', 'id'), COALESCE((SELECT MAX(id) FROM public.skin_inventory), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.case_openings', 'id'), COALESCE((SELECT MAX(id) FROM public.case_openings), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.skin_market_listings', 'id'), COALESCE((SELECT MAX(id) FROM public.skin_market_listings), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.skin_market_bids', 'id'), COALESCE((SELECT MAX(id) FROM public.skin_market_bids), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.case_market_listings', 'id'), COALESCE((SELECT MAX(id) FROM public.case_market_listings), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.skin_trade_requests', 'id'), COALESCE((SELECT MAX(id) FROM public.skin_trade_requests), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.trade_up_transactions', 'id'), COALESCE((SELECT MAX(id) FROM public.trade_up_transactions), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.cross_server_game_invites', 'id'), COALESCE((SELECT MAX(id) FROM public.cross_server_game_invites), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.news_messages', 'id'), COALESCE((SELECT MAX(id) FROM public.news_messages), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.chat_logs', 'id'), COALESCE((SELECT MAX(id) FROM public.chat_logs), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.violations', 'id'), COALESCE((SELECT MAX(id) FROM public.violations), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('public.ip_events', 'id'), COALESCE((SELECT MAX(id) FROM public.ip_events), 0) + 1, false);

-- 3e. Confirm every table matches before switching anything over.
SELECT 'accounts' AS table_name, (SELECT count(*) FROM railway_src.accounts) AS source, (SELECT count(*) FROM public.accounts) AS neon UNION ALL
SELECT 'active_game_rooms' AS table_name, (SELECT count(*) FROM railway_src.active_game_rooms) AS source, (SELECT count(*) FROM public.active_game_rooms) AS neon UNION ALL
SELECT 'app_migrations' AS table_name, (SELECT count(*) FROM railway_src.app_migrations) AS source, (SELECT count(*) FROM public.app_migrations) AS neon UNION ALL
SELECT 'bans' AS table_name, (SELECT count(*) FROM railway_src.bans) AS source, (SELECT count(*) FROM public.bans) AS neon UNION ALL
SELECT 'case_inventory' AS table_name, (SELECT count(*) FROM railway_src.case_inventory) AS source, (SELECT count(*) FROM public.case_inventory) AS neon UNION ALL
SELECT 'chat_logs' AS table_name, (SELECT count(*) FROM railway_src.chat_logs) AS source, (SELECT count(*) FROM public.chat_logs) AS neon UNION ALL
SELECT 'cross_server_auth_handoffs' AS table_name, (SELECT count(*) FROM railway_src.cross_server_auth_handoffs) AS source, (SELECT count(*) FROM public.cross_server_auth_handoffs) AS neon UNION ALL
SELECT 'cross_server_game_invites' AS table_name, (SELECT count(*) FROM railway_src.cross_server_game_invites) AS source, (SELECT count(*) FROM public.cross_server_game_invites) AS neon UNION ALL
SELECT 'custom_cases' AS table_name, (SELECT count(*) FROM railway_src.custom_cases) AS source, (SELECT count(*) FROM public.custom_cases) AS neon UNION ALL
SELECT 'daily_challenge_claims' AS table_name, (SELECT count(*) FROM railway_src.daily_challenge_claims) AS source, (SELECT count(*) FROM public.daily_challenge_claims) AS neon UNION ALL
SELECT 'daily_challenge_progress' AS table_name, (SELECT count(*) FROM railway_src.daily_challenge_progress) AS source, (SELECT count(*) FROM public.daily_challenge_progress) AS neon UNION ALL
SELECT 'daily_challenge_templates' AS table_name, (SELECT count(*) FROM railway_src.daily_challenge_templates) AS source, (SELECT count(*) FROM public.daily_challenge_templates) AS neon UNION ALL
SELECT 'daily_stats' AS table_name, (SELECT count(*) FROM railway_src.daily_stats) AS source, (SELECT count(*) FROM public.daily_stats) AS neon UNION ALL
SELECT 'daily_weapon_kills' AS table_name, (SELECT count(*) FROM railway_src.daily_weapon_kills) AS source, (SELECT count(*) FROM public.daily_weapon_kills) AS neon UNION ALL
SELECT 'devices' AS table_name, (SELECT count(*) FROM railway_src.devices) AS source, (SELECT count(*) FROM public.devices) AS neon UNION ALL
SELECT 'friendships' AS table_name, (SELECT count(*) FROM railway_src.friendships) AS source, (SELECT count(*) FROM public.friendships) AS neon UNION ALL
SELECT 'ip_events' AS table_name, (SELECT count(*) FROM railway_src.ip_events) AS source, (SELECT count(*) FROM public.ip_events) AS neon UNION ALL
SELECT 'news_messages' AS table_name, (SELECT count(*) FROM railway_src.news_messages) AS source, (SELECT count(*) FROM public.news_messages) AS neon UNION ALL
SELECT 'recent_player_encounters' AS table_name, (SELECT count(*) FROM railway_src.recent_player_encounters) AS source, (SELECT count(*) FROM public.recent_player_encounters) AS neon UNION ALL
SELECT 'sessions' AS table_name, (SELECT count(*) FROM railway_src.sessions) AS source, (SELECT count(*) FROM public.sessions) AS neon UNION ALL
SELECT 'skin_collection_unlocks' AS table_name, (SELECT count(*) FROM railway_src.skin_collection_unlocks) AS source, (SELECT count(*) FROM public.skin_collection_unlocks) AS neon UNION ALL
SELECT 'skin_inventory' AS table_name, (SELECT count(*) FROM railway_src.skin_inventory) AS source, (SELECT count(*) FROM public.skin_inventory) AS neon UNION ALL
SELECT 'skin_loadouts' AS table_name, (SELECT count(*) FROM railway_src.skin_loadouts) AS source, (SELECT count(*) FROM public.skin_loadouts) AS neon UNION ALL
SELECT 'skin_market_listings' AS table_name, (SELECT count(*) FROM railway_src.skin_market_listings) AS source, (SELECT count(*) FROM public.skin_market_listings) AS neon UNION ALL
SELECT 'skin_trade_requests' AS table_name, (SELECT count(*) FROM railway_src.skin_trade_requests) AS source, (SELECT count(*) FROM public.skin_trade_requests) AS neon UNION ALL
SELECT 'stats' AS table_name, (SELECT count(*) FROM railway_src.stats) AS source, (SELECT count(*) FROM public.stats) AS neon UNION ALL
SELECT 'trade_up_transactions' AS table_name, (SELECT count(*) FROM railway_src.trade_up_transactions) AS source, (SELECT count(*) FROM public.trade_up_transactions) AS neon UNION ALL
SELECT 'violations' AS table_name, (SELECT count(*) FROM railway_src.violations) AS source, (SELECT count(*) FROM public.violations) AS neon UNION ALL
SELECT 'weekly_challenge_rotations' AS table_name, (SELECT count(*) FROM railway_src.weekly_challenge_rotations) AS source, (SELECT count(*) FROM public.weekly_challenge_rotations) AS neon UNION ALL
SELECT 'account_email_codes' AS table_name, (SELECT count(*) FROM railway_src.account_email_codes) AS source, (SELECT count(*) FROM public.account_email_codes) AS neon UNION ALL
SELECT 'case_market_listings' AS table_name, (SELECT count(*) FROM railway_src.case_market_listings) AS source, (SELECT count(*) FROM public.case_market_listings) AS neon UNION ALL
SELECT 'case_openings' AS table_name, (SELECT count(*) FROM railway_src.case_openings) AS source, (SELECT count(*) FROM public.case_openings) AS neon UNION ALL
SELECT 'skin_market_bids' AS table_name, (SELECT count(*) FROM railway_src.skin_market_bids) AS source, (SELECT count(*) FROM public.skin_market_bids) AS neon;

-- 3f. Once the counts agree, drop the link. Leaving it live means Neon holds
-- credentials for Railway indefinitely.
-- DROP SCHEMA railway_src CASCADE;
-- DROP USER MAPPING FOR CURRENT_USER SERVER railway;
-- DROP SERVER railway;
