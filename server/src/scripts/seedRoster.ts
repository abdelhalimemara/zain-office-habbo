import { CEO_PROFILE, ROSTER } from "../../../shared/roster";
import { defaultClients } from "../app";
import { hire } from "../org/hire";
import { fileHireStore } from "../org/hireStore";
import { fileBriefs } from "../org/privateBriefs";
import { refreshPersonas } from "../org/refreshPersonas";
import { fileTeamStore } from "../org/teamStore";
import { hermesSkillName } from "../headcount/skillFile";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const { hermes, headcount, skillFiles: files } = defaultClients(process.env);
  const hires = fileHireStore(process.cwd());
  const briefs = fileBriefs(process.cwd());
  const teams = fileTeamStore(process.cwd());
  if (process.argv.includes("--refresh-personas")) {
    const failed = await refreshPersonas({ hermes, hires, apply, briefs, teams });
    if (!apply) console.log("\nDry run. Re-run with --refresh-personas --apply to rewrite each SOUL and description above.");
    if (failed) process.exitCode = 1;
    return;
  }
  const existing = new Set((await hermes.listProfiles()).map((p) => p.name));
  const pending = ROSTER.filter((a) => a.profile !== CEO_PROFILE && !existing.has(a.profile));

  console.log(`${ROSTER.length - 1} roster agents, ${pending.length} not hired yet.`);
  for (const agent of pending) {
    console.log(`- ${agent.profile} (${agent.title}, ${agent.division}) skills: ${agent.skills.map(hermesSkillName).join(", ")}`);
  }
  if (!apply) {
    console.log("\nDry run. Re-run with --apply to clone the default profile and install skills for each agent above.");
    return;
  }

  let failed = 0;
  for (const agent of pending) {
    const result = await hire(agent, { hermes, headcount, hires, briefs, teams, files });
    const failures = result.steps.filter((s) => !s.ok);
    if (failures.length) failed++;
    console.log(`${result.ok ? "hired" : "PARTIAL"} ${agent.profile}`);
    for (const f of failures) console.log(`    ${f.step} ${f.target}: ${f.error}`);
  }
  if (failed) {
    console.log(`\n${failed} agent(s) need attention; re-running is safe (hiring is idempotent).`);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
