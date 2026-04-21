// const express = require("express");
// const cors = require("cors");
// const { Pool } = require("pg");
// require("dotenv").config();

// const app = express();
// const PORT = process.env.PORT || 3001;
// app.use(cors());
// app.use(express.json());

// // ========== PostgreSQL CONNECTION POOL ==========
// const pool = new Pool({
//   host: process.env.DB_HOST || "localhost",
//   port: process.env.DB_PORT || 5432,
//   user: process.env.DB_USER || "sandip",
//   password: process.env.DB_PASSWORD || "",
//   database: process.env.DB_NAME || "control_tower",
//   max: 50,
//   idleTimeoutMillis: 30000,
//   connectionTimeoutMillis: 5000,
// });

// // ========== HELPER FUNCTIONS ==========
// async function getSetting(key) {
//   const res = await pool.query("SELECT value FROM settings WHERE key = $1", [key]);
//   return res.rows[0]?.value;
// }
// async function setSetting(key, value) {
//   await pool.query(
//     "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
//     [key, value]
//   );
// }
// async function logEvent(badge, login, eventType, description, details) {
//   await pool.query(
//     "INSERT INTO event_log (badge, login, event_type, description, details, created_at) VALUES ($1, $2, $3, $4, $5, EXTRACT(EPOCH FROM NOW()))",
//     [badge, login, eventType, description, details]
//   );
// }
// function getWeekStart() {
//   const d = new Date();
//   d.setHours(0, 0, 0, 0);
//   const day = d.getDay();
//   d.setDate(d.getDate() - day);
//   return d.toISOString().split("T")[0];
// }

// // ========== INITIALIZE TABLES AND SEED DEFAULT PATHS ==========
// async function initTables() {
//   const client = await pool.connect();
//   try {
//     await client.query("BEGIN");
//     // Create all tables
//     await client.query(`
//       CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
//       CREATE TABLE IF NOT EXISTS shifts (code TEXT PRIMARY KEY, name TEXT, start_hour INTEGER, start_minute INTEGER, end_hour INTEGER, end_minute INTEGER, days TEXT);
//       CREATE TABLE IF NOT EXISTS departments (id SERIAL PRIMARY KEY, name TEXT UNIQUE, mode TEXT, active BOOLEAN DEFAULT true);
//       CREATE TABLE IF NOT EXISTS paths (
//         id SERIAL PRIMARY KEY, name TEXT UNIQUE, dept_id INTEGER REFERENCES departments(id),
//         role_type TEXT, mode TEXT, rotation_hours INTEGER, priority INTEGER DEFAULT 5,
//         max_capacity INTEGER, sort_order INTEGER, active BOOLEAN DEFAULT true
//       );
//       CREATE TABLE IF NOT EXISTS lines (id SERIAL PRIMARY KEY, dept_id INTEGER REFERENCES departments(id), path_id INTEGER REFERENCES paths(id), name TEXT, side TEXT, sort_order INTEGER, active BOOLEAN DEFAULT true);
//       CREATE TABLE IF NOT EXISTS stations (id SERIAL PRIMARY KEY, line_id INTEGER REFERENCES lines(id), name TEXT, side TEXT, station_number INTEGER, occupied BOOLEAN DEFAULT false, occupied_by TEXT, occupied_since BIGINT, active BOOLEAN DEFAULT true);
//       CREATE TABLE IF NOT EXISTS associates (badge TEXT PRIMARY KEY, login TEXT UNIQUE, name TEXT, home_dept TEXT, manager TEXT, shift_code TEXT, operation_mode TEXT, default_dept TEXT DEFAULT 'INBOUND', current_path_id INTEGER, current_station_id INTEGER, current_path_start BIGINT, active BOOLEAN DEFAULT true);
//       CREATE TABLE IF NOT EXISTS permissions (badge TEXT REFERENCES associates(badge) ON DELETE CASCADE, path_id INTEGER REFERENCES paths(id) ON DELETE CASCADE, lc_level INTEGER, PRIMARY KEY (badge, path_id));
//       CREATE TABLE IF NOT EXISTS role_hours (badge TEXT REFERENCES associates(badge) ON DELETE CASCADE, path_id INTEGER REFERENCES paths(id) ON DELETE CASCADE, week_start DATE, hours FLOAT, PRIMARY KEY (badge, path_id, week_start));
//       CREATE TABLE IF NOT EXISTS yesterday_roles (badge TEXT REFERENCES associates(badge) ON DELETE CASCADE, path_id INTEGER REFERENCES paths(id) ON DELETE CASCADE, work_date DATE, hours FLOAT, PRIMARY KEY (badge, path_id, work_date));
//       CREATE TABLE IF NOT EXISTS assignments (id SERIAL PRIMARY KEY, badge TEXT REFERENCES associates(badge), path_name TEXT, assigned_at BIGINT, released_at BIGINT);
//       CREATE TABLE IF NOT EXISTS event_log (id SERIAL PRIMARY KEY, badge TEXT, login TEXT, event_type TEXT, description TEXT, details TEXT, created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW())));
//       CREATE TABLE IF NOT EXISTS shift_plans (id SERIAL PRIMARY KEY, mode TEXT, shift_code TEXT, created_by TEXT, created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW())));
//       CREATE TABLE IF NOT EXISTS shift_plan_items (id SERIAL PRIMARY KEY, plan_id INTEGER REFERENCES shift_plans(id) ON DELETE CASCADE, badge TEXT, path_id INTEGER, score FLOAT, lc_level INTEGER, role_type TEXT);
//       CREATE TABLE IF NOT EXISTS labor_share_settings (shift_code TEXT, dept TEXT, enabled BOOLEAN DEFAULT false, percentage INTEGER DEFAULT 0, PRIMARY KEY (shift_code, dept));
//       CREATE TABLE IF NOT EXISTS admin_profiles (id SERIAL PRIMARY KEY, name TEXT, login TEXT UNIQUE, pin TEXT, role TEXT DEFAULT 'Manager', created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW())));
//       CREATE TABLE IF NOT EXISTS both_assignments (shift_code TEXT, dept TEXT, work_date DATE, assigned_to_other INTEGER DEFAULT 0, PRIMARY KEY (shift_code, dept, work_date));
//     `);
//     // Insert default departments
//     await client.query(`
//       INSERT INTO departments (name, mode) VALUES ('INBOUND', 'INBOUND'), ('OUTBOUND', 'OUTBOUND')
//       ON CONFLICT (name) DO NOTHING;
//     `);
//     const deptRes = await client.query("SELECT id, name FROM departments WHERE name IN ('INBOUND','OUTBOUND')");
//     const deptMap = {};
//     deptRes.rows.forEach(d => { deptMap[d.name] = d.id; });
//     const inboundPaths = ["CRETS Processing","CRETS High Side","WHD Processing","Refurb Processing","Tech Grading","Problem Solve","Super Solver","Waterspider","Downstacker","Unloader","Upstacker","Cage Builder"];
//     for (let i = 0; i < inboundPaths.length; i++) {
//       await client.query(`INSERT INTO paths (name, dept_id, role_type, mode, priority, sort_order) VALUES ($1, $2, $3, 'INBOUND', $4, $5) ON CONFLICT (name) DO NOTHING`, [inboundPaths[i], deptMap["INBOUND"], i < 6 ? "DIRECT" : "INDIRECT", 5, i]);
//     }
//     const outboundPaths = ["Pick Driver","Stow Driver","Rebin Processing","Pack Processing","Problem Solve","Super Solver","Step 1 Processor - Liquidation","Step 2 Processor - Liquidation","Step 1 Processor - Sellable","Step 2 Processor - Sellable","Step 1 Processor - Donation/Destroy","Step 2 Processor - Donation/Destroy","Waterspider","Cage Builder"];
//     for (let i = 0; i < outboundPaths.length; i++) {
//       await client.query(`INSERT INTO paths (name, dept_id, role_type, mode, priority, sort_order) VALUES ($1, $2, $3, 'OUTBOUND', $4, $5) ON CONFLICT (name) DO NOTHING`, [outboundPaths[i], deptMap["OUTBOUND"], i < 6 ? "DIRECT" : "INDIRECT", 5, i]);
//     }
//     await client.query("COMMIT");
//     console.log("✅ All tables verified/created and default paths seeded");
//   } catch (err) {
//     await client.query("ROLLBACK");
//     console.error("Error initializing tables:", err);
//     throw err;
//   } finally {
//     client.release();
//   }
// }

// // ========== SMART ASSIGN LOGIC ==========
// function getCanonicalRole(pathName) {
//   if (!pathName) return "";
//   const u = pathName.toUpperCase();
//   if (u.includes("CRETS")) return "CRETS Processing";
//   if (u.includes("WHD")) return "WHD Processing";
//   if (u.includes("REFURB")) return "Refurb Processing";
//   if (u.includes("TECH")) return "Tech Grading";
//   if (u.includes("PROBLEM SOLVE")) return "Problem Solve";
//   if (u.includes("SUPER SOLVER")) return "Super Solver";
//   if (u.includes("WATERSPIDER")) return "Waterspider";
//   if (u.includes("DOWNSTACKER")) return "Downstacker";
//   if (u.includes("UNLOADER")) return "Unloader";
//   if (u.includes("UPSTACKER")) return "Upstacker";
//   if (u.includes("CAGE")) return "Cage Builder";
//   if (u.includes("PICK")) return "Pick Driver";
//   if (u.includes("STOW")) return "Stow Driver";
//   if (u.includes("REBIN")) return "Rebin Processing";
//   if (u.includes("PACK")) return "Pack Processing";
//   if (u.includes("LIQUIDATION") && u.includes("STEP 1")) return "Step 1 Processor - Liquidation";
//   if (u.includes("LIQUIDATION") && u.includes("STEP 2")) return "Step 2 Processor - Liquidation";
//   if (u.includes("SELLABLE") && u.includes("STEP 1")) return "Step 1 Processor - Sellable";
//   if (u.includes("SELLABLE") && u.includes("STEP 2")) return "Step 2 Processor - Sellable";
//   if (u.includes("DONATION") && u.includes("STEP 1")) return "Step 1 Processor - Donation/Destroy";
//   if (u.includes("DONATION") && u.includes("STEP 2")) return "Step 2 Processor - Donation/Destroy";
//   return pathName;
// }

// async function scoreOnePath(assoc, pathName, pool) {
//   const canon = getCanonicalRole(pathName);
//   const permRes = await pool.query(
//     `SELECT lc_level FROM permissions p JOIN paths pa ON p.path_id = pa.id WHERE p.badge = $1 AND pa.name = $2`,
//     [assoc.badge, pathName]
//   );
//   if (permRes.rows.length === 0) return null;
//   const lcLevel = permRes.rows[0].lc_level;
//   const ydRes = await pool.query(
//     `SELECT hours FROM yesterday_roles WHERE badge = $1 AND path_id = (SELECT id FROM paths WHERE name = $2) AND work_date = CURRENT_DATE - 1`,
//     [assoc.badge, pathName]
//   );
//   const yd = ydRes.rows[0]?.hours || 0;
//   const weekStart = getWeekStart();
//   const wkRes = await pool.query(
//     `SELECT COALESCE(SUM(hours), 0) as hours FROM role_hours WHERE badge = $1 AND path_id = (SELECT id FROM paths WHERE name = $2) AND week_start >= CURRENT_DATE - 14`,
//     [assoc.badge, pathName]
//   );
//   const wk = wkRes.rows[0]?.hours || 0;
//   const totRes = await pool.query(
//     `SELECT COALESCE(SUM(hours), 1) as total FROM role_hours WHERE badge = $1 AND week_start >= CURRENT_DATE - 14`,
//     [assoc.badge]
//   );
//   const tot = totRes.rows[0].total;
//   const sh = wk / tot;
//   const prioRes = await pool.query(`SELECT priority FROM paths WHERE name = $1`, [pathName]);
//   const prPts = prioRes.rows[0]?.priority || 5;
//   const ydPts = yd > 0 ? -Math.min(15, Math.round(yd * 1.8)) : 4;
//   const wkPts = Math.round(Math.max(0, (0.5 - sh) * 6));
//   const lcPts = lcLevel * 0.8;
//   const bPts = Math.min(1, (assoc.permissionsCount || 0) * 0.1);
//   const totalScore = Math.max(0, prPts + ydPts + wkPts + lcPts + bPts);
//   return {
//     score: +totalScore.toFixed(1),
//     lc: lcLevel,
//     roleType: pathName.includes("Waterspider") ? "INDIRECT" : "DIRECT",
//     rotationHours: 10,
//     breakdown: []
//   };
// }

