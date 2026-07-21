const STORAGE_KEY = "ridgeline.active-route.v1";
const invoke = window.__TAURI__?.core?.invoke;

const DEFAULT_POINTS = Object.freeze([
    { id: "high-point", name: "High Point", x: 0.86, y: 0.48, lat: 47.5098, lon: -121.8975, elevation: 1760, distance: 4.6, climb: 1160, surface: "DIRT" },
    { id: "west-tiger-3", name: "West Tiger 3", x: 0.27, y: 0.17, lat: 47.5439, lon: -121.9859, elevation: 2953, distance: 5.2, climb: 860, surface: "SINGLETRACK" },
    { id: "preston-railroad", name: "Preston Railroad", x: 0.38, y: 0.73, lat: 47.4823, lon: -121.9694, elevation: 2240, distance: 3.8, climb: 720, surface: "GRAVEL" },
    { id: "high-point-return", name: "High Point Return", x: 0.88, y: 0.66, lat: 47.4900, lon: -121.8945, elevation: 1510, distance: 4.8, climb: 880, surface: "SINGLETRACK" },
]);

const state = {
    name: "Tiger Mountain Traverse",
    activity: "trail-run",
    points: DEFAULT_POINTS.map((point) => ({ ...point })),
    redo: [],
    selectedIndex: null,
    profileHover: null,
    placing: false,
};

const elements = {
    routeName: document.getElementById("route-name"),
    segmentList: document.getElementById("segment-list"),
    segmentCount: document.getElementById("segment-count"),
    routeCanvas: document.getElementById("route-canvas"),
    elevationCanvas: document.getElementById("elevation-canvas"),
    totalDistance: document.getElementById("total-distance"),
    totalGain: document.getElementById("total-gain"),
    estimatedTime: document.getElementById("estimated-time"),
    status: document.getElementById("status"),
    mapMode: document.getElementById("map-mode"),
    mapCoordinate: document.getElementById("map-coordinate"),
    saveState: document.getElementById("save-state"),
    btnAdd: document.getElementById("btn-add"),
    btnReverse: document.getElementById("btn-reverse"),
    btnExport: document.getElementById("btn-export"),
    btnNew: document.getElementById("btn-new"),
    btnShortcuts: document.getElementById("btn-shortcuts"),
    shortcutsDialog: document.getElementById("shortcuts-dialog"),
    btnCloseShortcuts: document.getElementById("btn-close-shortcuts"),
};

const routeContext = elements.routeCanvas.getContext("2d");
const elevationContext = elements.elevationCanvas.getContext("2d");

function clonePoint(point) {
    return { ...point };
}

function loadDraft() {
    try {
        const draft = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (!draft || !Array.isArray(draft.points)) return;

        state.name = typeof draft.name === "string" ? draft.name.slice(0, 72) : state.name;
        state.activity = draft.activity === "mtb" ? "mtb" : "trail-run";
        state.points = draft.points
            .filter(isValidPoint)
            .slice(0, 40)
            .map(clonePoint);
    } catch {
        localStorage.removeItem(STORAGE_KEY);
    }
}

function isValidPoint(point) {
    return point
        && Number.isFinite(point.x)
        && Number.isFinite(point.y)
        && Number.isFinite(point.lat)
        && Number.isFinite(point.lon)
        && Number.isFinite(point.elevation)
        && Number.isFinite(point.distance)
        && Number.isFinite(point.climb)
        && typeof point.name === "string"
        && typeof point.surface === "string";
}

function persistDraft() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        name: state.name,
        activity: state.activity,
        points: state.points,
    }));
    elements.saveState.textContent = "LOCAL DRAFT SAVED";
}

function setStatus(message, tone = "ready") {
    elements.status.textContent = message;
    elements.status.dataset.tone = tone;
}

function formatInteger(value) {
    return Math.round(value).toLocaleString("en-US");
}

function routeStats() {
    const distance = state.points.reduce((total, point) => total + point.distance, 0);
    const gain = state.points.reduce((total, point) => total + point.climb, 0);
    const minutes = state.activity === "trail-run"
        ? distance * 10.4 + gain * 0.01
        : distance * 7.2 + gain * 0.0045;
    return { distance, gain, minutes };
}

function formatDuration(totalMinutes) {
    if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "0:00";
    const rounded = Math.round(totalMinutes);
    const hours = Math.floor(rounded / 60);
    const minutes = rounded % 60;
    return `${hours}:${String(minutes).padStart(2, "0")}`;
}

