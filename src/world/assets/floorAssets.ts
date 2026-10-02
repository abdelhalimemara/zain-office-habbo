import type { DivisionId } from "../../../shared/divisions";
import type { SpriteKey } from "../characters";
import hqFloor from "./floors/hq.webp";
import studioFloor from "./floors/studio.webp";
import growthFloor from "./floors/growth.webp";
import labsFloor from "./floors/labs.webp";
import techFloor from "./floors/tech.webp";
import female1 from "./people/female-1.webp";
import female2 from "./people/female-2.webp";
import female3 from "./people/female-3.webp";
import female4 from "./people/female-4.webp";
import female5 from "./people/female-5.webp";
import male1 from "./people/male-1.webp";
import male2 from "./people/male-2.webp";
import male3 from "./people/male-3.webp";
import male4 from "./people/male-4.webp";
import male5 from "./people/male-5.webp";
import male6 from "./people/male-6.webp";
import male7 from "./people/male-7.webp";
import male8 from "./people/male-8.webp";
import male9 from "./people/male-9.webp";
import hormozi from "./board/hormozi.webp";
import alwaleed from "./board/alwaleed.webp";
import bezos from "./board/bezos.webp";
import buffett from "./board/buffett.webp";
import jobs from "./board/jobs.webp";

export const FLOOR_URLS: Readonly<Record<DivisionId, string>> = {
  hq: hqFloor,
  studio: studioFloor,
  growth: growthFloor,
  labs: labsFloor,
  tech: techFloor,
};

export const SPRITE_URLS: Readonly<Record<SpriteKey, string>> = {
  "people/female-1": female1,
  "people/female-2": female2,
  "people/female-3": female3,
  "people/female-4": female4,
  "people/female-5": female5,
  "people/male-1": male1,
  "people/male-2": male2,
  "people/male-3": male3,
  "people/male-4": male4,
  "people/male-5": male5,
  "people/male-6": male6,
  "people/male-7": male7,
  "people/male-8": male8,
  "people/male-9": male9,
  "board/hormozi": hormozi,
  "board/alwaleed": alwaleed,
  "board/bezos": bezos,
  "board/buffett": buffett,
  "board/jobs": jobs,
};