// async function smartAssign(badge, targetDept, pool) {
//   const client = await pool.connect();
//   try {
//     const assocRes = await pool.query("SELECT * FROM associates WHERE badge = $1 OR login = $2", [badge, badge.toLowerCase()]);
//     if (assocRes.rows.length === 0) return { error: "Associate not found" };
//     const assoc = assocRes.rows[0];
//     const pathsRes = await pool.query(
//       `SELECT id, name, role_type FROM paths WHERE mode = $1 AND active = true ORDER BY priority DESC`,
//       [targetDept]
//     );
//     const paths = pathsRes.rows;
//     if (paths.length === 0) return { error: "No paths available for department" };
//     const scored = [];
//     for (const p of paths) {
//       const s = await scoreOnePath(assoc, p.name, pool);
//       if (s) {
//         scored.push({ pathId: p.id, pathName: p.name, roleType: p.role_type, ...s });
//       }
//     }
//     scored.sort((a, b) => b.score - a.score);
//     if (scored.length === 0) {
//       return { error: "No eligible paths (check permissions or station availability)" };
//     }
//     const chosen = scored[0];
//     const stationRes = await pool.query(
//       `SELECT s.id, s.name, l.name as line_name FROM stations s
//        JOIN lines l ON s.line_id = l.id
//        JOIN paths p ON l.path_id = p.id
//        WHERE p.id = $1 AND s.active = true AND s.occupied = false
//        LIMIT 1`,
//       [chosen.pathId]
//     );
//     if (stationRes.rows.length === 0) {
//       return { error: `No open station for ${chosen.pathName}` };
//     }
//     const station = stationRes.rows[0];
//     await client.query("BEGIN");
//     await client.query(
//       "UPDATE stations SET occupied = false, occupied_by = NULL, occupied_since = NULL WHERE occupied_by = $1",
//       [assoc.login]
//     );
//     const now = Math.floor(Date.now() / 1000);
//     await client.query(
//       "UPDATE stations SET occupied = true, occupied_by = $1, occupied_since = $2 WHERE id = $3",
//       [assoc.login, now, station.id]
//     );
//     await client.query(
//       "UPDATE associates SET current_path_id = $1, current_station_id = $2, current_path_start = $3 WHERE badge = $4",
//       [chosen.pathId, station.id, now, assoc.badge]
//     );
//     await client.query(
//       "INSERT INTO assignments (badge, path_name, assigned_at) VALUES ($1, $2, $3)",
//       [assoc.badge, chosen.pathName, now]
//     );
//     await client.query("COMMIT");
//     await logEvent(assoc.badge, assoc.login, "SCAN_ASSIGN", `Assigned to ${chosen.pathName} at ${station.name}`, targetDept);
//     return {
//       success: true,
//       associate: { name: assoc.name, login: assoc.login, badge: assoc.badge, shift_code: assoc.shift_code, operation_mode: assoc.operation_mode },
//       path: chosen.pathName,
//       station: { id: station.id, name: station.name, line_name: station.line_name },
//       score: chosen.score,
//       lc: chosen.lc,
//       roleType: chosen.roleType,
//       rotationHours: chosen.rotationHours,
//       breakdown: chosen.breakdown,
//       allScores: scored.slice(1, 4).map(s => ({ path: s.pathName, score: s.score, type: s.roleType })),
//       method: "AUTO",
//       assignedDept: targetDept
//     };
//   } catch (err) {
//     await client.query("ROLLBACK");
//     console.error("SmartAssign error:", err);
//     return { error: err.message };
//   } finally {
//     client.release();
//   }
// }

// // ========== API ENDPOINTS ==========

// // System
// app.get("/api/system", async (req, res) => {
//   try {
//     const mode = (await getSetting("active_mode")) || "INBOUND";
//     const activeShift = (await getSetting("active_shift")) || "FHD";
//     const shifts = await pool.query("SELECT * FROM shifts");
//     const totalAssoc = await pool.query("SELECT COUNT(*) as c FROM associates WHERE active = true");
//     const onFloor = await pool.query("SELECT COUNT(*) as c FROM associates WHERE active = true AND current_path_id IS NOT NULL");
//     const openStations = await pool.query("SELECT COUNT(*) as c FROM stations WHERE active = true AND occupied = false");
//     const filledStations = await pool.query("SELECT COUNT(*) as c FROM stations WHERE active = true AND occupied = true");
//     res.json({
//       mode, activeShift,
//       shifts: shifts.rows,
//       totalAssoc: parseInt(totalAssoc.rows[0].c),
//       onFloor: parseInt(onFloor.rows[0].c),
//       openStations: parseInt(openStations.rows[0].c),
//       filledStations: parseInt(filledStations.rows[0].c),
//     });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// app.post("/api/system/mode", async (req, res) => {
//   const { mode } = req.body;
//   if (!["INBOUND", "OUTBOUND"].includes(mode)) return res.status(400).json({ error: "Invalid mode" });
//   await setSetting("active_mode", mode);
//   await logEvent(null, null, "SYSTEM", "MODE_CHANGE", `Switched to ${mode}`);
//   res.json({ success: true, mode });
// });

// app.post("/api/system/shift", async (req, res) => {
//   const { shift } = req.body;
//   const s = await pool.query("SELECT * FROM shifts WHERE code = $1", [shift]);
//   if (!s.rows.length) return res.status(404).json({ error: "Shift not found" });
//   await setSetting("active_shift", s.rows[0].code);
//   await logEvent(null, null, "SYSTEM", "SHIFT_CHANGE", `Shift set to ${s.rows[0].code}`);
//   res.json({ success: true, shift: s.rows[0] });
// });

// // Scan with labor share
// app.post("/api/scan", async (req, res) => {
//   const { badge, shiftType, staffDate, laborShareEnabled, laborShareCount } = req.body;
//   if (!badge) return res.status(400).json({ error: "Badge required" });
//   const mode = (await getSetting("active_mode")) || "INBOUND";

//   try {
//     const assocRes = await pool.query("SELECT * FROM associates WHERE badge = $1 OR login = $2", [badge, badge.toLowerCase()]);
//     if (assocRes.rows.length === 0) return res.status(404).json({ error: "Associate not found" });
//     const assoc = assocRes.rows[0];

//     let targetDept = assoc.operation_mode === "BOTH" ? (assoc.default_dept || "INBOUND") : assoc.operation_mode;

//     if (assoc.operation_mode === "BOTH" && laborShareEnabled && shiftType && staffDate) {
//       const defaultDept = assoc.default_dept || "INBOUND";
//       const otherDept = defaultDept === "INBOUND" ? "OUTBOUND" : "INBOUND";
//       const countRes = await pool.query(
//         "SELECT assigned_to_other FROM both_assignments WHERE shift_code = $1 AND dept = $2 AND work_date = $3",
//         [shiftType, otherDept, staffDate]
//       );
//       const assignedToOther = countRes.rows[0]?.assigned_to_other || 0;
//       const totalBothRes = await pool.query("SELECT COUNT(*) as c FROM associates WHERE operation_mode = 'BOTH' AND active = true");
//       const totalBoth = parseInt(totalBothRes.rows[0].c);
//       const targetOtherCount = laborShareCount === 0 ? totalBoth : Math.floor(totalBoth * (laborShareCount / 100));
//       if (assignedToOther < targetOtherCount) {
//         const hasPermRes = await pool.query(`
//           SELECT 1 FROM permissions p
//           JOIN paths pa ON p.path_id = pa.id
//           WHERE p.badge = $1 AND pa.mode = $2
//           LIMIT 1
//         `, [assoc.badge, otherDept]);
//         if (hasPermRes.rows.length > 0) {
//           targetDept = otherDept;
//         } else {
//           targetDept = defaultDept;
//         }
//       } else {
//         targetDept = defaultDept;
//       }
//     }

//     const result = await smartAssign(badge, targetDept, pool);
//     if (result.error) return res.status(404).json(result);

//     if (assoc.operation_mode === "BOTH" && laborShareEnabled && targetDept !== (assoc.default_dept || "INBOUND")) {
//       await pool.query(
//         `INSERT INTO both_assignments (shift_code, dept, work_date, assigned_to_other) VALUES ($1, $2, $3, 1)
//          ON CONFLICT (shift_code, dept, work_date) DO UPDATE SET assigned_to_other = both_assignments.assigned_to_other + 1`,
//         [shiftType, targetDept, staffDate]
//       );
//     }

//     res.json(result);
//   } catch (err) {
//     console.error("Scan error:", err);
//     res.status(500).json({ error: err.message });
//   }
// });

// // Admin profiles
// app.get("/api/admin/profiles", async (req, res) => {
//   try {
//     const result = await pool.query("SELECT id, name, login, role FROM admin_profiles ORDER BY name");
//     res.json(result.rows);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// app.post("/api/admin/login", async (req, res) => {
//   const { login, pin } = req.body;
//   try {
//     const result = await pool.query("SELECT id, name, login, role FROM admin_profiles WHERE login = $1 AND pin = $2", [login, pin]);
//     if (result.rows.length === 0) return res.status(401).json({ error: "Invalid login or PIN" });
//     res.json(result.rows[0]);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// app.post("/api/admin/profiles", async (req, res) => {
//   const { name, login, pin, role } = req.body;
//   if (!name || !login || !pin) return res.status(400).json({ error: "Name, login, and PIN required" });
//   try {
//     await pool.query("INSERT INTO admin_profiles (name, login, pin, role) VALUES ($1, $2, $3, $4)", [name, login, pin, role || "Manager"]);
//     res.json({ success: true });
//   } catch (err) {
//     if (err.code === "23505") return res.status(409).json({ error: "Login already exists" });
//     res.status(500).json({ error: err.message });
//   }
// });

// app.delete("/api/admin/profiles/:id", async (req, res) => {
//   try {
//     await pool.query("DELETE FROM admin_profiles WHERE id = $1", [req.params.id]);
//     res.json({ success: true });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // Path priorities
// app.get("/api/path-priorities", async (req, res) => {
//   try {
//     const result = await pool.query("SELECT id, name, mode, priority FROM paths WHERE active = true ORDER BY mode, priority DESC");
//     res.json(result.rows);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// app.patch("/api/path-priorities/:id", async (req, res) => {
//   const { priority } = req.body;
//   try {
//     await pool.query("UPDATE paths SET priority = $1 WHERE id = $2", [priority, req.params.id]);
//     res.json({ success: true });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // Labor share settings endpoints
// app.get("/api/labor-share/:shiftCode/:dept", async (req, res) => {
//   const { shiftCode, dept } = req.params;
//   try {
//     const result = await pool.query("SELECT * FROM labor_share_settings WHERE shift_code = $1 AND dept = $2", [shiftCode, dept]);
//     if (result.rows.length) res.json(result.rows[0]);
//     else res.json({ shift_code: shiftCode, dept, enabled: false, percentage: 0 });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// app.post("/api/labor-share", async (req, res) => {
//   const { shift_code, dept, enabled, percentage } = req.body;
//   try {
//     await pool.query(
//       "INSERT INTO labor_share_settings (shift_code, dept, enabled, percentage) VALUES ($1, $2, $3, $4) ON CONFLICT (shift_code, dept) DO UPDATE SET enabled = EXCLUDED.enabled, percentage = EXCLUDED.percentage",
//       [shift_code, dept, enabled, percentage || 0]
//     );
//     res.json({ success: true });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// app.get("/api/labor-share/counts/:shiftCode/:dept/:date", async (req, res) => {
//   const { shiftCode, dept, date } = req.params;
//   try {
//     const result = await pool.query("SELECT assigned_to_other FROM both_assignments WHERE shift_code = $1 AND dept = $2 AND work_date = $3", [shiftCode, dept, date]);
//     res.json({ count: result.rows[0]?.assigned_to_other || 0 });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// app.post("/api/labor-share/increment", async (req, res) => {
//   const { shift_code, dept, work_date } = req.body;
//   try {
//     await pool.query(
//       `INSERT INTO both_assignments (shift_code, dept, work_date, assigned_to_other) VALUES ($1, $2, $3, 1)
//        ON CONFLICT (shift_code, dept, work_date) DO UPDATE SET assigned_to_other = both_assignments.assigned_to_other + 1`,
//       [shift_code, dept, work_date]
//     );
//     res.json({ success: true });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // ========== ASSOCIATES ==========
// app.get("/api/associates", async (req, res) => {
//   const { search, shift, op_mode } = req.query;
//   let query = "SELECT * FROM associates WHERE active = true";
//   const params = [];
//   if (search) {
//     query += " AND (name ILIKE $1 OR login ILIKE $2 OR badge ILIKE $3)";
//     params.push(`%${search}%`, `%${search}%`, `%${search}%`);
//   }
//   if (shift) {
//     query += ` AND shift_code = $${params.length + 1}`;
//     params.push(shift);
//   }
//   if (op_mode && op_mode !== "ALL") {
//     query += ` AND (operation_mode = $${params.length + 1} OR operation_mode = 'BOTH')`;
//     params.push(op_mode);
//   }
//   query += " ORDER BY name";
//   try {
//     const result = await pool.query(query, params);
//     const weekStart = getWeekStart();
//     const enriched = [];
//     for (const a of result.rows) {
//       const perms = await pool.query(`SELECT pm.*, p.name as path_name, p.mode as path_mode, p.role_type, p.rotation_hours
//         FROM permissions pm JOIN paths p ON pm.path_id = p.id WHERE pm.badge = $1`, [a.badge]);
//       const weekHours = await pool.query(`SELECT p.name as path_name, rh.hours, p.mode as path_mode
//         FROM role_hours rh JOIN paths p ON rh.path_id = p.id WHERE rh.badge = $1 AND rh.week_start = $2`, [a.badge, weekStart]);
//       const yesterdayRoles = await pool.query(`SELECT p.name as path_name, yr.hours
//         FROM yesterday_roles yr JOIN paths p ON yr.path_id = p.id
//         WHERE yr.badge = $1 AND yr.work_date = CURRENT_DATE - 1`, [a.badge]);
//       const currentPath = a.current_path_id ? (await pool.query("SELECT name FROM paths WHERE id = $1", [a.current_path_id])).rows[0] : null;
//       const currentStation = a.current_station_id ? (await pool.query("SELECT name, line_id FROM stations WHERE id = $1", [a.current_station_id])).rows[0] : null;
//       enriched.push({
//         ...a,
//         permissions: perms.rows,
//         weekHours: weekHours.rows,
//         yesterdayRoles: yesterdayRoles.rows,
//         currentPath: currentPath?.name,
//         currentStation: currentStation?.name,
//       });
//     }
//     res.json(enriched);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// app.post("/api/associates", async (req, res) => {
//   const { badge, login, name, home_dept, manager, shift_code, operation_mode, default_dept } = req.body;
//   if (!badge || !login || !name) return res.status(400).json({ error: "badge, login, name required" });
//   try {
//     await pool.query(
//       `INSERT INTO associates (badge, login, name, home_dept, manager, shift_code, operation_mode, default_dept)
//        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
//       [badge, login, name, home_dept || "CRETS Processing", manager || "", shift_code || "FHD", operation_mode || "INBOUND", default_dept || (operation_mode === "BOTH" ? "INBOUND" : operation_mode)]
//     );
//     await logEvent(badge, login, "ASSOCIATE_ADDED", `${name} added`, null);
//     const newAssoc = await pool.query("SELECT * FROM associates WHERE badge = $1", [badge]);
//     res.json(newAssoc.rows[0]);
//   } catch (err) {
//     if (err.code === "23505") return res.status(409).json({ error: "Badge or login already exists" });
//     res.status(500).json({ error: err.message });
//   }
// });

