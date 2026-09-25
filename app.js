// VECTOR-TRACK // Real-Time Authentic Live Orbital Satellite Telemetry Logic

// --- GLOBALS & PARAMETERS ---
const EARTH_RADIUS_KM = 6378.137;
const MU = 398600.44; // Gravitational parameter GM (km^3/s^2)
let scene, camera, renderer, controls;
let miniScene, miniCamera, miniRenderer, miniSatelliteMesh;

let timeTravelOffsetSeconds = 0; // offset in seconds (from timeline slider)

// Ground Station Observer Coordinates
let gsLat = 28.3922; // default: Cape Canaveral, FL
let gsLon = -80.6077;
let observerMarker = null; // 3D cone marker
let linkLine = null;       // 3D uplink line

const SATELLITE_TYPES = {
  GPS: 'GPS',
  COMMS: 'comms',
  SCIENCE: 'science',
  DEBRIS: 'debris'
};

// Controls/Toggle states
let showOrbits = true;
let showGrid = true;
let showStars = true;
let activeFilters = {
  GPS: true,
  comms: true,
  science: true,
  debris: true
};

// Tracking arrays
let satrecs = []; // satellite.js records
let selectedSat = null;
let selectedSatIndex = -1;
let selectedOrbitLine = null; // Single orbital loop for selected satellite

let satellitePoints = null; // Point cloud
let scanMesh = null;
let scanActive = false;
let scanProgress = 0;
const MAX_SCAN_RADIUS = 7.0;

// Camera Tracking Modes
const CAMERA_MODES = {
  FREE: 'free',
  FOLLOW: 'follow',
  ROTATE: 'rotate'
};
let currentCameraMode = CAMERA_MODES.FREE;

// Camera Smooth Recentering variables
let isRecentering = false;
let recenterProgress = 0;
const recenterStartPos = new THREE.Vector3();
const recenterStartTarget = new THREE.Vector3();
const RECENTER_DEFAULT_POS = new THREE.Vector3(0, 2.5, 3.5);

// Selection indicator box
let selectionBox = null;

// --- DOM ELEMENTS ---
const elSimTime = document.getElementById('sim-time');
const elSatCount = document.getElementById('satellite-count');
const elTelemetryHud = document.getElementById('telemetry-hud');
const elCloseHud = document.getElementById('close-hud');

// Telemetry Labels
const elTelId = document.getElementById('tel-id');
const elTelName = document.getElementById('tel-name');
const elTelClass = document.getElementById('tel-class');
const elTelStatus = document.getElementById('tel-status');
const elTelAltitude = document.getElementById('tel-altitude');
const elTelVelocity = document.getElementById('tel-velocity');
const elTelPeriod = document.getElementById('tel-period');
const elTelInclination = document.getElementById('tel-inclination');
const elTelLat = document.getElementById('tel-lat');
const elTelLon = document.getElementById('tel-lon');
const elTelX = document.getElementById('tel-x');
const elTelY = document.getElementById('tel-y');
const elTelZ = document.getElementById('tel-z');

// Look Angles Labels
const elTelAzimuth = document.getElementById('tel-azimuth');
const elTelElevation = document.getElementById('tel-elevation');
const elTelRange = document.getElementById('tel-range');
const elTelLink = document.getElementById('tel-link');

// Ground Station Controls
const elGsLat = document.getElementById('gs-lat');
const elGsLon = document.getElementById('gs-lon');
const btnUpdateGs = document.getElementById('btn-update-gs');

// Controls Buttons
const btnCamFree = document.getElementById('btn-camera-free');
const btnCamFollow = document.getElementById('btn-camera-follow');
const btnCamRotate = document.getElementById('btn-camera-rotate');
const btnRecenter = document.getElementById('btn-recenter');
const btnToggleOrbits = document.getElementById('btn-toggle-orbits');
const btnToggleGrid = document.getElementById('btn-toggle-grid');
const btnToggleStars = document.getElementById('btn-toggle-stars');

const btnScanOrbitals = document.getElementById('btn-scan-orbitals');

const btnFilterGps = document.getElementById('btn-filter-gps');
const btnFilterComms = document.getElementById('btn-filter-comms');
const btnFilterScience = document.getElementById('btn-filter-science');
const btnFilterDebris = document.getElementById('btn-filter-debris');

// Timeline Elements
const elTimelineContainer = document.getElementById('timeline-container');
const elTimelineSlider = document.getElementById('timeline-slider');
const elTimelineMode = document.getElementById('timeline-mode');
const elTimelineOffsetVal = document.getElementById('timeline-offset-val');
const btnSnapLive = document.getElementById('btn-snap-live');

