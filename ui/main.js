const STORAGE_KEY = "ridgeline.active-route.v2";
const ROUTER_URL = "https://brouter.de/brouter";
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_VIEW = Object.freeze({ lat: 47.4884, lon: -121.9460, zoom: 13 });
const FEET_PER_METER = 3.28084;
const METERS_PER_MILE = 1609.344;
const MAX_WAYPOINTS = 25;
const MAX_TRACK_POINTS = 19_000;
const ROUTING_PROFILES = Object.freeze({
    "trail-run": "hiking-mountain",
    mtb: "mtb",
});

const invoke = window.__TAURI__?.core?.invoke;

const state = {
    name: "Untitled Route",
    activity: "trail-run",
    points: [],
    track: [],
    route: { distance: 0, gain: 0, source: "empty" },
    redo: [],
    selectedIndex: null,
    profileHover: null,
    placing: false,
    routing: false,
    routeRequest: 0,
    routeAbort: null,
    userLocation: null,
};

const elements = {
    routeName: document.getElementById("route-name"),
    segmentList: document.getElementById("segment-list"),
    segmentCount: document.getElementById("segment-count"),
    liveMap: document.getElementById("live-map"),
    elevationCanvas: document.getElementById("elevation-canvas"),
    totalDistance: document.getElementById("total-distance"),
    totalGain: document.getElementById("total-gain"),
    estimatedTime: document.getElementById("estimated-time"),
    status: document.getElementById("status"),
    mapMode: document.getElementById("map-mode"),
    mapCoordinate: document.getElementById("map-coordinate"),
    mapSource: document.getElementById("map-source"),
    saveState: document.getElementById("save-state"),
    btnAdd: document.getElementById("btn-add"),
    btnLocate: document.getElementById("btn-locate"),
    btnReverse: document.getElementById("btn-reverse"),
    btnExport: document.getElementById("btn-export"),
    btnNew: document.getElementById("btn-new"),
    btnShortcuts: document.getElementById("btn-shortcuts"),
    shortcutsDialog: document.getElementById("shortcuts-dialog"),
    btnCloseShortcuts: document.getElementById("btn-close-shortcuts"),
};

if (!window.L) {
    throw new Error("RIDGELINE could not load its bundled map engine.");
}

const map = window.L.map(elements.liveMap, {
    zoomControl: false,
    minZoom: 3,
    maxZoom: 19,
}).setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lon], DEFAULT_VIEW.zoom);

window.L.tileLayer(TILE_URL, {
    maxZoom: 19,
    attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>',
}).addTo(map);
map.attributionControl.setPrefix(false);
window.L.control.zoom({ position: "topright" }).addTo(map);

const routeLayer = window.L.layerGroup().addTo(map);
const waypointLayer = window.L.layerGroup().addTo(map);
const locationLayer = window.L.layerGroup().addTo(map);
const profileLayer = window.L.layerGroup().addTo(map);
const elevationContext = elements.elevationCanvas.getContext("2d");

function clonePoint(point) {
    return { ...point };
}

function isValidPoint(point) {
    return point
        && Number.isFinite(point.lat)
        && Number.isFinite(point.lon)
        && Number.isFinite(point.elevation)
        && Number.isFinite(point.distance)
        && Number.isFinite(point.climb)
        && (-90 <= point.lat && point.lat <= 90)
        && (-180 <= point.lon && point.lon <= 180)
        && typeof point.name === "string"
        && typeof point.surface === "string";
}