// app.delete("/api/associates/:badge", async (req, res) => {
//   const { badge } = req.params;
//   const client = await pool.connect();
//   try {
//     await client.query("BEGIN");
//     await client.query("DELETE FROM permissions WHERE badge = $1", [badge]);
//     await client.query("DELETE FROM role_hours WHERE badge = $1", [badge]);
//     await client.query("DELETE FROM yesterday_roles WHERE badge = $1", [badge]);
//     await client.query("DELETE FROM associates WHERE badge = $1", [badge]);
//     await client.query("COMMIT");
//     await logEvent(badge, null, "ASSOCIATE_DELETED", `Associate ${badge} deleted`, null);
//     res.json({ success: true });
//   } catch (err) {
//     await client.query("ROLLBACK");
//     res.status(500).json({ error: err.message });
//   } finally {
//     client.release();
//   }
// });

// app.patch("/api/associates/:badge", async (req, res) => {
//   const fields = [];
//   const values = [];
//   const allowed = ["name", "home_dept", "manager", "shift_code", "operation_mode", "default_dept", "active"];
//   for (const f of allowed) {
//     if (req.body[f] !== undefined) {
//       fields.push(`${f} = $${fields.length + 1}`);
//       values.push(req.body[f] === undefined ? null : req.body[f]);
//     }
//   }
//   if (!fields.length) return res.status(400).json({ error: "Nothing to update" });
//   values.push(req.params.badge);
//   try {
//     await pool.query(`UPDATE associates SET ${fields.join(", ")} WHERE badge = $${values.length}`, values);
//     const updated = await pool.query("SELECT * FROM associates WHERE badge = $1", [req.params.badge]);
//     const perms = await pool.query(`SELECT pm.*, p.name as path_name, p.mode as path_mode, p.role_type, p.rotation_hours
//       FROM permissions pm JOIN paths p ON pm.path_id = p.id WHERE pm.badge = $1`, [req.params.badge]);
//     const weekStart = getWeekStart();
//     const weekHours = await pool.query(`SELECT p.name as path_name, rh.hours, p.mode as path_mode
//       FROM role_hours rh JOIN paths p ON rh.path_id = p.id WHERE rh.badge = $1 AND rh.week_start = $2`, [req.params.badge, weekStart]);
//     const yesterdayRoles = await pool.query(`SELECT p.name as path_name, yr.hours
//       FROM yesterday_roles yr JOIN paths p ON yr.path_id = p.id
//       WHERE yr.badge = $1 AND yr.work_date = CURRENT_DATE - 1`, [req.params.badge]);
//     res.json({ ...updated.rows[0], permissions: perms.rows, weekHours: weekHours.rows, yesterdayRoles: yesterdayRoles.rows });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // ========== PERMISSIONS ==========
// app.get("/api/permissions", async (req, res) => {
//   const { badge, path_id, mode } = req.query;
//   let query = `SELECT pm.*, a.name as assoc_name, a.login, a.shift_code, a.operation_mode,
//     p.name as path_name, p.mode as path_mode, p.role_type, p.rotation_hours
//     FROM permissions pm
//     JOIN associates a ON pm.badge = a.badge
//     JOIN paths p ON pm.path_id = p.id
//     WHERE a.active = true AND p.active = true`;
//   const params = [];
//   if (badge) {
//     query += " AND pm.badge = $" + (params.length + 1);
//     params.push(badge);
//   }
//   if (path_id) {
//     query += " AND pm.path_id = $" + (params.length + 1);
//     params.push(path_id);
//   }
//   if (mode) {
//     query += " AND p.mode = $" + (params.length + 1);
//     params.push(mode);
//   }
//   query += " ORDER BY a.name, p.name";
//   try {
//     const result = await pool.query(query, params);
//     res.json(result.rows);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// app.get("/api/permissions/summary", async (req, res) => {
//   const { mode } = req.query;
//   let query = `SELECT p.id as path_id, p.name as path_name, p.mode, p.role_type, p.max_capacity,
//     pm.lc_level, COUNT(pm.badge) as count
//     FROM permissions pm
//     JOIN paths p ON pm.path_id = p.id
//     JOIN associates a ON pm.badge = a.badge
//     WHERE p.active = true AND a.active = true`;
//   const params = [];
//   if (mode) {
//     query += " AND p.mode = $" + (params.length + 1);
//     params.push(mode);
//   }
//   query += " GROUP BY p.id, pm.lc_level ORDER BY p.sort_order, pm.lc_level DESC";
//   const rows = (await pool.query(query, params)).rows;
//   const map = {};
//   for (const r of rows) {
//     if (!map[r.path_id]) {
//       map[r.path_id] = {
//         path_id: r.path_id,
//         path_name: r.path_name,
//         mode: r.mode,
//         role_type: r.role_type,
//         max_capacity: r.max_capacity,
//         lc1: 0, lc2: 0, lc3: 0, lc4: 0, lc5: 0, total: 0,
//       };
//     }
//     map[r.path_id][`lc${r.lc_level}`] = r.count;
//     map[r.path_id].total += r.count;
//   }
//   res.json(Object.values(map));
// });

// app.post("/api/permissions", async (req, res) => {
//   const { badge, path_id, lc_level } = req.body;
//   if (!badge || !path_id) return res.status(400).json({ error: "badge and path_id required" });
//   try {
//     await pool.query(
//       "INSERT INTO permissions (badge, path_id, lc_level) VALUES ($1, $2, $3) ON CONFLICT (badge, path_id) DO UPDATE SET lc_level = EXCLUDED.lc_level",
//       [badge, path_id, lc_level || 1]
//     );
//     await logEvent(badge, null, "PERM_UPDATED", `Permission set: path ${path_id} LC ${lc_level}`, null);
//     const updated = await pool.query("SELECT * FROM associates WHERE badge = $1", [badge]);
//     const perms = await pool.query(`SELECT pm.*, p.name as path_name, p.mode as path_mode, p.role_type, p.rotation_hours
//       FROM permissions pm JOIN paths p ON pm.path_id = p.id WHERE pm.badge = $1`, [badge]);
//     const weekStart = getWeekStart();
//     const weekHours = await pool.query(`SELECT p.name as path_name, rh.hours, p.mode as path_mode
//       FROM role_hours rh JOIN paths p ON rh.path_id = p.id WHERE rh.badge = $1 AND rh.week_start = $2`, [badge, weekStart]);
//     const yesterdayRoles = await pool.query(`SELECT p.name as path_name, yr.hours
//       FROM yesterday_roles yr JOIN paths p ON yr.path_id = p.id
//       WHERE yr.badge = $1 AND yr.work_date = CURRENT_DATE - 1`, [badge]);
//     res.json({ ...updated.rows[0], permissions: perms.rows, weekHours: weekHours.rows, yesterdayRoles: yesterdayRoles.rows });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// app.delete("/api/permissions/:badge/:path_id", async (req, res) => {
//   const { badge, path_id } = req.params;
//   try {
//     await pool.query("DELETE FROM permissions WHERE badge = $1 AND path_id = $2", [badge, path_id]);
//     await logEvent(badge, null, "PERM_REMOVED", `Permission removed: path ${path_id}`, null);
//     res.json({ success: true });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // ========== PATHS ==========
// app.get("/api/paths", async (req, res) => {
//   const { mode } = req.query;
//   let query = `SELECT p.*, d.name as dept_name FROM paths p LEFT JOIN departments d ON p.dept_id = d.id WHERE p.active = true`;
//   const params = [];
//   if (mode && mode !== "BOTH") {
//     query += ` AND (p.mode = $1 OR p.mode = 'BOTH')`;
//     params.push(mode);
//   }
//   query += ` ORDER BY p.priority DESC, p.sort_order`;
//   const paths = (await pool.query(query, params)).rows;
//   const enriched = [];
//   for (const p of paths) {
//     const currentCount = await pool.query("SELECT COUNT(*) as c FROM associates WHERE current_path_id = $1", [p.id]);
//     const openStations = await pool.query(`SELECT COUNT(*) as c FROM stations s
//       JOIN lines l ON s.line_id = l.id
//       JOIN departments d ON l.dept_id = d.id
//       JOIN paths pt ON pt.dept_id = d.id
//       WHERE pt.id = $1 AND s.active = true AND s.occupied = false`, [p.id]);
//     enriched.push({
//       ...p,
//       currentCount: parseInt(currentCount.rows[0].c),
//       openStations: parseInt(openStations.rows[0].c),
//       capacityPct: p.max_capacity > 0 ? Math.round(currentCount.rows[0].c / p.max_capacity * 100) : 0,
//     });
//   }
//   res.json(enriched);
// });

// app.post("/api/paths", async (req, res) => {
//   const { name, dept_id, role_type, mode, rotation_hours, priority, max_capacity } = req.body;
//   if (!name) return res.status(400).json({ error: "name required" });
//   const maxOrd = await pool.query("SELECT MAX(sort_order) as m FROM paths");
//   const sortOrder = (maxOrd.rows[0]?.m || 0) + 1;
//   try {
//     const result = await pool.query(
//       `INSERT INTO paths (name, dept_id, role_type, mode, rotation_hours, priority, max_capacity, sort_order)
//        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
//       [name, dept_id || null, role_type || "DIRECT", mode || "INBOUND", rotation_hours || 10, priority || 5, max_capacity || 999, sortOrder]
//     );
//     res.json(result.rows[0]);
//   } catch (err) {
//     if (err.code === "23505") return res.status(409).json({ error: "Path name exists" });
//     res.status(500).json({ error: err.message });
//   }
// });