// --- INIT MAIN ENGINE ---
function init() {
  const container = document.getElementById('viewport');
  
  // 1. Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  // 2. Camera
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 1000);
  camera.position.copy(RECENTER_DEFAULT_POS);

  // 3. Renderer
  renderer = new THREE.WebGLRenderer({ canvas: container, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // 4. Controls
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxDistance = 15;
  controls.minDistance = 1.1;

  // Cancel recentering on user interaction drag/zoom
  controls.addEventListener('start', () => {
    isRecentering = false;
  });

  // 5. Build Globe & environment
  createWireframeEarth();
  createStarfield();
  createSelectionBox();
  
  // 6. Init Mini HUD Viewer
  initMiniViewer();

  // 7. Load Ground Station Config
  loadGroundStationSettings();
  createObserverMarker();

  // 8. Load Real-Time Satellites from API
  fetchSatelliteData();

  // 9. Event Listeners
  window.addEventListener('resize', onWindowResize);
  renderer.domElement.addEventListener('click', onViewportClick);
  setupUIEventListeners();

  // 10. Start Loop
  animate();
}

// --- GLOBE GENERATION ---
let earthGridGroup;
let earthOcclusionSphere;
let coordinateAxes;

function createWireframeEarth() {
  earthGridGroup = new THREE.Group();

  // Solid black sphere to occlude satellites behind the Earth
  const occGeom = new THREE.SphereGeometry(0.995, 36, 36);
  const occMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  earthOcclusionSphere = new THREE.Mesh(occGeom, occMat);
  earthGridGroup.add(earthOcclusionSphere);

  const gridMat = new THREE.LineBasicMaterial({ color: 0xffffff });

  // Latitude lines (parallels) every 15 degrees
  for (let lat = -75; lat <= 75; lat += 15) {
    const radLat = THREE.MathUtils.degToRad(lat);
    const y = Math.sin(radLat);
    const r = Math.cos(radLat);

    const points = [];
    for (let lon = 0; lon <= 360; lon += 5) {
      const radLon = THREE.MathUtils.degToRad(lon);
      points.push(new THREE.Vector3(r * Math.cos(radLon), y, r * Math.sin(radLon)));
    }
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geom, gridMat);
    earthGridGroup.add(line);
  }

  // Longitude lines (meridians) every 15 degrees
  for (let lon = 0; lon < 180; lon += 15) {
    const radLon = THREE.MathUtils.degToRad(lon);
    const points = [];
    for (let lat = -90; lat <= 270; lat += 5) {
      const radLat = THREE.MathUtils.degToRad(lat);
      const x = Math.cos(radLat) * Math.cos(radLon);
      const z = Math.cos(radLat) * Math.sin(radLon);
      const y = Math.sin(radLat);
      points.push(new THREE.Vector3(x, y, z));
    }
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geom, gridMat);
    earthGridGroup.add(line);
  }

  scene.add(earthGridGroup);

  // Coordinate Axes System
  coordinateAxes = new THREE.Group();
  const axisMat = new THREE.LineDashedMaterial({ 
    color: 0xffffff, 
    dashSize: 0.05, 
    gapSize: 0.05 
  });
  
  const axesLength = 2.0;
  const createAxis = (start, end) => {
    const geom = new THREE.BufferGeometry().setFromPoints([start, end]);
    const line = new THREE.Line(geom, axisMat);
    line.computeLineDistances();
    return line;
  };
  
  coordinateAxes.add(createAxis(new THREE.Vector3(-axesLength, 0, 0), new THREE.Vector3(axesLength, 0, 0))); // X
  coordinateAxes.add(createAxis(new THREE.Vector3(0, -axesLength, 0), new THREE.Vector3(0, axesLength, 0))); // Y
  coordinateAxes.add(createAxis(new THREE.Vector3(0, 0, -axesLength), new THREE.Vector3(0, 0, axesLength))); // Z
  
  scene.add(coordinateAxes);
}

// --- STARFIELD ---
let starfield;

function createStarfield() {
  const starCount = 1000;
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array(starCount * 3);

  for (let i = 0; i < starCount * 3; i += 3) {
    const u = Math.random();
    const v = Math.random();
    const theta = u * 2.0 * Math.PI;
    const phi = Math.acos(2.0 * v - 1.0);
    const r = 60 + Math.random() * 40;

    positions[i] = r * Math.sin(phi) * Math.cos(theta);
    positions[i + 1] = r * Math.cos(phi);
    positions[i + 2] = r * Math.sin(phi) * Math.sin(theta);
  }

  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.05,
    sizeAttenuation: true
  });

  starfield = new THREE.Points(geom, mat);
  scene.add(starfield);
}

