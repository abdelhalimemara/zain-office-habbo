import type { SpriteKey } from "../../characters";
import female_1Url from "./people-female-1.webp";
import female_1Meta from "./people-female-1.json";
import female_2Url from "./people-female-2.webp";
import female_2Meta from "./people-female-2.json";
import female_3Url from "./people-female-3.webp";
import female_3Meta from "./people-female-3.json";
import female_4Url from "./people-female-4.webp";
import female_4Meta from "./people-female-4.json";
import female_5Url from "./people-female-5.webp";
import female_5Meta from "./people-female-5.json";
import male_1Url from "./people-male-1.webp";
import male_1Meta from "./people-male-1.json";
import male_2Url from "./people-male-2.webp";
import male_2Meta from "./people-male-2.json";
import male_3Url from "./people-male-3.webp";
import male_3Meta from "./people-male-3.json";
import male_4Url from "./people-male-4.webp";
import male_4Meta from "./people-male-4.json";
import male_5Url from "./people-male-5.webp";
import male_5Meta from "./people-male-5.json";
import male_6Url from "./people-male-6.webp";
import male_6Meta from "./people-male-6.json";
import male_7Url from "./people-male-7.webp";
import male_7Meta from "./people-male-7.json";
import male_8Url from "./people-male-8.webp";
import male_8Meta from "./people-male-8.json";
import male_9Url from "./people-male-9.webp";
import male_9Meta from "./people-male-9.json";
import hormoziUrl from "./board-hormozi.webp";
import hormoziMeta from "./board-hormozi.json";
import alwaleedUrl from "./board-alwaleed.webp";
import alwaleedMeta from "./board-alwaleed.json";
import bezosUrl from "./board-bezos.webp";
import bezosMeta from "./board-bezos.json";
import buffettUrl from "./board-buffett.webp";
import buffettMeta from "./board-buffett.json";
import jobsUrl from "./board-jobs.webp";
import jobsMeta from "./board-jobs.json";

export const ATLASES: Readonly<Record<SpriteKey, { url: string; meta: unknown }>> = {
  "people/female-1": { url: female_1Url, meta: female_1Meta },
  "people/female-2": { url: female_2Url, meta: female_2Meta },
  "people/female-3": { url: female_3Url, meta: female_3Meta },
  "people/female-4": { url: female_4Url, meta: female_4Meta },
  "people/female-5": { url: female_5Url, meta: female_5Meta },
  "people/male-1": { url: male_1Url, meta: male_1Meta },
  "people/male-2": { url: male_2Url, meta: male_2Meta },
  "people/male-3": { url: male_3Url, meta: male_3Meta },
  "people/male-4": { url: male_4Url, meta: male_4Meta },
  "people/male-5": { url: male_5Url, meta: male_5Meta },
  "people/male-6": { url: male_6Url, meta: male_6Meta },
  "people/male-7": { url: male_7Url, meta: male_7Meta },
  "people/male-8": { url: male_8Url, meta: male_8Meta },
  "people/male-9": { url: male_9Url, meta: male_9Meta },
  "board/hormozi": { url: hormoziUrl, meta: hormoziMeta },
  "board/alwaleed": { url: alwaleedUrl, meta: alwaleedMeta },
  "board/bezos": { url: bezosUrl, meta: bezosMeta },
  "board/buffett": { url: buffettUrl, meta: buffettMeta },
  "board/jobs": { url: jobsUrl, meta: jobsMeta },
};