function updateSummary() {
    const { distance, gain, minutes } = routeStats();
    elements.totalDistance.textContent = distance.toFixed(1);
    elements.totalGain.textContent = `+${formatInteger(gain)}`;
    elements.estimatedTime.textContent = formatDuration(minutes);
    elements.segmentCount.textContent = `${String(state.points.length).padStart(2, "0")} ${state.points.length === 1 ? "SEGMENT" : "SEGMENTS"}`;
    elements.btnReverse.disabled = state.points.length < 2;
    elements.btnExport.disabled = state.points.length < 2;
}

function makeButton(label, className, onClick, disabled = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = className;
    button.disabled = disabled;
    button.addEventListener("click", onClick);
    return button;
}

function renderSegments() {
    elements.segmentList.replaceChildren();

    if (state.points.length === 0) {
        const empty = document.createElement("li");
        empty.className = "segment-row segment-empty";
        const message = document.createElement("div");
        message.className = "segment-content";
        const title = document.createElement("strong");
        title.textContent = "No checkpoints yet";
        const hint = document.createElement("span");
        hint.className = "segment-meta";
        hint.textContent = "Click the map to begin your route.";
        message.append(title, hint);
        empty.append(message);
        elements.segmentList.append(empty);
        return;
    }

    state.points.forEach((point, index) => {
        const row = document.createElement("li");
        row.className = "segment-row";
        row.dataset.index = String(index);
        row.setAttribute("aria-current", String(state.selectedIndex === index));
        row.addEventListener("click", () => {
            state.selectedIndex = index;
            renderSegments();
            drawRoute();
            setStatus(`checkpoint ${index + 1} selected · ${point.name.toLowerCase()}`);
        });

        const number = document.createElement("span");
        number.className = "segment-index";
        number.textContent = String(index + 1);

        const content = document.createElement("div");
        content.className = "segment-content";

        const nameInput = document.createElement("input");
        nameInput.className = "segment-name";
        nameInput.value = point.name;
        nameInput.maxLength = 48;
        nameInput.setAttribute("aria-label", `Name for checkpoint ${index + 1}`);
        nameInput.addEventListener("click", (event) => event.stopPropagation());
        nameInput.addEventListener("input", () => {
            point.name = nameInput.value;
            persistDraft();
        });

        const meta = document.createElement("span");
        meta.className = "segment-meta";
        const distance = document.createElement("span");
        distance.textContent = `${point.distance.toFixed(1)} MI`;
        const climb = document.createElement("span");
        climb.className = "segment-climb";
        climb.textContent = `+${formatInteger(point.climb)} FT`;
        const surface = document.createElement("span");
        surface.textContent = point.surface;
        meta.append(distance, document.createTextNode(" · "), climb, document.createTextNode(" · "), surface);
        content.append(nameInput, meta);

        const actions = document.createElement("div");
        actions.className = "segment-actions";
        actions.append(
            makeButton("UP", "", (event) => { event.stopPropagation(); movePoint(index, -1); }, index === 0),
            makeButton("DOWN", "", (event) => { event.stopPropagation(); movePoint(index, 1); }, index === state.points.length - 1),
            makeButton("DEL", "", (event) => { event.stopPropagation(); removePoint(index); }),
        );

        row.append(number, content, actions);
        elements.segmentList.append(row);
    });
}

function movePoint(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= state.points.length) return;
    [state.points[index], state.points[target]] = [state.points[target], state.points[index]];
    state.selectedIndex = target;
    state.redo = [];
    commitRouteChange("route sequence updated");
}

function removePoint(index) {
    const [removed] = state.points.splice(index, 1);
    state.redo = [{ point: removed, index }];
    state.selectedIndex = null;
    commitRouteChange(`removed ${removed.name.toLowerCase()} · ⌘⇧Z to restore`);
}

function setActivity(activity) {
    state.activity = activity;
    document.querySelectorAll("[data-activity]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.activity === activity));
    });
    persistDraft();
    updateSummary();
    setStatus(`${activity === "mtb" ? "mountain bike" : "trail run"} routing active`);
}

