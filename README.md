# TF frame viewer

A static website that draws coordinate frames (red = x, green = y, blue = z). The website is accessible here:

[TFviz](https://johannesernst.github.io/tfviz/)

Enter a pose for **frame 1** relative to the world origin and a pose for **frame 2** relative to frame 1.
The 3D view updates as you type or drag the sliders. Orbit with the left mouse button, pan with the right, zoom with the wheel.

- Inputs per frame: `x, y, z, roll, pitch, yaw` (angles in degrees or radians, switchable).
- Convention (ROS REP-103): `R = Rz(yaw) · Ry(pitch) · Rx(roll)`, i.e. fixed-axis roll, pitch, yaw.
- Frame 2 in the world is `T_world_frame2 = T_world_frame1 · T_frame1_frame2`; the resulting pose and 4×4 matrix are shown in the side panel.
- The current values are stored in the URL hash, so you can bookmark or share a configuration.

## Repository layout

```
site/index.html            page structure and import map (three.js from jsDelivr)
site/style.css             styling
site/app.js                math, 3D scene and input handling
.github/workflows/pages.yml  deploys ./site to GitHub Pages
```

## Run locally

ES modules do not load from `file://`, so serve the folder:

```bash
cd site
python3 -m http.server 8000   # then open http://localhost:8000
```

## Offline use

To avoid the CDN, download `three.module.js` and `examples/jsm/controls/OrbitControls.js` (three r160) into `site/vendor/` and point the import map in `index.html` at them. Note that `OrbitControls.js` imports `three`, which the import map resolves.
