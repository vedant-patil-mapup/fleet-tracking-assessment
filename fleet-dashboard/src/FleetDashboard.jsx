import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Polyline,
  Marker,
  Popup,
} from "react-leaflet";
import L from "leaflet";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import "leaflet/dist/leaflet.css";

// ---------- CONFIG ----------
// Replace this with your assessment folder placed under `public/`
const ASSESSMENT_FOLDER = "/assessment-2025-11-10-10-45-15/";
const TRIP_FILES = [
  "trip_1_cross_country.json",
  "trip_2_urban_dense.json",
  "trip_3_mountain_cancelled.json",
  "trip_4_southern_technical.json",
  "trip_5_regional_logistics.json",
];

// ---------- Utilities ----------
function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// Simple vehicle icon
const vehicleIcon = new L.Icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/190/190601.png",
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

// ---------- EventPlayer ----------
class EventPlayer {
  constructor(
    events = [],
    { startTime = null, onEvent = () => {}, onTick = () => {}, speed = 1 } = {}
  ) {
    this.events = events
      .slice()
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    this.onEvent = onEvent;
    this.onTick = onTick;
    this.speed = speed;
    this.timer = null;
    this.baseReal = null;
    this.baseSim = startTime
      ? new Date(startTime).getTime()
      : this.events.length
      ? new Date(this.events[0].timestamp).getTime()
      : Date.now();
    this.pointer = 0;
    this.simNow = new Date(this.baseSim);
  }

  play(speed = this.speed) {
    this.setSpeed(speed);
    if (this.timer) return;
    this.baseReal = Date.now();
    this.timer = setInterval(() => this._tick(), 250);
  }

  pause() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setSpeed(s) {
    this.simNow = this.getSimTime();
    this.baseSim = this.simNow.getTime();
    this.baseReal = Date.now();
    this.speed = s;
  }

  seek(iso) {
    const t = new Date(iso).getTime();
    this.baseSim = t;
    this.baseReal = Date.now();
    this.simNow = new Date(t);
    this.pointer = this.events.findIndex(
      (e) => new Date(e.timestamp) >= this.simNow
    );
    if (this.pointer === -1) this.pointer = this.events.length;
  }

  getSimTime() {
    if (!this.baseReal) return new Date(this.baseSim);
    const elapsedReal = Date.now() - this.baseReal;
    const elapsedSim = elapsedReal * this.speed;
    return new Date(this.baseSim + elapsedSim);
  }

  _tick() {
    const now = this.getSimTime();
    this.simNow = now;
    this.onTick(now);
    while (
      this.pointer < this.events.length &&
      new Date(this.events[this.pointer].timestamp) <= now
    ) {
      this.onEvent(this.events[this.pointer]);
      this.pointer++;
    }
    if (this.pointer >= this.events.length) this.pause();
  }
}

// ---------- Fleet State ----------
function deriveFleetState(trips) {
  const perTrip = {};
  let maxPoints = 0;
  trips.forEach((t) => {
    const locs = (t.events || []).filter(
      (e) => e.event_type === "location_ping"
    );
    maxPoints = Math.max(maxPoints, locs.length);
  });
  trips.forEach((t) => {
    const locs = (t.events || []).filter(
      (e) => e.event_type === "location_ping"
    );
    const completed = (t.events || []).some(
      (e) => e.event_type === "trip_completed"
    );
    const cancelled = (t.events || []).some(
      (e) => e.event_type === "trip_cancelled"
    );
    const latest = locs.length ? locs[locs.length - 1] : null;
    const progress = maxPoints
      ? Math.round((locs.length / maxPoints) * 100)
      : 0;
    perTrip[t.tripId || t.filename] = {
      latest,
      count: locs.length,
      completed,
      cancelled,
      progress,
    };
  });
  const total = trips.length;
  const cancelled = Object.values(perTrip).filter((p) => p.cancelled).length;
  const completed = Object.values(perTrip).filter((p) => p.completed).length;
  const pct50 = Object.values(perTrip).filter((p) => p.progress >= 50).length;
  const pct80 = Object.values(perTrip).filter((p) => p.progress >= 80).length;
  return { perTrip, total, cancelled, completed, pct50, pct80 };
}

