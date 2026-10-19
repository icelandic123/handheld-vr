/**
 * Build-time stand-in for @pmndrs/uikit-lucide (about 4.7 MB of icon classes).
 * The SDK's UIKitML layer imports the whole icon set, but this app has no
 * spatial UI panels, so no icon is ever created. The two names the horizon kit
 * imports by name still resolve; they only throw if something builds them.
 */
class MissingIcon {
  constructor() {
    throw new Error('Icons are not bundled in this build');
  }
}
export class CheckIcon extends MissingIcon {}
export class ChevronDownIcon extends MissingIcon {}
