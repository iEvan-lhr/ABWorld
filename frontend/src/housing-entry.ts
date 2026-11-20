interface Listing {
  id: number;
  district: string;
  quarter: string;
  sponsor: string;
  x: number;
  z: number;
}
export async function chooseHousing(
  name: string,
): Promise<{ x: number; z: number } | null> {
  const status = async () => {
    const r = await fetch("/api/civic/housing", { cache: "no-store" });
    const v = await r.json();
    if (!r.ok) throw Error(v.error ?? "住房清单读取失败");
    return v as { member: boolean; homes: Listing[] };
  };
  let data = await status();
  if (data.member) return null;
  const form = document.getElementById("authForm")!,
    mode = document.getElementById("authMode")!,
    wrap = document.getElementById("housingEntry")!,
    list = document.getElementById("housingList")!,
    hint = document.getElementById("housingHint")!,
    filter = document.getElementById("housingDistrict") as HTMLSelectElement;
  form.hidden = mode.hidden = true;
  document.getElementById("authHint")!.textContent = "";
  document.getElementById("gateTitle")!.textContent = "选择住宅";
  wrap.hidden = false;
  document.getElementById("housingUser")!.textContent = name;
  return new Promise((resolve) => {
    let working = false;
    function draw() {
      list.replaceChildren();
      const groups = [
          ...new Set(data.homes.map((h) => h.district + " · " + h.quarter)),
        ],
        selected = filter.value;
      filter.replaceChildren(
        new Option("所有街坊", ""),
        ...groups.map((g) => new Option(g, g)),
      );
      if (groups.includes(selected)) filter.value = selected;
      for (const h of data.homes.filter(
        (h) => !filter.value || h.district + " · " + h.quarter === filter.value,
      )) {
        const card = document.createElement("article"),
          title = document.createElement("strong"),
          desc = document.createElement("p"),
          claim = document.createElement("button");
        title.textContent = `${h.district} · ${h.quarter}　${h.id + 1} 号院`;
        desc.textContent = `修缮人 ${h.sponsor}　·　檐廊与院落已验收`;
        claim.textContent = "选择并入住";
        claim.onclick = async () => {
          if (working) return;
          working = true;
          claim.disabled = true;
          try {
            const r = await fetch("/api/civic/housing/claim/" + h.id, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
              }),
              v = await r.json();
            if (!r.ok) throw Error(v.error);
            wrap.hidden = true;
            clearInterval(timer);
            resolve({ x: h.x, z: h.z + 15.8 });
          } catch (e) {
            working = false;
            await refresh();
            hint.textContent = (e as Error).message;
          } finally {
            claim.disabled = false;
          }
        };
        card.append(title, desc, claim);
        list.append(card);
      }
      hint.textContent = data.homes.length
        ? "入住后领取首日 50 工。"
        : "城里暂时没有修缮完毕的空宅。新房源会自动出现。";
    }
    async function refresh() {
      if (working || document.hidden) return;
      try {
        data = await status();
        if (data.member) {
          clearInterval(timer);
          wrap.hidden = true;
          resolve(null);
          return;
        }
        draw();
      } catch (e) {
        hint.textContent = (e as Error).message;
      }
    }
    const timer = setInterval(refresh, 12000);
    filter.onchange = draw;
    document.getElementById("housingRefresh")!.onclick = refresh;
    document.getElementById("housingLogout")!.onclick = async () => {
      const r = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (r.ok) location.reload();
    };
    draw();
  });
}
