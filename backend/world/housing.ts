import type { DatabaseSync } from "node:sqlite";
export function housingMarket(
  db: DatabaseSync,
  plots: readonly { x: number; z: number }[],
) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS housing_projects(plot INTEGER PRIMARY KEY,sponsor INTEGER NOT NULL,roof TEXT,yard TEXT,occupant INTEGER UNIQUE,claimed_at TEXT);CREATE UNIQUE INDEX IF NOT EXISTS one_unfinished_per_sponsor ON housing_projects(sponsor) WHERE yard IS NULL`,
  );
  function candidates(uid: number) {
    const projects = db
      .prepare(
        "SELECT plot,sponsor,roof IS NOT NULL AS roof,yard IS NOT NULL AS yard FROM housing_projects",
      )
      .all();
    const occupied = new Set(
      db
        .prepare("SELECT no-1 AS plot FROM citizens")
        .all()
        .map((r) => Number(r.plot)),
    );
    const reserved = new Map(projects.map((p) => [Number(p.plot), p]));
    const mine = projects.find((p) => p.sponsor === uid && !p.yard);
    return plots.flatMap((p, id) => {
      const project = reserved.get(id);
      if (
        id === 0 ||
        occupied.has(id) ||
        (mine && mine.plot !== id) ||
        (project && (project.sponsor !== uid || project.yard))
      )
        return [];
      return [
        {
          id,
          x: p.x,
          z: p.z,
          district: p.x < 0 ? "城西" : "城东",
          quarter: p.z < 0 ? "北坊" : "南坊",
          mine: !!project,
          stage: project?.roof ? "yard" : "roof",
        },
      ];
    });
  }
  // Called under the same BEGIN IMMEDIATE as task reservation.
  function prepare(uid: number, plot: number) {
    if (!Number.isSafeInteger(plot) || plot <= 0 || plot >= plots.length)
      throw Error("请选择有效的待修缮住宅");
    if (db.prepare("SELECT no FROM citizens WHERE no=?").get(plot + 1))
      throw Error("这套住宅已有人入住，请重新选房");
    const selected = db
      .prepare("SELECT * FROM housing_projects WHERE plot=?")
      .get(plot);
    if (selected) {
      if (selected.yard) throw Error("这套住宅已修缮完毕，请重新选房");
      if (selected.sponsor !== uid)
        throw Error("这套住宅已被其他公民接取，请重新选房");
      return selected;
    }
    const current = db
      .prepare(
        "SELECT plot FROM housing_projects WHERE sponsor=? AND yard IS NULL",
      )
      .get(uid);
    if (current) throw Error(`请先完成 ${Number(current.plot) + 1} 号院的修缮`);
    db.prepare("INSERT INTO housing_projects(plot,sponsor) VALUES(?,?)").run(
      plot,
      uid,
    );
    return db.prepare("SELECT * FROM housing_projects WHERE plot=?").get(plot)!;
  }
  function listings(uid: number) {
    const member = db.prepare("SELECT no FROM citizens WHERE uid=?").get(uid);
    const homes = db
      .prepare(
        `SELECT p.plot,u.name AS sponsor FROM housing_projects p JOIN users u ON u.id=p.sponsor WHERE p.roof IS NOT NULL AND p.yard IS NOT NULL AND p.occupant IS NULL AND p.sponsor<>? ORDER BY p.plot`,
      )
      .all(uid)
      .map((r) => {
        const p = plots[Number(r.plot)];
        const district = p.x < 0 ? "城西" : "城东",
          quarter = p.z < 0 ? "北坊" : "南坊";
        return {
          id: Number(r.plot),
          district,
          quarter,
          sponsor: r.sponsor,
          x: p.x,
          z: p.z,
        };
      });
    const project = db
      .prepare(
        "SELECT plot,roof IS NOT NULL AS roof FROM housing_projects WHERE sponsor=? AND yard IS NULL",
      )
      .get(uid);
    return {
      vacantCount: Number(
        db
          .prepare(
            "SELECT COUNT(*) n FROM housing_projects WHERE roof IS NOT NULL AND yard IS NOT NULL AND occupant IS NULL",
          )
          .get()!.n,
      ),
      member: !!member,
      home: member ? Number(member.no) - 1 : null,
      homes,
      project,
    };
  }
  function claim(uid: number, plot: number) {
    if (!Number.isSafeInteger(plot) || plot < 0 || plot >= plots.length)
      throw Error("住宅无效");
    const existing = db.prepare("SELECT no FROM citizens WHERE uid=?").get(uid);
    if (existing) {
      if (Number(existing.no) === plot + 1) return;
      throw Error("你已经有住所");
    }
    const h = db
      .prepare(
        "SELECT * FROM housing_projects WHERE plot=? AND sponsor<>? AND roof IS NOT NULL AND yard IS NOT NULL AND occupant IS NULL",
      )
      .get(plot, uid);
    if (!h) throw Error("该住宅尚未修缮完毕，或已有人入住");
    db.prepare(
      "UPDATE housing_projects SET occupant=?,claimed_at=CURRENT_TIMESTAMP WHERE plot=? AND occupant IS NULL",
    ).run(uid, plot);
    db.prepare(
      "INSERT INTO citizens(no,uid,paid,roof,yard) VALUES(?,?,?,?,?)",
    ).run(
      plot + 1,
      uid,
      Math.floor((Date.now() + 8 * 3600000) / 86400000) - 1,
      h.roof,
      h.yard,
    );
  }
  return { prepare, listings, claim, candidates };
}