// app.patch("/api/paths/:id", async (req, res) => {
//   const fields = [];
//   const values = [];
//   const allowed = ["name", "role_type", "rotation_hours", "priority", "max_capacity", "active"];
//   for (const f of allowed) {
//     if (req.body[f] !== undefined) {
//       fields.push(`${f} = $${fields.length + 1}`);
//       values.push(req.body[f]);
//     }
//   }
//   if (!fields.length) return res.status(400).json({ error: "Nothing to update" });
//   values.push(req.params.id);
//   try {
//     await pool.query(`UPDATE paths SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
//     res.json({ success: true });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// app.delete("/api/paths/:id", async (req, res) => {
//   try {
//     await pool.query("UPDATE paths SET active = false WHERE id = $1", [req.params.id]);
//     res.json({ success: true });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // ========== LINES ==========
// app.get("/api/lines", async (req, res) => {
//   const { mode } = req.query;
//   let query = `SELECT l.*, d.name as dept_name, d.mode,
//     COUNT(s.id) as total_stations,
//     SUM(CASE WHEN s.active THEN 1 ELSE 0 END) as active_stations,
//     SUM(CASE WHEN s.active AND s.occupied THEN 1 ELSE 0 END) as occupied_stations
//     FROM lines l
//     JOIN departments d ON l.dept_id = d.id
//     LEFT JOIN stations s ON s.line_id = l.id`;
//   const params = [];
//   if (mode) {
//     query += " WHERE d.mode = $1";
//     params.push(mode);
//   }
//   query += " GROUP BY l.id ORDER BY l.sort_order";
//   const lines = (await pool.query(query, params)).rows;
//   for (let i = 0; i < lines.length; i++) {
//     const stations = await pool.query("SELECT * FROM stations WHERE line_id = $1 ORDER BY side, station_number", [lines[i].id]);
//     lines[i].stations = stations.rows;
//   }
//   res.json(lines);
// });

// app.post("/api/lines", async (req, res) => {
//   const { dept_id, name, side } = req.body;
//   if (!dept_id || !name) return res.status(400).json({ error: "dept_id and name required" });
//   const maxOrd = await pool.query("SELECT MAX(sort_order) as m FROM lines");
//   const sortOrder = (maxOrd.rows[0]?.m || 0) + 1;
//   try {
//     const result = await pool.query(
//       "INSERT INTO lines (dept_id, name, side, active, sort_order) VALUES ($1, $2, $3, true, $4) RETURNING id",
//       [dept_id, name, side || "LOW", sortOrder]
//     );
//     res.json({ success: true, id: result.rows[0].id });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// app.patch("/api/lines/:id", async (req, res) => {
//   const fields = [];
//   const values = [];
//   if (req.body.name !== undefined) { fields.push("name = $1"); values.push(req.body.name); }
//   if (req.body.active !== undefined) { fields.push("active = $" + (fields.length + 1)); values.push(req.body.active); }
//   if (!fields.length) return res.status(400).json({ error: "Nothing to update" });
//   values.push(req.params.id);
//   try {
//     await pool.query(`UPDATE lines SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
//     res.json({ success: true });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// app.delete("/api/lines/:id", async (req, res) => {
//   const client = await pool.connect();
//   try {
//     await client.query("BEGIN");
//     await client.query("UPDATE stations SET active = false WHERE line_id = $1", [req.params.id]);
//     await client.query("DELETE FROM lines WHERE id = $1", [req.params.id]);
//     await client.query("COMMIT");
//     res.json({ success: true });
//   } catch (err) {
//     await client.query("ROLLBACK");
//     res.status(500).json({ error: err.message });
//   } finally {
//     client.release();
//   }
// });

// // ========== STATIONS ==========
// app.get("/api/stations", async (req, res) => {
//   const { line_id } = req.query;
//   let query = `SELECT s.*, l.name as line_name, d.name as dept_name, d.mode
//     FROM stations s
//     JOIN lines l ON s.line_id = l.id
//     JOIN departments d ON l.dept_id = d.id
//     WHERE 1=1`;
//   const params = [];
//   if (line_id) {
//     query += " AND s.line_id = $1";
//     params.push(line_id);
//   }
//   query += " ORDER BY l.sort_order, s.side, s.station_number";
//   const result = await pool.query(query, params);
//   res.json(result.rows);
// });

// app.post("/api/stations", async (req, res) => {
//   const { line_id, name, side, station_number } = req.body;
//   if (!line_id || !name) return res.status(400).json({ error: "line_id and name required" });
//   const maxNum = await pool.query("SELECT MAX(station_number) as m FROM stations WHERE line_id = $1", [line_id]);
//   const stationNum = station_number || (maxNum.rows[0]?.m || 0) + 1;
//   try {
//     const result = await pool.query(
//       "INSERT INTO stations (line_id, name, side, station_number, active, occupied) VALUES ($1, $2, $3, $4, true, false) RETURNING id",
//       [line_id, name, side || "ODD", stationNum]
//     );
//     res.json({ success: true, id: result.rows[0].id });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// app.patch("/api/stations/:id", async (req, res) => {
//   const fields = [];
//   const values = [];
//   if (req.body.name !== undefined) { fields.push("name = $1"); values.push(req.body.name); }
//   if (req.body.active !== undefined) { fields.push("active = $" + (fields.length + 1)); values.push(req.body.active); }
//   if (req.body.occupied !== undefined) {
//     fields.push("occupied = $" + (fields.length + 1));
//     values.push(req.body.occupied);
//     if (!req.body.occupied) {
//       fields.push("occupied_by = NULL");
//       fields.push("occupied_since = NULL");
//     }
//   }
//   if (req.body.side !== undefined) { fields.push("side = $" + (fields.length + 1)); values.push(req.body.side); }
//   if (!fields.length) return res.status(400).json({ error: "Nothing to update" });
//   values.push(req.params.id);
//   try {
//     await pool.query(`UPDATE stations SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
//     res.json({ success: true });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// app.post("/api/stations/bulk-toggle", async (req, res) => {
//   const { ids, active } = req.body;
//   if (!Array.isArray(ids)) return res.status(400).json({ error: "ids must be array" });
//   const client = await pool.connect();
//   try {
//     await client.query("BEGIN");
//     for (const id of ids) {
//       await client.query("UPDATE stations SET active = $1 WHERE id = $2", [active, id]);
//     }
//     await client.query("COMMIT");
//     res.json({ success: true, count: ids.length });
//   } catch (err) {
//     await client.query("ROLLBACK");
//     res.status(500).json({ error: err.message });
//   } finally {
//     client.release();
//   }
// });

// app.delete("/api/stations/:id", async (req, res) => {
//   try {
//     await pool.query("UPDATE stations SET active = false, occupied = false, occupied_by = NULL WHERE id = $1", [req.params.id]);
//     res.json({ success: true });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // ========== DEPARTMENTS ==========
// app.get("/api/departments", async (req, res) => {
//   try {
//     const result = await pool.query("SELECT * FROM departments WHERE active = true");
//     res.json(result.rows);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // ========== SHIFT PLANS (placeholder) ==========
// app.post("/api/plans/build", async (req, res) => { res.json({ planId: 1, message: "Plan built (placeholder)" }); });
// app.get("/api/plans", async (req, res) => { const result = await pool.query("SELECT * FROM shift_plans ORDER BY created_at DESC LIMIT 10"); res.json(result.rows); });
// app.get("/api/plans/:id", async (req, res) => {
//   const plan = await pool.query("SELECT * FROM shift_plans WHERE id = $1", [req.params.id]);
//   if (!plan.rows.length) return res.status(404).json({ error: "Plan not found" });
//   const items = await pool.query(`SELECT spi.*, a.name, a.login, a.shift_code, a.operation_mode, a.home_dept
//     FROM shift_plan_items spi JOIN associates a ON spi.badge = a.badge
//     WHERE spi.plan_id = $1 ORDER BY spi.score DESC`, [req.params.id]);
//   res.json({ ...plan.rows[0], items: items.rows });
// });
// app.post("/api/plans/:id/apply", async (req, res) => { res.json({ success: true, message: "Applied (placeholder)" }); });
// app.delete("/api/plans/:id", async (req, res) => {
//   await pool.query("DELETE FROM shift_plan_items WHERE plan_id = $1", [req.params.id]);
//   await pool.query("DELETE FROM shift_plans WHERE id = $1", [req.params.id]);
//   res.json({ success: true });
// });

// // ========== DASHBOARD ==========
// app.get("/api/dashboard", async (req, res) => {
//   const mode = (await getSetting("active_mode")) || "INBOUND";
//   const shift = (await getSetting("active_shift")) || "FHD";
//   const since8h = Math.floor(Date.now() / 1000) - 28800;
//   const weekStart = getWeekStart();

//   const totalAssoc = await pool.query("SELECT COUNT(*) as c FROM associates WHERE active = true");
//   const onFloor = await pool.query("SELECT COUNT(*) as c FROM associates WHERE active = true AND current_path_id IS NOT NULL");
//   const assigned = await pool.query("SELECT COUNT(DISTINCT badge) as c FROM assignments WHERE assigned_at > $1 AND path_name != 'GREEN MILE'", [since8h]);
//   const greenMile = await pool.query("SELECT COUNT(*) as c FROM assignments WHERE assigned_at > $1 AND path_name = 'GREEN MILE'", [since8h]);
//   const byDept = await pool.query(`SELECT a.home_dept, COUNT(DISTINCT asn.badge) as count
//     FROM assignments asn JOIN associates a ON asn.badge = a.badge
//     WHERE asn.assigned_at > $1 GROUP BY a.home_dept`, [since8h]);
//   const topPaths = await pool.query(`SELECT path_name, COUNT(*) as count FROM assignments
//     WHERE assigned_at > $1 AND path_name != 'GREEN MILE' GROUP BY path_name ORDER BY count DESC LIMIT 8`, [since8h]);
//   const stationSummary = await pool.query(`SELECT l.name as line, COUNT(s.id) as total, SUM(s.occupied::int) as filled,
//     SUM(CASE WHEN s.active THEN 1 ELSE 0 END) as active
//     FROM stations s JOIN lines l ON s.line_id = l.id JOIN departments d ON l.dept_id = d.id
//     WHERE d.mode = $1 GROUP BY l.id ORDER BY l.sort_order`, [mode]);
//   const recentEvents = await pool.query("SELECT * FROM event_log ORDER BY created_at DESC LIMIT 25");
//   const hoursLeaderboard = await pool.query(`SELECT a.name, a.login, a.badge, SUM(rh.hours) as total_hours
//     FROM role_hours rh JOIN associates a ON rh.badge = a.badge
//     WHERE rh.week_start >= CURRENT_DATE - 14
//     GROUP BY rh.badge, a.name, a.login, a.badge ORDER BY total_hours DESC LIMIT 10`, []);
//   const pathCapacity = await pool.query(`SELECT p.name, p.max_capacity, COUNT(a.id) as current_count
//     FROM paths p LEFT JOIN associates a ON a.current_path_id = p.id AND a.active = true
//     WHERE p.active = true AND (p.mode = $1 OR p.mode = 'BOTH') GROUP BY p.id ORDER BY p.sort_order`, [mode]);

//   res.json({
//     mode, shift,
//     totalAssoc: parseInt(totalAssoc.rows[0].c),
//     onFloor: parseInt(onFloor.rows[0].c),
//     assigned: parseInt(assigned.rows[0].c),
//     greenMile: parseInt(greenMile.rows[0].c),
//     byDept: byDept.rows,
//     topPaths: topPaths.rows,
//     stationSummary: stationSummary.rows,
//     recentEvents: recentEvents.rows,
//     hoursLeaderboard: hoursLeaderboard.rows,
//     pathCapacity: pathCapacity.rows,
//   });
// });

// // ========== EVENTS, MOVE, RESET, FLOOR CUSTOM ==========
// app.get("/api/events", async (req, res) => {
//   const limit = parseInt(req.query.limit) || 100;
//   const result = await pool.query("SELECT * FROM event_log ORDER BY created_at DESC LIMIT $1", [limit]);
//   res.json(result.rows);
// });

// app.post("/api/move", async (req, res) => {
//   const { badge, station_id, moved_by } = req.body;
//   const assoc = await pool.query("SELECT * FROM associates WHERE badge = $1", [badge]);
//   if (!assoc.rows.length) return res.status(404).json({ error: "Not found" });
//   const station = await pool.query("SELECT s.*, l.name as line_name FROM stations s JOIN lines l ON s.line_id = l.id WHERE s.id = $1 AND s.active = true", [station_id]);
//   if (!station.rows.length) return res.status(404).json({ error: "Station not found" });
//   if (station.rows[0].occupied) return res.status(409).json({ error: "Station occupied" });
//   const now = Math.floor(Date.now() / 1000);
//   if (assoc.rows[0].current_station_id) {
//     await pool.query("UPDATE stations SET occupied = false, occupied_by = NULL, occupied_since = NULL WHERE id = $1", [assoc.rows[0].current_station_id]);
//   }
//   await pool.query("UPDATE stations SET occupied = true, occupied_by = $1, occupied_since = $2 WHERE id = $3", [assoc.rows[0].login, now, station_id]);
//   await pool.query("UPDATE associates SET current_station_id = $1, current_path_start = $2 WHERE badge = $3", [station_id, now, badge]);
//   await logEvent(badge, assoc.rows[0].login, "MANUAL_MOVE", `→ ${station.rows[0].name}`, await getSetting("active_mode"));
//   res.json({ success: true });
// });

