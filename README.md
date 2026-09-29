# VECTOR-TRACK

Interactive orbital satellite telemetry visualizer for the browser. VECTOR-TRACK renders a wireframe Earth and live satellite positions in Three.js, propagates orbital data with `satellite.js`, and exposes telemetry relative to a configurable ground observation station.

<img width="1462" height="727" alt="Screenshot 2026-09-25 at 03 24 10" src="https://github.com/user-attachments/assets/5a4aec3c-f197-4675-b82e-8ce68b526bdb" />

## Features

- Three-dimensional wireframe Earth with orbit paths, coordinate grid, axes, and starfield
- Live satellite positions from CelesTrak active-satellite TLE data
- SGP4 orbit propagation through `satellite.js`
- Click-to-select satellite telemetry, including:
  - NORAD catalog ID and name
  - Satellite classification and status
  - Altitude, velocity, orbital period, and inclination
  - Sub-satellite latitude, longitude, and ECI coordinates
  - Observer azimuth, elevation, range, and line-of-sight status
- Automatic ISS selection when NORAD ID `25544` is available
- Ground observer configuration with browser-local persistence
- Time travel slider for a 24-hour historical or future projection window
- Camera modes for free look, selected-satellite following, and automatic rotation
- Constellation filters for GPS, communications, science, and debris objects
- Space scan visualization and optional scene layers

## AI Disclaimer

Some of the code, documentation, and content in this repository were created with the assistance of AI tools. 

To ensure quality and reliability, all agentic coding output is thoroughly reviewed, tested, and refined by me.

I remain solely responsible for the content, security, and reliability of this project. If you encounter any bugs or inconsistencies, please open an Issue so we can address them.

## Requirements

- Python 3
- A modern browser with WebGL support
- Network access to CelesTrak for fresh TLE data on the first run or after the cache expires

The frontend libraries are loaded from public CDNs, so an internet connection is also required unless those assets are hosted locally.

## Run Locally

1. Clone the repository and enter its directory:

   ```bash
   git clone https://github.com/rngkGit/Satellite-Tracker.git
   cd Satellite-Tracker
   ```

2. Start the included proxy and static file server:

   ```bash
   python3 server.py
   ```

3. Open the application at [http://localhost:8080](http://localhost:8080).

The server must be used instead of opening `index.html` directly. The frontend requests satellite data from the relative endpoint `/api/satellites`.

To use another port, change `PORT` near the top of `server.py`, then restart the server.

## How Data Works

`server.py` serves the static application and provides the `/api/satellites` endpoint. When the endpoint is requested, it:

1. Uses `active_satellites.tle` when the file is less than 24 hours old.
2. Otherwise fetches the active satellite group from CelesTrak.
3. Stores the downloaded TLE content in `active_satellites.tle`.
4. Falls back to the existing cache if the network request fails.
5. Parses each three-line TLE record into JSON containing the satellite name, NORAD ID, classification, and two orbital lines.

The browser validates and propagates each record using `satellite.js`. Invalid or malformed records are skipped.

### API response

`GET /api/satellites` returns an array like:

```json
[
  {
    "id": "25544",
    "name": "ISS (ZARYA)",
    "group": "science",
    "line1": "1 ...",
    "line2": "2 ..."
  }
]
```

The server classifies satellites from name patterns. GPS and NAVSTAR objects are placed in `GPS`; Starlink and other communications constellations are placed in `comms`; recognized debris names are placed in `debris`; recognized research, weather, and crewed objects are placed in `science`. Unmatched objects use the `science` fallback.

## Using the Interface

### Select and inspect a satellite

Click a satellite point in the main viewport to open the telemetry panel. The selected object receives a marker and its orbital path is displayed when orbit paths are enabled.

### Configure the observer

Enter latitude and longitude in decimal degrees in the telemetry panel, then choose **Update Observer**. Values are stored in `localStorage` as `gs_latitude` and `gs_longitude` for the current browser profile.

The default observer is near Cape Canaveral, Florida:

```text
Latitude:  28.3922
Longitude: -80.6077
```

### Move through time

Use the timeline slider to view positions from 24 hours in the past to 24 hours in the future. Returning the slider to the center restores live tracking. The **Snap to Live** control also resets the timeline.

### Camera and scene controls

- **Free Look**: orbit the camera manually
- **Follow Sel**: keep the selected satellite centered
- **Auto Rotate**: rotate the camera around the scene
- **Re-Center**: return to the default camera position
- **Orbit Paths**: show or hide the selected orbit path
- **Show Grid**: show or hide the Earth grid and axes
- **Starfield**: show or hide the background stars
- **Scan Space**: trigger a radial scan animation

The constellation filters toggle GPS, communications, science, and debris objects independently.

## Project Structure

| File | Purpose |
| --- | --- |
| `index.html` | Application markup and CDN library references |
| `app.js` | Three.js scene, UI behavior, satellite propagation, and telemetry |
| `style.css` | Full-screen monochrome HUD styling |
| `server.py` | Static server, CelesTrak proxy, TLE parser, and cache handling |
| `active_satellites.tle` | Local TLE cache and offline fallback data |

## Troubleshooting

### `CONNECTION_FAIL` or no satellites appear

Confirm that:

- `server.py` is running and the page was opened at `http://localhost:8080`.
- The browser can reach CelesTrak.
- The terminal running the server does not report a TLE download or parsing error.
- `active_satellites.tle` exists if you need to work without network access.

You can test the API directly:

```bash
curl http://localhost:8080/api/satellites
```

### The page is blank

Check that the browser supports WebGL and that the CDN resources for Three.js, OrbitControls, and `satellite.js` are reachable. Browser developer tools will show failed script or network requests.

### Satellite positions differ from another tracker

TLE data changes over time, and the tracker propagates the downloaded records for the current or selected simulation time. Different TLE epochs, update times, or propagation settings can produce small differences.

## Data and Operational Notes

- Orbital predictions are based on publicly available TLE data and are not suitable for safety-critical navigation.
- CelesTrak availability and rate limits are outside this project’s control.
- The cache is refreshed after 24 hours and is overwritten by the next successful download.
- The server currently listens on all local interfaces at port `8080`.

## License

Distributed under the MIT License. See `LICENSE.md` for more information.
