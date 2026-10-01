import { useEffect, useRef } from "react";
import type { DivisionId } from "../../shared/divisions";
import type { DivisionStats } from "../../shared/flow";
import type { Insets } from "./camera";
import type { WorldAgent, WorldView } from "./types";
import { World } from "./World";

export interface WorldCanvasProps {
  view: WorldView;
  agents: WorldAgent[];
  stats: Record<DivisionId, DivisionStats> | null;
  selectedAgent: string | null;
  onSelectBuilding(division: DivisionId): void;
  onSelectAgent(profile: string): void;
  className?: string;
  /** Css pixels covered by overlay UI (HUD, side panels); auto-fit centres the world in the rest. Defaults to 0. */
  insets?: Partial<Insets>;
}

export function WorldCanvas(props: WorldCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<World | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;
    let created: World | null = null;
    void World.create(el, {
      onSelectBuilding: (d) => propsRef.current.onSelectBuilding(d),
      onSelectAgent: (p) => propsRef.current.onSelectAgent(p),
    }, { insets: propsRef.current.insets }).then((world) => {
      created = world;
      if (cancelled) {
        world.destroy();
        return;
      }
      const p = propsRef.current;
      world.setView(p.view);
      world.setAgents(p.agents);
      if (p.stats) world.setDivisionStats(p.stats);
      world.setSelectedAgent(p.selectedAgent);
      world.setInsets(p.insets ?? {});
      worldRef.current = world;
    });
    return () => {
      cancelled = true;
      created?.destroy();
      worldRef.current = null;
    };
  }, []);

  useEffect(() => {
    worldRef.current?.setView(props.view);
  }, [props.view]);

  useEffect(() => {
    worldRef.current?.setAgents(props.agents);
  }, [props.agents]);

  useEffect(() => {
    if (props.stats) worldRef.current?.setDivisionStats(props.stats);
  }, [props.stats]);

  useEffect(() => {
    worldRef.current?.setSelectedAgent(props.selectedAgent);
  }, [props.selectedAgent]);

  const { top = 0, right = 0, bottom = 0, left = 0 } = props.insets ?? {};
  useEffect(() => {
    worldRef.current?.setInsets({ top, right, bottom, left });
  }, [top, right, bottom, left]);

  return <div ref={containerRef} className={props.className} style={{ position: "relative", width: "100%", height: "100%" }} />;
}