function setCanvasSize(canvas, context) {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width * ratio));
    const height = Math.max(1, Math.floor(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { width: rect.width, height: rect.height };
}

function sampledRoute(stepsPerSegment = 16) {
    if (state.points.length === 0) return [];
    if (state.points.length === 1) return [{ ...state.points[0], progress: 0 }];

    const samples = [];
    for (let segment = 0; segment < state.points.length - 1; segment += 1) {
        const start = state.points[segment];
        const end = state.points[segment + 1];
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy) || 1;
        const bend = (segment % 2 === 0 ? 1 : -1) * Math.min(0.085, length * 0.18);

        for (let step = segment === 0 ? 0 : 1; step <= stepsPerSegment; step += 1) {
            const t = step / stepsPerSegment;
            const ease = t * t * (3 - 2 * t);
            const wave = Math.sin(t * Math.PI) * bend
                + Math.sin(t * Math.PI * 3) * 0.025
                + Math.sin(t * Math.PI * 7) * 0.012
                + Math.sin(t * Math.PI * 13) * 0.006;
            const x = start.x + dx * ease + (-dy / length) * wave;
            const y = start.y + dy * ease + (dx / length) * wave;
            const elevationWave = Math.sin(t * Math.PI * 3) * 86 + Math.sin(t * Math.PI * 7) * 34;
            samples.push({
                x,
                y,
                lat: start.lat + (end.lat - start.lat) * ease,
                lon: start.lon + (end.lon - start.lon) * ease,
                elevation: Math.max(200, start.elevation + (end.elevation - start.elevation) * ease + elevationWave),
                progress: (segment + t) / (state.points.length - 1),
            });
        }
    }
    return samples;
}

function drawRoute() {
    const { width, height } = setCanvasSize(elements.routeCanvas, routeContext);
    routeContext.clearRect(0, 0, width, height);

    const samples = sampledRoute();
    if (samples.length > 1) {
        routeContext.beginPath();
        samples.forEach((point, index) => {
            const x = point.x * width;
            const y = point.y * height;
            if (index === 0) routeContext.moveTo(x, y);
            else routeContext.lineTo(x, y);
        });
        routeContext.lineCap = "round";
        routeContext.lineJoin = "round";
        routeContext.strokeStyle = "rgba(4, 8, 7, 0.78)";
        routeContext.lineWidth = 7;
        routeContext.stroke();

        routeContext.strokeStyle = "#70e6a5";
        routeContext.lineWidth = 3;
        routeContext.shadowColor = "rgba(112, 230, 165, 0.48)";
        routeContext.shadowBlur = 8;
        routeContext.stroke();
        routeContext.shadowBlur = 0;
    }

    state.points.forEach((point, index) => {
        const x = point.x * width;
        const y = point.y * height;
        const selected = state.selectedIndex === index;
        routeContext.beginPath();
        routeContext.arc(x, y, selected ? 15 : 13, 0, Math.PI * 2);
        routeContext.fillStyle = selected ? "#70e6a5" : "#0b1513";
        routeContext.fill();
        routeContext.lineWidth = 2;
        routeContext.strokeStyle = "#70e6a5";
        routeContext.stroke();
        routeContext.fillStyle = selected ? "#07120c" : "#e1eee9";
        routeContext.font = '700 11px "SFMono-Regular", Menlo, monospace';
        routeContext.textAlign = "center";
        routeContext.textBaseline = "middle";
        routeContext.fillText(String(index + 1), x, y + 0.5);
    });

    if (state.profileHover !== null && samples.length > 0) {
        const index = Math.min(samples.length - 1, Math.round(state.profileHover * (samples.length - 1)));
        const point = samples[index];
        const x = point.x * width;
        const y = point.y * height;
        routeContext.beginPath();
        routeContext.arc(x, y, 6, 0, Math.PI * 2);
        routeContext.fillStyle = "#ffffff";
        routeContext.fill();
        routeContext.lineWidth = 3;
        routeContext.strokeStyle = "#0b1012";
        routeContext.stroke();
    }
}

function elevationRange(samples) {
    if (samples.length === 0) return { min: 0, max: 1000 };
    const elevations = samples.map((sample) => sample.elevation);
    const min = Math.floor((Math.min(...elevations) - 250) / 500) * 500;
    const max = Math.ceil((Math.max(...elevations) + 250) / 500) * 500;
    return { min: Math.max(0, min), max: Math.max(min + 500, max) };
}

