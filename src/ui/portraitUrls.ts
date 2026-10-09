import type { TexturedSpriteKey } from "../world/characters";
import female1 from "../world/assets/people/female-1.webp";
import female2 from "../world/assets/people/female-2.webp";
import female3 from "../world/assets/people/female-3.webp";
import female4 from "../world/assets/people/female-4.webp";
import female5 from "../world/assets/people/female-5.webp";
import male1 from "../world/assets/people/male-1.webp";
import male2 from "../world/assets/people/male-2.webp";
import male3 from "../world/assets/people/male-3.webp";
import male4 from "../world/assets/people/male-4.webp";
import male5 from "../world/assets/people/male-5.webp";
import male6 from "../world/assets/people/male-6.webp";
import male7 from "../world/assets/people/male-7.webp";
import male8 from "../world/assets/people/male-8.webp";
import male9 from "../world/assets/people/male-9.webp";
import hormozi from "../world/assets/board/hormozi.webp";
import alwaleed from "../world/assets/board/alwaleed.webp";
import bezos from "../world/assets/board/bezos.webp";
import buffett from "../world/assets/board/buffett.webp";
import jobs from "../world/assets/board/jobs.webp";

export const PORTRAIT_URLS: Readonly<Record<TexturedSpriteKey, string>> = {
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