// --- SELECTION BOX ---
function createSelectionBox() {
  const boxGeom = new THREE.BoxGeometry(0.06, 0.06, 0.06);
  const edges = new THREE.EdgesGeometry(boxGeom);
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff });
  selectionBox = new THREE.LineSegments(edges, mat);
  selectionBox.visible = false;
  scene.add(selectionBox);
}

// --- GROUND STATION MARKER ---
function createObserverMarker() {
  if (observerMarker) {
    earthGridGroup.remove(observerMarker);
  }

  // Visual observer station: small cone pointing outwards
  const coneGeom = new THREE.ConeGeometry(0.015, 0.035, 6);
  coneGeom.translate(0, 0.0175, 0); // pivot base
  const edges = new THREE.EdgesGeometry(coneGeom);
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff });
  
  observerMarker = new THREE.LineSegments(edges, mat);

  // Position mathematically on Earth sphere surface (radius = 1.0)
  const latRad = THREE.MathUtils.degToRad(gsLat);
  const lonRad = THREE.MathUtils.degToRad(gsLon);

  const x = Math.cos(latRad) * Math.cos(lonRad);
  const y = Math.sin(latRad);
  const z = Math.cos(latRad) * Math.sin(lonRad);

  const pos = new THREE.Vector3(x, y, z);
  observerMarker.position.copy(pos);

  // Align orientation normal facing out
  const up = new THREE.Vector3(0, 1, 0);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(up, pos.clone().normalize());
  observerMarker.setRotationFromQuaternion(quaternion);

  earthGridGroup.add(observerMarker);
}

function updateLinkLine(observerPos, satPos) {
  const points = [observerPos, satPos];
  if (!linkLine) {
    const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
    const lineMat = new THREE.LineDashedMaterial({
      color: 0xffffff,
      dashSize: 0.03,
      gapSize: 0.03
    });
    linkLine = new THREE.Line(lineGeom, lineMat);
    scene.add(linkLine);
  } else {
    linkLine.geometry.setFromPoints(points);
    linkLine.computeLineDistances();
    linkLine.visible = true;
  }
}

// --- LOCAL STORAGE COORDINATES SETTINGS ---
function loadGroundStationSettings() {
  const lat = localStorage.getItem('gs_latitude');
  const lon = localStorage.getItem('gs_longitude');
  if (lat !== null && lon !== null) {
    gsLat = parseFloat(lat);
    gsLon = parseFloat(lon);
  }
  elGsLat.value = gsLat;
  elGsLon.value = gsLon;
}

function saveGroundStationSettings(lat, lon) {
  gsLat = lat;
  gsLon = lon;
  localStorage.setItem('gs_latitude', lat.toString());
  localStorage.setItem('gs_longitude', lon.toString());
  createObserverMarker();
  
  // Re-calculate look angles immediately
  const activeTimeMs = Date.now() + (timeTravelOffsetSeconds * 1000);
  updateTelemetryValues(new Date(activeTimeMs));
}

// --- API LOADING & SGP4 SETUP ---
function fetchSatelliteData() {
  const statusIndicator = document.querySelector('.connection-status');
  statusIndicator.textContent = "FETCHING ORBITS...";
  statusIndicator.style.animation = "pulse-button 1s infinite alternate";

  fetch('/api/satellites')
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      satrecs = [];
      data.forEach(item => {
        try {
          const satrec = satellite.twoline2satrec(item.line1, item.line2);
          const testProp = satellite.propagate(satrec, new Date());
          if (testProp.position) {
            satrecs.push({
              id: item.id,
              name: item.name,
              group: item.group,
              satrec: satrec
            });
          }
        } catch (e) {
          // skip malformed entries
        }
      });

      console.log(`Loaded ${satrecs.length} authentic satellites.`);
      buildPointCloud();
      updateSatelliteCount();

      statusIndicator.textContent = "LINK_OK [REAL-TIME_API]";
      statusIndicator.style.animation = "none";

      // Default select ISS (ZARYA)
      const issIndex = satrecs.findIndex(s => s.id === '25544');
      if (issIndex > -1) {
        selectSatellite(satrecs[issIndex], issIndex);
      }
    })
    .catch(err => {
      console.error("Failed to load satellite data:", err);
      statusIndicator.textContent = "CONNECTION_FAIL";
      statusIndicator.style.animation = "none";
      alert("Failed to retrieve real-time orbits from server.");
    });
}

