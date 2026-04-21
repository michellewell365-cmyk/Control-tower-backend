const { getWeekStart, getYesterday } = require("./database");

// ─────────────────────────────────────────────────────────────────────────────
// SCORE: one associate against one path. Returns null if not eligible.
// Max possible score ≈ 120 pts. Explained:
//   Yesterday penalty : -40 to +20  (biggest factor — drives rotation)
//   Week share bonus  :   0 to +30  (fairness across the week)
//   LC level          :  +8 to +40  (qualification fit)
//   Path priority     :  +5 to +10  (business need)
//   Breadth bonus     :  +2 to +30  (flexibility value)
//   Today penalty     :   0 to -15  (approaching rotation cap)
// ─────────────────────────────────────────────────────────────────────────────
function scorePath(badge, path, db, capacityMap = {}) {
  // 1. Must have permission
  const perm = db.prepare("SELECT lc_level FROM permissions WHERE badge=? AND path_id=?").get(badge, path.id);
  if (!perm) return null;

  // 2. Capacity check — if path is full, skip entirely
  const currentCount = capacityMap[path.id] !== undefined
    ? capacityMap[path.id]
    : db.prepare("SELECT COUNT(*) as c FROM associates WHERE current_path_id=? AND active=1").get(path.id)?.c || 0;
  if (currentCount >= path.max_capacity) return null;

  // 3. Rotation cap — hours already on this path today
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const hoursToday = db.prepare(`
    SELECT COALESCE(SUM(
      CASE WHEN released_at IS NOT NULL THEN released_at - assigned_at
           ELSE strftime('%s','now') - assigned_at END
    ),0) / 3600.0 as h
    FROM assignments WHERE badge=? AND path_id=? AND assigned_at>=?
  `).get(badge, path.id, Math.floor(todayStart.getTime()/1000))?.h || 0;
  if (hoursToday >= path.rotation_hours) return null; // cap hit

  const weekStart = getWeekStart();
  const yesterday = getYesterday();
  let score = 0;
  const breakdown = [];

  // ── FACTOR 1: Yesterday's role (−40 to +20) ──
  const yest = db.prepare("SELECT hours FROM yesterday_roles WHERE badge=? AND path_id=? AND work_date=?")
    .get(badge, path.id, yesterday);
  if (yest?.hours > 0) {
    const penalty = -Math.min(40, Math.round(yest.hours * 4));
    score += penalty;
    breakdown.push({ factor:"Yesterday", pts:penalty, detail:`${yest.hours.toFixed(1)}h worked yesterday` });
  } else {
    score += 20;
    breakdown.push({ factor:"Yesterday", pts:20, detail:"Not on this path yesterday" });
  }

  // ── FACTOR 2: Weekly hour share (0 to +30) ──
  const weekHours = db.prepare("SELECT hours FROM role_hours WHERE badge=? AND path_id=? AND week_start=?")
    .get(badge, path.id, weekStart)?.hours || 0;
  const totalWeekHours = db.prepare("SELECT COALESCE(SUM(hours),0) as t FROM role_hours WHERE badge=? AND week_start=?")
    .get(badge, weekStart)?.t || 1;
  const share = weekHours / totalWeekHours;
  const weekBonus = Math.round(Math.max(0, (0.5 - share)) * 60);
  score += weekBonus;
  breakdown.push({ factor:"Week rotation", pts:weekBonus, detail:`${(share*100).toFixed(0)}% of week hours on this path` });

  // ── FACTOR 3: LC level (+8 to +40) ──
  const lcPts = perm.lc_level * 8;
  score += lcPts;
  breakdown.push({ factor:"LC Level", pts:lcPts, detail:`Level ${perm.lc_level}/5` });

  // ── FACTOR 4: Path priority (+5 to +10) ──
  const prPts = Math.round(path.priority / 10);
  score += prPts;
  breakdown.push({ factor:"Path priority", pts:prPts, detail:`Priority ${path.priority}` });

  // ── FACTOR 5: Permission breadth (+2 per perm, max +30) ──
  const permCount = db.prepare("SELECT COUNT(*) as c FROM permissions WHERE badge=?").get(badge)?.c || 1;
  const breadthPts = Math.min(30, permCount * 2);
  score += breadthPts;
  breakdown.push({ factor:"Breadth", pts:breadthPts, detail:`${permCount} total permissions` });

  // ── FACTOR 6: Today's hours on path (0 to −15) ──
  if (hoursToday > 0) {
    const todayPenalty = -Math.round((hoursToday / path.rotation_hours) * 15);
    score += todayPenalty;
    breakdown.push({ factor:"Today hours", pts:todayPenalty, detail:`${hoursToday.toFixed(1)}h on path today` });
  }

  return {
    path, score: Math.max(0, score),
    breakdown, lc: perm.lc_level,
    hoursToday, weeklyHours: weekHours,
    capacity: { current: currentCount, max: path.max_capacity }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FIND BEST OPEN STATION for a path
// ─────────────────────────────────────────────────────────────────────────────
function findOpenStation(pathId, db) {
  return db.prepare(`
    SELECT s.*, l.name as line_name
    FROM stations s
    JOIN lines l ON s.line_id=l.id
    JOIN departments d ON l.dept_id=d.id
    JOIN paths p ON p.dept_id=d.id
    WHERE p.id=? AND s.active=1 AND s.occupied=0 AND l.active=1
    ORDER BY l.sort_order ASC, s.station_number ASC
    LIMIT 1
  `).get(pathId);
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SCAN ASSIGNMENT
// ─────────────────────────────────────────────────────────────────────────────
function smartAssign(badgeOrLogin, db, currentMode = "INBOUND") {
  const assoc = db.prepare("SELECT * FROM associates WHERE (badge=? OR login=?) AND active=1")
    .get(badgeOrLogin, badgeOrLogin.toLowerCase());
  if (!assoc) return { error: "Associate not found" };

  // Check operation_mode — INBOUND associate cannot be sent to OUTBOUND paths
  if (assoc.operation_mode !== "BOTH" && assoc.operation_mode !== currentMode) {
    return {
      associate: assoc,
      path: "GREEN MILE", station: { name: "SEE PA" }, score: 0,
      reasons: [`Associate is ${assoc.operation_mode}-only. Floor is in ${currentMode} mode.`],
      allScores: [], lc: 0,
    };
  }

  // Release previous
  if (assoc.current_station_id) {
    db.prepare("UPDATE stations SET occupied=0,occupied_by=NULL,occupied_since=NULL WHERE id=?")
      .run(assoc.current_station_id);
    db.prepare("UPDATE assignments SET released_at=strftime('%s','now') WHERE badge=? AND released_at IS NULL")
      .run(assoc.badge);
    _accumulateHours(assoc, db);
  }

  const allPaths = db.prepare("SELECT * FROM paths WHERE active=1 AND (mode=? OR mode='BOTH') ORDER BY priority DESC")
    .all(currentMode);

  const scores = allPaths
    .map(p => scorePath(assoc.badge, p, db))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (!scores.length) {
    _logEvent(db, assoc.badge, assoc.login, "NO_ASSIGNMENT", "No qualified paths — all caps reached or capacity full", currentMode);
    return { associate: assoc, path: "GREEN MILE", station: { name: "SEE PA" }, score: 0,
      reasons: ["No qualified open paths available"], allScores: [], lc: 0 };
  }

  // Pick best with an open station
  let chosen = null, chosenStation = null;
  for (const s of scores) {
    const st = findOpenStation(s.path.id, db);
    if (st) { chosen = s; chosenStation = st; break; }
  }

  if (!chosen) {
    _logEvent(db, assoc.badge, assoc.login, "NO_STATION", "All stations full in qualified paths", currentMode);
    return { associate: assoc, path: "GREEN MILE", station: { name: "SEE PA" }, score: 0,
      reasons: ["All stations filled — see PA"], allScores: scores.slice(0,3).map(s=>({path:s.path.name,score:s.score})), lc: 0 };
  }

  _applyAssignment(assoc, chosen, chosenStation, db, currentMode, "AUTO");

  return {
    associate: assoc,
    path: chosen.path.name,
    pathObj: chosen.path,
    station: chosenStation,
    score: chosen.score,
    breakdown: chosen.breakdown,
    reasons: chosen.breakdown.map(b => `${b.factor}: ${b.detail} (${b.pts>0?"+":""}${b.pts}pts)`),
    lc: chosen.lc,
    hoursToday: chosen.hoursToday,
    weeklyHours: chosen.weeklyHours,
    rotationHours: chosen.path.rotation_hours,
    roleType: chosen.path.role_type,
    capacity: chosen.capacity,
    allScores: scores.slice(1,4).map(s=>({ path:s.path.name, score:s.score, type:s.path.role_type })),
    mode: currentMode,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PRE-ASSIGNMENT PLANNING
// Allocates ALL active associates for the shift in one pass.
// Uses a global capacity map to prevent over-filling any path.
// Associates sorted by score DESC so highest scorers get first pick.
// ─────────────────────────────────────────────────────────────────────────────
function buildShiftPlan(db, mode, shiftCode, createdBy = "MANAGER") {
  const associates = db.prepare(
    "SELECT * FROM associates WHERE active=1 AND (operation_mode=? OR operation_mode='BOTH')"
  ).all(mode);

  const allPaths = db.prepare("SELECT * FROM paths WHERE active=1 AND (mode=? OR mode='BOTH') ORDER BY priority DESC")
    .all(mode);

  // Capacity tracker: how many have been assigned to each path in this plan
  const capacityMap = {};
  allPaths.forEach(p => { capacityMap[p.id] = 0; });

  // For each associate, score all paths
  const associateScores = associates.map(assoc => {
    const scored = allPaths
      .map(p => scorePath(assoc.badge, p, db, capacityMap))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    return { assoc, scored };
  });

  // Sort associates: those with FEWER path options go first (more constrained)
  // This is the key insight — don't send the 50 CRETS experts first.
  // Instead, assign the most constrained (fewest options) first, then flexible.
  associateScores.sort((a, b) => a.scored.length - b.scored.length);

  const planItems = [];
  let totalAssigned = 0;

  // Track which stations are taken in this plan
  const takenStations = new Set();

  for (const { assoc, scored: initialScored } of associateScores) {
    // Re-score with current capacity map (it changes as we assign)
    const rescored = allPaths
      .map(p => scorePath(assoc.badge, p, db, capacityMap))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    let assigned = false;
    for (const s of rescored) {
      // Find open station not already taken in this plan
      const stations = db.prepare(`
        SELECT st.*, l.name as line_name
        FROM stations st
        JOIN lines l ON st.line_id=l.id
        JOIN departments d ON l.dept_id=d.id
        JOIN paths p ON p.dept_id=d.id
        WHERE p.id=? AND st.active=1 AND st.occupied=0 AND l.active=1
        ORDER BY l.sort_order, st.station_number
      `).all(s.path.id);

      const available = stations.find(st => !takenStations.has(st.id));
      if (!available) continue;

      planItems.push({
        badge: assoc.badge,
        name: assoc.name,
        login: assoc.login,
        home_dept: assoc.home_dept,
        shift_code: assoc.shift_code,
        operation_mode: assoc.operation_mode,
        path_id: s.path.id,
        path_name: s.path.name,
        role_type: s.path.role_type,
        station_id: available.id,
        station_name: available.name,
        line_name: available.line_name,
        score: s.score,
        breakdown: s.breakdown,
        lc: s.lc,
        capacity: s.capacity,
        confirmed: 0,
      });

      capacityMap[s.path.id] = (capacityMap[s.path.id] || 0) + 1;
      takenStations.add(available.id);
      totalAssigned++;
      assigned = true;
      break;
    }

    if (!assigned) {
      planItems.push({
        badge: assoc.badge, name: assoc.name, login: assoc.login,
        home_dept: assoc.home_dept, shift_code: assoc.shift_code,
        operation_mode: assoc.operation_mode,
        path_id: null, path_name: "GREEN MILE",
        role_type: null, station_id: null, station_name: "SEE PA", line_name: null,
        score: 0, breakdown: [], lc: 0, capacity: null, confirmed: 0,
      });
    }
  }

  // Save plan to DB
  const plan = db.prepare(`INSERT INTO shift_plans (shift_code,mode,created_by,status,total_associates,total_assigned)
    VALUES (?,?,?,'DRAFT',?,?)`).run(shiftCode, mode, createdBy, associates.length, totalAssigned);
  const planId = plan.lastInsertRowid;

  const iItem = db.prepare(`INSERT INTO shift_plan_items (plan_id,badge,path_id,path_name,station_id,station_name,line_name,score,confirmed)
    VALUES (?,?,?,?,?,?,?,?,0)`);
  for (const item of planItems) {
    iItem.run(planId, item.badge, item.path_id||null, item.path_name, item.station_id||null, item.station_name||null, item.line_name||null, item.score);
  }

  _logEvent(db, null, createdBy, "PLAN_CREATED",
    `Shift plan created: ${totalAssigned}/${associates.length} assigned, mode=${mode}, shift=${shiftCode}`, mode);

  return { planId, planItems, totalAssociates: associates.length, totalAssigned, mode, shiftCode };
}

// Apply a saved plan — commit all assignments to live stations
function applyShiftPlan(planId, db) {
  const items = db.prepare("SELECT * FROM shift_plan_items WHERE plan_id=?").all(planId);
  const now = Math.floor(Date.now() / 1000);
  const mode = db.prepare("SELECT mode FROM shift_plans WHERE id=?").get(planId)?.mode || "INBOUND";
  const shiftCode = db.prepare("SELECT shift_code FROM shift_plans WHERE id=?").get(planId)?.shift_code || "FHD";

  // Clear current assignments first
  db.prepare("UPDATE stations SET occupied=0,occupied_by=NULL,occupied_since=NULL").run();
  db.prepare("UPDATE associates SET current_path_id=NULL,current_station_id=NULL,current_path_start=NULL").run();

  for (const item of items) {
    if (!item.station_id || item.path_name === "GREEN MILE") continue;
    const assoc = db.prepare("SELECT * FROM associates WHERE badge=?").get(item.badge);
    if (!assoc) continue;
    db.prepare("UPDATE stations SET occupied=1,occupied_by=?,occupied_since=? WHERE id=?")
      .run(assoc.login, now, item.station_id);
    db.prepare("UPDATE associates SET current_path_id=?,current_station_id=?,current_path_start=? WHERE badge=?")
      .run(item.path_id, item.station_id, now, item.badge);
    db.prepare(`INSERT INTO assignments (badge,path_id,path_name,station_id,station_name,line_name,shift_code,mode,score,assigned_by,notes)
      VALUES (?,?,?,?,?,?,?,?,?,'PLAN','Pre-shift plan')`).run(
        item.badge, item.path_id, item.path_name, item.station_id, item.station_name, item.line_name, shiftCode, mode, item.score);
  }

  db.prepare("UPDATE shift_plans SET status='APPLIED' WHERE id=?").run(planId);
  _logEvent(db, null, "MANAGER", "PLAN_APPLIED", `Shift plan ${planId} applied to floor`, mode);
  return { success: true, applied: items.filter(i=>i.station_id).length };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function _applyAssignment(assoc, scored, station, db, mode, by) {
  const now = Math.floor(Date.now() / 1000);
  const shiftCode = db.prepare("SELECT value FROM settings WHERE key='active_shift'").get()?.value || "FHD";

  db.prepare("UPDATE stations SET occupied=1,occupied_by=?,occupied_since=? WHERE id=?")
    .run(assoc.login, now, station.id);
  db.prepare("UPDATE associates SET current_path_id=?,current_station_id=?,current_path_start=? WHERE badge=?")
    .run(scored.path.id, station.id, now, assoc.badge);

  db.prepare(`INSERT INTO assignments (badge,path_id,path_name,station_id,station_name,line_name,shift_code,mode,score,assigned_by,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      assoc.badge, scored.path.id, scored.path.name, station.id, station.name, station.line_name,
      shiftCode, mode, scored.score, by,
      scored.breakdown?.map(b=>`${b.factor}:${b.pts}`).join(", ") || "");

  // Accumulate to week hours
  const weekStart = getWeekStart();
  db.prepare(`INSERT INTO role_hours (badge,path_id,week_start,hours,last_updated) VALUES (?,?,?,0,?)
    ON CONFLICT(badge,path_id,week_start) DO UPDATE SET last_updated=excluded.last_updated`)
    .run(assoc.badge, scored.path.id, weekStart, now);

  _logEvent(db, assoc.badge, assoc.login, "ASSIGNED",
    `${scored.path.name} → ${station.name} (${station.line_name}) score:${scored.score}`, mode);
}

function _accumulateHours(assoc, db) {
  if (!assoc.current_path_id || !assoc.current_path_start) return;
  const hours = (Math.floor(Date.now()/1000) - assoc.current_path_start) / 3600;
  const weekStart = getWeekStart();
  db.prepare(`INSERT INTO role_hours (badge,path_id,week_start,hours,last_updated) VALUES (?,?,?,?,?)
    ON CONFLICT(badge,path_id,week_start) DO UPDATE SET hours=hours+excluded.hours,last_updated=excluded.last_updated`)
    .run(assoc.badge, assoc.current_path_id, weekStart, hours, Math.floor(Date.now()/1000));
  const today = new Date().toISOString().split("T")[0];
  db.prepare(`INSERT INTO yesterday_roles (badge,path_id,work_date,hours) VALUES (?,?,?,?)
    ON CONFLICT(badge,path_id,work_date) DO UPDATE SET hours=hours+excluded.hours`)
    .run(assoc.badge, assoc.current_path_id, today, hours);
}

function accumulateHours(badge, db) {
  const assoc = db.prepare("SELECT * FROM associates WHERE badge=?").get(badge);
  if (assoc) _accumulateHours(assoc, db);
}

function _logEvent(db, badge, login, type, detail, mode) {
  const shift = db.prepare("SELECT value FROM settings WHERE key='active_shift'").get()?.value;
  db.prepare("INSERT INTO event_log (badge,login,event_type,detail,shift_code,mode) VALUES (?,?,?,?,?,?)")
    .run(badge||null, login||null, type, detail||null, shift||null, mode||null);
}

function logEvent(db, badge, login, type, detail, mode) {
  _logEvent(db, badge, login, type, detail, mode);
}

module.exports = { smartAssign, buildShiftPlan, applyShiftPlan, accumulateHours, logEvent, scorePath };
