// Maps a TrackDef.icon name to a Phosphor component, kept out of the data
// layer so lib/helpdesk/tracks.ts stays JSX-free.
import { Headset, ShieldCheck, Code, Bug, type Icon } from "@phosphor-icons/react";

const TRACK_ICONS: Record<string, Icon> = {
  Headset,
  ShieldCheck,
  Code,
  Bug,
};

export function trackIconFor(name: string): Icon {
  return TRACK_ICONS[name] ?? Code;
}