function buildPointCloud() {
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array(satrecs.length * 3);
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.035,
    sizeAttenuation: true
  });

  satellitePoints = new THREE.Points(geom, mat);
  scene.add(satellitePoints);
}

// --- MINI HUD VIEWER ---
function initMiniViewer() {
  const container = document.getElementById('mini-viewer-container');
  const canvas = document.getElementById('mini-viewer');
  
  miniScene = new THREE.Scene();
  miniScene.background = new THREE.Color(0x000000);

  miniCamera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 10);
  miniCamera.position.set(0, 1.2, 1.8);
  miniCamera.lookAt(0, 0, 0);

  miniRenderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  miniRenderer.setSize(canvas.clientWidth, canvas.clientHeight);
  miniRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const axes = new THREE.GridHelper(2, 10, 0x555555, 0x222222);
  axes.position.y = -0.3;
  miniScene.add(axes);
}

function updateMiniViewerModel(type) {
  if (miniSatelliteMesh) {
    miniScene.remove(miniSatelliteMesh);
  }

  miniSatelliteMesh = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff });

  if (type === SATELLITE_TYPES.GPS) {
    const coreGeom = new THREE.OctahedronGeometry(0.18, 0);
    const core = new THREE.LineSegments(new THREE.EdgesGeometry(coreGeom), mat);
    miniSatelliteMesh.add(core);

    const panelGeom = new THREE.BoxGeometry(0.7, 0.12, 0.01);
    const panel = new THREE.LineSegments(new THREE.EdgesGeometry(panelGeom), mat);
    miniSatelliteMesh.add(panel);

  } else if (type === SATELLITE_TYPES.COMMS) {
    const bodyGeom = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const body = new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeom), mat);
    miniSatelliteMesh.add(body);

    const solarGeom = new THREE.BoxGeometry(1.0, 0.16, 0.01);
    const solar = new THREE.LineSegments(new THREE.EdgesGeometry(solarGeom), mat);
    miniSatelliteMesh.add(solar);

    const dishGeom = new THREE.ConeGeometry(0.12, 0.15, 8);
    const dish = new THREE.LineSegments(new THREE.EdgesGeometry(dishGeom), mat);
    dish.position.set(0, 0.2, 0);
    dish.rotation.x = Math.PI;
    miniSatelliteMesh.add(dish);

  } else if (type === SATELLITE_TYPES.SCIENCE) {
    const bodyGeom = new THREE.CylinderGeometry(0.12, 0.12, 0.45, 8);
    const body = new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeom), mat);
    body.rotation.x = Math.PI / 2;
    miniSatelliteMesh.add(body);

    const hatchGeom = new THREE.BoxGeometry(0.15, 0.01, 0.15);
    const hatch = new THREE.LineSegments(new THREE.EdgesGeometry(hatchGeom), mat);
    hatch.position.set(0, 0.18, 0.22);
    hatch.rotation.x = Math.PI / 4;
    miniSatelliteMesh.add(hatch);

    const panel1Geom = new THREE.BoxGeometry(0.12, 0.5, 0.01);
    const panel1 = new THREE.LineSegments(new THREE.EdgesGeometry(panel1Geom), mat);
    panel1.position.set(-0.25, 0, 0);
    miniSatelliteMesh.add(panel1);

    const panel2Geom = new THREE.BoxGeometry(0.12, 0.5, 0.01);
    const panel2 = new THREE.LineSegments(new THREE.EdgesGeometry(panel2Geom), mat);
    panel2.position.set(0.25, 0, 0);
    miniSatelliteMesh.add(panel2);

  } else {
    // Debris
    const geom = new THREE.DodecahedronGeometry(0.18, 0);
    const posAttribute = geom.attributes.position;
    for (let i = 0; i < posAttribute.count; i++) {
      posAttribute.setX(i, posAttribute.getX(i) + (Math.random() - 0.5) * 0.08);
      posAttribute.setY(i, posAttribute.getY(i) + (Math.random() - 0.5) * 0.08);
      posAttribute.setZ(i, posAttribute.getZ(i) + (Math.random() - 0.5) * 0.08);
    }
    const edges = new THREE.EdgesGeometry(geom);
    const debrisMesh = new THREE.LineSegments(edges, mat);
    miniSatelliteMesh.add(debrisMesh);
  }

  miniScene.add(miniSatelliteMesh);
}