function drawElevation() {
    const { width, height } = setCanvasSize(elements.elevationCanvas, elevationContext);
    elevationContext.clearRect(0, 0, width, height);
    const samples = sampledRoute(22);
    const padding = { top: 10, right: 8, bottom: 22, left: 70 };
    const chartWidth = Math.max(1, width - padding.left - padding.right);
    const chartHeight = Math.max(1, height - padding.top - padding.bottom);
    const { min, max } = elevationRange(samples);

    elevationContext.font = '9px "SFMono-Regular", Menlo, monospace';
    elevationContext.textAlign = "right";
    elevationContext.textBaseline = "middle";

    for (let line = 0; line < 4; line += 1) {
        const ratio = line / 3;
        const y = padding.top + chartHeight * ratio;
        const feet = max - (max - min) * ratio;
        elevationContext.beginPath();
        elevationContext.moveTo(padding.left, y);
        elevationContext.lineTo(width - padding.right, y);
        elevationContext.strokeStyle = "rgba(54, 80, 84, 0.42)";
        elevationContext.lineWidth = 1;
        elevationContext.stroke();
        elevationContext.fillStyle = "#829b94";
        elevationContext.fillText(`${formatInteger(feet)} FT`, padding.left - 10, y);
    }

    if (samples.length > 1) {
        const pointFor = (sample, index) => ({
            x: padding.left + (index / (samples.length - 1)) * chartWidth,
            y: padding.top + (1 - (sample.elevation - min) / (max - min)) * chartHeight,
        });

        elevationContext.beginPath();
        samples.forEach((sample, index) => {
            const point = pointFor(sample, index);
            if (index === 0) elevationContext.moveTo(point.x, point.y);
            else elevationContext.lineTo(point.x, point.y);
        });
        const lastPoint = pointFor(samples[samples.length - 1], samples.length - 1);
        elevationContext.lineTo(lastPoint.x, padding.top + chartHeight);
        elevationContext.lineTo(padding.left, padding.top + chartHeight);
        elevationContext.closePath();
        elevationContext.fillStyle = "rgba(112, 230, 165, 0.1)";
        elevationContext.fill();

        elevationContext.beginPath();
        samples.forEach((sample, index) => {
            const point = pointFor(sample, index);
            if (index === 0) elevationContext.moveTo(point.x, point.y);
            else elevationContext.lineTo(point.x, point.y);
        });
        elevationContext.strokeStyle = "#70e6a5";
        elevationContext.lineWidth = 2;
        elevationContext.lineJoin = "round";
        elevationContext.stroke();

        if (state.profileHover !== null) {
            const x = padding.left + state.profileHover * chartWidth;
            const sampleIndex = Math.min(samples.length - 1, Math.round(state.profileHover * (samples.length - 1)));
            const point = pointFor(samples[sampleIndex], sampleIndex);
            elevationContext.beginPath();
            elevationContext.moveTo(x, padding.top);
            elevationContext.lineTo(x, padding.top + chartHeight);
            elevationContext.strokeStyle = "#e1eee9";
            elevationContext.lineWidth = 1;
            elevationContext.stroke();
            elevationContext.beginPath();
            elevationContext.arc(point.x, point.y, 4, 0, Math.PI * 2);
            elevationContext.fillStyle = "#e1eee9";
            elevationContext.fill();
        }
    }

    const totalDistance = routeStats().distance;
    elevationContext.fillStyle = "#829b94";
    elevationContext.textBaseline = "bottom";
    elevationContext.textAlign = "left";
    elevationContext.fillText("0 MI", padding.left, height - 2);
    elevationContext.textAlign = "center";
    elevationContext.fillText(`${(totalDistance / 2).toFixed(1)} MI`, padding.left + chartWidth / 2, height - 2);
    elevationContext.textAlign = "right";
    elevationContext.fillText(`${totalDistance.toFixed(1)} MI`, width - padding.right, height - 2);
}

function renderAll() {
    elements.routeName.value = state.name;
    document.querySelectorAll("[data-activity]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.activity === state.activity));
    });
    renderSegments();
    updateSummary();
    drawRoute();
    drawElevation();
}

function commitRouteChange(message) {
    persistDraft();
    renderAll();
    const trailConfidence = state.points.length < 2 ? 0 : Math.max(82, 99 - state.points.length);
    setStatus(`${message} · ${trailConfidence}% on trail`);
}