function loadDraft() {
    try {
        const draft = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (!draft || !Array.isArray(draft.points)) return;

        state.name = typeof draft.name === "string" ? draft.name.slice(0, 72) : state.name;
        state.activity = draft.activity === "mtb" ? "mtb" : "trail-run";
        state.points = draft.points
            .filter(isValidPoint)
            .slice(0, MAX_WAYPOINTS)
            .map(clonePoint);
    } catch {
        localStorage.removeItem(STORAGE_KEY);
    }
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

function formatDuration(totalMinutes) {
    if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "0:00";
    const rounded = Math.round(totalMinutes);
    const hours = Math.floor(rounded / 60);
    const minutes = rounded % 60;
    return `${hours}:${String(minutes).padStart(2, "0")}`;
}

function haversineMiles(start, end) {
    const radians = Math.PI / 180;
    const latitudeDelta = (end.lat - start.lat) * radians;
    const longitudeDelta = (end.lon - start.lon) * radians;
    const startLatitude = start.lat * radians;
    const endLatitude = end.lat * radians;
    const a = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
    return 3958.7613 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeTrackMetrics(track) {
    let distance = 0;
    let gain = 0;
    for (let index = 1; index < track.length; index += 1) {
        distance += haversineMiles(track[index - 1], track[index]);
        gain += Math.max(0, track[index].elevation - track[index - 1].elevation);
    }
    return { distance, gain };
}

function provisionalTrack() {
    if (state.points.length === 0) return [];
    if (state.points.length === 1) return [clonePoint(state.points[0])];

    const track = [];
    state.points.forEach((point, index) => {
        if (index === 0) {
            track.push(clonePoint(point));
            return;
        }
        const previous = state.points[index - 1];
        const steps = Math.max(2, Math.min(18, Math.ceil(haversineMiles(previous, point) * 2)));
        for (let step = 1; step <= steps; step += 1) {
            const progress = step / steps;
            track.push({
                lat: previous.lat + (point.lat - previous.lat) * progress,
                lon: previous.lon + (point.lon - previous.lon) * progress,
                elevation: previous.elevation + (point.elevation - previous.elevation) * progress,
            });
        }
    });
    return track;
}

function setProvisionalRoute() {
    state.track = provisionalTrack();
    const metrics = computeTrackMetrics(state.track);
    state.route = {
        ...metrics,
        source: state.points.length > 1 ? "direct" : state.points.length === 1 ? "point" : "empty",
    };
}

function routeStats() {
    const distance = state.route.distance;
    const gain = state.route.gain;
    const minutes = state.activity === "trail-run"
        ? distance * 10.4 + gain * 0.01
        : distance * 7.2 + gain * 0.0045;
    return { distance, gain, minutes };
}

function updateSummary() {
    const { distance, gain, minutes } = routeStats();
    elements.totalDistance.textContent = distance.toFixed(1);
    elements.totalGain.textContent = `+${formatInteger(gain)}`;
    elements.estimatedTime.textContent = formatDuration(minutes);
    elements.segmentCount.textContent = `${String(state.points.length).padStart(2, "0")} ${state.points.length === 1 ? "CHECKPOINT" : "CHECKPOINTS"}`;
    elements.btnReverse.disabled = state.routing || state.points.length < 2;
    elements.btnExport.disabled = state.routing || state.points.length < 2 || state.route.source !== "brouter";
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

function selectPoint(index) {
    const point = state.points[index];
    if (!point) return;
    state.selectedIndex = index;
    renderSegments();
    renderMap();
    map.panTo([point.lat, point.lon]);
    setStatus(`checkpoint ${index + 1} selected · ${point.name.toLowerCase()}`);
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
        hint.textContent = "Locate yourself or click the live map to begin.";
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
        row.addEventListener("click", () => selectPoint(index));

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
        distance.textContent = index === 0 ? "START" : `${point.distance.toFixed(1)} MI`;
        const climb = document.createElement("span");
        climb.className = "segment-climb";
        climb.textContent = index === 0 ? `${formatInteger(point.elevation)} FT` : `+${formatInteger(point.climb)} FT`;
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

function trackCumulative(track) {
    const distance = [0];
    const gain = [0];
    for (let index = 1; index < track.length; index += 1) {
        distance[index] = distance[index - 1] + haversineMiles(track[index - 1], track[index]);
        gain[index] = gain[index - 1] + Math.max(0, track[index].elevation - track[index - 1].elevation);
    }
    return { distance, gain };
}

function nearestTrackIndex(point, track, start, end) {
    let nearest = start;
    let nearestDistance = Number.POSITIVE_INFINITY;
    const latitudeScale = Math.cos(point.lat * Math.PI / 180);
    for (let index = start; index <= end; index += 1) {
        const latitudeDelta = point.lat - track[index].lat;
        const longitudeDelta = (point.lon - track[index].lon) * latitudeScale;
        const distance = latitudeDelta ** 2 + longitudeDelta ** 2;
        if (distance < nearestDistance) {
            nearest = index;
            nearestDistance = distance;
        }
    }
    return nearest;
}

function syncWaypointMetrics() {
    if (state.points.length === 0 || state.track.length === 0) return;
    const matches = new Array(state.points.length).fill(0);
    matches[0] = 0;
    if (state.points.length > 1) matches[matches.length - 1] = state.track.length - 1;

    for (let index = 1; index < state.points.length - 1; index += 1) {
        const start = matches[index - 1];
        const remainingWaypoints = state.points.length - index - 1;
        const end = Math.max(start, state.track.length - 1 - remainingWaypoints);
        matches[index] = nearestTrackIndex(state.points[index], state.track, start, end);
    }

    const cumulative = trackCumulative(state.track);
    state.points.forEach((point, index) => {
        const trackIndex = matches[index];
        const previousTrackIndex = index === 0 ? trackIndex : matches[index - 1];
        point.elevation = Math.round(state.track[trackIndex].elevation);
        point.distance = Number((cumulative.distance[trackIndex] - cumulative.distance[previousTrackIndex]).toFixed(1));
        point.climb = Math.round(cumulative.gain[trackIndex] - cumulative.gain[previousTrackIndex]);
        point.surface = index === 0 ? "START" : state.activity === "mtb" ? "OSM MTB ROUTE" : "OSM TRAIL ROUTE";
    });
}

function downsampleCoordinates(coordinates) {
    if (coordinates.length <= MAX_TRACK_POINTS) return coordinates;
    const step = Math.ceil(coordinates.length / (MAX_TRACK_POINTS - 1));
    const sampled = coordinates.filter((_, index) => index % step === 0);
    const last = coordinates.at(-1);
    if (sampled.at(-1) !== last) sampled.push(last);
    return sampled;
}

function parseBrouterResponse(payload) {
    const feature = payload?.features?.find((candidate) => candidate?.geometry?.type === "LineString");
    const rawCoordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(rawCoordinates) || rawCoordinates.length < 2) {
        throw new Error("the router returned no usable trail geometry");
    }

    const coordinates = downsampleCoordinates(rawCoordinates);
    const track = coordinates.map((coordinate) => {
        const [lon, lat, elevationMeters = 0] = coordinate;
        if (![lat, lon, elevationMeters].every(Number.isFinite)) {
            throw new Error("the router returned an invalid coordinate");
        }
        return { lat, lon, elevation: elevationMeters * FEET_PER_METER };
    });

    const computed = computeTrackMetrics(track);
    const lengthMeters = Number(feature.properties?.["track-length"]);
    const ascentMeters = Number(feature.properties?.["filtered ascend"]);
    return {
        track,
        distance: Number.isFinite(lengthMeters) ? lengthMeters / METERS_PER_MILE : computed.distance,
        gain: Number.isFinite(ascentMeters) ? ascentMeters * FEET_PER_METER : computed.gain,
    };
}

async function routeWaypoints({ fit = false, message = "route updated" } = {}) {
    if (state.points.length < 2) return;

    state.routeAbort?.abort();
    const controller = new AbortController();
    const request = state.routeRequest + 1;
    state.routeRequest = request;
    state.routeAbort = controller;
    state.routing = true;
    elements.mapSource.textContent = "ROUTING OSM…";
    elements.mapMode.textContent = "SNAPPING TO TRAILS";
    setStatus(`${message} · requesting live ${state.activity === "mtb" ? "MTB" : "trail"} route`, "busy");
    updateSummary();

    const parameters = new URLSearchParams({
        lonlats: state.points.map((point) => `${point.lon.toFixed(6)},${point.lat.toFixed(6)}`).join("|"),
        profile: ROUTING_PROFILES[state.activity],
        alternativeidx: "0",
        format: "geojson",
    });

    try {
        const response = await fetch(`${ROUTER_URL}?${parameters}`, {
            signal: controller.signal,
            headers: { Accept: "application/geo+json, application/json" },
        });
        if (!response.ok) throw new Error(`BRouter returned HTTP ${response.status}`);
        const routed = parseBrouterResponse(await response.json());
        if (request !== state.routeRequest) return;

        state.track = routed.track;
        state.route = { distance: routed.distance, gain: routed.gain, source: "brouter" };
        syncWaypointMetrics();
        persistDraft();
        elements.mapSource.textContent = "LIVE OSM · BROUTER";
        elements.mapMode.textContent = "TRAIL ROUTE READY";
        renderAll();
        if (fit) fitCurrentRoute();
        setStatus(`live trail route ready · ${state.route.distance.toFixed(1)} mi · +${formatInteger(state.route.gain)} ft`);
    } catch (error) {
        if (error?.name === "AbortError") return;
        if (request !== state.routeRequest) return;
        setProvisionalRoute();
        elements.mapSource.textContent = "OSM TILES · ROUTER OFFLINE";
        elements.mapMode.textContent = "DIRECT PREVIEW ONLY";
        renderAll();
        setStatus(`trail routing unavailable · ${String(error?.message || error)} · change activity to retry`, "error");
    } finally {
        if (request === state.routeRequest) {
            state.routing = false;
            state.routeAbort = null;
            updateSummary();
        }
    }
}

function renderMap() {
    routeLayer.clearLayers();
    waypointLayer.clearLayers();

    if (state.track.length > 1) {
        const latLngs = state.track.map((point) => [point.lat, point.lon]);
        window.L.polyline(latLngs, {
            color: "#020605",
            weight: 9,
            opacity: 0.78,
            lineCap: "round",
            lineJoin: "round",
            interactive: false,
        }).addTo(routeLayer);
        window.L.polyline(latLngs, {
            color: state.route.source === "brouter" ? "#70e6a5" : "#e5bf72",
            weight: 3,
            opacity: 1,
            dashArray: state.route.source === "brouter" ? null : "7 7",
            lineCap: "round",
            lineJoin: "round",
            interactive: false,
        }).addTo(routeLayer);
    }

    state.points.forEach((point, index) => {
        const selected = state.selectedIndex === index ? " is-selected" : "";
        const icon = window.L.divIcon({
            className: "route-marker-shell",
            html: `<span class="route-marker${selected}">${index + 1}</span>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
        });
        window.L.marker([point.lat, point.lon], {
            icon,
            title: `${index + 1}. ${point.name}`,
            keyboard: true,
            bubblingMouseEvents: false,
        }).on("click", () => selectPoint(index)).addTo(waypointLayer);
    });

    updateProfileMapMarker();
}

function renderLocation() {
    locationLayer.clearLayers();
    if (!state.userLocation) return;
    const { lat, lon, accuracy } = state.userLocation;
    window.L.circle([lat, lon], {
        radius: Math.max(accuracy, 8),
        color: "#55aaff",
        weight: 1,
        opacity: 0.72,
        fillColor: "#55aaff",
        fillOpacity: 0.09,
        interactive: false,
    }).addTo(locationLayer);
    const icon = window.L.divIcon({
        className: "location-marker-shell",
        html: '<span class="location-marker" aria-hidden="true"></span>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
    });
    window.L.marker([lat, lon], { icon, title: "Your current location", keyboard: false }).addTo(locationLayer);
}

function updateProfileMapMarker() {
    profileLayer.clearLayers();
    if (state.profileHover === null || state.track.length === 0) return;
    const index = Math.min(state.track.length - 1, Math.round(state.profileHover * (state.track.length - 1)));
    const point = state.track[index];
    window.L.circleMarker([point.lat, point.lon], {
        radius: 6,
        color: "#07120c",
        weight: 3,
        fillColor: "#ffffff",
        fillOpacity: 1,
        interactive: false,
    }).addTo(profileLayer);
}

function fitCurrentRoute() {
    if (state.track.length > 1) {
        map.fitBounds(state.track.map((point) => [point.lat, point.lon]), {
            padding: [56, 56],
            maxZoom: 16,
        });
    } else if (state.points.length === 1) {
        map.setView([state.points[0].lat, state.points[0].lon], 15);
    }
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
    const samples = state.track;
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
        const lastPoint = pointFor(samples.at(-1), samples.length - 1);
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
        elevationContext.strokeStyle = state.route.source === "brouter" ? "#70e6a5" : "#e5bf72";
        elevationContext.lineWidth = 2;
        elevationContext.lineJoin = "round";
        elevationContext.stroke();

        if (state.profileHover !== null) {
            const sampleIndex = Math.min(samples.length - 1, Math.round(state.profileHover * (samples.length - 1)));
            const point = pointFor(samples[sampleIndex], sampleIndex);
            elevationContext.beginPath();
            elevationContext.moveTo(point.x, padding.top);
            elevationContext.lineTo(point.x, padding.top + chartHeight);
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
    renderMap();
    renderLocation();
    drawElevation();
}

function commitRouteChange(message, { fit = false } = {}) {
    state.routeAbort?.abort();
    state.routing = false;
    setProvisionalRoute();
    persistDraft();
    renderAll();
    if (state.points.length > 1) {
        void routeWaypoints({ fit, message });
    } else {
        elements.mapSource.textContent = "LIVE OPENSTREETMAP";
        setStatus(message);
        if (fit) fitCurrentRoute();
    }
}

function movePoint(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= state.points.length) return;
    [state.points[index], state.points[target]] = [state.points[target], state.points[index]];
    state.selectedIndex = target;
    state.redo = [];
    commitRouteChange("route sequence updated", { fit: true });
}

function removePoint(index) {
    const [removed] = state.points.splice(index, 1);
    state.redo = [{ point: removed, index }];
    state.selectedIndex = null;
    commitRouteChange(`removed ${removed.name.toLowerCase()} · ⌘⇧Z to restore`, { fit: true });
}

function setActivity(activity) {
    if (!ROUTING_PROFILES[activity]) return;
    state.activity = activity;
    persistDraft();
    renderAll();
    if (state.points.length > 1) {
        setProvisionalRoute();
        renderAll();
        void routeWaypoints({ message: `${activity === "mtb" ? "mountain bike" : "trail run"} profile active` });
    } else {
        setStatus(`${activity === "mtb" ? "mountain bike" : "trail run"} routing active`);
    }
}

function pointFromLatLng(lat, lon, name) {
    const previous = state.points.at(-1);
    const number = state.points.length + 1;
    return {
        id: `checkpoint-${Date.now()}-${number}`,
        name: name || (number === 1 ? "Start" : `Checkpoint ${number}`),
        lat,
        lon,
        elevation: previous?.elevation || 0,
        distance: previous ? Number(haversineMiles(previous, { lat, lon }).toFixed(1)) : 0,
        climb: 0,
        surface: number === 1 ? "START" : "PENDING ROUTE",
    };
}

function addPoint(point, { fit = false } = {}) {
    if (state.points.length >= MAX_WAYPOINTS) {
        setStatus("checkpoint limit reached · export or start a new route", "error");
        return;
    }
    state.points.push(point);
    state.redo = [];
    state.selectedIndex = state.points.length - 1;
    state.placing = false;
    elements.mapMode.textContent = state.points.length === 1 ? "ADD DESTINATION" : "ROUTING…";
    commitRouteChange(`checkpoint ${state.points.length} added`, { fit });
}

function beginPlacing() {
    state.placing = true;
    elements.mapMode.textContent = "PLACE CHECKPOINT";
    setStatus("click the live map to add the next checkpoint");
    elements.liveMap.focus();
}

function addPointAtMapCenter() {
    const center = map.getCenter();
    addPoint(pointFromLatLng(center.lat, center.lng));
}

function undoPoint() {
    if (state.points.length === 0) return;
    const index = state.points.length - 1;
    const point = state.points.pop();
    state.redo = [{ point, index }];
    state.selectedIndex = null;
    commitRouteChange(`removed ${point.name.toLowerCase()} · ⌘⇧Z to restore`, { fit: true });
}

function redoPoint() {
    const entry = state.redo.pop();
    if (!entry) return;
    state.points.splice(Math.min(entry.index, state.points.length), 0, entry.point);
    state.selectedIndex = Math.min(entry.index, state.points.length - 1);
    commitRouteChange(`restored ${entry.point.name.toLowerCase()}`, { fit: true });
}

function reverseRoute() {
    if (state.points.length < 2) return;
    state.points.reverse();
    state.selectedIndex = null;
    state.redo = [];
    commitRouteChange("route reversed", { fit: true });
}

function newRoute() {
    state.routeAbort?.abort();
    state.name = "Untitled Route";
    state.points = [];
    state.track = [];
    state.route = { distance: 0, gain: 0, source: "empty" };
    state.redo = [];
    state.selectedIndex = null;
    state.profileHover = null;
    state.placing = true;
    state.routing = false;
    elements.mapMode.textContent = "PLACE START POINT";
    elements.mapSource.textContent = "LIVE OPENSTREETMAP";
    persistDraft();
    renderAll();
    setStatus("new route ready · locate yourself or place a start point");
    elements.routeName.focus();
    elements.routeName.select();
}

function locationErrorMessage(error) {
    if (error?.code === 1) return "location permission denied · enable RIDGELINE in System Settings › Privacy & Security › Location Services";
    if (error?.code === 2) return "your location is currently unavailable";
    if (error?.code === 3) return "location request timed out · try again near a window or with Wi-Fi enabled";
    return `location failed · ${String(error?.message || error)}`;
}

function applyUserLocation(position) {
    const lat = Number(position?.coords?.latitude);
    const lon = Number(position?.coords?.longitude);
    const accuracy = Math.max(1, Number(position?.coords?.accuracy) || 25);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new Error("location returned invalid coordinates");
    }
    state.userLocation = { lat, lon, accuracy };
    renderLocation();
    map.setView([lat, lon], 15);
    elements.btnLocate.textContent = "LOCATED";
    if (state.points.length === 0) {
        addPoint(pointFromLatLng(lat, lon, "My Location"));
        setStatus(`location ready · accurate to ${formatInteger(accuracy)} m · add a destination`);
    } else {
        setStatus(`centered on your location · accurate to ${formatInteger(accuracy)} m`);
    }
}

function browserLocation() {
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 15_000,
            maximumAge: 30_000,
        });
    });
}

async function locateUser() {
    if (!invoke && !navigator.geolocation) {
        setStatus("location is not available on this device", "error");
        return;
    }
    elements.btnLocate.disabled = true;
    elements.btnLocate.textContent = "LOCATING…";
    setStatus("requesting your current location · macOS may ask you to approve RIDGELINE", "busy");

    try {
        const position = invoke
            ? { coords: await invoke("current_location") }
            : await browserLocation();
        applyUserLocation(position);
    } catch (error) {
        elements.btnLocate.textContent = "LOCATE ME";
        setStatus(locationErrorMessage(error), "error");
    } finally {
        elements.btnLocate.disabled = false;
    }
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
    return state.track.map((point) => ({
        lat: Number(point.lat.toFixed(7)),
        lon: Number(point.lon.toFixed(7)),
        elevation: Number((point.elevation / FEET_PER_METER).toFixed(1)),
    }));
}

function browserGpx(routeName, activity, points) {
    const trackPoints = points
        .map((point) => `      <trkpt lat="${point.lat}" lon="${point.lon}"><ele>${point.elevation}</ele></trkpt>`)
        .join("\n");
    const activityName = activity === "mtb" ? "Mountain Biking" : "Trail Running";
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RIDGELINE" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata><name>${xmlEscape(routeName)}</name><desc>${activityName} route exported by RIDGELINE using OpenStreetMap data</desc></metadata>
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
    if (state.route.source !== "brouter") {
        setStatus("wait for live trail routing before exporting · direct preview is not a navigable route", "error");
        return;
    }

    const fileName = safeFileName(state.name);
    const points = gpxPoints();
    elements.btnExport.disabled = true;
    elements.btnExport.textContent = "PREPARING…";
    setStatus(`building GPX 1.1 track · ${points.length} real trail points`, "busy");

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
        updateSummary();
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

map.on("click", (event) => addPoint(pointFromLatLng(event.latlng.lat, event.latlng.lng)));
map.on("mousemove", (event) => {
    const size = map.getSize();
    elements.mapCoordinate.style.display = "block";
    elements.mapCoordinate.style.left = `${Math.min(size.x - 132, event.containerPoint.x + 13)}px`;
    elements.mapCoordinate.style.top = `${Math.min(size.y - 32, event.containerPoint.y + 13)}px`;
    elements.mapCoordinate.textContent = `${event.latlng.lat.toFixed(5)}, ${event.latlng.lng.toFixed(5)}`;
});
elements.liveMap.addEventListener("mouseleave", () => { elements.mapCoordinate.style.display = "none"; });

elements.elevationCanvas.addEventListener("mousemove", (event) => {
    const rect = elements.elevationCanvas.getBoundingClientRect();
    const leftPadding = 70;
    state.profileHover = Math.max(0, Math.min(1, (event.clientX - rect.left - leftPadding) / Math.max(1, rect.width - leftPadding - 8)));
    drawElevation();
    updateProfileMapMarker();
});
elements.elevationCanvas.addEventListener("mouseleave", () => {
    state.profileHover = null;
    drawElevation();
    updateProfileMapMarker();
});

elements.btnAdd.addEventListener("click", beginPlacing);
elements.btnLocate.addEventListener("click", locateUser);
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
    if ((event.target instanceof HTMLInputElement) && key === "z") return;
    const actions = {
        "1": () => setActivity("trail-run"),
        "2": () => setActivity("mtb"),
        "/": toggleShortcuts,
        e: exportGpx,
        l: locateUser,
        n: newRoute,
        p: addPointAtMapCenter,
        r: reverseRoute,
        z: event.shiftKey ? redoPoint : undoPoint,
    };
    const action = actions[key];
    if (!action) return;
    event.preventDefault();
    action();
});

const resizeObserver = new ResizeObserver(() => {
    map.invalidateSize({ pan: false });
    drawElevation();
});
resizeObserver.observe(elements.liveMap);
resizeObserver.observe(elements.elevationCanvas);

loadDraft();
setProvisionalRoute();
renderAll();
window.setTimeout(() => map.invalidateSize({ pan: false }), 0);
if (state.points.length > 1) {
    void routeWaypoints({ fit: true, message: "restored local draft" });
} else if (state.points.length === 1) {
    fitCurrentRoute();
    setStatus("draft restored · add a destination for live trail routing");
} else {
    setStatus("live map ready · locate yourself or click to place a start point");
}

window.__RIDGELINE_TEST__ = {
    getState: () => JSON.parse(JSON.stringify(state)),
    getGpxPoints: () => gpxPoints(),
    applyLocation: (lat, lon, accuracy = 10) => applyUserLocation({ coords: { latitude: lat, longitude: lon, accuracy } }),
    addCheckpoint: (lat, lon) => addPoint(pointFromLatLng(lat, lon)),
    newRoute,
    reverseRoute,
    routeWaypoints,
    exportGpx,
};
