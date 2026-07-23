import { withTransaction } from "../database.js";

export async function recordMatch(match) {
  return withTransaction(async (client) => {
    const matchResult = await client.query(
      `INSERT INTO matches
       (room_code, started_at, ended_at, winning_faction, player_count, map_id, duration_seconds, match_data_json)
       VALUES ($1, $2, $3, $4, $5, 'osv-meridian', $6, $7::jsonb) RETURNING id`,
      [match.roomCode, match.startedAt, match.endedAt, match.winner, match.players.length, match.durationSeconds, JSON.stringify(match.summary)]
    );
    const matchId = matchResult.rows[0].id;

    for (const player of match.players) {
      await client.query(
        `INSERT INTO match_players
         (match_id, account_id, display_name_snapshot, assigned_role, faction, won, score,
          tasks_completed, sabotages_started, sabotages_repaired, eliminations,
          incidents_reported, correct_votes, incorrect_votes, survival_seconds, disconnected)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [matchId, player.accountId, player.displayName, player.role, player.faction, player.won,
          player.score, player.stats.tasksCompleted, player.stats.sabotagesStarted,
          player.stats.sabotagesRepaired, player.stats.eliminations, player.stats.incidentsReported,
          player.stats.correctVotes, player.stats.incorrectVotes, player.survivalSeconds, !player.connected]
      );

      if (player.accountId) {
        await client.query(
          `UPDATE player_stats SET
            games_played = games_played + 1,
            crew_games = crew_games + CASE WHEN $2 = 'crew' THEN 1 ELSE 0 END,
            operative_games = operative_games + CASE WHEN $2 = 'operative' THEN 1 ELSE 0 END,
            crew_wins = crew_wins + CASE WHEN $2 = 'crew' AND $3 THEN 1 ELSE 0 END,
            operative_wins = operative_wins + CASE WHEN $2 = 'operative' AND $3 THEN 1 ELSE 0 END,
            total_wins = total_wins + CASE WHEN $3 THEN 1 ELSE 0 END,
            total_losses = total_losses + CASE WHEN $3 THEN 0 ELSE 1 END,
            tasks_completed = tasks_completed + $4,
            sabotages_started = sabotages_started + $5,
            sabotages_repaired = sabotages_repaired + $6,
            eliminations = eliminations + $7,
            times_eliminated = times_eliminated + CASE WHEN $8 THEN 1 ELSE 0 END,
            incidents_reported = incidents_reported + $9,
            correct_votes = correct_votes + $10,
            incorrect_votes = incorrect_votes + $11,
            total_survival_seconds = total_survival_seconds + $12,
            longest_survival_seconds = GREATEST(longest_survival_seconds, $12),
            score = score + $13,
            experience = experience + GREATEST(0, $13),
            updated_at = now()
           WHERE account_id = $1`,
          [player.accountId, player.faction, player.won, player.stats.tasksCompleted,
            player.stats.sabotagesStarted, player.stats.sabotagesRepaired, player.stats.eliminations,
            !player.alive, player.stats.incidentsReported, player.stats.correctVotes,
            player.stats.incorrectVotes, player.survivalSeconds, player.score]
        );
      }
    }
    return matchId;
  });
}
