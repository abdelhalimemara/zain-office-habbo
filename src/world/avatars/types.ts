import type { SpriteKey } from "../characters";

export type Facing = "SE" | "SW" | "NE" | "NW";
export type Pose = "stand" | "walk" | "sit" | "type";
export type Emote = "none" | "wave" | "thumbsUp" | "frustrated" | "thinking" | "celebrate" | "sleepy";

export const FACINGS: readonly Facing[] = ["SW", "SE", "NW", "NE"];
export const POSES: readonly Pose[] = ["stand", "walk", "sit", "type"];
export const EMOTES: readonly Emote[] = ["none", "wave", "thumbsUp", "frustrated", "thinking", "celebrate", "sleepy"];

export type HairStyle =
  | "sidePart"
  | "quiff"
  | "short"
  | "wavyWhite"
  | "bald"
  | "bun"
  | "topKnot"
  | "lowBun"
  | "bob"
  | "wavyLong"
  | "cap"
  | "ghutra";

export type TopKind = "suit" | "shirt" | "jacketTee" | "overshirt" | "turtleneck" | "dress" | "blazer" | "bisht";
export type BottomKind = "trousers" | "jeans" | "shorts" | "skirt" | "robe";
export type ShoeKind = "dress" | "sneakers" | "heels";
export type Accessory =
  | "glassesSquare"
  | "glassesRound"
  | "beard"
  | "moustache"
  | "stubble"
  | "earrings"
  | "nose"
  | "pocketSquare"
  | "breastPocket"
  | "logo";

/** Body proportions in voxels. Every field has a default (see `bodyOf`). */
export interface BodySpec {
  torsoW?: number;
  torsoD?: number;
  torsoH?: number;
  thighW?: number;
  /** Lateral distance of each leg's centre from the body centre. */
  hipX?: number;
  shinW?: number;
  legD?: number;
  thighLen?: number;
  shinLen?: number;
  armW?: number;
  armD?: number;
  upperArm?: number;
  foreArm?: number;
  headW?: number;
  headD?: number;
  headH?: number;
}

export interface HairSpec {
  style: HairStyle;
  color: number;
  /** Secondary colour: cap fabric, ghutra pattern, agal. */
  accent?: number;
  accent2?: number;
}

export interface TopSpec {
  kind: TopKind;
  color: number;
  /** Shirt, tee or thobe colour. */
  accent?: number;
  tie?: number;
  /** Gold bisht trim, lapel highlight. */
  trim?: number;
  /** How far the shirt V reaches down the torso, 0..1. */
  vDepth?: number;
  sleeve?: "long" | "short" | "none";
}

export interface BottomSpec {
  kind: BottomKind;
  color: number;
  belt?: number;
  buckle?: number;
  cuff?: number;
}

export interface ShoeSpec {
  kind: ShoeKind;
  color: number;
  sole?: number;
}

export interface AvatarSpec {
  key: SpriteKey;
  body?: BodySpec;
  skin: number;
  hair: HairSpec;
  /** Eyebrow colour (defaults to a darkened hair colour). */
  brow?: number;
  /** Eye height in voxels (default 3). */
  eyeH?: number;
  /** Rows of skin between brows and eyes (default 1). */
  browGap?: number;
  top: TopSpec;
  bottom: BottomSpec;
  shoes: ShoeSpec;
  accessories: readonly Accessory[];
  /** Beard, moustache and stubble colour. */
  facialHair?: number;
}

/** Joint angles in degrees, offsets in voxels. Pitch swings the far end forward, roll swings it outward. */
export interface Rig {
  hipR: number;
  hipL: number;
  kneeR: number;
  kneeL: number;
  shoulderR: Joint;
  shoulderL: Joint;
  elbowR: number;
  elbowL: number;
  headYaw: number;
  headPitch: number;
  /** Lowers the whole body (sitting). */
  drop: number;
  thumbL: boolean;
}

export interface Joint {
  pitch: number;
  roll: number;
  yaw: number;
}