// app.post("/api/reset-shift", async (req, res) => {
//   await pool.query("UPDATE stations SET occupied = false, occupied_by = NULL, occupied_since = NULL");
//   await pool.query("UPDATE associates SET current_path_id = NULL, current_station_id = NULL, current_path_start = NULL");
//   await pool.query("UPDATE assignments SET released_at = EXTRACT(EPOCH FROM NOW()) WHERE released_at IS NULL");
//   await logEvent(null, null, "SYSTEM", "SHIFT_RESET", "All assignments cleared");
//   res.json({ success: true });
// });

// app.get("/api/floor-custom-renames", async (req, res) => {
//   const row = await pool.query("SELECT value FROM settings WHERE key = 'path_renames'");
//   if (!row.rows.length) return res.json({ renames: {} });
//   try {
//     res.json({ renames: JSON.parse(row.rows[0].value) });
//   } catch {
//     res.json({ renames: {} });
//   }
// });

// app.post("/api/floor-custom-renames", async (req, res) => {
//   const { renames } = req.body;
//   await pool.query("INSERT INTO settings (key, value) VALUES ('path_renames', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(renames || {})]);
//   res.json({ success: true });
// });

// app.get("/api/floor-custom", async (req, res) => {
//   const row = await pool.query("SELECT value FROM settings WHERE key = 'floor_custom'");
//   if (!row.rows.length) return res.json({ paths: [], lines: [], stations: [] });
//   try {
//     res.json(JSON.parse(row.rows[0].value));
//   } catch {
//     res.json({ paths: [], lines: [], stations: [] });
//   }
// });

// app.post("/api/floor-custom", async (req, res) => {
//   const { paths, lines, stations } = req.body;
//   const val = JSON.stringify({ paths: paths || [], lines: lines || [], stations: stations || [] });
//   await pool.query("INSERT INTO settings (key, value) VALUES ('floor_custom', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [val]);
//   res.json({ success: true });
// });

// // ========== START SERVER ==========
// async function startServer() {
//   try {
//     await initTables();
//     const mode = await getSetting("active_mode") || "INBOUND";
//     const shift = await getSetting("active_shift") || "FHD";
//     app.listen(PORT, () => {
//       console.log(`\n🏭 Monopoly 3.0 (PostgreSQL with Labor Share) — http://localhost:${PORT}`);
//       console.log(`📍 TEN1 | Mode: ${mode} | Shift: ${shift}\n`);
//     });
//   } catch (err) {
//     console.error("Failed to start server:", err);
//     process.exit(1);
//   }
// }

// startServer();



const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 50,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function getSetting(key) {
  const res = await pool.query("SELECT value FROM settings WHERE key = $1", [key]);
  return res.rows[0]?.value;
}
async function setSetting(key, value) {
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [key, value]
  );
}
async function logEvent(badge, login, eventType, description, details) {
  await pool.query(
    "INSERT INTO event_log (badge, login, event_type, description, details, created_at) VALUES ($1, $2, $3, $4, $5, EXTRACT(EPOCH FROM NOW()))",
    [badge, login, eventType, description, details]
  );
}


function getWeekStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d.toISOString().split("T")[0];
}