function pointFromMapEvent(event) {
    const rect = elements.routeCanvas.getBoundingClientRect();
    const x = Math.min(0.96, Math.max(0.04, (event.clientX - rect.left) / rect.width));
    const y = Math.min(0.94, Math.max(0.06, (event.clientY - rect.top) / rect.height));
    return pointFromNormalized(x, y);
}

function pointFromNormalized(x, y) {
    const previous = state.points.at(-1);
    const distance = previous
        ? Math.max(0.4, Math.hypot((x - previous.x) * 15.5, (y - previous.y) * 10.5))
        : 0;
    const elevation = Math.round(950 + (1 - y) * 1900 + Math.sin(x * Math.PI * 4) * 220);
    const climb = previous ? Math.max(0, elevation - previous.elevation) : 0;
    const number = state.points.length + 1;
    return {
        id: `checkpoint-${Date.now()}-${number}`,
        name: number === 1 ? "Trailhead" : `Checkpoint ${number}`,
        x,
        y,
        lat: 47.555 - y * 0.11,
        lon: -122.035 + x * 0.155,
        elevation,
        distance: Number(distance.toFixed(1)),
        climb: Math.round(climb / 10) * 10,
        surface: state.activity === "mtb" ? "SINGLETRACK" : number % 3 === 0 ? "GRAVEL" : "DIRT",
    };
}

function addPoint(point) {
    if (state.points.length >= 40) {
        setStatus("route limit reached · export or start a new route", "error");
        return;
    }
    state.points.push(point);
    state.redo = [];
    state.selectedIndex = state.points.length - 1;
    state.placing = false;
    elements.mapMode.textContent = "ROUTE UPDATED";
    commitRouteChange(`checkpoint ${state.points.length} added`);
}

function beginPlacing() {
    state.placing = true;
    elements.mapMode.textContent = "PLACE CHECKPOINT";
    setStatus("click anywhere on the terrain to add the next checkpoint");
    elements.routeCanvas.focus();
}

function undoPoint() {
    if (state.points.length === 0) return;
    const index = state.points.length - 1;
    const point = state.points.pop();
    state.redo = [{ point, index }];
    state.selectedIndex = null;
    commitRouteChange(`removed ${point.name.toLowerCase()} · ⌘⇧Z to restore`);
}

function redoPoint() {
    const entry = state.redo.pop();
    if (!entry) return;
    state.points.splice(Math.min(entry.index, state.points.length), 0, entry.point);
    state.selectedIndex = Math.min(entry.index, state.points.length - 1);
    commitRouteChange(`restored ${entry.point.name.toLowerCase()}`);
}

function reverseRoute() {
    if (state.points.length < 2) return;
    state.points.reverse();
    state.selectedIndex = null;
    state.redo = [];
    commitRouteChange("route reversed");
}

function newRoute() {
    state.name = "Untitled Route";
    state.points = [];
    state.redo = [];
    state.selectedIndex = null;
    state.profileHover = null;
    state.placing = true;
    elements.mapMode.textContent = "PLACE START POINT";
    commitRouteChange("new route ready · place your first checkpoint");
    elements.routeName.focus();
    elements.routeName.select();
}

