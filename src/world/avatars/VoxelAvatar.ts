import { Container, Graphics, Point, Sprite, Texture, type DestroyOptions, type PointData } from "pixi.js";
import { AvatarAnimator } from "./animator";
import { frameArt, unitFor, type FrameArt } from "./cache";
import { EmoteFx } from "./fx";
import { Z_SCALE } from "./mesh";
import { seatHeight } from "./model";
import { EMOTE_CLIPS } from "./rig";
import type { AvatarSpec, Emote, Facing, Pose } from "./types";

export interface VoxelAvatarOptions {
  /** Standing height in px (top of hair to the soles, facing SW). */
  height: number;
  facing?: Facing;
  pose?: Pose;
  reducedMotion?: boolean;
  /** Texture resolution for baked frames (defaults to devicePixelRatio). */
  resolution?: number;
}

/**
 * Programmed voxel character. The container origin is the point between the feet on the floor.
 * Frames are baked lazily per spec, facing and pose frame and shared by every avatar.
 */
export class VoxelAvatar extends Container {
  readonly spec: AvatarSpec;
  /** Screen px per voxel step. */
  readonly unit: number;
  readonly footAnchor: PointData = new Point(0, 0);
  /** Where the hips meet a chair seat, relative to the feet (sit/type poses): place the avatar at seat − seatOffset. */
  readonly seatOffset: PointData;
  /** Top of the head when standing, relative to the feet; anchor speech bubbles here. */
  readonly headTop: PointData;
  private readonly anim: AvatarAnimator;
  private readonly sprite = new Sprite(Texture.EMPTY);
  private readonly vector = new Graphics();
  private readonly fx = new EmoteFx();
  private readonly resolution: number;
  private facingValue: Facing;
  private slots: (FrameArt | undefined)[] = [];
  private slotEmoteFrames = 1;
  private shownEmote: Emote = "none";

  constructor(spec: AvatarSpec, opts: VoxelAvatarOptions) {
    super();
    this.spec = spec;
    this.unit = unitFor(spec, opts.height);
    this.resolution = opts.resolution ?? (typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1));
    this.anim = new AvatarAnimator(opts.reducedMotion ?? false);
    this.anim.setPose(opts.pose ?? "stand");
    this.facingValue = opts.facing ?? "SW";
    this.seatOffset = new Point(0, -seatHeight(spec) * Z_SCALE * this.unit);
    this.headTop = new Point(0, -opts.height);
    this.fx.scale.set(this.unit);
    this.fx.position.set(0, -opts.height);
    this.addChild(this.sprite, this.vector, this.fx);
    this.resetSlots();
  }

  get facing(): Facing {
    return this.facingValue;
  }

  get pose(): Pose {
    return this.anim.pose;
  }

  get emote(): Emote {
    return this.anim.emote;
  }

  get reducedMotion(): boolean {
    return this.anim.reducedMotion;
  }

  setFacing(f: Facing): void {
    if (f === this.facingValue) return;
    this.facingValue = f;
    this.resetSlots();
  }

  setPose(p: Pose): void {
    if (p === this.anim.pose) return;
    this.anim.setPose(p);
    this.resetSlots();
  }

  /** Timed emotes (wave, thumbsUp, thinking, celebrate) play once then return to none; frustrated and sleepy loop. */
  setEmote(e: Emote): void {
    this.anim.setEmote(e);
    this.resetSlots();
  }

  setReducedMotion(reduced: boolean): void {
    this.anim.setReducedMotion(reduced);
    this.showFrame();
  }

  update(dtMs: number): void {
    const emoteBefore = this.anim.emote;
    const changed = this.anim.update(dtMs);
    if (this.anim.emote !== emoteBefore) this.resetSlots();
    else if (changed) this.showFrame();
    this.fx.update(dtMs, this.anim.reducedMotion);
  }

  private resetSlots(): void {
    this.slotEmoteFrames = EMOTE_CLIPS[this.anim.emote].frames;
    this.slots.length = 0;
    if (this.shownEmote !== this.anim.emote) {
      this.shownEmote = this.anim.emote;
      this.fx.show(this.anim.emote);
    }
    this.showFrame();
  }

  private showFrame(): void {
    const a = this.anim;
    const i = a.poseFrame * this.slotEmoteFrames + a.emoteFrame;
    let art = this.slots[i];
    if (!art) {
      art = frameArt(this.spec, this.facingValue, a.pose, a.poseFrame, a.emote, a.emoteFrame, this.unit, this.resolution);
      this.slots[i] = art;
    }
    const hop = a.hop * Z_SCALE * this.unit;
    if (art.texture) {
      this.sprite.texture = art.texture;
      this.sprite.position.set(art.x, art.y - hop);
      this.sprite.visible = true;
      this.vector.visible = false;
    } else if (art.context) {
      this.vector.context = art.context;
      this.vector.position.set(0, -hop);
      this.vector.visible = true;
      this.sprite.visible = false;
    }
    this.fx.y = this.headTop.y + art.drop * Z_SCALE * this.unit - hop;
  }

  override destroy(options?: DestroyOptions): void {
    this.slots.length = 0;
    super.destroy(typeof options === "boolean" ? options : { ...(options ?? {}), children: true, texture: false, context: false });
  }
}