// ---------- Main Dashboard ----------
export default function FleetDashboard() {
  const [tripsData, setTripsData] = useState([]);
  const [mergedEvents, setMergedEvents] = useState([]);
  const [player, setPlayer] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [simTime, setSimTime] = useState(null);
  const [activity, setActivity] = useState([]);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const playerRef = useRef(null);

  useEffect(() => {
    async function load() {
      const results = [];
      for (const f of TRIP_FILES) {
        try {
          const res = await fetch(ASSESSMENT_FOLDER + f);
          if (!res.ok) throw new Error("HTTP " + res.status);
          const events = await res.json();
          const tripId = events.length
            ? events[0].trip_id || `trip_${f}`
            : `trip_${f}`;
          results.push({ tripId, events, filename: f });
        } catch (err) {
          console.error("Failed to load", f, err.message);
        }
      }
      setTripsData(results);

      const all = results.flatMap((r) => r.events || []);
      all.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      setMergedEvents(all);

      if (all.length) {
        const pl = new EventPlayer(all, {
          startTime: all[0].timestamp,
          onEvent: (ev) => setActivity((prev) => [ev, ...prev].slice(0, 300)),
          onTick: (now) => setSimTime(now),
          speed: 1,
        });
        playerRef.current = pl;
        setPlayer(pl);
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (player) player.setSpeed(speed);
  }, [speed, player]);

  const fleetState = useMemo(
    () => deriveFleetState(tripsData),
    [tripsData, activity]
  );

  function togglePlay() {
    if (!player) return;
    if (isPlaying) {
      player.pause();
      setIsPlaying(false);
    } else {
      player.play(speed);
      setIsPlaying(true);
    }
  }

  function stepForward() {
    if (!player) return;
    player.pause();
    const now = player.getSimTime();
    const nextIndex = player.events.findIndex(
      (e) => new Date(e.timestamp) > now
    );
    if (nextIndex !== -1) {
      player.seek(player.events[nextIndex].timestamp);
      setSimTime(player.getSimTime());
      setActivity((prev) => [player.events[nextIndex], ...prev].slice(0, 300));
    }
  }

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <h2>Fleet Tracking — Live Simulation</h2>
        <div style={styles.controls}>
          <button
            onClick={togglePlay}
            style={{
              ...styles.button,
              background: isPlaying ? "#f59e0b" : "#16a34a", // yellow for pause, green for play
            }}
          >
            {isPlaying ? "Pause" : "Play"}
          </button>

          <button
            onClick={() => {
              if (player) {
                player.pause();
                player.seek(mergedEvents[0]?.timestamp);
                setIsPlaying(false);
                setActivity([]);
              }
            }}
            style={{ ...styles.button, background: "#dc2626" }} // red for reset
          >
            Reset
          </button>

          <button
            onClick={stepForward}
            style={{ ...styles.button, background: "#2563eb" }} // blue for step
          >
            Step ▶
          </button>

          <label style={styles.label}>
            Speed
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              style={styles.select}
            >
              <option value={0.25}>0.25x</option>
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={5}>5x</option>
            </select>
          </label>
          <div style={styles.simTime}>
            Sim time: {simTime ? simTime.toISOString() : "—"}
          </div>
        </div>
      </header>

      <div style={styles.container}>
        <aside style={styles.sidebar}>
          <div style={styles.kpis}>
            <div style={styles.kpiCard}>
              <div style={styles.kpiValue}>{fleetState.total}</div>
              <div>Trips</div>
            </div>
            <div style={styles.kpiCard}>
              <div style={styles.kpiValue}>{fleetState.completed}</div>
              <div>Completed</div>
            </div>
            <div style={styles.kpiCard}>
              <div style={styles.kpiValue}>{fleetState.cancelled}</div>
              <div>Cancelled</div>
            </div>
            <div style={styles.kpiCard}>
              <div style={styles.kpiValue}>{fleetState.pct50}</div>
              <div>≥50%</div>
            </div>
            <div style={styles.kpiCard}>
              <div style={styles.kpiValue}>{fleetState.pct80}</div>
              <div>≥80%</div>
            </div>
          </div>

          <div style={styles.tripList}>
            <h4>Trips</h4>
            {tripsData.map((t) => {
              const info = fleetState.perTrip[t.tripId] || {};
              return (
                <div key={t.tripId} style={styles.tripItem}>
                  <div style={{ fontWeight: 700 }}>{t.tripId}</div>
                  <div style={styles.small}>{t.filename}</div>
                  <div style={styles.small}>
                    Points: {info.count ?? 0} · Progress: {info.progress ?? 0}%
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: info.cancelled ? "#b91c1c" : "#065f46",
                    }}
                  >
                    {info.cancelled
                      ? "CANCELLED"
                      : info.completed
                      ? "COMPLETED"
                      : "IN PROGRESS"}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={styles.activityBox}>
            <h4>Activity Feed</h4>
            <div style={{ maxHeight: 300, overflow: "auto" }}>
              {activity.slice(0, 80).map((ev, i) => (
                <div key={ev.event_id || i} style={styles.activityItem}>
                  <div style={{ fontSize: 12 }}>
                    <strong>{ev.event_type}</strong> ·{" "}
                    {ev.trip_id || ev.vehicle_id} · {fmtDate(ev.timestamp)}
                  </div>
                  <div style={{ fontSize: 12, color: "#334155" }}>
                    {ev.cancellation_reason ||
                      (ev.movement && `spd:${ev.movement.speed_kmh} km/h`) ||
                      JSON.stringify(ev).slice(0, 80)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main style={styles.main}>
          <section style={styles.mapSection}>
            <MapPanel tripsData={tripsData} activity={activity} />
          </section>

          <section style={styles.cardsSection}>
            {tripsData.map((t) => (
              <TripCard key={t.tripId} trip={t} />
            ))}
          </section>
        </main>
      </div>
    </div>
  );
}

// ---------- MapPanel ----------
function MapPanel({ tripsData = [], activity = [] }) {
  const tripPolylines = tripsData.map((t) => ({
    tripId: t.tripId,
    coords: (t.events || [])
      .filter((e) => e.event_type === "location_ping")
      .map((e) => [e.location.lat, e.location.lng]),
  }));

  const latestByTrip = {};
  activity.forEach((ev) => {
    if (ev.event_type === "location_ping") latestByTrip[ev.trip_id] = ev;
  });

  const center =
    tripPolylines.length && tripPolylines[0].coords.length
      ? tripPolylines[0].coords[0]
      : [39.5, -98.35];

  return (
    <div
      style={{
        height: 420,
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid #e6eef7",
      }}
    >
      <MapContainer
        center={center}
        zoom={4}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {tripPolylines.map(
          (tp) =>
            tp.coords.length > 1 && (
              <Polyline key={tp.tripId} positions={tp.coords} color="#2563eb" />
            )
        )}
        {Object.entries(latestByTrip).map(([tripId, ev]) => (
          <Marker
            key={tripId}
            position={[ev.location.lat, ev.location.lng]}
            icon={vehicleIcon}
          >
            <Popup>
              <div style={{ fontWeight: 700 }}>{tripId}</div>
              <div>Speed: {ev.movement?.speed_kmh ?? "—"} km/h</div>
              <div>Time: {fmtDate(ev.timestamp)}</div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

// ---------- TripCard ----------
function TripCard({ trip }) {
  const locs = (trip.events || []).filter(
    (e) => e.event_type === "location_ping"
  );
  const total = locs.length;
  const latest = locs[locs.length - 1] || null;
  const cancelled = (trip.events || []).some(
    (e) => e.event_type === "trip_cancelled"
  );
  const completed = (trip.events || []).some(
    (e) => e.event_type === "trip_completed"
  );
  const spark = locs
    .slice(-20)
    .map((e) => ({ t: e.timestamp, s: e.movement?.speed_kmh || 0 }));
  const progress = Math.round((locs.length / Math.max(1, total)) * 100);

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <strong>{trip.tripId}</strong>
        <span style={{ fontSize: 12 }}>{trip.filename}</span>
      </div>
      <div style={styles.cardBody}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div>
            Latest speed: {latest ? `${latest.movement?.speed_kmh} km/h` : "—"}
          </div>
          <div>Signal: {latest?.signal_quality ?? "—"}</div>
          <div>Points: {total}</div>
        </div>
        <div style={{ marginTop: 8 }}>
          <strong>Status:</strong>{" "}
          <strong
            style={{
              color: cancelled ? "#dc2626" : completed ? "#16a34a" : "#2563eb",
            }}
          >
            {cancelled
              ? " CANCELLED"
              : completed
              ? " COMPLETED"
              : "In-progress"}
          </strong>
        </div>

        <div
          style={{
            height: 10,
            background: "#eef2f8",
            borderRadius: 6,
            marginTop: 8,
          }}
        >
          <div
            style={{
              height: 10,
              width: `${progress}%`,
              borderRadius: 6,
              background: cancelled
                ? "linear-gradient(90deg, #dc2626, #ef4444)"
                : completed
                ? "linear-gradient(90deg, #16a34a, #22c55e)"
                : "linear-gradient(90deg, #3b82f6, #06b6d4)",
            }}
          />
        </div>

        <div style={{ height: 60, marginTop: 8 }}>
          <ResponsiveContainer width="100%" height={60}>
            <LineChart data={spark}>
              <Line dataKey="s" dot={false} stroke="#001bb5ff" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ---------- Styles ----------
const styles = {
  app: {
    fontFamily: "Inter, Roboto, Arial",
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "#f6f8fb",
  },
  header: {
    padding: 16,
    background: "#fff",
    borderBottom: "1px solid #e6e9ef",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  controls: { display: "flex", gap: 10, alignItems: "center" },
  button: {
    padding: "8px 12px",
    borderRadius: 6,
    border: "none",
    background: "turquoise",
    color: "#fff",
    cursor: "pointer",
  },
  label: { display: "flex", gap: 8, alignItems: "center", fontSize: 13 },
  select: { marginLeft: 6, padding: 6 },
  simTime: { fontSize: 13, color: "#334155" },
  container: {
    display: "grid",
    gridTemplateColumns: "320px 1fr",
    gap: 16,
    padding: 16,
  },
  sidebar: { display: "flex", flexDirection: "column", gap: 12 },
  kpis: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  kpiCard: {
    background: "#fff",
    padding: 10,
    borderRadius: 8,
    textAlign: "center",
    boxShadow: "0 1px 4px rgba(2,6,23,0.04)",
  },
  kpiValue: { fontSize: 18, fontWeight: 700 },
  tripList: {
    background: "#fff",
    padding: 10,
    borderRadius: 8,
    maxHeight: 260,
    overflow: "auto",
  },
  tripItem: {
    padding: 8,
    borderBottom: "1px solid #eef2f8",
    cursor: "pointer",
  },
  small: { fontSize: 12, color: "#64748b" },
  activityBox: { background: "#fff", padding: 10, borderRadius: 8 },
  activityItem: { padding: 8, borderBottom: "1px dashed #e6f0ff" },
  main: { display: "flex", flexDirection: "column", gap: 12 },
  cardsSection: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: 12,
  },
  card: {
    background: "#fff",
    padding: 12,
    borderRadius: 8,
    boxShadow: "0 1px 6px rgba(2,6,23,0.04)",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  cardBody: { fontSize: 13 },
};
