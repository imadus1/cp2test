import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Global Variables ---
let scene, camera, renderer, controls;
let segmentsData = []; // Stores { p1: Vector3, p2: Vector3, length: number, centroid: Vector3 }
let segmentLines = []; // Stores THREE.Line objects
let surfaceMesh = null;
let axisOfRotation = 'y'; // 'x', 'y', or 'z'
let revolutionAngle = 360; // degrees
let axisHelper, rotationAxisLine, centroidPathVisual;

// --- Constants ---
const SEGMENT_COLOR = 0x0000ff; // Blue
const SURFACE_COLOR = 0xffa500; // Orange
const AXIS_COLOR = 0xff0000; // Red (Selected Axis)
const OTHER_AXIS_COLOR = 0xaaaaaa; // Grey (Other Axes)
const CENTROID_PATH_COLOR = 0x00ff00; // Green
const RADIAL_SEGMENTS = 32; // For surface smoothness
const CENTROID_PATH_RADIUS = 0.05; // Thickness of centroid path torus

// --- DOM Elements ---
const segmentsContainer = document.getElementById('segmentsContainer');
const addSegmentBtn = document.getElementById('addSegmentBtn');
const segmentTemplate = document.getElementById('segmentTemplate');
const revolutionSlider = document.getElementById('revolutionSlider');
const angleValueSpan = document.getElementById('angleValue');
const axisRadios = document.querySelectorAll('input[name="axis"]');
// Calculation display spans
const totalLengthSpan = document.getElementById('totalLength');
const centroidCoordsSpan = document.getElementById('centroidCoords');
const centroidDistanceRSpan = document.getElementById('centroidDistanceR');
const centroidDistanceDSpan = document.getElementById('centroidDistanceD');
const surfaceAreaSpan = document.getElementById('surfaceArea');

// --- Initialization ---
function init() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeeeeee);

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(5, 5, 10); // Adjusted initial camera position
    camera.lookAt(0, 0, 0);


    // Renderer
    const canvas = document.getElementById('visualizationCanvas');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    // Adjust renderer size initially and on resize
    resizeRenderer();


    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 1;
    controls.maxDistance = 50;
    controls.maxPolarAngle = Math.PI; // Allow viewing from below

    // Helpers
    axisHelper = new THREE.AxesHelper(5); // X=red, Y=green, Z=blue
    scene.add(axisHelper);

    // Add initial axis highlight
    createRotationAxisLine();

    // Event Listeners
    addSegmentBtn.addEventListener('click', addSegmentUI);
    segmentsContainer.addEventListener('input', handleSegmentInputChange); // Use event delegation
    segmentsContainer.addEventListener('click', handleRemoveSegmentClick); // Use event delegation
    revolutionSlider.addEventListener('input', handleRevolutionSlider);
    axisRadios.forEach(radio => radio.addEventListener('change', handleAxisChange));
    window.addEventListener('resize', resizeRenderer); // Handle window resize

    // Add a default segment for quick start
    addSegmentUI(); // Add the first segment UI
    updateVisualizationAndCalculations(); // Initial calculation and render

    // Start animation loop
    animate();
}

function resizeRenderer() {
    const vizContainer = document.getElementById('visualization-container');
    const width = vizContainer.clientWidth;
    const height = vizContainer.clientHeight;

    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
}


// --- UI Management ---
function addSegmentUI() {
    const templateContent = segmentTemplate.content.cloneNode(true);
    segmentsContainer.appendChild(templateContent);
    // No need to add listeners here due to event delegation
    updateVisualizationAndCalculations(); // Update after adding default values
}

function handleSegmentInputChange(event) {
    if (event.target.classList.contains('coord')) {
        updateVisualizationAndCalculations();
    }
}

function handleRemoveSegmentClick(event) {
    if (event.target.classList.contains('removeSegmentBtn')) {
        event.target.closest('.segment-input').remove();
        updateVisualizationAndCalculations();
    }
}

