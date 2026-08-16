import { withTransaction } from "../database.js";

function placeholders(offset, count, casts = {}) {
  return Array.from({ length: count }, (_, index) => {
    const position = index + offset;
    return `$${position}${casts[index] ?? ""}`;
  }).join(",");
}

export async function recordMatch(match, { transaction = withTransaction } = {}) {
  return transaction(async (client) => {
    const matchResult = await client.query(
      `INSERT INTO matches
       (room_code, started_at, ended_at, winning_faction, player_count, map_id, duration_seconds, match_data_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) RETURNING id`,
      [match.roomCode, match.startedAt, match.endedAt, match.winner, match.players.length,
        match.mapId, match.durationSeconds, JSON.stringify(match.summary)]
    );
    const matchId = matchResult.rows[0].id;

    if (match.players.length) {
      const values = [];
      const rows = match.players.map((player, slotIndex) => {
        const offset = values.length + 1;
        values.push(
          matchId, slotIndex, player.accountId, player.displayName, player.role, player.faction,
          player.won, player.score, player.stats.tasksCompleted, player.stats.sabotagesStarted,
          player.stats.sabotagesRepaired, player.stats.eliminations, player.stats.incidentsReported,
          player.stats.correctVotes, player.stats.incorrectVotes, player.survivalSeconds, !player.connected
        );
        return `(${placeholders(offset, 17, {
          0: "::uuid", 1: "::smallint", 2: "::uuid", 3: "::varchar", 4: "::varchar",
          5: "::varchar", 6: "::boolean", 7: "::integer", 8: "::smallint", 9: "::smallint",
          10: "::smallint", 11: "::smallint", 12: "::smallint", 13: "::smallint",
          14: "::smallint", 15: "::integer", 16: "::boolean"
        })})`;
      });
      await client.query(
        `INSERT INTO match_players
         (match_id, slot_index, account_id, display_name_snapshot, assigned_role, faction, won, score,
          tasks_completed, sabotages_started, sabotages_repaired, eliminations,
          incidents_reported, correct_votes, incorrect_votes, survival_seconds, disconnected)
         VALUES ${rows.join(",")}`,
        values
      );
    }

    const accountPlayers = match.players.filter((player) => player.accountId);
    if (accountPlayers.length) {
      const values = [];
      const rows = accountPlayers.map((player) => {
        const offset = values.length + 1;
        values.push(
          player.accountId, player.faction, player.won, player.stats.tasksCompleted,
          player.stats.sabotagesStarted, player.stats.sabotagesRepaired, player.stats.eliminations,
          !player.alive, player.stats.incidentsReported, player.stats.correctVotes,
          player.stats.incorrectVotes, player.survivalSeconds, player.score
        );
        return `(${placeholders(offset, 13, {
          0: "::uuid", 1: "::text", 2: "::boolean", 3: "::integer", 4: "::integer",
          5: "::integer", 6: "::integer", 7: "::boolean", 8: "::integer", 9: "::integer",
          10: "::integer", 11: "::integer", 12: "::integer"
        })})`;
      });
      await client.query(
        `UPDATE player_stats AS stats SET
          games_played = stats.games_played + 1,
          crew_games = stats.crew_games + CASE WHEN delta.faction = 'crew' THEN 1 ELSE 0 END,
          operative_games = stats.operative_games + CASE WHEN delta.faction = 'operative' THEN 1 ELSE 0 END,
          crew_wins = stats.crew_wins + CASE WHEN delta.faction = 'crew' AND delta.won THEN 1 ELSE 0 END,
          operative_wins = stats.operative_wins + CASE WHEN delta.faction = 'operative' AND delta.won THEN 1 ELSE 0 END,
          total_wins = stats.total_wins + CASE WHEN delta.won THEN 1 ELSE 0 END,
          total_losses = stats.total_losses + CASE WHEN delta.won THEN 0 ELSE 1 END,
          tasks_completed = stats.tasks_completed + delta.tasks_completed,
          sabotages_started = stats.sabotages_started + delta.sabotages_started,
          sabotages_repaired = stats.sabotages_repaired + delta.sabotages_repaired,
          eliminations = stats.eliminations + delta.eliminations,
          times_eliminated = stats.times_eliminated + CASE WHEN delta.eliminated THEN 1 ELSE 0 END,
          incidents_reported = stats.incidents_reported + delta.incidents_reported,
          correct_votes = stats.correct_votes + delta.correct_votes,
          incorrect_votes = stats.incorrect_votes + delta.incorrect_votes,
          total_survival_seconds = stats.total_survival_seconds + delta.survival_seconds,
          longest_survival_seconds = GREATEST(stats.longest_survival_seconds, delta.survival_seconds),
          score = stats.score + delta.score,
          experience = stats.experience + GREATEST(0, delta.score),
          updated_at = now()
         FROM (VALUES ${rows.join(",")}) AS delta(
           account_id, faction, won, tasks_completed, sabotages_started, sabotages_repaired,
           eliminations, eliminated, incidents_reported, correct_votes, incorrect_votes,
           survival_seconds, score
         )
         WHERE stats.account_id = delta.account_id`,
        values
      );
    }
    return matchId;
  });
}
