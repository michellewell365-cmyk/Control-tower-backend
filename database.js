const Database = require("better-sqlite3");
const path = require("path");
const DB_PATH = path.join(__dirname, "monopoly3.db");

function initDB() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      half TEXT NOT NULL,
      start_hour INTEGER NOT NULL,
      end_hour INTEGER NOT NULL,
      days TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      mode TEXT NOT NULL DEFAULT 'INBOUND',
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dept_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      side TEXT NOT NULL DEFAULT 'LOW',
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (dept_id) REFERENCES departments(id)
    );
    CREATE TABLE IF NOT EXISTS stations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      line_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      side TEXT NOT NULL DEFAULT 'ODD',
      station_number INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      occupied INTEGER NOT NULL DEFAULT 0,
      occupied_by TEXT,
      occupied_since INTEGER,
      FOREIGN KEY (line_id) REFERENCES lines(id)
    );
    CREATE TABLE IF NOT EXISTS paths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      dept_id INTEGER,
      role_type TEXT NOT NULL DEFAULT 'DIRECT',
      mode TEXT NOT NULL DEFAULT 'INBOUND',
      rotation_hours INTEGER NOT NULL DEFAULT 10,
      priority INTEGER NOT NULL DEFAULT 50,
      max_capacity INTEGER NOT NULL DEFAULT 999,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (dept_id) REFERENCES departments(id)
    );
    CREATE TABLE IF NOT EXISTS associates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      badge TEXT UNIQUE NOT NULL,
      login TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      home_dept TEXT NOT NULL,
      manager TEXT,
      shift_code TEXT,
      operation_mode TEXT NOT NULL DEFAULT 'INBOUND',
      current_path_id INTEGER,
      current_station_id INTEGER,
      current_path_start INTEGER,
      total_hours_today REAL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      badge TEXT NOT NULL,
      path_id INTEGER NOT NULL,
      lc_level INTEGER NOT NULL DEFAULT 1,
      UNIQUE(badge, path_id),
      FOREIGN KEY (badge) REFERENCES associates(badge),
      FOREIGN KEY (path_id) REFERENCES paths(id)
    );
    CREATE TABLE IF NOT EXISTS role_hours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      badge TEXT NOT NULL,
      path_id INTEGER NOT NULL,
      week_start TEXT NOT NULL,
      hours REAL NOT NULL DEFAULT 0,
      last_updated INTEGER,
      UNIQUE(badge, path_id, week_start),
      FOREIGN KEY (badge) REFERENCES associates(badge),
      FOREIGN KEY (path_id) REFERENCES paths(id)
    );
    CREATE TABLE IF NOT EXISTS yesterday_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      badge TEXT NOT NULL,
      path_id INTEGER NOT NULL,
      work_date TEXT NOT NULL,
      hours REAL NOT NULL DEFAULT 0,
      UNIQUE(badge, path_id, work_date),
      FOREIGN KEY (badge) REFERENCES associates(badge),
      FOREIGN KEY (path_id) REFERENCES paths(id)
    );
    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      badge TEXT NOT NULL,
      path_id INTEGER,
      path_name TEXT NOT NULL,
      station_id INTEGER,
      station_name TEXT,
      line_name TEXT,
      shift_code TEXT,
      mode TEXT DEFAULT 'INBOUND',
      score INTEGER,
      assigned_by TEXT DEFAULT 'AUTO',
      assigned_at INTEGER DEFAULT (strftime('%s','now')),
      released_at INTEGER,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      badge TEXT,
      login TEXT,
      event_type TEXT NOT NULL,
      detail TEXT,
      shift_code TEXT,
      mode TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS shift_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_code TEXT NOT NULL,
      mode TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      created_by TEXT DEFAULT 'MANAGER',
      status TEXT NOT NULL DEFAULT 'DRAFT',
      total_associates INTEGER DEFAULT 0,
      total_assigned INTEGER DEFAULT 0,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS shift_plan_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL,
      badge TEXT NOT NULL,
      path_id INTEGER,
      path_name TEXT NOT NULL,
      station_id INTEGER,
      station_name TEXT,
      line_name TEXT,
      score INTEGER DEFAULT 0,
      confirmed INTEGER DEFAULT 0,
      FOREIGN KEY (plan_id) REFERENCES shift_plans(id)
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split("T")[0];
}

