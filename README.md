<div align="center">

# Vinyl Player

**A minimal Spotify player for macOS that looks and feels like a real turntable.**

Spin the record to scrub through your track, tap to pause, and keep a floating widget in the corner of your screen — all wrapped in a quiet, purple-tinted interface.

[![Platform](https://img.shields.io/badge/platform-macOS-black?style=flat-square)](https://www.apple.com/macos/)
[![Electron](https://img.shields.io/badge/Electron-31-47848F?style=flat-square&logo=electron)](https://www.electronjs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Status](https://img.shields.io/badge/status-active-brightgreen?style=flat-square)]()

</div>

---

## What is this?

Vinyl Player is a desktop music player that reimagines your Spotify library as a physical turntable. Instead of lists and progress bars, you get a spinning record that responds to your touch — drag it to scrub, tap it to play or pause, double-tap to skip.

It sits quietly in your menu bar, runs a tiny local server, and can show up as a floating widget in the corner of your screen while you work on other things.

It's built with [Electron](https://www.electronjs.org/) and runs entirely on your own machine.

---

## Features

- **Physical vinyl control** — Drag the record to scrub, tap to play or pause, double-tap to skip.
- **Live lyrics** — Karaoke mode that follows whatever's playing in real time, powered by [LRCLIB](https://lrclib.net/).
- **Floating widget** — A small, always-on-top vinyl in the corner of your screen. Move it where you want, resize it between 75% and 125%, and lock it in place with Space.
- **Device switching** — Send audio to any Spotify Connect device without missing a beat.
- **Playlist & queue view** — Swipe up for your current playlist or queue, complete with cover art and artist names.
- **Dynamic background** — The backdrop shifts and breathes with the colors of the album art.
- **Menu bar app** — No Dock icon by default. It lives in your menu bar and stays out of your way.

---

## Requirements

- **macOS** (developed and tested on macOS Sonoma and Sequoia)
- **Spotify Premium** — required for playback control via the Spotify Web API
- **A free Spotify Developer account** — you'll create your own app to get a Client ID
- **Node.js 18+** — only if you're building from source

---

## Installation

### Option 1 — Download a release

Download the latest `.dmg` from the [Releases](https://github.com/YOUR_USERNAME/vinyl-player/releases) page, open it, and drag Vinyl Player to your Applications folder.

### Option 2 — Build from source

```bash
git clone https://github.com/YOUR_USERNAME/vinyl-player.git
cd vinyl-player
npm install
npm start