// --- RADAR SCAN OVERLAY ---
function triggerSpaceScan() {
  if (scanActive) return;

  if (scanMesh) {
    scene.remove(scanMesh);
  }

  const scanGeom = new THREE.SphereGeometry(1.0, 16, 16);
  const scanEdges = new THREE.EdgesGeometry(scanGeom);
  const scanMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.8
  });

  scanMesh = new THREE.LineSegments(scanEdges, scanMat);
  scene.add(scanMesh);

  scanProgress = 0;
  scanActive = true;
}

function updateSpaceScan(dt) {
  if (!scanActive || !scanMesh) return;

  scanProgress += dt * 2.5; 
  scanMesh.scale.set(scanProgress, scanProgress, scanProgress);
  
  const ratio = scanProgress / MAX_SCAN_RADIUS;
  scanMesh.material.opacity = Math.max(0, 0.8 * (1.0 - ratio));

  if (scanProgress >= MAX_SCAN_RADIUS) {
    scanActive = false;
    scene.remove(scanMesh);
    scanMesh = null;
  }
}

// --- RAYCAST SELECTION ---
function onViewportClick(event) {
  if (event.clientX > window.innerWidth - 320 && !elTelemetryHud.classList.contains('hidden')) return;
  if (event.clientY > window.innerHeight - 100) return;
  if (event.clientY < 50) return;

  if (!satellitePoints) return;

  // Interrupt recentering if user interacts/clicks
  isRecentering = false;

  const mouse = new THREE.Vector2();
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);
  raycaster.params.Points.threshold = 0.07;

  const intersects = raycaster.intersectObject(satellitePoints);

  if (intersects.length > 0) {
    const clickedIndex = intersects[0].index;
    const clickedSat = satrecs[clickedIndex];
    
    const px = satellitePoints.geometry.attributes.position.array[clickedIndex * 3];
    if (px < 1000 && clickedSat) {
      selectSatellite(clickedSat, clickedIndex);
    }
  }
}

function selectSatellite(sat, index) {
  selectedSat = sat;
  selectedSatIndex = index;

  if (sat === null) {
    selectionBox.visible = false;
    elTelemetryHud.classList.add('hidden');
    document.body.classList.remove('sidebar-open');
    
    btnCamFollow.classList.remove('active');
    if (currentCameraMode === CAMERA_MODES.FOLLOW) {
      currentCameraMode = CAMERA_MODES.FREE;
      btnCamFree.classList.add('active');
    }

    if (selectedOrbitLine) {
      scene.remove(selectedOrbitLine);
      selectedOrbitLine = null;
    }
    if (linkLine) {
      linkLine.visible = false;
    }
    return;
  }

  elTelId.textContent = sat.id;
  elTelName.textContent = sat.name;
  elTelClass.textContent = sat.group.toUpperCase();
  elTelStatus.textContent = 'NOMINAL';

  updateMiniViewerModel(sat.group);
  updateSelectedOrbitLine();

  elTelemetryHud.classList.remove('hidden');
  document.body.classList.add('sidebar-open');

  if (currentCameraMode === CAMERA_MODES.FOLLOW) {
    const posArr = satellitePoints.geometry.attributes.position.array;
    controls.target.set(
      posArr[selectedSatIndex * 3],
      posArr[selectedSatIndex * 3 + 1],
      posArr[selectedSatIndex * 3 + 2]
    );
  }
}

function updateSelectedOrbitLine() {
  if (selectedOrbitLine) {
    scene.remove(selectedOrbitLine);
    selectedOrbitLine = null;
  }

  if (!selectedSat || !showOrbits) return;

  const points = [];
  const meanMotionRadsMin = selectedSat.satrec.no;
  const periodMin = (2 * Math.PI) / meanMotionRadsMin;
  
  const steps = 120;
  const dtSeconds = (periodMin * 60) / steps;
  
  const activeTimeMs = Date.now() + (timeTravelOffsetSeconds * 1000);
  
  for (let step = 0; step <= steps; step++) {
    const sampleDate = new Date(activeTimeMs + step * dtSeconds * 1000);
    
    const posVel = satellite.propagate(selectedSat.satrec, sampleDate);
    const pos = posVel.position;
    if (pos) {
      const tx = pos.x / EARTH_RADIUS_KM;
      const ty = pos.z / EARTH_RADIUS_KM;
      const tz = -pos.y / EARTH_RADIUS_KM;
      points.push(new THREE.Vector3(tx, ty, tz));
    }
  }

  if (points.length > 0) {
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8
    });
    selectedOrbitLine = new THREE.Line(geom, mat);
    scene.add(selectedOrbitLine);
  }
}