function xmlEscape(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

function gpxPoints() {
    return sampledRoute(20).map((point) => ({
        lat: Number(point.lat.toFixed(7)),
        lon: Number(point.lon.toFixed(7)),
        elevation: Number(point.elevation.toFixed(1)),
    }));
}

function browserGpx(routeName, activity, points) {
    const trackPoints = points
        .map((point) => `      <trkpt lat="${point.lat}" lon="${point.lon}"><ele>${point.elevation}</ele></trkpt>`)
        .join("\n");
    const activityName = activity === "mtb" ? "Mountain Biking" : "Trail Running";
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RIDGELINE" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata><name>${xmlEscape(routeName)}</name><desc>${activityName} route exported by RIDGELINE</desc></metadata>
  <trk><name>${xmlEscape(routeName)}</name><type>${activityName}</type><trkseg>
${trackPoints}
  </trkseg></trk>
</gpx>\n`;
}

function safeFileName(value) {
    const base = value.trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64);
    return `${base || "ridgeline-route"}.gpx`;
}

function downloadGpx(fileName, contents) {
    const url = URL.createObjectURL(new Blob([contents], { type: "application/gpx+xml" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportGpx() {
    if (state.points.length < 2) {
        setStatus("add at least two checkpoints before exporting", "error");
        return;
    }

    const fileName = safeFileName(state.name);
    const points = gpxPoints();
    elements.btnExport.disabled = true;
    elements.btnExport.textContent = "PREPARING…";
    setStatus(`building GPX 1.1 track · ${points.length} points`, "busy");

    try {
        if (invoke) {
            const savedPath = await invoke("export_gpx", {
                routeName: state.name,
                activity: state.activity,
                fileName,
                points,
            });
            setStatus(savedPath ? `GPX saved · ${savedPath}` : "export cancelled");
        } else {
            downloadGpx(fileName, browserGpx(state.name, state.activity, points));
            setStatus(`GPX downloaded · ${fileName}`);
        }
    } catch (error) {
        setStatus(`export failed · ${String(error)}`, "error");
    } finally {
        elements.btnExport.textContent = "EXPORT GPX";
        elements.btnExport.disabled = state.points.length < 2;
    }
}

function toggleShortcuts() {
    if (elements.shortcutsDialog.open) elements.shortcutsDialog.close();
    else elements.shortcutsDialog.showModal();
}

elements.routeName.addEventListener("input", () => {
    state.name = elements.routeName.value;
    persistDraft();
    setStatus("route name updated");
});

document.querySelectorAll("[data-activity]").forEach((button) => {
    button.addEventListener("click", () => setActivity(button.dataset.activity));
});

elements.routeCanvas.addEventListener("click", (event) => addPoint(pointFromMapEvent(event)));
elements.routeCanvas.addEventListener("mousemove", (event) => {
    const rect = elements.routeCanvas.getBoundingClientRect();
    const point = pointFromMapEvent(event);
    elements.mapCoordinate.style.display = "block";
    elements.mapCoordinate.style.left = `${Math.min(rect.width - 120, event.clientX - rect.left + 13)}px`;
    elements.mapCoordinate.style.top = `${Math.min(rect.height - 32, event.clientY - rect.top + 13)}px`;
    elements.mapCoordinate.textContent = `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`;
});
elements.routeCanvas.addEventListener("mouseleave", () => { elements.mapCoordinate.style.display = "none"; });
elements.routeCanvas.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const offset = (state.points.length % 5) * 0.11;
        addPoint(pointFromNormalized(0.28 + offset, 0.52 - offset / 2));
    }
});

elements.elevationCanvas.addEventListener("mousemove", (event) => {
    const rect = elements.elevationCanvas.getBoundingClientRect();
    const leftPadding = 70;
    state.profileHover = Math.max(0, Math.min(1, (event.clientX - rect.left - leftPadding) / Math.max(1, rect.width - leftPadding - 8)));
    drawElevation();
    drawRoute();
});
elements.elevationCanvas.addEventListener("mouseleave", () => {
    state.profileHover = null;
    drawElevation();
    drawRoute();
});

elements.btnAdd.addEventListener("click", beginPlacing);
elements.btnReverse.addEventListener("click", reverseRoute);
elements.btnExport.addEventListener("click", exportGpx);
elements.btnNew.addEventListener("click", newRoute);
elements.btnShortcuts.addEventListener("click", toggleShortcuts);
elements.btnCloseShortcuts.addEventListener("click", () => elements.shortcutsDialog.close());
elements.shortcutsDialog.addEventListener("click", (event) => {
    if (event.target === elements.shortcutsDialog) elements.shortcutsDialog.close();
});

document.addEventListener("keydown", (event) => {
    if (!event.metaKey) return;
    const key = event.key.toLowerCase();
    const actions = {
        "1": () => setActivity("trail-run"),
        "2": () => setActivity("mtb"),
        "/": toggleShortcuts,
        "e": exportGpx,
        "n": newRoute,
        "r": reverseRoute,
        "z": event.shiftKey ? redoPoint : undoPoint,
    };
    const action = actions[key];
    if (!action) return;
    event.preventDefault();
    action();
});

const resizeObserver = new ResizeObserver(() => {
    drawRoute();
    drawElevation();
});
resizeObserver.observe(elements.routeCanvas);
resizeObserver.observe(elements.elevationCanvas);

loadDraft();
renderAll();

window.__RIDGELINE_TEST__ = {
    getState: () => JSON.parse(JSON.stringify(state)),
    newRoute,
    reverseRoute,
    exportGpx,
};
