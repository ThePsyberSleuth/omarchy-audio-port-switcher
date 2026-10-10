# Audio Port Switcher for Omarchy

A drop-in replacement for Omarchy's stock audio widget (`omarchy.audio`). It keeps the stock speaker, mute and headphone icons, volume controls and per-app mixer, and adds switching between devices, ports and card profiles.

## Install

```sh
omarchy plugin add https://github.com/ThePsyberSleuth/omarchy-audio-port-switcher.git --enable
```

Or open the Omarchy menu with Super+Space, go to **Setup → Plugins → Add Plugin**, and paste the URL.

Enabling it replaces the stock audio widget in the same spot on the bar.

## Remove

```sh
omarchy plugin remove thepsybersleuth.audio-port-switcher
```

Removing or disabling it puts the stock audio widget back where it was.

## Requirements

- Omarchy 4 (Quattro) shell. Tested on Qt 6.12; palette references use `Commons.Color`, which also works on Qt 6.11.
- Everything else ships with Omarchy: PipeWire with WirePlumber, `pactl` (from `libpulse`), and the `omarchy-audio-*` commands.

## What it does

- **Output and input devices**: picks the default sink or source through Omarchy's own `omarchy-audio-output-set-default` / `omarchy-audio-input-set-default`, so volume keys and the stock switcher agree with it.
- **Ports**: switches between the current device's ports (speakers, headphones, line out) with `pactl set-sink-port` / `set-source-port`.
- **Card profiles**: some laptop codecs only create an HDMI or DisplayPort output after you switch the card profile. This section lists those profiles from `pactl -f json list cards` and switches with `pactl set-card-profile`. Profiles whose outputs are physically absent are left out, and the section hides itself when a card offers no real alternative.
- **Per-app mixing** and media controls through PipeWire and MPRIS.
- Scrolling on the icon changes the volume and shows Omarchy's volume OSD.
- The **Super+Ctrl+A** keybinding and `omarchy-shell shell toggle omarchy.audio` open this panel, because it answers on the stock `omarchy.audio` target.

Nothing here is tied to specific hardware: every section is built from what PipeWire and `pactl` report on your machine.

## Security

Plugins run unsandboxed inside `omarchy-shell`. This plugin needs no privileges; it only runs `pactl` and Omarchy's `omarchy-audio-*` commands as your user.

## Files

- `manifest.json`: plugin id, version, and the `omarchy.audio` replacement metadata.
- `AudioWidget.qml`: bar button and popup.
- `Model.js`: device, port, profile and icon helpers.

## License

MIT