function updateTelemetryValues(activeDate) {
  if (!selectedSat || selectedSatIndex === -1) return;

  const posVel = satellite.propagate(selectedSat.satrec, activeDate);
  const pos = posVel.position;
  const vel = posVel.velocity;

  if (pos && vel) {
    const gmst = satellite.gstime(activeDate);
    const positionGd = satellite.eciToGeodetic(pos, gmst);
    
    const latRad = positionGd.latitude;
    const lonRad = positionGd.longitude;
    const heightKm = positionGd.height;
    
    const latDeg = latRad * 180 / Math.PI;
    const lonDeg = lonRad * 180 / Math.PI;
    
    const speedKms = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    
    // Core telemetry
    elTelAltitude.textContent = `${Math.round(heightKm).toLocaleString()} KM`;
    elTelVelocity.textContent = `${speedKms.toFixed(2)} KM/S`;
    
    const meanMotionRadsMin = selectedSat.satrec.no;
    const periodMin = (2 * Math.PI) / meanMotionRadsMin;
    elTelPeriod.textContent = `${Math.round(periodMin)} MIN`;
    
    const inclDeg = selectedSat.satrec.inclo * 180 / Math.PI;
    elTelInclination.textContent = `${inclDeg.toFixed(1)}°`;
    
    const latDir = latDeg >= 0 ? 'N' : 'S';
    const lonDir = lonDeg >= 0 ? 'E' : 'W';
    elTelLat.textContent = `${Math.abs(latDeg).toFixed(2)}° ${latDir}`;
    elTelLon.textContent = `${Math.abs(lonDeg).toFixed(2)}° ${lonDir}`;
    
    elTelX.textContent = pos.x.toFixed(1);
    elTelY.textContent = pos.y.toFixed(1);
    elTelZ.textContent = pos.z.toFixed(1);
    
    // Position target box
    const tx = pos.x / EARTH_RADIUS_KM;
    const ty = pos.z / EARTH_RADIUS_KM;
    const tz = -pos.y / EARTH_RADIUS_KM;
    const satWorldPos = new THREE.Vector3(tx, ty, tz);
    
    // Only position automatically if not smoothly recentering
    if (!isRecentering) {
      selectionBox.position.copy(satWorldPos);
      selectionBox.visible = true;

      // Follow camera target snap
      if (currentCameraMode === CAMERA_MODES.FOLLOW) {
        controls.target.copy(selectionBox.position);
      }
    }

    // --- LOOK ANGLES & LINK LINE ---
    const observerGeodetic = {
      latitude: satellite.degreesToRadians(gsLat),
      longitude: satellite.degreesToRadians(gsLon),
      height: 0.1 // km
    };

    const positionEcf = satellite.eciToEcf(pos, gmst);
    const lookAngles = satellite.ecfToLookAngles(observerGeodetic, positionEcf);
    
    const elevationDeg = lookAngles.elevation * 180 / Math.PI;
    const azimuthDeg = lookAngles.azimuth * 180 / Math.PI;
    const rangeKm = lookAngles.rangeSat;

    elTelAzimuth.textContent = `${azimuthDeg.toFixed(1)}°`;
    elTelElevation.textContent = `${elevationDeg.toFixed(1)}°`;
    elTelRange.textContent = `${Math.round(rangeKm).toLocaleString()} KM`;

    const isVisible = elevationDeg > 0;
    if (isVisible) {
      elTelLink.textContent = "SIGNAL ACTIVE [UPLINK]";
      elTelLink.style.color = "#ffffff";

      // 3D link line (observer local rotates with Earth, get world coordinate)
      const observerWorldPos = new THREE.Vector3();
      observerMarker.getWorldPosition(observerWorldPos);
      
      updateLinkLine(observerWorldPos, satWorldPos);
    } else {
      elTelLink.textContent = "LOS [BELOW HORIZON]";
      elTelLink.style.color = "rgba(255, 255, 255, 0.4)";
      if (linkLine) {
        linkLine.visible = false;
      }
    }

  } else {
    selectionBox.visible = false;
    if (linkLine) {
      linkLine.visible = false;
    }
  }
}

