import { query } from "../database.js";

// Leaderboards and announcements: the two read-mostly surfaces that make the
// stats already being written mean something.

const BOARDS = Object.freeze({
  score: { column: "score", label: "Score" },
  wins: { column: "total_wins", label: "Victories" },
  tasks: { column: "tasks_completed", label: "Assignments" },
  eliminations: { column: "eliminations", label: "Eliminations" },
  survival: { column: "longest_survival_seconds", label: "Longest survival" }
});

export function leaderboardKinds() {
  return Object.entries(BOARDS).map(([id, { label }]) => ({ id, label }));
}

export async function listLeaderboard(kind = "score", { limit = 25 } = {}) {
  // The column is chosen from a fixed map, never interpolated from input.
  const board = BOARDS[kind] ?? BOARDS.score;
  const result = await query(
    `SELECT a.display_name, s.games_played, s.total_wins, s.score,
            s.tasks_completed, s.eliminations, s.longest_survival_seconds,
            s.${board.column} AS ranking_value
       FROM player_stats s
       JOIN accounts a ON a.id = s.account_id
      WHERE a.account_status = 'active' AND s.games_played > 0
      ORDER BY s.${board.column} DESC, s.games_played DESC
      LIMIT $1`,
    [Math.max(1, Math.min(100, Number(limit) || 25))]
  );
  return result.rows.map((row, index) => ({
    rank: index + 1,
    displayName: row.display_name,
    value: Number(row.ranking_value),
    gamesPlayed: row.games_played,
    wins: row.total_wins,
    score: row.score
  }));
}

export async function listNews({ limit = 10 } = {}) {
  const result = await query(
    `SELECT n.id, n.title, n.body, n.created_at, a.display_name AS posted_by_name
       FROM news_posts n
       LEFT JOIN accounts a ON a.id = n.posted_by
      WHERE n.published = true
      ORDER BY n.created_at DESC
      LIMIT $1`,
    [Math.max(1, Math.min(50, Number(limit) || 10))]
  );
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    postedBy: row.posted_by_name,
    createdAt: row.created_at
  }));
}

export async function createNews({ title, body, postedBy }) {
  const result = await query(
    `INSERT INTO news_posts (title, body, posted_by) VALUES ($1, $2, $3)
     RETURNING id, title, body, created_at`,
    [title, body, postedBy ?? null]
  );
  return result.rows[0];
}

export async function deleteNews(id) {
  const result = await query(`DELETE FROM news_posts WHERE id = $1 RETURNING id`, [id]);
  return result.rowCount > 0;
}
