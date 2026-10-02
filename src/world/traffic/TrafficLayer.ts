import { Assets, Container, Graphics, Sprite, type Texture } from "pixi.js";
import car1 from "../assets/cars/car1.webp";
import car2 from "../assets/cars/car2.webp";
import car3 from "../assets/cars/car3.webp";
import car4 from "../assets/cars/car4.webp";
import car5 from "../assets/cars/car5.webp";
import car6 from "../assets/cars/car6.webp";
import car7 from "../assets/cars/car7.webp";
import { OCCLUDERS } from "./occluders";
import { TrafficSim } from "./sim";

const CAR_URLS = [car1, car2, car3, car4, car5, car6, car7];

/** Drawn car width in image pixels: about one lane, judged against the crosswalks. */
export const CAR_WIDTH = 54;
/** Where the wheels' footprint centre sits in the trimmed car art. */
const ANCHOR_Y = 0.64;

/**
 * Cars between the city image and its labels. `cars` sits just above the city sprite; `front` above it
 * redraws the buildings that stand in front of a road, so cars slip behind them.
 */
export class TrafficLayer {
  readonly cars = new Container();
  readonly front = new Container();
  private readonly sim: TrafficSim;
  private readonly sprites: Sprite[] = [];
  private textures: Texture[] = [];
  private reduced: boolean;
  private ready = false;
  private destroyed = false;

  constructor(reducedMotion: boolean, rng: () => number = Math.random) {
    this.sim = new TrafficSim(undefined, rng, CAR_URLS.length);
    this.cars.eventMode = "none";
    this.front.eventMode = "none";
    this.cars.sortableChildren = true;
    this.reduced = reducedMotion;
    this.applyVisibility();
  }

  async load(city: Texture): Promise<void> {
    const textures = await Promise.all(
      CAR_URLS.map((src) =>
        Assets.load<Texture>({
          src,
          data: { alphaMode: "premultiply-alpha-on-upload", scaleMode: "linear", autoGenerateMipmaps: true },
        }),
      ),
    );
    if (this.destroyed) return;
    for (const t of textures) {
      t.source.autoGenerateMipmaps = true;
      t.source.updateMipmaps();
    }
    this.textures = textures;

    const overlay = new Sprite(city);
    const mask = new Graphics();
    for (const poly of OCCLUDERS) mask.poly(poly.flatMap((p) => [p.x, p.y])).fill(0xffffff);
    overlay.mask = mask;
    this.front.addChild(overlay, mask);

    for (let i = 0; i < this.sim.cars.length; i++) {
      const sprite = new Sprite(textures[0]);
      sprite.anchor.set(0.5, ANCHOR_Y);
      sprite.visible = false;
      this.sprites.push(sprite);
      this.cars.addChild(sprite);
    }
    this.sim.seed();
    this.ready = true;
    this.sync();
  }

  update(dtMs: number): void {
    if (!this.ready || this.reduced || pageHidden()) return;
    this.sim.update(dtMs / 1000);
    this.sync();
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
    this.applyVisibility();
  }

  destroy(): void {
    this.destroyed = true;
    this.ready = false;
    this.cars.destroy({ children: true });
    this.front.destroy({ children: true });
  }

  private applyVisibility(): void {
    this.cars.visible = !this.reduced;
    this.front.visible = !this.reduced;
  }

  private sync(): void {
    const cars = this.sim.cars;
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]!;
      const sprite = this.sprites[i]!;
      if (!car.active) {
        sprite.visible = false;
        continue;
      }
      const texture = this.textures[car.sprite]!;
      if (sprite.texture !== texture) sprite.texture = texture;
      const k = CAR_WIDTH / texture.width;
      sprite.scale.set(car.mirrored ? -k : k, k);
      sprite.position.set(car.x, car.y);
      sprite.alpha = car.alpha;
      sprite.zIndex = car.y;
      sprite.visible = car.alpha > 0;
    }
  }
}

function pageHidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}
