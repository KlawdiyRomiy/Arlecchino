import type { BuiltInThemeId, IDEThemeDefinition } from "./themes";

import cobaltSignalNight from "./bundled-themes/01-midnight-cobalt.arlecchino-theme.json";
import emberSignalNight from "./bundled-themes/02-ember-forge.arlecchino-theme.json";
import mossSignalNight from "./bundled-themes/03-moss-observatory.arlecchino-theme.json";
import amethystSignalNight from "./bundled-themes/04-amethyst-rain.arlecchino-theme.json";
import arcticSignalNight from "./bundled-themes/05-arctic-signal.arlecchino-theme.json";
import rosewoodSignalNight from "./bundled-themes/06-rosewood-terminal.arlecchino-theme.json";
import sandstoneSignalNight from "./bundled-themes/07-sandstone-dusk.arlecchino-theme.json";
import limeSignalNight from "./bundled-themes/08-graphite-lime.arlecchino-theme.json";
import seafoamSignalNight from "./bundled-themes/09-deep-sea-ink.arlecchino-theme.json";
import sakuraSignalNight from "./bundled-themes/10-noir-sakura.arlecchino-theme.json";
import cobaltSignalDay from "./bundled-themes/11-alpine-paper.arlecchino-theme.json";
import emberSignalDay from "./bundled-themes/12-citrus-grove.arlecchino-theme.json";
import mossSignalDay from "./bundled-themes/13-lilac-ledger.arlecchino-theme.json";
import amethystSignalDay from "./bundled-themes/14-terracotta-studio.arlecchino-theme.json";
import arcticSignalDay from "./bundled-themes/15-sea-glass.arlecchino-theme.json";
import rosewoodSignalDay from "./bundled-themes/16-blueprint-daylight.arlecchino-theme.json";
import sandstoneSignalDay from "./bundled-themes/17-cherry-blossom.arlecchino-theme.json";
import limeSignalDay from "./bundled-themes/18-cloud-harbor.arlecchino-theme.json";
import seafoamSignalDay from "./bundled-themes/19-lavender-fog.arlecchino-theme.json";
import sakuraSignalDay from "./bundled-themes/20-minted-paper.arlecchino-theme.json";

export type BundledThemeSource = Omit<
  IDEThemeDefinition,
  "id" | "cssVariables"
> & {
  id: BuiltInThemeId;
};

const asBundledThemeSource = (source: unknown): BundledThemeSource =>
  source as BundledThemeSource;

export const bundledThemeSources = [
  cobaltSignalNight,
  emberSignalNight,
  mossSignalNight,
  amethystSignalNight,
  arcticSignalNight,
  rosewoodSignalNight,
  sandstoneSignalNight,
  limeSignalNight,
  seafoamSignalNight,
  sakuraSignalNight,
  cobaltSignalDay,
  emberSignalDay,
  mossSignalDay,
  amethystSignalDay,
  arcticSignalDay,
  rosewoodSignalDay,
  sandstoneSignalDay,
  limeSignalDay,
  seafoamSignalDay,
  sakuraSignalDay,
].map(asBundledThemeSource);