function handleRevolutionSlider(event) {
    revolutionAngle = parseFloat(event.target.value);
    angleValueSpan.textContent = revolutionAngle;
    // Only redraw the surface, calculations are based on full 360
    clearSurfaceMesh();
    clearCentroidPathVisual(); // Also clear/redraw path if partially drawn
    drawSurfaceOfRevolution();
    // Redraw centroid path based on full R, but maybe only partial circle if needed?
    // For simplicity, let's only show full path tied to calculations.
    // OR: Optionally draw partial path (more complex)
    // For now, keep path visual linked to full 360 calculation.
    // If angle < 360, perhaps hide the path visual?
    const polylineProps = calculatePolylineProperties();
    if (polylineProps.totalLength > 0) {
        drawCentroidPathVisual(polylineProps.polylineCentroid, axisOfRotation);
        if (centroidPathVisual) centroidPathVisual.visible = (revolutionAngle === 360); // Only show full path at 360
    }

}

function handleAxisChange(event) {
    axisOfRotation = event.target.value;
    updateVisualizationAndCalculations();
}

// --- Data Parsing ---
function parseSegmentsFromUI() {
    segmentsData = [];
    const segmentDivs = segmentsContainer.querySelectorAll('.segment-input');

    segmentDivs.forEach(div => {
        const p1 = new THREE.Vector3(
            parseFloat(div.querySelector('.p1x').value) || 0,
            parseFloat(div.querySelector('.p1y').value) || 0,
            parseFloat(div.querySelector('.p1z').value) || 0
        );
        const p2 = new THREE.Vector3(
            parseFloat(div.querySelector('.p2x').value) || 0,
            parseFloat(div.querySelector('.p2y').value) || 0,
            parseFloat(div.querySelector('.p2z').value) || 0
        );

        // Basic validation: ignore segments with identical endpoints
        if (p1.distanceTo(p2) > 1e-6) { // Use epsilon for float comparison
             const length = p1.distanceTo(p2);
             const centroid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
             segmentsData.push({ p1, p2, length, centroid });
        }
    });
}

// --- Calculations ---
function calculatePolylineProperties() {
    let totalLength = 0;
    let weightedCentroidSum = new THREE.Vector3(0, 0, 0);

    segmentsData.forEach(seg => {
        totalLength += seg.length;
        weightedCentroidSum.addScaledVector(seg.centroid, seg.length);
    });

    const polylineCentroid = totalLength > 0 ? weightedCentroidSum.divideScalar(totalLength) : new THREE.Vector3(0, 0, 0);

    return { totalLength, polylineCentroid };
}

function getDistanceToAxis(point, axis) {
    switch (axis) {
        case 'x': return Math.sqrt(point.y * point.y + point.z * point.z);
        case 'y': return Math.sqrt(point.x * point.x + point.z * point.z);
        case 'z': return Math.sqrt(point.x * point.x + point.y * point.y);
        default: return 0;
    }
}

function calculatePappusValues(totalLength, polylineCentroid, axis) {
    if (totalLength === 0) {
        return { R: 0, d: 0, area: 0 };
    }
    const R = getDistanceToAxis(polylineCentroid, axis);
    const d = 2 * Math.PI * R;
    const area = totalLength * d;
    return { R, d, area };
}

// --- 3D Visualization ---
function clearSceneGeometry() {
    // Remove segment lines
    segmentLines.forEach(line => scene.remove(line));
    segmentLines = [];
    // Remove surface mesh
    clearSurfaceMesh();
    // Remove axis highlight line
    if (rotationAxisLine) scene.remove(rotationAxisLine);
    rotationAxisLine = null;
    // Remove centroid path
    clearCentroidPathVisual();
}

function clearSurfaceMesh() {
     if (surfaceMesh) {
        scene.remove(surfaceMesh);
        surfaceMesh.geometry.dispose();
        surfaceMesh.material.dispose();
        surfaceMesh = null;
    }
}

