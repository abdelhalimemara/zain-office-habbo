import { access, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { defaultClients } from "../app";
import { fileHireStore, fullRoster } from "../org/hireStore";
import { allTeams, fileTeamStore } from "../org/teamStore";
import { defaultGhExec } from "../org/techTeams";
import { techSetup } from "../org/techSetup";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const { hermes } = defaultClients(process.env);
  const root = process.cwd();
  const result = await techSetup({
    hermes,
    execFile: defaultGhExec,
    home: homedir(),
    exists: (path) => access(path).then(() => true, () => false),
    mkdir: async (path) => {
      await mkdir(path, { recursive: true });
    },
    teams: await allTeams(fileTeamStore(root)),
    roster: await fullRoster(fileHireStore(root)),
    apply,
    ghBin: process.env.GH_BIN,
  });
  console.log("");
  if (!apply) {
    console.log("Dry run. Re-run with `npm run tech:setup -- --apply` to do the steps above.");
  } else {
    console.log(`Created ${result.createdRepos.length} repo(s), ${result.cloned.length} clone(s), ${result.charters.length} charter task(s).`);
  }
  console.log("Next steps:");
  console.log("  1. npm run seed:roster -- --apply                      (hire every team member; safe to re-run)");
  console.log("  2. npm run seed:roster -- --refresh-personas --apply   (rewrite SOULs of agents hired before)");
  console.log("  3. npm run tech:setup -- --apply                       (again, if a charter was skipped above)");
  console.log("  4. Send Zain Tech a mandate from Zain HQ; the VP Tech fans it out to the team leads.");
  if (result.warnings.length) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
