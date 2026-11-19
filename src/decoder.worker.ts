import { gunzipSync, strFromU8 } from "fflate";
import type { Packet } from "./types.ts";
const scope = self as unknown as {
  onmessage:
    | ((
        event: MessageEvent<{ id: number; key: string; payload: string }>,
      ) => void)
    | null;
  postMessage: (data: unknown, transfer?: Transferable[]) => void;
};
scope.onmessage = ({ data: { id, payload } }) => {
  try {
    const binary = atob(payload),
      compressed = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++)
      compressed[i] = binary.charCodeAt(i);
    const packet: Packet = JSON.parse(strFromU8(gunzipSync(compressed)));
    const transfer: ArrayBuffer[] = [];
    const decode = (raw: string) => {
      const text = atob(raw),
        out = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
      transfer.push(out.buffer);
      return out;
    };
    if (!Array.isArray(packet)) {
      if ("b" in packet) {
        packet.c = decode(String(packet.c));
        if (packet.extra) packet.extra = decode(String(packet.extra));
        for (const row of packet.b) row[2] = decode(String(row[2]));
        for (const g of packet.g)
          for (const k of ["p", "n", "uv", "c", "i"] as const)
            g[k] = decode(String(g[k]));
      } else if ("body" in packet || "attrs" in packet) {
        const geom = "body" in packet ? packet.body : packet;
        for (const a of Object.values(geom.attrs)) a[2] = decode(String(a[2]));
        if (geom.indices) geom.indices[2] = decode(String(geom.indices[2]));
      }
    }
    scope.postMessage({ id, packet }, transfer);
  } catch (error) {
    scope.postMessage({ id, error: String(error) });
  }
};