// --- ANIMATION / PHYSICS LOOP ---
function animate() {
  requestAnimationFrame(animate);

  const dt = 1.0 / 60.0;
  
  // Calculate active date based on real time clock plus slider offset
  const activeTimeMs = Date.now() + (timeTravelOffsetSeconds * 1000);
  const activeDate = new Date(activeTimeMs);
  
  updateSimTimeHUD(activeDate);

  // Greenwich Sidereal Time Earth grid alignment rotation
  const gmst = satellite.gstime(activeDate);
  earthGridGroup.rotation.y = gmst;

  // Orbit controls update
  controls.update();

  // Smooth Camera recenter interpolation
  if (isRecentering) {
    recenterProgress += dt * 2.0; // 0.5 second animation
    if (recenterProgress >= 1.0) {
      recenterProgress = 1.0;
      isRecentering = false;
    }
    
    // Smoothly lerp camera target to Earth center
    controls.target.lerpVectors(recenterStartTarget, new THREE.Vector3(0, 0, 0), recenterProgress);
    // Smoothly lerp camera position back to default orbit view
    camera.position.lerpVectors(recenterStartPos, RECENTER_DEFAULT_POS, recenterProgress);
  }

  if (satellitePoints) {
    const positions = satellitePoints.geometry.attributes.position.array;
    
    for (let i = 0; i < satrecs.length; i++) {
      const sat = satrecs[i];
      const isFiltered = activeFilters[sat.group];

      if (isFiltered) {
        const posVel = satellite.propagate(sat.satrec, activeDate);
        const pos = posVel.position;
        if (pos) {
          positions[i * 3] = pos.x / EARTH_RADIUS_KM;
          positions[i * 3 + 1] = pos.z / EARTH_RADIUS_KM;
          positions[i * 3 + 2] = -pos.y / EARTH_RADIUS_KM;
        } else {
          positions[i * 3] = 9999;
          positions[i * 3 + 1] = 9999;
          positions[i * 3 + 2] = 9999;
        }
      } else {
        positions[i * 3] = 9999;
        positions[i * 3 + 1] = 9999;
        positions[i * 3 + 2] = 9999;
      }
    }
    
    satellitePoints.geometry.attributes.position.needsUpdate = true;
  }

  if (selectedSat) {
    updateTelemetryValues(activeDate);
    
    selectionBox.rotation.y += 0.02;
    selectionBox.rotation.x += 0.01;
    const pulse = 1.0 + Math.sin(dt * 5.0) * 0.15;
    selectionBox.scale.set(pulse, pulse, pulse);
  }

  if (currentCameraMode === CAMERA_MODES.ROTATE) {
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;
  } else {
    controls.autoRotate = false;
  }

  updateSpaceScan(dt);

  renderer.render(scene, camera);

  if (miniRenderer && miniSatelliteMesh && !elTelemetryHud.classList.contains('hidden')) {
    miniSatelliteMesh.rotation.y += 0.015;
    miniSatelliteMesh.rotation.x += 0.005;
    miniRenderer.render(miniScene, miniCamera);
  }
}

function updateSimTimeHUD(date) {
  elSimTime.textContent = date.toISOString().substr(11, 8);
}

function updateSatelliteCount() {
  let count = 0;
  satrecs.forEach(sat => {
    if (activeFilters[sat.group]) {
      count++;
    }
  });
  elSatCount.textContent = count;
}

// --- TIME TRAVEL TIMELINE SLIDER ---
function updateTimelineHUD() {
  const offset = timeTravelOffsetSeconds;
  
  if (offset === 0) {
    elTimelineMode.textContent = "MODE: LIVE TRACKING";
    elTimelineOffsetVal.textContent = "OFFSET: 00:00:00";
    btnSnapLive.classList.add('hidden');
    elTimelineContainer.classList.remove('historical-mode');
  } else {
    const sign = offset >= 0 ? '+' : '-';
    const absSec = Math.abs(offset);
    const hrs = Math.floor(absSec / 3600).toString().padStart(2, '0');
    const mins = Math.floor((absSec % 3600) / 60).toString().padStart(2, '0');
    const secs = (absSec % 60).toString().padStart(2, '0');

    elTimelineMode.textContent = offset < 0 ? "MODE: HISTORICAL FEED" : "MODE: FUTURE PROJECTION";
    elTimelineOffsetVal.textContent = `OFFSET: ${sign}${hrs}:${mins}:${secs}`;
    btnSnapLive.classList.remove('hidden');
    elTimelineContainer.classList.add('historical-mode');
  }

  if (selectedSat) {
    updateSelectedOrbitLine();
  }
}

