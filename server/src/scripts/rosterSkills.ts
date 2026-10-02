import { defaultClients } from "../app";
import { fileHireStore } from "../org/hireStore";
import { syncSkills } from "../org/skillSync";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const profile = argValue("--profile");
  if (process.argv.includes("--profile") && !profile) throw new Error("--profile needs a profile name");
  const { hermes, headcount, skillFiles: files } = defaultClients(process.env);
  if (!files) console.log("Hermes is not on this machine: multi-file skills will install SKILL.md without their references.\n");
  const failed = await syncSkills({ hermes, headcount, hires: fileHireStore(process.cwd()), apply, profile, files });
  if (!apply) console.log("Dry run. Re-run with `npm run roster:skills -- --apply` to install the skills and SOUL updates above.");
  if (failed) {
    console.log(`\n${failed} step(s) failed; re-running is safe (the sync is idempotent).`);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