function clearCentroidPathVisual() {
    if (centroidPathVisual) {
        scene.remove(centroidPathVisual);
        centroidPathVisual.geometry.dispose();
        centroidPathVisual.material.dispose();
        centroidPathVisual = null;
    }
}

function drawSegments() {
    const material = new THREE.LineBasicMaterial({ color: SEGMENT_COLOR, linewidth: 3 }); // Note: linewidth > 1 may not work on all platforms/drivers

    segmentsData.forEach(seg => {
        const points = [seg.p1, seg.p2];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geometry, material);
        scene.add(line);
        segmentLines.push(line);
    });
}

function createRotationAxisLine() {
     if (rotationAxisLine) scene.remove(rotationAxisLine);

    const material = new THREE.LineBasicMaterial({ color: AXIS_COLOR, linewidth: 2 });
    let points = [];
    const length = 1000; // Make it very long

    switch (axisOfRotation) {
        case 'x':
            points = [new THREE.Vector3(-length, 0, 0), new THREE.Vector3(length, 0, 0)];
            break;
        case 'y':
            points = [new THREE.Vector3(0, -length, 0), new THREE.Vector3(0, length, 0)];
            break;
        case 'z':
            points = [new THREE.Vector3(0, 0, -length), new THREE.Vector3(0, 0, length)];
            break;
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    rotationAxisLine = new THREE.Line(geometry, material);
    scene.add(rotationAxisLine);
}

// Maps a 3D point to a 2D point (radius, height) for LatheGeometry, relative to the specified axis
function map3DPointToLathePoint(point, axis) {
    let radius, height;
    switch (axis) {
        case 'x':
            radius = Math.sqrt(point.y * point.y + point.z * point.z);
            height = point.x;
            break;
        case 'y':
            radius = Math.sqrt(point.x * point.x + point.z * point.z);
            height = point.y;
            break;
        case 'z':
            radius = Math.sqrt(point.x * point.x + point.y * point.y);
            height = point.z;
            break;
        default:
             radius = 0; height = 0;
    }
    // LatheGeometry expects non-negative radius
    return new THREE.Vector2(Math.max(0, radius), height);
}


function drawSurfaceOfRevolution() {
    if (segmentsData.length === 0) return;

    // 1. Create the profile points for LatheGeometry
    const lathePoints = [];
    // Add the first point of the first segment
    lathePoints.push(map3DPointToLathePoint(segmentsData[0].p1, axisOfRotation));
    // Add the second point of each segment
    segmentsData.forEach(seg => {
        lathePoints.push(map3DPointToLathePoint(seg.p2, axisOfRotation));
    });

     // Check for collinear points which LatheGeometry might dislike
    const uniqueLathePoints = [];
    if(lathePoints.length > 0) {
        uniqueLathePoints.push(lathePoints[0]);
        for(let i = 1; i < lathePoints.length; i++) {
            // Only add if different from the previous point (within epsilon)
            if(lathePoints[i].distanceTo(lathePoints[i-1]) > 1e-6) {
                 uniqueLathePoints.push(lathePoints[i]);
            }
        }
    }

    if (uniqueLathePoints.length < 2) return; // Need at least 2 unique points for a lathe


    // 2. Create Lathe Geometry
    const angleRad = THREE.MathUtils.degToRad(revolutionAngle);
    const geometry = new THREE.LatheGeometry(uniqueLathePoints, RADIAL_SEGMENTS, 0, angleRad);

    // 3. Create Material
    const material = new THREE.MeshStandardMaterial({
        color: SURFACE_COLOR,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide, // Show inside and outside
        metalness: 0.2,
        roughness: 0.8,
    });

    // 4. Create Mesh
    surfaceMesh = new THREE.Mesh(geometry, material);

    // 5. Orient the Mesh based on the axis of rotation
    // LatheGeometry rotates around Y by default.
    switch (axisOfRotation) {
        case 'x':
            // Rotate from Y-axis profile to X-axis profile
            surfaceMesh.rotation.z = -Math.PI / 2; // Rotate -90 degrees around Z
            break;
        case 'y':
            // No rotation needed
            break;
        case 'z':
             // Rotate from Y-axis profile to Z-axis profile
            surfaceMesh.rotation.x = Math.PI / 2; // Rotate 90 degrees around X
            break;
    }
    surfaceMesh.updateMatrixWorld(); // Apply rotation

    // 6. Add to Scene
    scene.add(surfaceMesh);
}


function drawCentroidPathVisual(centroid, axis) {
    clearCentroidPathVisual();
    if (!centroid) return;

    const R = getDistanceToAxis(centroid, axis);
    if (R < 1e-6) return; // Don't draw if centroid is on the axis

    const torusRadius = R;
    const tubeRadius = CENTROID_PATH_RADIUS; // Make it a thin torus
    const torusRadialSegments = 64; // More segments for smooth circle
    const torusTubularSegments = 16; // Segments for the tube thickness

    const geometry = new THREE.TorusGeometry(torusRadius, tubeRadius, torusTubularSegments, torusRadialSegments);
    const material = new THREE.MeshBasicMaterial({ color: CENTROID_PATH_COLOR });
    centroidPathVisual = new THREE.Mesh(geometry, material);

    // Position and orient the torus
    switch (axis) {
        case 'x':
            centroidPathVisual.position.set(centroid.x, 0, 0);
            centroidPathVisual.rotation.y = Math.PI / 2; // Align circle in YZ plane
            break;
        case 'y':
            centroidPathVisual.position.set(0, centroid.y, 0);
            // No rotation needed (already in XZ plane)
            break;
        case 'z':
            centroidPathVisual.position.set(0, 0, centroid.z);
            centroidPathVisual.rotation.x = Math.PI / 2; // Align circle in XY plane
            break;
    }
    centroidPathVisual.updateMatrixWorld();
    centroidPathVisual.visible = (revolutionAngle === 360); // Only show when slider is at 360
    scene.add(centroidPathVisual);
}


// --- Update Cycle ---
function updateVisualizationAndCalculations() {
    // 1. Read data from UI
    parseSegmentsFromUI();

    // 2. Perform Calculations
    const polylineProps = calculatePolylineProperties();
    const pappusValues = calculatePappusValues(polylineProps.totalLength, polylineProps.polylineCentroid, axisOfRotation);

    // 3. Update Calculation Display (Always based on full revolution)
    totalLengthSpan.textContent = polylineProps.totalLength.toFixed(2);
    if (polylineProps.totalLength > 0) {
        centroidCoordsSpan.textContent = `(${polylineProps.polylineCentroid.x.toFixed(2)}, ${polylineProps.polylineCentroid.y.toFixed(2)}, ${polylineProps.polylineCentroid.z.toFixed(2)})`;
        centroidDistanceRSpan.textContent = pappusValues.R.toFixed(2);
        centroidDistanceDSpan.textContent = pappusValues.d.toFixed(2);
        surfaceAreaSpan.textContent = pappusValues.area.toFixed(2);
    } else {
        centroidCoordsSpan.textContent = "N/A";
        centroidDistanceRSpan.textContent = "0.00";
        centroidDistanceDSpan.textContent = "0.00";
        surfaceAreaSpan.textContent = "0.00";
    }


    // 4. Update 3D Scene
    clearSceneGeometry(); // Clear old visuals
    createRotationAxisLine(); // Draw highlighted axis
    drawSegments(); // Draw new segment lines
    drawSurfaceOfRevolution(); // Draw new surface based on current slider angle
    if (polylineProps.totalLength > 0) {
        drawCentroidPathVisual(polylineProps.polylineCentroid, axisOfRotation); // Draw new centroid path
    }

}

// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate);
    controls.update(); // Required if enableDamping is true
    renderer.render(scene, camera);
}

// --- Run ---
init();