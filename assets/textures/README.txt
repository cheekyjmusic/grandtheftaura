GRAND THEFT AURA - TEXTURES
===========================

Drop your .png (or .jpg) texture files in THIS folder, e.g.

    assets/textures/brick.png
    assets/textures/metal_plate.png

sample_grid.png is a starter 512x512 texture. Use it to test the pipeline.

HOW TO USE A TEXTURE
--------------------
1. Open studio.html (served through start-windows.bat / start-mac.command).
2. In the left "Assets" panel click  "+ Import PNG Texture", pick your file and
   confirm the project path (assets/textures/<name>.png). The texture shows up as
   a thumbnail and is available instantly for previews.
3. Select any 3D object (or open a model tab) and click the thumbnail - or choose
   it in the Inspector's "PNG Texture" dropdown. Use "UV Repeat X / Y" to tile it.
4. Click "Save & Test in Game" to try it in the game, and "Export levelData.js"
   to make the change permanent (replace js/levelData.js with the exported file).

IMPORTANT: For a permanent setup the file must really exist at the path you
entered, so copy the PNG into this folder with exactly that name (Studio can
download a correctly named copy for you when you import).

Tips
----
- Power-of-two sizes (256, 512, 1024) look best and load fastest.
- Textures tile (repeat) in both directions by default.
- Keep files reasonably small (< 2 MB) so the game starts quickly.
