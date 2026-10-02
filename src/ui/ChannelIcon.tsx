import { CHANNEL_LABEL, type ClientChannel } from "./clientReply";

/** Small line icon for a client channel; decorative unless `labelled` is false. */
export function ChannelIcon({ channel, labelled = true }: { channel: ClientChannel; labelled?: boolean }) {
  const a11y = labelled ? { "aria-hidden": true } : { role: "img", "aria-label": CHANNEL_LABEL[channel] };
  return (
    <svg className={`zui-channel-icon zui-channel-icon--${channel}`} viewBox="0 0 16 16" width="14" height="14" {...a11y}>
      {channel === "email" ? (
        <path d="M2 4h12v8H2z M2 4l6 5 6-5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      ) : (
        <path
          d="M8 2a6 6 0 0 0-5.2 9l-.8 3 3.1-.8A6 6 0 1 0 8 2z M6 5.5c.3 1.9 1.6 3.4 3.7 4.3l.9-.9 1.2.6-.3 1.2c-3 .2-6-2.8-5.8-5.8L7 4.6l.6 1.2z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export function ChannelLabel({ channel }: { channel: ClientChannel | null }) {
  if (!channel) return <span className="zui-channel">—</span>;
  return (
    <span className={`zui-channel zui-channel--${channel}`}>
      <ChannelIcon channel={channel} />
      {CHANNEL_LABEL[channel]}
    </span>
  );
}
