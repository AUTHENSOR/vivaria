import 'dotenv/config'

import { Knex } from 'knex'
import { sql, withClientFromKnex } from '../services/db/db'

export async function up(knex: Knex) {
  await withClientFromKnex(knex, async conn => {
    // Clamp each pause row to the branch's lifetime: a pause never counts time before the branch
    // started, and never counts a negative duration. This keeps usage accounting non-negative even
    // for pause rows with client-stamped starts that predate the branch (e.g. rows written by older
    // server versions or inserted directly into the database). The CASE keeps rows with no pause
    // (from the LEFT JOIN) contributing NULL, so SUM skips them as before.
    await conn.none(sql`CREATE OR REPLACE VIEW branch_paused_time_v AS
      SELECT
        agent_branches_t."runId",
        agent_branches_t."agentBranchNumber",
        COALESCE(SUM(
          CASE WHEN run_pauses_t."runId" IS NOT NULL THEN
            GREATEST(
              COALESCE("end", -- if pause is completed, use end time
                agent_branches_t."completedAt", -- if the pause isn't complete but the branch is, use the branch time
                extract(epoch from now()) * 1000 -- otherwise, use current time
              ) - GREATEST("start", agent_branches_t."startedAt"), -- never count time before the branch started
              0 -- never count a negative pause duration
            )
          END
        ), 0)::bigint as "pausedMs"
      FROM agent_branches_t
      LEFT JOIN run_pauses_t
        ON run_pauses_t."runId" = agent_branches_t."runId"
        AND run_pauses_t."agentBranchNumber" = agent_branches_t."agentBranchNumber"
      GROUP BY agent_branches_t."runId", agent_branches_t."agentBranchNumber"
      `)
  })
}

export async function down(knex: Knex) {
  await withClientFromKnex(knex, async conn => {
    await conn.none(sql`CREATE OR REPLACE VIEW branch_paused_time_v AS
      SELECT
        agent_branches_t."runId",
        agent_branches_t."agentBranchNumber",
        COALESCE(SUM(
          COALESCE("end", -- if pause is completed, use end time
            agent_branches_t."completedAt", -- if the pause isn't complete but the branch is, use the branch time
            extract(epoch from now()) * 1000 -- otherwise, use current time
          ) - "start" -- calculate the difference between end time and start time
        ), 0)::bigint as "pausedMs"
      FROM agent_branches_t
      LEFT JOIN run_pauses_t
        ON run_pauses_t."runId" = agent_branches_t."runId"
        AND run_pauses_t."agentBranchNumber" = agent_branches_t."agentBranchNumber"
      GROUP BY agent_branches_t."runId", agent_branches_t."agentBranchNumber"
      `)
  })
}