async function initTables() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS shifts (code TEXT PRIMARY KEY, name TEXT, start_hour INTEGER, start_minute INTEGER, end_hour INTEGER, end_minute INTEGER, days TEXT);
      CREATE TABLE IF NOT EXISTS departments (id SERIAL PRIMARY KEY, name TEXT UNIQUE, mode TEXT, active BOOLEAN DEFAULT true);
      CREATE TABLE IF NOT EXISTS paths (
        id SERIAL PRIMARY KEY, name TEXT UNIQUE, dept_id INTEGER REFERENCES departments(id),
        role_type TEXT, mode TEXT, rotation_hours INTEGER, priority INTEGER DEFAULT 5,
        max_capacity INTEGER, sort_order INTEGER, active BOOLEAN DEFAULT true
      );
      CREATE TABLE IF NOT EXISTS lines (id SERIAL PRIMARY KEY, dept_id INTEGER REFERENCES departments(id), path_id INTEGER REFERENCES paths(id), name TEXT, side TEXT, sort_order INTEGER, active BOOLEAN DEFAULT true);
      CREATE TABLE IF NOT EXISTS stations (id SERIAL PRIMARY KEY, line_id INTEGER REFERENCES lines(id), name TEXT, side TEXT, station_number INTEGER, occupied BOOLEAN DEFAULT false, occupied_by TEXT, occupied_since BIGINT, active BOOLEAN DEFAULT true);
      CREATE TABLE IF NOT EXISTS associates (badge TEXT PRIMARY KEY, login TEXT UNIQUE, name TEXT, home_dept TEXT, manager TEXT, shift_code TEXT, operation_mode TEXT, default_dept TEXT DEFAULT 'INBOUND', current_path_id INTEGER, current_station_id INTEGER, current_path_start BIGINT, active BOOLEAN DEFAULT true);
      CREATE TABLE IF NOT EXISTS permissions (badge TEXT REFERENCES associates(badge) ON DELETE CASCADE, path_id INTEGER REFERENCES paths(id) ON DELETE CASCADE, lc_level INTEGER, PRIMARY KEY (badge, path_id));
      CREATE TABLE IF NOT EXISTS role_hours (badge TEXT REFERENCES associates(badge) ON DELETE CASCADE, path_id INTEGER REFERENCES paths(id) ON DELETE CASCADE, week_start DATE, hours FLOAT, PRIMARY KEY (badge, path_id, week_start));
      CREATE TABLE IF NOT EXISTS yesterday_roles (badge TEXT REFERENCES associates(badge) ON DELETE CASCADE, path_id INTEGER REFERENCES paths(id) ON DELETE CASCADE, work_date DATE, hours FLOAT, PRIMARY KEY (badge, path_id, work_date));
      CREATE TABLE IF NOT EXISTS assignments (id SERIAL PRIMARY KEY, badge TEXT REFERENCES associates(badge), path_name TEXT, assigned_at BIGINT, released_at BIGINT);
      CREATE TABLE IF NOT EXISTS event_log (id SERIAL PRIMARY KEY, badge TEXT, login TEXT, event_type TEXT, description TEXT, details TEXT, created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW())));
      CREATE TABLE IF NOT EXISTS shift_plans (id SERIAL PRIMARY KEY, mode TEXT, shift_code TEXT, created_by TEXT, created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW())));
      CREATE TABLE IF NOT EXISTS shift_plan_items (id SERIAL PRIMARY KEY, plan_id INTEGER REFERENCES shift_plans(id) ON DELETE CASCADE, badge TEXT, path_id INTEGER, score FLOAT, lc_level INTEGER, role_type TEXT);
      CREATE TABLE IF NOT EXISTS labor_share_settings (shift_code TEXT, dept TEXT, enabled BOOLEAN DEFAULT false, percentage INTEGER DEFAULT 0, PRIMARY KEY (shift_code, dept));
      CREATE TABLE IF NOT EXISTS admin_profiles (id SERIAL PRIMARY KEY, name TEXT, login TEXT UNIQUE, pin TEXT, role TEXT DEFAULT 'Manager', created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW())));
      CREATE TABLE IF NOT EXISTS both_assignments (shift_code TEXT, dept TEXT, work_date DATE, assigned_to_other INTEGER DEFAULT 0, PRIMARY KEY (shift_code, dept, work_date));
    `);
    await client.query(`
      INSERT INTO departments (name, mode) VALUES ('INBOUND', 'INBOUND'), ('OUTBOUND', 'OUTBOUND')
      ON CONFLICT (name) DO NOTHING;
    `);
    const deptRes = await client.query("SELECT id, name FROM departments WHERE name IN ('INBOUND','OUTBOUND')");
    const deptMap = {};
    deptRes.rows.forEach(d => { deptMap[d.name] = d.id; });
    const inboundPaths = ["CRETS Processing","CRETS High Side","WHD Processing","Refurb Processing","Tech Grading","Problem Solve","Super Solver","Waterspider","Downstacker","Unloader","Upstacker","Cage Builder"];
    for (let i = 0; i < inboundPaths.length; i++) {
      await client.query(`INSERT INTO paths (name, dept_id, role_type, mode, priority, sort_order) VALUES ($1, $2, $3, 'INBOUND', $4, $5) ON CONFLICT (name) DO NOTHING`, [inboundPaths[i], deptMap["INBOUND"], i < 6 ? "DIRECT" : "INDIRECT", 5, i]);
    }
    const outboundPaths = ["Pick Driver","Stow Driver","Rebin Processing","Pack Processing","Problem Solve","Super Solver","Step 1 Processor - Liquidation","Step 2 Processor - Liquidation","Step 1 Processor - Sellable","Step 2 Processor - Sellable","Step 1 Processor - Donation/Destroy","Step 2 Processor - Donation/Destroy","Waterspider","Cage Builder"];
    for (let i = 0; i < outboundPaths.length; i++) {
      await client.query(`INSERT INTO paths (name, dept_id, role_type, mode, priority, sort_order) VALUES ($1, $2, $3, 'OUTBOUND', $4, $5) ON CONFLICT (name) DO NOTHING`, [outboundPaths[i], deptMap["OUTBOUND"], i < 6 ? "DIRECT" : "INDIRECT", 5, i]);
    }

    // Seed default admin if no profiles exist
const adminCount = await client.query("SELECT COUNT(*) FROM admin_profiles");
if (parseInt(adminCount.rows[0].count) === 0) {
  await client.query(
    `INSERT INTO admin_profiles (name, login, pin, role) VALUES ($1, $2, $3, $4)`,
    ["System Admin", "admin", "1234", "Admin"]
  );
  console.log("✅ Default admin profile created (login: admin, pin: 1234)");
}
    await client.query("COMMIT");
    console.log("✅ All tables verified/created and default paths seeded");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error initializing tables:", err);
    throw err;
  } finally {
    client.release();
  }
}

function getCanonicalRole(pathName) {
  if (!pathName) return "";
  const u = pathName.toUpperCase();
  if (u.includes("CRETS")) return "CRETS Processing";
  if (u.includes("WHD")) return "WHD Processing";
  if (u.includes("REFURB")) return "Refurb Processing";
  if (u.includes("TECH")) return "Tech Grading";
  if (u.includes("PROBLEM SOLVE")) return "Problem Solve";
  if (u.includes("SUPER SOLVER")) return "Super Solver";
  if (u.includes("WATERSPIDER")) return "Waterspider";
  if (u.includes("DOWNSTACKER")) return "Downstacker";
  if (u.includes("UNLOADER")) return "Unloader";
  if (u.includes("UPSTACKER")) return "Upstacker";
  if (u.includes("CAGE")) return "Cage Builder";
  if (u.includes("PICK")) return "Pick Driver";
  if (u.includes("STOW")) return "Stow Driver";
  if (u.includes("REBIN")) return "Rebin Processing";
  if (u.includes("PACK")) return "Pack Processing";
  if (u.includes("LIQUIDATION") && u.includes("STEP 1")) return "Step 1 Processor - Liquidation";
  if (u.includes("LIQUIDATION") && u.includes("STEP 2")) return "Step 2 Processor - Liquidation";
  if (u.includes("SELLABLE") && u.includes("STEP 1")) return "Step 1 Processor - Sellable";
  if (u.includes("SELLABLE") && u.includes("STEP 2")) return "Step 2 Processor - Sellable";
  if (u.includes("DONATION") && u.includes("STEP 1")) return "Step 1 Processor - Donation/Destroy";
  if (u.includes("DONATION") && u.includes("STEP 2")) return "Step 2 Processor - Donation/Destroy";
  return pathName;
}

async function scoreOnePath(assoc, pathName, pool) {
  const canon = getCanonicalRole(pathName);
  const permRes = await pool.query(
    `SELECT lc_level FROM permissions p JOIN paths pa ON p.path_id = pa.id WHERE p.badge = $1 AND pa.name = $2`,
    [assoc.badge, pathName]
  );
  if (permRes.rows.length === 0) return null;
  const lcLevel = permRes.rows[0].lc_level;
  const ydRes = await pool.query(
    `SELECT hours FROM yesterday_roles WHERE badge = $1 AND path_id = (SELECT id FROM paths WHERE name = $2) AND work_date = CURRENT_DATE - 1`,
    [assoc.badge, pathName]
  );
  const yd = ydRes.rows[0]?.hours || 0;
  const weekStart = getWeekStart();
  const wkRes = await pool.query(
    `SELECT COALESCE(SUM(hours), 0) as hours FROM role_hours WHERE badge = $1 AND path_id = (SELECT id FROM paths WHERE name = $2) AND week_start >= CURRENT_DATE - 14`,
    [assoc.badge, pathName]
  );
  const wk = wkRes.rows[0]?.hours || 0;
  const totRes = await pool.query(
    `SELECT COALESCE(SUM(hours), 1) as total FROM role_hours WHERE badge = $1 AND week_start >= CURRENT_DATE - 14`,
    [assoc.badge]
  );
  const tot = totRes.rows[0].total;
  const sh = wk / tot;
  const prioRes = await pool.query(`SELECT priority FROM paths WHERE name = $1`, [pathName]);
  const prPts = prioRes.rows[0]?.priority || 5;
  const ydPts = yd > 0 ? -Math.min(15, Math.round(yd * 1.8)) : 4;
  const wkPts = Math.round(Math.max(0, (0.5 - sh) * 6));
  const lcPts = lcLevel * 0.8;
  const bPts = Math.min(1, (assoc.permissionsCount || 0) * 0.1);
  const totalScore = Math.max(0, prPts + ydPts + wkPts + lcPts + bPts);
  let rotationHours = 10;
  if (pathName === "CRETS High Side") rotationHours = 5;
  return {
    score: +totalScore.toFixed(1),
    lc: lcLevel,
    roleType: pathName.includes("Waterspider") ? "INDIRECT" : "DIRECT",
    rotationHours: rotationHours,
    breakdown: []
  };
}

async function smartAssign(badge, targetDept, pool) {
  const client = await pool.connect();
  try {
    const assocRes = await pool.query("SELECT * FROM associates WHERE badge = $1 OR login = $2", [badge, badge.toLowerCase()]);
    if (assocRes.rows.length === 0) return { error: "Associate not found" };
    const assoc = assocRes.rows[0];
    const pathsRes = await pool.query(
      `SELECT id, name, role_type FROM paths WHERE mode = $1 AND active = true ORDER BY priority DESC`,
      [targetDept]
    );
    const paths = pathsRes.rows;
    if (paths.length === 0) return { error: "No paths available for department" };
    const scored = [];
    for (const p of paths) {
      const s = await scoreOnePath(assoc, p.name, pool);
      if (s) {
        scored.push({ pathId: p.id, pathName: p.name, roleType: p.role_type, ...s });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    if (scored.length === 0) {
      return { error: "No eligible paths (check permissions or station availability)" };
    }
    const chosen = scored[0];
    const stationRes = await pool.query(
      `SELECT s.id, s.name, l.name as line_name FROM stations s
       JOIN lines l ON s.line_id = l.id
       JOIN paths p ON l.path_id = p.id
       WHERE p.id = $1 AND s.active = true AND s.occupied = false
       LIMIT 1`,
      [chosen.pathId]
    );
    if (stationRes.rows.length === 0) {
      return { error: `No open station for ${chosen.pathName}` };
    }
    const station = stationRes.rows[0];
    await client.query("BEGIN");
    await client.query(
      "UPDATE stations SET occupied = false, occupied_by = NULL, occupied_since = NULL WHERE occupied_by = $1",
      [assoc.login]
    );
    const now = Math.floor(Date.now() / 1000);
    await client.query(
      "UPDATE stations SET occupied = true, occupied_by = $1, occupied_since = $2 WHERE id = $3",
      [assoc.login, now, station.id]
    );
    await client.query(
      "UPDATE associates SET current_path_id = $1, current_station_id = $2, current_path_start = $3 WHERE badge = $4",
      [chosen.pathId, station.id, now, assoc.badge]
    );
    await client.query(
      "INSERT INTO assignments (badge, path_name, assigned_at) VALUES ($1, $2, $3)",
      [assoc.badge, chosen.pathName, now]
    );
    await client.query("COMMIT");
    await logEvent(assoc.badge, assoc.login, "SCAN_ASSIGN", `Assigned to ${chosen.pathName} at ${station.name}`, targetDept);
    return {
      success: true,
      associate: { name: assoc.name, login: assoc.login, badge: assoc.badge, shift_code: assoc.shift_code, operation_mode: assoc.operation_mode },
      path: chosen.pathName,
      station: { id: station.id, name: station.name, line_name: station.line_name },
      score: chosen.score,
      lc: chosen.lc,
      roleType: chosen.roleType,
      rotationHours: chosen.rotationHours,
      breakdown: chosen.breakdown,
      allScores: scored.slice(1, 4).map(s => ({ path: s.pathName, score: s.score, type: s.roleType })),
      method: "AUTO",
      assignedDept: targetDept
    };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("SmartAssign error:", err);
    return { error: err.message };
  } finally {
    client.release();
  }
}

app.get("/api/system", async (req, res) => {
  try {
    const mode = (await getSetting("active_mode")) || "INBOUND";
    const activeShift = (await getSetting("active_shift")) || "FHD";
    const shifts = await pool.query("SELECT * FROM shifts");
    const totalAssoc = await pool.query("SELECT COUNT(*) as c FROM associates WHERE active = true");
    const onFloor = await pool.query("SELECT COUNT(*) as c FROM associates WHERE active = true AND current_path_id IS NOT NULL");
    const openStations = await pool.query("SELECT COUNT(*) as c FROM stations WHERE active = true AND occupied = false");
    const filledStations = await pool.query("SELECT COUNT(*) as c FROM stations WHERE active = true AND occupied = true");
    res.json({
      mode, activeShift,
      shifts: shifts.rows,
      totalAssoc: parseInt(totalAssoc.rows[0].c),
      onFloor: parseInt(onFloor.rows[0].c),
      openStations: parseInt(openStations.rows[0].c),
      filledStations: parseInt(filledStations.rows[0].c),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/system/mode", async (req, res) => {
  const { mode } = req.body;
  if (!["INBOUND", "OUTBOUND"].includes(mode)) return res.status(400).json({ error: "Invalid mode" });
  await setSetting("active_mode", mode);
  await logEvent(null, null, "SYSTEM", "MODE_CHANGE", `Switched to ${mode}`);
  res.json({ success: true, mode });
});

app.post("/api/system/shift", async (req, res) => {
  const { shift } = req.body;
  const s = await pool.query("SELECT * FROM shifts WHERE code = $1", [shift]);
  if (!s.rows.length) return res.status(404).json({ error: "Shift not found" });
  await setSetting("active_shift", s.rows[0].code);
  await logEvent(null, null, "SYSTEM", "SHIFT_CHANGE", `Shift set to ${s.rows[0].code}`);
  res.json({ success: true, shift: s.rows[0] });
});

app.post("/api/scan", async (req, res) => {
  const { badge, shiftType, staffDate, laborShareEnabled, laborShareCount } = req.body;
  if (!badge) return res.status(400).json({ error: "Badge required" });
  const mode = (await getSetting("active_mode")) || "INBOUND";
  try {
    const assocRes = await pool.query("SELECT * FROM associates WHERE badge = $1 OR login = $2", [badge, badge.toLowerCase()]);
    if (assocRes.rows.length === 0) return res.status(404).json({ error: "Associate not found" });
    const assoc = assocRes.rows[0];
    let targetDept = assoc.operation_mode === "BOTH" ? (assoc.default_dept || "INBOUND") : assoc.operation_mode;
    if (assoc.operation_mode === "BOTH" && laborShareEnabled && shiftType && staffDate) {
      const defaultDept = assoc.default_dept || "INBOUND";
      const otherDept = defaultDept === "INBOUND" ? "OUTBOUND" : "INBOUND";
      const countRes = await pool.query(
        "SELECT assigned_to_other FROM both_assignments WHERE shift_code = $1 AND dept = $2 AND work_date = $3",
        [shiftType, otherDept, staffDate]
      );
      const assignedToOther = countRes.rows[0]?.assigned_to_other || 0;
      const totalBothRes = await pool.query("SELECT COUNT(*) as c FROM associates WHERE operation_mode = 'BOTH' AND active = true");
      const totalBoth = parseInt(totalBothRes.rows[0].c);
      const targetOtherCount = laborShareCount === 0 ? totalBoth : Math.floor(totalBoth * (laborShareCount / 100));
      if (assignedToOther < targetOtherCount) {
        const hasPermRes = await pool.query(`
          SELECT 1 FROM permissions p
          JOIN paths pa ON p.path_id = pa.id
          WHERE p.badge = $1 AND pa.mode = $2
          LIMIT 1
        `, [assoc.badge, otherDept]);
        if (hasPermRes.rows.length > 0) {
          targetDept = otherDept;
        } else {
          targetDept = defaultDept;
        }
      } else {
        targetDept = defaultDept;
      }
    }
    const result = await smartAssign(badge, targetDept, pool);
    if (result.error) return res.status(404).json(result);
    if (assoc.operation_mode === "BOTH" && laborShareEnabled && targetDept !== (assoc.default_dept || "INBOUND")) {
      await pool.query(
        `INSERT INTO both_assignments (shift_code, dept, work_date, assigned_to_other) VALUES ($1, $2, $3, 1)
         ON CONFLICT (shift_code, dept, work_date) DO UPDATE SET assigned_to_other = both_assignments.assigned_to_other + 1`,
        [shiftType, targetDept, staffDate]
      );
    }
    res.json(result);
  } catch (err) {
    console.error("Scan error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/profiles", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name, login, role FROM admin_profiles ORDER BY name");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/login", async (req, res) => {
  const { login, pin } = req.body;
  try {
    const result = await pool.query("SELECT id, name, login, role FROM admin_profiles WHERE login = $1 AND pin = $2", [login, pin]);
    if (result.rows.length === 0) return res.status(401).json({ error: "Invalid login or PIN" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/profiles", async (req, res) => {
  const { name, login, pin, role } = req.body;
  if (!name || !login || !pin) return res.status(400).json({ error: "Name, login, and PIN required" });
  try {
    await pool.query("INSERT INTO admin_profiles (name, login, pin, role) VALUES ($1, $2, $3, $4)", [name, login, pin, role || "Manager"]);
    res.json({ success: true });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Login already exists" });
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/profiles/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM admin_profiles WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/path-priorities", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name, mode, priority FROM paths WHERE active = true ORDER BY mode, priority DESC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/path-priorities/:id", async (req, res) => {
  const { priority } = req.body;
  try {
    await pool.query("UPDATE paths SET priority = $1 WHERE id = $2", [priority, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/labor-share/:shiftCode/:dept", async (req, res) => {
  const { shiftCode, dept } = req.params;
  try {
    const result = await pool.query("SELECT * FROM labor_share_settings WHERE shift_code = $1 AND dept = $2", [shiftCode, dept]);
    if (result.rows.length) res.json(result.rows[0]);
    else res.json({ shift_code: shiftCode, dept, enabled: false, percentage: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/labor-share", async (req, res) => {
  const { shift_code, dept, enabled, percentage } = req.body;
  try {
    await pool.query(
      "INSERT INTO labor_share_settings (shift_code, dept, enabled, percentage) VALUES ($1, $2, $3, $4) ON CONFLICT (shift_code, dept) DO UPDATE SET enabled = EXCLUDED.enabled, percentage = EXCLUDED.percentage",
      [shift_code, dept, enabled, percentage || 0]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/labor-share/counts/:shiftCode/:dept/:date", async (req, res) => {
  const { shiftCode, dept, date } = req.params;
  try {
    const result = await pool.query("SELECT assigned_to_other FROM both_assignments WHERE shift_code = $1 AND dept = $2 AND work_date = $3", [shiftCode, dept, date]);
    res.json({ count: result.rows[0]?.assigned_to_other || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/labor-share/increment", async (req, res) => {
  const { shift_code, dept, work_date } = req.body;
  try {
    await pool.query(
      `INSERT INTO both_assignments (shift_code, dept, work_date, assigned_to_other) VALUES ($1, $2, $3, 1)
       ON CONFLICT (shift_code, dept, work_date) DO UPDATE SET assigned_to_other = both_assignments.assigned_to_other + 1`,
      [shift_code, dept, work_date]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== ASSOCIATES ==========
app.get("/api/associates", async (req, res) => {
  const { search, shift, op_mode } = req.query;
  let query = "SELECT * FROM associates WHERE active = true";
  const params = [];
  if (search) {
    query += " AND (name ILIKE $1 OR login ILIKE $2 OR badge ILIKE $3)";
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (shift) {
    query += ` AND shift_code = $${params.length + 1}`;
    params.push(shift);
  }
  if (op_mode && op_mode !== "ALL") {
    query += ` AND (operation_mode = $${params.length + 1} OR operation_mode = 'BOTH')`;
    params.push(op_mode);
  }
  query += " ORDER BY name";
  try {
    const result = await pool.query(query, params);
    const weekStart = getWeekStart();
    const enriched = [];
    for (const a of result.rows) {
      const perms = await pool.query(`SELECT pm.*, p.name as path_name, p.mode as path_mode, p.role_type, p.rotation_hours
        FROM permissions pm JOIN paths p ON pm.path_id = p.id WHERE pm.badge = $1`, [a.badge]);
      const weekHours = await pool.query(`SELECT p.name as path_name, rh.hours, p.mode as path_mode
        FROM role_hours rh JOIN paths p ON rh.path_id = p.id WHERE rh.badge = $1 AND rh.week_start = $2`, [a.badge, weekStart]);
      const yesterdayRoles = await pool.query(`SELECT p.name as path_name, yr.hours
        FROM yesterday_roles yr JOIN paths p ON yr.path_id = p.id
        WHERE yr.badge = $1 AND yr.work_date = CURRENT_DATE - 1`, [a.badge]);
      const currentPath = a.current_path_id ? (await pool.query("SELECT name FROM paths WHERE id = $1", [a.current_path_id])).rows[0] : null;
      const currentStation = a.current_station_id ? (await pool.query("SELECT name, line_id FROM stations WHERE id = $1", [a.current_station_id])).rows[0] : null;
      enriched.push({
        ...a,
        permissions: perms.rows,
        weekHours: weekHours.rows,
        yesterdayRoles: yesterdayRoles.rows,
        currentPath: currentPath?.name,
        currentStation: currentStation?.name,
      });
    }
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/associates", async (req, res) => {
  const { badge, login, name, home_dept, manager, shift_code, operation_mode, default_dept } = req.body;
  if (!badge || !login || !name) return res.status(400).json({ error: "badge, login, name required" });
  try {
    await pool.query(
      `INSERT INTO associates (badge, login, name, home_dept, manager, shift_code, operation_mode, default_dept)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [badge, login, name, home_dept || "CRETS Processing", manager || "", shift_code || "FHD", operation_mode || "INBOUND", default_dept || (operation_mode === "BOTH" ? "INBOUND" : operation_mode)]
    );
    await logEvent(badge, login, "ASSOCIATE_ADDED", `${name} added`, null);
    const newAssoc = await pool.query("SELECT * FROM associates WHERE badge = $1", [badge]);
    res.json(newAssoc.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Badge or login already exists" });
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/associates/:badge", async (req, res) => {
  const { badge } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM permissions WHERE badge = $1", [badge]);
    await client.query("DELETE FROM role_hours WHERE badge = $1", [badge]);
    await client.query("DELETE FROM yesterday_roles WHERE badge = $1", [badge]);
    await client.query("DELETE FROM associates WHERE badge = $1", [badge]);
    await client.query("COMMIT");
    await logEvent(badge, null, "ASSOCIATE_DELETED", `Associate ${badge} deleted`, null);
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.patch("/api/associates/:badge", async (req, res) => {
  const fields = [];
  const values = [];
  const allowed = ["name", "home_dept", "manager", "shift_code", "operation_mode", "default_dept", "active"];
  for (const f of allowed) {
    if (req.body[f] !== undefined) {
      fields.push(`${f} = $${fields.length + 1}`);
      values.push(req.body[f] === undefined ? null : req.body[f]);
    }
  }
  if (!fields.length) return res.status(400).json({ error: "Nothing to update" });
  values.push(req.params.badge);
  try {
    await pool.query(`UPDATE associates SET ${fields.join(", ")} WHERE badge = $${values.length}`, values);
    const updated = await pool.query("SELECT * FROM associates WHERE badge = $1", [req.params.badge]);
    const perms = await pool.query(`SELECT pm.*, p.name as path_name, p.mode as path_mode, p.role_type, p.rotation_hours
      FROM permissions pm JOIN paths p ON pm.path_id = p.id WHERE pm.badge = $1`, [req.params.badge]);
    const weekStart = getWeekStart();
    const weekHours = await pool.query(`SELECT p.name as path_name, rh.hours, p.mode as path_mode
      FROM role_hours rh JOIN paths p ON rh.path_id = p.id WHERE rh.badge = $1 AND rh.week_start = $2`, [req.params.badge, weekStart]);
    const yesterdayRoles = await pool.query(`SELECT p.name as path_name, yr.hours
      FROM yesterday_roles yr JOIN paths p ON yr.path_id = p.id
      WHERE yr.badge = $1 AND yr.work_date = CURRENT_DATE - 1`, [req.params.badge]);
    res.json({ ...updated.rows[0], permissions: perms.rows, weekHours: weekHours.rows, yesterdayRoles: yesterdayRoles.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== PERMISSIONS ==========
app.get("/api/permissions", async (req, res) => {
  const { badge, path_id, mode } = req.query;
  let query = `SELECT pm.*, a.name as assoc_name, a.login, a.shift_code, a.operation_mode,
    p.name as path_name, p.mode as path_mode, p.role_type, p.rotation_hours
    FROM permissions pm
    JOIN associates a ON pm.badge = a.badge
    JOIN paths p ON pm.path_id = p.id
    WHERE a.active = true AND p.active = true`;
  const params = [];
  if (badge) {
    query += " AND pm.badge = $" + (params.length + 1);
    params.push(badge);
  }
  if (path_id) {
    query += " AND pm.path_id = $" + (params.length + 1);
    params.push(path_id);
  }
  if (mode) {
    query += " AND p.mode = $" + (params.length + 1);
    params.push(mode);
  }
  query += " ORDER BY a.name, p.name";
  try {
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/permissions/summary", async (req, res) => {
  const { mode } = req.query;
  let query = `SELECT p.id as path_id, p.name as path_name, p.mode, p.role_type, p.max_capacity,
    pm.lc_level, COUNT(pm.badge) as count
    FROM permissions pm
    JOIN paths p ON pm.path_id = p.id
    JOIN associates a ON pm.badge = a.badge
    WHERE p.active = true AND a.active = true`;
  const params = [];
  if (mode) {
    query += " AND p.mode = $" + (params.length + 1);
    params.push(mode);
  }
  query += " GROUP BY p.id, pm.lc_level ORDER BY p.sort_order, pm.lc_level DESC";
  const rows = (await pool.query(query, params)).rows;
  const map = {};
  for (const r of rows) {
    if (!map[r.path_id]) {
      map[r.path_id] = {
        path_id: r.path_id,
        path_name: r.path_name,
        mode: r.mode,
        role_type: r.role_type,
        max_capacity: r.max_capacity,
        lc1: 0, lc2: 0, lc3: 0, lc4: 0, lc5: 0, total: 0,
      };
    }
    map[r.path_id][`lc${r.lc_level}`] = r.count;
    map[r.path_id].total += r.count;
  }
  res.json(Object.values(map));
});

app.post("/api/permissions", async (req, res) => {
  const { badge, path_id, lc_level } = req.body;
  if (!badge || !path_id) return res.status(400).json({ error: "badge and path_id required" });
  try {
    await pool.query(
      "INSERT INTO permissions (badge, path_id, lc_level) VALUES ($1, $2, $3) ON CONFLICT (badge, path_id) DO UPDATE SET lc_level = EXCLUDED.lc_level",
      [badge, path_id, lc_level || 1]
    );
    await logEvent(badge, null, "PERM_UPDATED", `Permission set: path ${path_id} LC ${lc_level}`, null);
    const updated = await pool.query("SELECT * FROM associates WHERE badge = $1", [badge]);
    const perms = await pool.query(`SELECT pm.*, p.name as path_name, p.mode as path_mode, p.role_type, p.rotation_hours
      FROM permissions pm JOIN paths p ON pm.path_id = p.id WHERE pm.badge = $1`, [badge]);
    const weekStart = getWeekStart();
    const weekHours = await pool.query(`SELECT p.name as path_name, rh.hours, p.mode as path_mode
      FROM role_hours rh JOIN paths p ON rh.path_id = p.id WHERE rh.badge = $1 AND rh.week_start = $2`, [badge, weekStart]);
    const yesterdayRoles = await pool.query(`SELECT p.name as path_name, yr.hours
      FROM yesterday_roles yr JOIN paths p ON yr.path_id = p.id
      WHERE yr.badge = $1 AND yr.work_date = CURRENT_DATE - 1`, [badge]);
    res.json({ ...updated.rows[0], permissions: perms.rows, weekHours: weekHours.rows, yesterdayRoles: yesterdayRoles.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/permissions/:badge/:path_id", async (req, res) => {
  const { badge, path_id } = req.params;
  try {
    await pool.query("DELETE FROM permissions WHERE badge = $1 AND path_id = $2", [badge, path_id]);
    await logEvent(badge, null, "PERM_REMOVED", `Permission removed: path ${path_id}`, null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== PATHS ==========
app.get("/api/paths", async (req, res) => {
  const { mode } = req.query;
  let query = `SELECT p.*, d.name as dept_name FROM paths p LEFT JOIN departments d ON p.dept_id = d.id WHERE p.active = true`;
  const params = [];
  if (mode && mode !== "BOTH") {
    query += ` AND (p.mode = $1 OR p.mode = 'BOTH')`;
    params.push(mode);
  }
  query += ` ORDER BY p.priority DESC, p.sort_order`;
  const paths = (await pool.query(query, params)).rows;
  const enriched = [];
  for (const p of paths) {
    const currentCount = await pool.query("SELECT COUNT(*) as c FROM associates WHERE current_path_id = $1", [p.id]);
    const openStations = await pool.query(`SELECT COUNT(*) as c FROM stations s
      JOIN lines l ON s.line_id = l.id
      JOIN departments d ON l.dept_id = d.id
      JOIN paths pt ON pt.dept_id = d.id
      WHERE pt.id = $1 AND s.active = true AND s.occupied = false`, [p.id]);
    enriched.push({
      ...p,
      currentCount: parseInt(currentCount.rows[0].c),
      openStations: parseInt(openStations.rows[0].c),
      capacityPct: p.max_capacity > 0 ? Math.round(currentCount.rows[0].c / p.max_capacity * 100) : 0,
    });
  }
  res.json(enriched);
});

app.post("/api/paths", async (req, res) => {
  const { name, dept_id, role_type, mode, rotation_hours, priority, max_capacity } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const maxOrd = await pool.query("SELECT MAX(sort_order) as m FROM paths");
  const sortOrder = (maxOrd.rows[0]?.m || 0) + 1;
  try {
    const result = await pool.query(
      `INSERT INTO paths (name, dept_id, role_type, mode, rotation_hours, priority, max_capacity, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [name, dept_id || null, role_type || "DIRECT", mode || "INBOUND", rotation_hours || 10, priority || 5, max_capacity || 999, sortOrder]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Path name exists" });
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/paths/:id", async (req, res) => {
  const fields = [];
  const values = [];
  const allowed = ["name", "role_type", "rotation_hours", "priority", "max_capacity", "active"];
  for (const f of allowed) {
    if (req.body[f] !== undefined) {
      fields.push(`${f} = $${fields.length + 1}`);
      values.push(req.body[f]);
    }
  }
  if (!fields.length) return res.status(400).json({ error: "Nothing to update" });
  values.push(req.params.id);
  try {
    await pool.query(`UPDATE paths SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/paths/:id", async (req, res) => {
  try {
    await pool.query("UPDATE paths SET active = false WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== LINES ==========
app.get("/api/lines", async (req, res) => {
  const { mode } = req.query;
  let query = `SELECT l.*, d.name as dept_name, d.mode,
    COUNT(s.id) as total_stations,
    SUM(CASE WHEN s.active THEN 1 ELSE 0 END) as active_stations,
    SUM(CASE WHEN s.active AND s.occupied THEN 1 ELSE 0 END) as occupied_stations
    FROM lines l
    JOIN departments d ON l.dept_id = d.id
    LEFT JOIN stations s ON s.line_id = l.id`;
  const params = [];
  if (mode) {
    query += " WHERE d.mode = $1";
    params.push(mode);
  }
  query += " GROUP BY l.id ORDER BY l.sort_order";
  const lines = (await pool.query(query, params)).rows;
  for (let i = 0; i < lines.length; i++) {
    const stations = await pool.query("SELECT * FROM stations WHERE line_id = $1 ORDER BY side, station_number", [lines[i].id]);
    lines[i].stations = stations.rows;
  }
  res.json(lines);
});

app.post("/api/lines", async (req, res) => {
  const { dept_id, name, side } = req.body;
  if (!dept_id || !name) return res.status(400).json({ error: "dept_id and name required" });
  const maxOrd = await pool.query("SELECT MAX(sort_order) as m FROM lines");
  const sortOrder = (maxOrd.rows[0]?.m || 0) + 1;
  try {
    const result = await pool.query(
      "INSERT INTO lines (dept_id, name, side, active, sort_order) VALUES ($1, $2, $3, true, $4) RETURNING id",
      [dept_id, name, side || "LOW", sortOrder]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/lines/:id", async (req, res) => {
  const fields = [];
  const values = [];
  if (req.body.name !== undefined) { fields.push("name = $1"); values.push(req.body.name); }
  if (req.body.active !== undefined) { fields.push("active = $" + (fields.length + 1)); values.push(req.body.active); }
  if (!fields.length) return res.status(400).json({ error: "Nothing to update" });
  values.push(req.params.id);
  try {
    await pool.query(`UPDATE lines SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/lines/:id", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE stations SET active = false WHERE line_id = $1", [req.params.id]);
    await client.query("DELETE FROM lines WHERE id = $1", [req.params.id]);
    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ========== STATIONS ==========
app.get("/api/stations", async (req, res) => {
  const { line_id } = req.query;
  let query = `SELECT s.*, l.name as line_name, d.name as dept_name, d.mode
    FROM stations s
    JOIN lines l ON s.line_id = l.id
    JOIN departments d ON l.dept_id = d.id
    WHERE 1=1`;
  const params = [];
  if (line_id) {
    query += " AND s.line_id = $1";
    params.push(line_id);
  }
  query += " ORDER BY l.sort_order, s.side, s.station_number";
  const result = await pool.query(query, params);
  res.json(result.rows);
});

app.post("/api/stations", async (req, res) => {
  const { line_id, name, side, station_number } = req.body;
  if (!line_id || !name) return res.status(400).json({ error: "line_id and name required" });
  const maxNum = await pool.query("SELECT MAX(station_number) as m FROM stations WHERE line_id = $1", [line_id]);
  const stationNum = station_number || (maxNum.rows[0]?.m || 0) + 1;
  try {
    const result = await pool.query(
      "INSERT INTO stations (line_id, name, side, station_number, active, occupied) VALUES ($1, $2, $3, $4, true, false) RETURNING id",
      [line_id, name, side || "ODD", stationNum]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/stations/:id", async (req, res) => {
  const fields = [];
  const values = [];
  if (req.body.name !== undefined) { fields.push("name = $1"); values.push(req.body.name); }
  if (req.body.active !== undefined) { fields.push("active = $" + (fields.length + 1)); values.push(req.body.active); }
  if (req.body.occupied !== undefined) {
    fields.push("occupied = $" + (fields.length + 1));
    values.push(req.body.occupied);
    if (!req.body.occupied) {
      fields.push("occupied_by = NULL");
      fields.push("occupied_since = NULL");
    }
  }
  if (req.body.side !== undefined) { fields.push("side = $" + (fields.length + 1)); values.push(req.body.side); }
  if (!fields.length) return res.status(400).json({ error: "Nothing to update" });
  values.push(req.params.id);
  try {
    await pool.query(`UPDATE stations SET ${fields.join(", ")} WHERE id = $${values.length}`, values);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/stations/bulk-toggle", async (req, res) => {
  const { ids, active } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: "ids must be array" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const id of ids) {
      await client.query("UPDATE stations SET active = $1 WHERE id = $2", [active, id]);
    }
    await client.query("COMMIT");
    res.json({ success: true, count: ids.length });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.delete("/api/stations/:id", async (req, res) => {
  try {
    await pool.query("UPDATE stations SET active = false, occupied = false, occupied_by = NULL WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== DEPARTMENTS ==========
app.get("/api/departments", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM departments WHERE active = true");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== SHIFT PLANS (placeholders) ==========
app.post("/api/plans/build", async (req, res) => { res.json({ planId: 1, message: "Plan built (placeholder)" }); });
app.get("/api/plans", async (req, res) => { const result = await pool.query("SELECT * FROM shift_plans ORDER BY created_at DESC LIMIT 10"); res.json(result.rows); });
app.get("/api/plans/:id", async (req, res) => {
  const plan = await pool.query("SELECT * FROM shift_plans WHERE id = $1", [req.params.id]);
  if (!plan.rows.length) return res.status(404).json({ error: "Plan not found" });
  const items = await pool.query(`SELECT spi.*, a.name, a.login, a.shift_code, a.operation_mode, a.home_dept
    FROM shift_plan_items spi JOIN associates a ON spi.badge = a.badge
    WHERE spi.plan_id = $1 ORDER BY spi.score DESC`, [req.params.id]);
  res.json({ ...plan.rows[0], items: items.rows });
});
app.post("/api/plans/:id/apply", async (req, res) => { res.json({ success: true, message: "Applied (placeholder)" }); });
app.delete("/api/plans/:id", async (req, res) => {
  await pool.query("DELETE FROM shift_plan_items WHERE plan_id = $1", [req.params.id]);
  await pool.query("DELETE FROM shift_plans WHERE id = $1", [req.params.id]);
  res.json({ success: true });
});

// ========== DASHBOARD ==========
app.get("/api/dashboard", async (req, res) => {
  const mode = (await getSetting("active_mode")) || "INBOUND";
  const shift = (await getSetting("active_shift")) || "FHD";
  const since8h = Math.floor(Date.now() / 1000) - 28800;
  const weekStart = getWeekStart();

  const totalAssoc = await pool.query("SELECT COUNT(*) as c FROM associates WHERE active = true");
  const onFloor = await pool.query("SELECT COUNT(*) as c FROM associates WHERE active = true AND current_path_id IS NOT NULL");
  const assigned = await pool.query("SELECT COUNT(DISTINCT badge) as c FROM assignments WHERE assigned_at > $1 AND path_name != 'GREEN MILE'", [since8h]);
  const greenMile = await pool.query("SELECT COUNT(*) as c FROM assignments WHERE assigned_at > $1 AND path_name = 'GREEN MILE'", [since8h]);
  const byDept = await pool.query(`SELECT a.home_dept, COUNT(DISTINCT asn.badge) as count
    FROM assignments asn JOIN associates a ON asn.badge = a.badge
    WHERE asn.assigned_at > $1 GROUP BY a.home_dept`, [since8h]);
  const topPaths = await pool.query(`SELECT path_name, COUNT(*) as count FROM assignments
    WHERE assigned_at > $1 AND path_name != 'GREEN MILE' GROUP BY path_name ORDER BY count DESC LIMIT 8`, [since8h]);
  const stationSummary = await pool.query(`SELECT l.name as line, COUNT(s.id) as total, SUM(s.occupied::int) as filled,
    SUM(CASE WHEN s.active THEN 1 ELSE 0 END) as active
    FROM stations s JOIN lines l ON s.line_id = l.id JOIN departments d ON l.dept_id = d.id
    WHERE d.mode = $1 GROUP BY l.id ORDER BY l.sort_order`, [mode]);
  const recentEvents = await pool.query("SELECT * FROM event_log ORDER BY created_at DESC LIMIT 25");
  const hoursLeaderboard = await pool.query(`SELECT a.name, a.login, a.badge, SUM(rh.hours) as total_hours
    FROM role_hours rh JOIN associates a ON rh.badge = a.badge
    WHERE rh.week_start >= CURRENT_DATE - 14
    GROUP BY rh.badge, a.name, a.login, a.badge ORDER BY total_hours DESC LIMIT 10`, []);
  const pathCapacity = await pool.query(`SELECT p.name, p.max_capacity, COUNT(a.id) as current_count
    FROM paths p LEFT JOIN associates a ON a.current_path_id = p.id AND a.active = true
    WHERE p.active = true AND (p.mode = $1 OR p.mode = 'BOTH') GROUP BY p.id ORDER BY p.sort_order`, [mode]);

  res.json({
    mode, shift,
    totalAssoc: parseInt(totalAssoc.rows[0].c),
    onFloor: parseInt(onFloor.rows[0].c),
    assigned: parseInt(assigned.rows[0].c),
    greenMile: parseInt(greenMile.rows[0].c),
    byDept: byDept.rows,
    topPaths: topPaths.rows,
    stationSummary: stationSummary.rows,
    recentEvents: recentEvents.rows,
    hoursLeaderboard: hoursLeaderboard.rows,
    pathCapacity: pathCapacity.rows,
  });
});

// ========== EVENTS, MOVE, RESET, FLOOR CUSTOM ==========
app.get("/api/events", async (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const result = await pool.query("SELECT * FROM event_log ORDER BY created_at DESC LIMIT $1", [limit]);
  res.json(result.rows);
});

app.post("/api/move", async (req, res) => {
  const { badge, station_id, moved_by } = req.body;
  const assoc = await pool.query("SELECT * FROM associates WHERE badge = $1", [badge]);
  if (!assoc.rows.length) return res.status(404).json({ error: "Not found" });
  const station = await pool.query("SELECT s.*, l.name as line_name FROM stations s JOIN lines l ON s.line_id = l.id WHERE s.id = $1 AND s.active = true", [station_id]);
  if (!station.rows.length) return res.status(404).json({ error: "Station not found" });
  if (station.rows[0].occupied) return res.status(409).json({ error: "Station occupied" });
  const now = Math.floor(Date.now() / 1000);
  if (assoc.rows[0].current_station_id) {
    await pool.query("UPDATE stations SET occupied = false, occupied_by = NULL, occupied_since = NULL WHERE id = $1", [assoc.rows[0].current_station_id]);
  }
  await pool.query("UPDATE stations SET occupied = true, occupied_by = $1, occupied_since = $2 WHERE id = $3", [assoc.rows[0].login, now, station_id]);
  await pool.query("UPDATE associates SET current_station_id = $1, current_path_start = $2 WHERE badge = $3", [station_id, now, badge]);
  await logEvent(badge, assoc.rows[0].login, "MANUAL_MOVE", `→ ${station.rows[0].name}`, await getSetting("active_mode"));
  res.json({ success: true });
});

app.post("/api/reset-shift", async (req, res) => {
  await pool.query("UPDATE stations SET occupied = false, occupied_by = NULL, occupied_since = NULL");
  await pool.query("UPDATE associates SET current_path_id = NULL, current_station_id = NULL, current_path_start = NULL");
  await pool.query("UPDATE assignments SET released_at = EXTRACT(EPOCH FROM NOW()) WHERE released_at IS NULL");
  await logEvent(null, null, "SYSTEM", "SHIFT_RESET", "All assignments cleared");
  res.json({ success: true });
});

app.get("/api/floor-custom-renames", async (req, res) => {
  const row = await pool.query("SELECT value FROM settings WHERE key = 'path_renames'");
  if (!row.rows.length) return res.json({ renames: {} });
  try {
    res.json({ renames: JSON.parse(row.rows[0].value) });
  } catch {
    res.json({ renames: {} });
  }
});

app.post("/api/floor-custom-renames", async (req, res) => {
  const { renames } = req.body;
  await pool.query("INSERT INTO settings (key, value) VALUES ('path_renames', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(renames || {})]);
  res.json({ success: true });
});

app.get("/api/floor-custom", async (req, res) => {
  const row = await pool.query("SELECT value FROM settings WHERE key = 'floor_custom'");
  if (!row.rows.length) return res.json({ paths: [], lines: [], stations: [] });
  try {
    res.json(JSON.parse(row.rows[0].value));
  } catch {
    res.json({ paths: [], lines: [], stations: [] });
  }
});

app.post("/api/floor-custom", async (req, res) => {
  const { paths, lines, stations } = req.body;
  const val = JSON.stringify({ paths: paths || [], lines: lines || [], stations: stations || [] });
  await pool.query("INSERT INTO settings (key, value) VALUES ('floor_custom', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [val]);
  res.json({ success: true });
});

async function startServer() {
  try {
    await initTables();
    const mode = await getSetting("active_mode") || "INBOUND";
    const shift = await getSetting("active_shift") || "FHD";
    app.listen(PORT, () => {
      console.log(`\n🏭 Monopoly 3.0 (PostgreSQL with RBAC & CRETS High Side 5h) — http://localhost:${PORT}`);
      console.log(`📍 TEN1 | Mode: ${mode} | Shift: ${shift}\n`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

startServer();
