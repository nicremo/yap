# Yap logo assets

The approved identity is the black sculptural Y with a small four-point star cutout in its upper left arm on an ice-blue tile.

- `approved-original.png` preserves the approved artwork.
- `icon-512.png` is the transparent desktop tile.
- `mark.png` contains the isolated mark.
- `mark-dark.png` and `mark-light.png` are monochrome variants.
- The SVG files embed the corresponding raster artwork. They are compatibility wrappers, not editable vector paths.
- `cover.svg` and `../cover.png` use the same identity for the repository cover.

The macOS application uses `build/icons/icon.icns`. The Dock override uses `build/icons/appIcon.png` in development and the packaged `icons/appIcon.png` resource. The sidebar and welcome screen use `src/renderer/logo.png`.

The menu bar uses `build/icons/trayTemplate.png` and its `@2x` companion. Electron marks the image as a template so macOS can adapt it to the menu bar appearance.