// --- UI LISTENERS & CONTROLS ---
function setupUIEventListeners() {
  elCloseHud.addEventListener('click', () => {
    selectSatellite(null);
  });

  // Ground Station coordinates updating
  btnUpdateGs.addEventListener('click', () => {
    const lat = parseFloat(elGsLat.value);
    const lon = parseFloat(elGsLon.value);
    
    if (isNaN(lat) || lat < -90 || lat > 90) {
      alert("ERROR: LATITUDE MUST BE A NUMBER BETWEEN -90 AND 90");
      return;
    }
    if (isNaN(lon) || lon < -180 || lon > 180) {
      alert("ERROR: LONGITUDE MUST BE A NUMBER BETWEEN -180 AND 180");
      return;
    }
    
    saveGroundStationSettings(lat, lon);
  });

  // Timeline Slider events
  elTimelineSlider.addEventListener('input', () => {
    timeTravelOffsetSeconds = parseInt(elTimelineSlider.value);
    updateTimelineHUD();
  });

  btnSnapLive.addEventListener('click', () => {
    timeTravelOffsetSeconds = 0;
    elTimelineSlider.value = 0;
    updateTimelineHUD();
  });

  btnCamFree.addEventListener('click', () => {
    setCameraMode(CAMERA_MODES.FREE);
  });
  btnCamFollow.addEventListener('click', () => {
    if (!selectedSat) {
      alert("COMMAND REFUSED: SELECT A TARGET SYSTEM TO FOLLOW");
      return;
    }
    setCameraMode(CAMERA_MODES.FOLLOW);
  });
  btnCamRotate.addEventListener('click', () => {
    setCameraMode(CAMERA_MODES.ROTATE);
  });

  // Recenter Click
  btnRecenter.addEventListener('click', () => {
    isRecentering = true;
    recenterProgress = 0;
    recenterStartPos.copy(camera.position);
    recenterStartTarget.copy(controls.target);
    setCameraMode(CAMERA_MODES.FREE);
  });

  btnToggleOrbits.addEventListener('click', () => {
    showOrbits = !showOrbits;
    btnToggleOrbits.classList.toggle('active', showOrbits);
    if (selectedOrbitLine) {
      selectedOrbitLine.visible = showOrbits;
    } else if (showOrbits && selectedSat) {
      updateSelectedOrbitLine();
    }
  });

  btnToggleGrid.addEventListener('click', () => {
    showGrid = !showGrid;
    btnToggleGrid.classList.toggle('active', showGrid);
    earthGridGroup.visible = showGrid;
    coordinateAxes.visible = showGrid;
  });

  btnToggleStars.addEventListener('click', () => {
    showStars = !showStars;
    btnToggleStars.classList.toggle('active', showStars);
    starfield.visible = showStars;
  });

  btnScanOrbitals.addEventListener('click', () => {
    triggerSpaceScan();
  });

  const setupFilterToggle = (btn, groupKey) => {
    btn.addEventListener('click', () => {
      activeFilters[groupKey] = !activeFilters[groupKey];
      btn.classList.toggle('active', activeFilters[groupKey]);
      
      if (selectedSat && selectedSat.group === groupKey && !activeFilters[groupKey]) {
        selectSatellite(null);
      }

      updateSatelliteCount();
    });
  };

  setupFilterToggle(btnFilterGps, SATELLITE_TYPES.GPS);
  setupFilterToggle(btnFilterComms, SATELLITE_TYPES.COMMS);
  setupFilterToggle(btnFilterScience, SATELLITE_TYPES.SCIENCE);
  setupFilterToggle(btnFilterDebris, SATELLITE_TYPES.DEBRIS);
}

function setCameraMode(mode) {
  currentCameraMode = mode;
  [btnCamFree, btnCamFollow, btnCamRotate].forEach(btn => btn.classList.remove('active'));

  if (mode === CAMERA_MODES.FREE) {
    btnCamFree.classList.add('active');
    // only reset immediately if not smoothly recentering
    if (!isRecentering) {
      controls.target.set(0, 0, 0); 
    }
  } else if (mode === CAMERA_MODES.FOLLOW) {
    isRecentering = false; // abort recentering to let follow mode snap
    btnCamFollow.classList.add('active');
    if (selectedSat && selectedSatIndex > -1) {
      const posArr = satellitePoints.geometry.attributes.position.array;
      controls.target.set(
        posArr[selectedSatIndex * 3],
        posArr[selectedSatIndex * 3 + 1],
        posArr[selectedSatIndex * 3 + 2]
      );
    }
  } else if (mode === CAMERA_MODES.ROTATE) {
    btnCamRotate.classList.add('active');
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  const miniCanvas = document.getElementById('mini-viewer');
  miniCamera.aspect = miniCanvas.clientWidth / miniCanvas.clientHeight;
  miniCamera.updateProjectionMatrix();
  miniRenderer.setSize(miniCanvas.clientWidth, miniCanvas.clientHeight);
}

window.onload = init;
