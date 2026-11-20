GRAND THEFT AURA - AUDIO
========================

Drop your .mp3, .wav or .ogg files in THIS folder, e.g.

    assets/audio/punch.wav
    assets/audio/theme.mp3

By default the game uses its built-in procedural Web Audio synthesizer.
Any sound event can be overridden with your own file:

    punch       - fist attacks
    batSwing    - bat / crowbar / pipe swings
    hotdogFire  - hotdog shooter
    pickup      - item pickups
    carHorn     - car horn
    engineLoop  - looping engine sound (pitch follows RPM)
    bgMusic     - looping background music while playing

HOW TO BIND A SOUND
-------------------
1. Open studio.html.
2. Left "Assets" panel -> "+ Import Audio File" (pick the file, confirm the
   project path assets/audio/<name>.<ext>). Use "Play" to preview it.
3. Explorer -> Audio Bindings. Pick the file for each event and press
   "Test Sound". Leave an event on "Built-in synth" to keep the original sound.
4. "Save & Test in Game" to try it, "Export levelData.js" to make it permanent
   (replace js/levelData.js with the exported file).

IMPORTANT: for a permanent setup the file must exist at the path you chose, so
copy it into this folder with exactly that name. If a file is missing or cannot
be decoded the game silently falls back to the built-in synth sound.

Browsers only start audio after you click or press a key in the page.
