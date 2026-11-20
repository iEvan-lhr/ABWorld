import type { DatabaseSync } from "node:sqlite";
export function housingMarket(
  db: DatabaseSync,
  plots: readonly { x: number; z: number }[],
) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS housing_projects(plot INTEGER PRIMARY KEY,sponsor INTEGER NOT NULL,roof TEXT,yard TEXT,occupant INTEGER UNIQUE,claimed_at TEXT);CREATE UNIQUE INDEX IF NOT EXISTS one_unfinished_per_sponsor ON housing_projects(sponsor) WHERE yard IS NULL`,
  );
  function prepare(uid: number) {
    const current = db
      .prepare(
        "SELECT * FROM housing_projects WHERE sponsor=? AND yard IS NULL",
      )
      .get(uid);
    if (current) return current;
    const used = new Set(
      db
        .prepare(
          "SELECT no-1 AS plot FROM citizens UNION SELECT plot FROM housing_projects",
        )
        .all()
        .map((r) => Number(r.plot)),
    );
    const plot = plots.findIndex((_, i) => i > 0 && !used.has(i));
    if (plot < 0) throw Error("当前可修缮的宅地已用完");
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
  return { prepare, listings, claim };
}
