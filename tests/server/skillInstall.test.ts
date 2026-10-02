import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HeadcountSource, SUPPORTING_FILE } from "../../server/src/headcount/catalog";
import { diskSkillFiles, skillFilesFor } from "../../server/src/headcount/install";
import { toHermesSkill } from "../../server/src/headcount/skillFile";
import { SKILL_SOURCES } from "../../shared/skillSources";
import { json, mockFetch } from "./helpers";

const mk = SKILL_SOURCES.find((s) => s.id === "mk")!;
const TREE = `GET /repos/${mk.repo}/git/trees/${mk.ref}`;

describe("supporting files of a multi-file skill", () => {
  it("lists references, templates and assets of the reviewed skill only, from one cached tree", async () => {
    const fetch = mockFetch({
      [TREE]: () => ({
        tree: [
          { path: "skills/ads/SKILL.md", type: "blob" },
          { path: "skills/ads/references/b.md", type: "blob" },
          { path: "skills/ads/references/a.md", type: "blob" },
          { path: "skills/ads/references/nested/c.md", type: "blob" },
          { path: "skills/ads/evals/evals.json", type: "blob" },
          { path: "skills/ads/scripts/run.sh", type: "blob" },
          { path: "skills/ads/references/.hidden", type: "blob" },
          { path: "skills/ads-extra/references/x.md", type: "blob" },
        ],
      }),
    });
    const source = new HeadcountSource({ fetchImpl: fetch.fetchImpl });
    expect(await source.supportingFiles("mk:ads")).toEqual(["references/a.md", "references/b.md", "references/nested/c.md"]);
    expect(await source.supportingFiles("mk:cro")).toEqual([]);
    expect(await source.supportingFiles("mk:not-reviewed")).toEqual([]);
    expect(await source.supportingFiles("hormozi:pricing-strategy")).toEqual([]);
    expect(await source.supportingFiles("marketing:brand-voice")).toEqual([]);
    expect(fetch.called(TREE)).toHaveLength(1);
  });

  it("refuses a truncated tree and retries it next time", async () => {
    let n = 0;
    const fetch = mockFetch({ [TREE]: () => (++n === 1 ? { tree: [], truncated: true } : { tree: [{ path: "skills/ads/references/a.md", type: "blob" }] }) });
    const source = new HeadcountSource({ fetchImpl: fetch.fetchImpl });
    await expect(source.supportingFiles("mk:ads")).rejects.toThrow(/incomplete/);
    expect(await source.supportingFiles("mk:ads")).toEqual(["references/a.md"]);
  });

  it("fetches a file from raw GitHub at the pinned ref and rejects paths outside the allowed folders", async () => {
    const fetch = mockFetch({ [`GET /${mk.repo}/${mk.ref}/skills/ads/references/a.md`]: () => new Response("# A") });
    const source = new HeadcountSource({ fetchImpl: fetch.fetchImpl });
    expect(await source.supportingFile("mk:ads", "references/a.md")).toBe("# A");
    for (const bad of ["../SKILL.md", "references/../../x", "evals/evals.json", "SKILL.md", "/etc/passwd"]) {
      await expect(source.supportingFile("mk:ads", bad)).rejects.toThrow(/invalid supporting file/);
    }
    expect(SUPPORTING_FILE.test("assets/creative-review-template.html")).toBe(true);
  });

  it("surfaces a GitHub failure", async () => {
    const source = new HeadcountSource({ fetchImpl: mockFetch({ [TREE]: () => json({ message: "rate limited" }, 403) }).fetchImpl });
    await expect(source.supportingFiles("mk:ads")).rejects.toThrow(/403/);
  });
});

describe("diskSkillFiles", () => {
  let root: string;
  let skillMd: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "zain-skill-"));
    const dir = join(root, "profiles", "zain-growth-paid", "skills", "zain-marketing", "mk-ads");
    await mkdir(dir, { recursive: true });
    skillMd = join(dir, "SKILL.md");
    await writeFile(skillMd, "---\nname: mk-ads\n---\n");
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("writes a missing file (with its folders) and leaves an existing one alone", async () => {
    const sink = diskSkillFiles();
    expect(await sink.write(skillMd, "references/nested/a.md", "# A")).toBe(true);
    expect(await readFile(join(root, "profiles/zain-growth-paid/skills/zain-marketing/mk-ads/references/nested/a.md"), "utf8")).toBe("# A");
    expect(await sink.write(skillMd, "references/nested/a.md", "# changed")).toBe(false);
    expect(await readFile(join(root, "profiles/zain-growth-paid/skills/zain-marketing/mk-ads/references/nested/a.md"), "utf8")).toBe("# A");
  });

  it("refuses paths that leave the skill folder, and targets that are not a Hermes SKILL.md", async () => {
    const sink = diskSkillFiles();
    await expect(sink.write(skillMd, "../escape.md", "x")).rejects.toThrow(/refusing/);
    await expect(sink.write(skillMd, "references/../../escape.md", "x")).rejects.toThrow(/refusing/);
    await expect(sink.write(join(root, "README.md"), "references/a.md", "x")).rejects.toThrow(/not a Hermes SKILL.md/);
    await expect(sink.write("relative/skills/x/SKILL.md", "references/a.md", "x")).rejects.toThrow(/not a Hermes SKILL.md/);
  });

  it("refuses a skill folder that is a symlink", async () => {
    const link = join(root, "profiles", "zain-growth-paid", "skills", "zain-marketing", "mk-link");
    await symlink(join(root, "profiles"), link);
    await expect(diskSkillFiles().write(join(link, "SKILL.md"), "references/a.md", "x")).rejects.toThrow(/not a plain directory/);
  });

  it("is only used when Hermes runs on this machine", () => {
    expect(skillFilesFor("http://127.0.0.1:9119")).toBeDefined();
    expect(skillFilesFor("http://localhost:9119")).toBeDefined();
    expect(skillFilesFor("https://hermes.example.com")).toBeUndefined();
    expect(skillFilesFor("not a url")).toBeUndefined();
  });
});

describe("marketingskills SKILL.md for Hermes", () => {
  it("keeps the body, credits the pinned repo and points at Zain's context file", () => {
    const upstream = "---\nname: ads\ndescription: When the user wants paid ads help.\n---\n\n# Ads\n\nIf `.agents/product-marketing.md` exists, read it.\n";
    const skill = toHermesSkill("mk:ads", upstream);
    expect(skill.name).toBe("mk-ads");
    expect(skill.category).toBe("zain-marketing");
    expect(skill.content).toMatch(/^---\nname: mk-ads\ndescription: "Ads \(mk\)\."\n---\n/);
    expect(skill.content).toContain(`> Skill \`mk:ads\` from github.com/coreyhaines31/marketingskills at ${mk.ref.slice(0, 12)} (MIT).`);
    expect(skill.content).toContain("read it wherever this skill says `.agents/product-marketing.md`");
    expect(skill.content).toContain("installed with the `mk-` prefix");
    expect(skill.content).toContain("**When to use:** When the user wants paid ads help.");
    expect(skill.content).toContain("# Ads");
  });
});