function getYesterday(date = new Date()) {
  const d = new Date(date);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

function detectShift(db) {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  const shifts = db.prepare("SELECT * FROM shifts").all();
  for (const s of shifts) {
    const days = JSON.parse(s.days);
    if (!days.includes(day)) continue;
    if (s.type === "DAY" && hour >= s.start_hour && hour < s.end_hour) return s;
    if (s.type === "NIGHT" && (hour >= s.start_hour || hour < s.end_hour)) return s;
  }
  const stored = db.prepare("SELECT value FROM settings WHERE key='active_shift'").get();
  if (stored) return db.prepare("SELECT * FROM shifts WHERE code=?").get(stored.value);
  return shifts[0];
}

function seedDB(db) {
  const count = db.prepare("SELECT COUNT(*) as c FROM shifts").get();
  if (count.c > 0) return;

  // Shifts
  const iS = db.prepare("INSERT OR IGNORE INTO shifts (code,label,type,half,start_hour,end_hour,days) VALUES (?,?,?,?,?,?,?)");
  iS.run("FHD","Front Half Day","DAY","FRONT",6,18,JSON.stringify([0,1,2,3]));
  iS.run("BHD","Back Half Day","DAY","BACK",6,18,JSON.stringify([3,4,5,6]));
  iS.run("FHN","Front Half Night","NIGHT","FRONT",18,6,JSON.stringify([0,1,2,3]));
  iS.run("BHN","Back Half Night","NIGHT","BACK",18,6,JSON.stringify([3,4,5,6]));

  db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)").run("active_mode","INBOUND");
  db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)").run("active_shift","FHD");

  // Departments
  const iD = db.prepare("INSERT OR IGNORE INTO departments (name,mode) VALUES (?,?)");
  iD.run("CRETS Processing","INBOUND");
  iD.run("Warehouse Deals","INBOUND");
  iD.run("Tech Grading","INBOUND");
  iD.run("High Side CRETS","INBOUND");
  iD.run("Outbound Operations","OUTBOUND");
  const gd = n => db.prepare("SELECT id FROM departments WHERE name=?").get(n);

  // Paths with max_capacity
  const iP = db.prepare("INSERT OR IGNORE INTO paths (name,dept_id,role_type,mode,rotation_hours,priority,max_capacity,sort_order) VALUES (?,?,?,?,?,?,?,?)");
  let so = 0;
  iP.run("CRETS Processing",  gd("CRETS Processing").id,"DIRECT",  "INBOUND", 10,95,80,so++);
  iP.run("CRETS High Side",   gd("High Side CRETS").id, "DIRECT",  "INBOUND", 10,90,20,so++);
  iP.run("WHD Refurb",        gd("Warehouse Deals").id, "DIRECT",  "INBOUND", 10,85,30,so++);
  iP.run("Tech Grading",      gd("Tech Grading").id,    "DIRECT",  "INBOUND", 10,85,20,so++);
  iP.run("CRETS PA",          gd("CRETS Processing").id,"INDIRECT","INBOUND",  5,80,10,so++);
  iP.run("Waterspider",       gd("CRETS Processing").id,"INDIRECT","INBOUND",  5,70,12,so++);
  iP.run("Gatekeeper",        gd("CRETS Processing").id,"INDIRECT","INBOUND",  5,65, 4,so++);
  iP.run("Problem Solve",     gd("CRETS Processing").id,"INDIRECT","INBOUND",  5,60, 8,so++);
  iP.run("Process Guide",     gd("CRETS Processing").id,"INDIRECT","INBOUND",  5,55, 4,so++);
  iP.run("Dock",              gd("CRETS Processing").id,"INDIRECT","INBOUND",  5,50, 6,so++);
  iP.run("Audit",             gd("CRETS Processing").id,"INDIRECT","INBOUND",  5,50, 6,so++);
  iP.run("Pick Driver",       gd("Outbound Operations").id,"DIRECT","OUTBOUND",10,90,15,so++);
  iP.run("Stow Driver",       gd("Outbound Operations").id,"DIRECT","OUTBOUND",10,85,15,so++);
  iP.run("Pack Station 1",    gd("Outbound Operations").id,"DIRECT","OUTBOUND",10,80, 5,so++);
  iP.run("Pack Station 2",    gd("Outbound Operations").id,"DIRECT","OUTBOUND",10,80, 5,so++);
  iP.run("Pack Station 3",    gd("Outbound Operations").id,"DIRECT","OUTBOUND",10,80, 5,so++);
  iP.run("Pack Station 4",    gd("Outbound Operations").id,"DIRECT","OUTBOUND",10,80, 5,so++);
  iP.run("Pack Station 5",    gd("Outbound Operations").id,"DIRECT","OUTBOUND",10,80, 5,so++);
  iP.run("Pack Station 6",    gd("Outbound Operations").id,"DIRECT","OUTBOUND",10,80, 5,so++);
  iP.run("Liquidations",      gd("Outbound Operations").id,"INDIRECT","OUTBOUND",5,70,10,so++);
  iP.run("Step Processor",    gd("Outbound Operations").id,"INDIRECT","OUTBOUND",5,65, 8,so++);
  iP.run("Step & Step Processor",gd("Outbound Operations").id,"INDIRECT","OUTBOUND",5,65,8,so++);
  const gp = n => db.prepare("SELECT id FROM paths WHERE name=?").get(n);

  // Lines
  const iL = db.prepare("INSERT OR IGNORE INTO lines (dept_id,name,side,active,sort_order) VALUES (?,?,?,1,?)");
  const cid = gd("CRETS Processing").id, hid = gd("High Side CRETS").id;
  for (let i=1;i<=8;i++) iL.run(cid,`Line ${i}`,"LOW",i);
  iL.run(hid,"High Side Line 1","HIGH",1);
  iL.run(hid,"High Side Line 2","HIGH",2);
  const gl = n => db.prepare("SELECT id FROM lines WHERE name=?").get(n);

  // Stations
  const iSt = db.prepare("INSERT OR IGNORE INTO stations (line_id,name,side,station_number,active,occupied) VALUES (?,?,?,?,1,0)");
  for (let line=1;line<=8;line++) {
    const lid = gl(`Line ${line}`).id;
    for (let j=0;j<14;j++) { const n=j*2+1; iSt.run(lid,`${line}-${n}`,"ODD",n); }
    for (let j=0;j<14;j++) { const n=j*2+2; iSt.run(lid,`${line}-${n}`,"EVEN",n); }
  }
  for (let hs=1;hs<=2;hs++) {
    const lid = gl(`High Side Line ${hs}`).id;
    for (let j=1;j<=10;j++) iSt.run(lid,`HS${hs}-${j}`,j%2===0?"EVEN":"ODD",j);
  }

  // Associates — diverse LC levels to show realistic distribution
  // operation_mode: INBOUND | OUTBOUND | BOTH
  const iA = db.prepare("INSERT OR IGNORE INTO associates (badge,login,name,home_dept,manager,shift_code,operation_mode) VALUES (?,?,?,?,?,?,?)");
  const associates = [
    ["101181","moberete","Mory Berete","CRETS Processing","Johnson,Lainie","FHD","INBOUND"],
    ["172099","mroblero","Manuel Roblero","Warehouse Deals","Moore,Daniel","BHD","BOTH"],
    ["105011","pblakeld","Patricia Blake","FLEX","Schuh,Steve","FHD","BOTH"],
    ["239804","jcclaire","Justin Claire","CRETS Processing","Schuh,Steve","FHN","INBOUND"],
    ["347020","diha","Donna Iha","Warehouse Deals","Blackburn,Trisha","BHN","OUTBOUND"],
    ["115361","nickomil","Nick Miller","CRETS Processing","Moore,Daniel","FHD","INBOUND"],
    ["11762283","warrema","Matthew Warren","Warehouse Deals","Moore,Daniel","BHD","BOTH"],
    ["12880163","willefc","Clifford Willeford","CRETS Processing","Johnson,Lainie","FHD","INBOUND"],
    ["11353448","jenwheel","Jeni Wheeler","Tech Grading","Beckley,Jonathan","BHD","INBOUND"],
    ["11873356","dhunroha","Rohan Dhungana","CRETS Processing","Metz,Lenny","FHN","INBOUND"],
    ["400001","aalpha","Alex Alpha","CRETS Processing","Moore,Daniel","FHD","INBOUND"],
    ["400002","abeta","Blake Beta","Warehouse Deals","Johnson,Lainie","BHD","OUTBOUND"],
    ["400003","agamma","Casey Gamma","Tech Grading","Schuh,Steve","FHD","INBOUND"],
    ["400004","adelta","Dana Delta","CRETS Processing","Moore,Daniel","FHN","INBOUND"],
    ["400005","aepsilon","Ellis Epsilon","Warehouse Deals","Metz,Lenny","BHN","OUTBOUND"],
  ];
  for (const a of associates) iA.run(...a);

  // Permissions — varied LC levels (realistic distribution)
  const iPm = db.prepare("INSERT OR IGNORE INTO permissions (badge,path_id,lc_level) VALUES (?,?,?)");
  const perms = [
    // moberete - L5 CRETS expert, L4 high side
    ["101181","CRETS Processing",5],["101181","CRETS High Side",4],["101181","CRETS PA",4],["101181","Waterspider",3],["101181","Problem Solve",3],["101181","Gatekeeper",2],
    // mroblero - WHD/Tech + some outbound
    ["172099","WHD Refurb",5],["172099","Tech Grading",4],["172099","CRETS Processing",3],["172099","Waterspider",3],["172099","Pick Driver",4],["172099","Stow Driver",3],
    // pblakeld - FLEX, wide permissions
    ["105011","CRETS Processing",4],["105011","WHD Refurb",5],["105011","Audit",4],["105011","Problem Solve",3],["105011","Pack Station 1",3],["105011","Pack Station 2",3],
    // jcclaire - CRETS night, L5
    ["239804","CRETS Processing",5],["239804","CRETS High Side",3],["239804","Dock",4],["239804","CRETS PA",3],["239804","Gatekeeper",2],
    // diha - outbound specialist
    ["347020","WHD Refurb",3],["347020","Liquidations",4],["347020","Step Processor",3],["347020","Pick Driver",2],
    // nickomil - L4 CRETS, limited
    ["115361","CRETS Processing",4],["115361","Gatekeeper",3],["115361","Audit",3],["115361","Process Guide",2],
    // warrema - WHD + outbound
    ["11762283","WHD Refurb",5],["11762283","CRETS Processing",4],["11762283","Pick Driver",5],["11762283","Stow Driver",4],
    // willefc - L5 CRETS only
    ["12880163","CRETS Processing",5],["12880163","Waterspider",3],
    // jenwheel - Tech specialist
    ["11353448","Tech Grading",5],["11353448","WHD Refurb",4],["11353448","CRETS Processing",3],
    // dhunroha - mixed CRETS
    ["11873356","CRETS Processing",4],["11873356","CRETS High Side",3],["11873356","Dock",3],
    // sample associates - lower LC levels (realistic new hires)
    ["400001","CRETS Processing",2],["400001","Waterspider",1],
    ["400002","Liquidations",3],["400002","Step Processor",2],["400002","Pick Driver",1],
    ["400003","Tech Grading",5],["400003","WHD Refurb",3],["400003","CRETS Processing",2],
    ["400004","CRETS Processing",3],["400004","CRETS High Side",2],
    ["400005","Liquidations",4],["400005","Step Processor",3],["400005","Pack Station 1",2],
  ];
  for (const [badge, pathName, lc] of perms) {
    const p = gp(pathName); if (p) iPm.run(badge, p.id, lc);
  }

  // Yesterday roles
  const yesterday = getYesterday();
  const iY = db.prepare("INSERT OR IGNORE INTO yesterday_roles (badge,path_id,work_date,hours) VALUES (?,?,?,?)");
  const ydata = [
    ["101181","CRETS Processing",yesterday,9.5],
    ["172099","WHD Refurb",yesterday,8.0],
    ["105011","CRETS Processing",yesterday,5.0],["105011","WHD Refurb",yesterday,4.5],
    ["239804","CRETS Processing",yesterday,9.0],
    ["347020","Liquidations",yesterday,5.0],
    ["115361","CRETS Processing",yesterday,10.0],
    ["11762283","WHD Refurb",yesterday,7.5],["11762283","Pick Driver",yesterday,2.0],
    ["12880163","CRETS Processing",yesterday,9.5],
    ["11353448","Tech Grading",yesterday,9.0],
    ["11873356","CRETS Processing",yesterday,6.0],["11873356","CRETS High Side",yesterday,3.5],
    ["400001","CRETS Processing",yesterday,8.0],
    ["400003","Tech Grading",yesterday,9.0],
    ["400004","CRETS Processing",yesterday,8.5],
  ];
  for (const [badge, pathName, date, hours] of ydata) {
    const p = gp(pathName); if (p) iY.run(badge, p.id, date, hours);
  }

  // Week hours
  const weekStart = getWeekStart();
  const iH = db.prepare("INSERT OR REPLACE INTO role_hours (badge,path_id,week_start,hours) VALUES (?,?,?,?)");
  const hdata = [
    ["101181","CRETS Processing",weekStart,28.5],["101181","CRETS PA",weekStart,6.0],["101181","Waterspider",weekStart,2.5],
    ["172099","WHD Refurb",weekStart,24.0],["172099","Pick Driver",weekStart,8.0],
    ["105011","CRETS Processing",weekStart,15.0],["105011","WHD Refurb",weekStart,13.5],
    ["239804","CRETS Processing",weekStart,27.0],["239804","CRETS High Side",weekStart,3.0],
    ["347020","Liquidations",weekStart,20.0],["347020","Step Processor",weekStart,8.5],
    ["115361","CRETS Processing",weekStart,30.0],
    ["11762283","WHD Refurb",weekStart,22.5],["11762283","Pick Driver",weekStart,7.5],
    ["12880163","CRETS Processing",weekStart,29.0],
    ["11353448","Tech Grading",weekStart,27.0],["11353448","WHD Refurb",weekStart,3.0],
    ["11873356","CRETS Processing",weekStart,18.0],["11873356","CRETS High Side",weekStart,10.5],
    ["400001","CRETS Processing",weekStart,16.0],
    ["400003","Tech Grading",weekStart,20.0],
    ["400004","CRETS Processing",weekStart,12.0],
  ];
  for (const [badge, pathName, week, hours] of hdata) {
    const p = gp(pathName); if (p) iH.run(badge, p.id, week, hours);
  }

  console.log("✅ Monopoly 3.0 database seeded — TEN1");
}

module.exports = { initDB, seedDB, detectShift, getWeekStart, getYesterday };
