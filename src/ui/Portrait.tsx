import { useState } from "react";
import type { Rank } from "@shared/roster";
import { spriteFor } from "../world/characters";
import { Avatar, type AvatarSize } from "./Avatar";
import { PORTRAIT_URLS } from "./portraitUrls";

export interface PortraitProps {
  /** Roster profile and rank; without them there is no character, so the initials circle is shown. */
  agent?: { profile: string; rank: Rank } | null;
  name: string;
  size?: AvatarSize;
  color?: string;
  vacant?: boolean;
  /** True when the name is already shown next to the portrait, so the image is decorative. */
  labelled?: boolean;
}

export function Portrait({ agent, name, size = "sm", color, vacant, labelled = true }: PortraitProps) {
  const [failed, setFailed] = useState(false);
  const sprite = agent ? spriteFor(agent.profile, agent.rank) : null;
  if (!sprite || failed) return <Avatar name={name} color={color} size={size} vacant={vacant} />;
  return (
    <span className={`zui-portrait zui-avatar--${size}${vacant ? " zui-portrait--vacant" : ""}`} data-sprite={sprite}>
      <img
        className={`zui-portrait__img${sprite.startsWith("board/") ? " zui-portrait__img--board" : ""}`}
        src={PORTRAIT_URLS[sprite]}
        alt={labelled ? "" : name}
        draggable={false}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
