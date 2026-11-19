import { build, context, type BuildOptions } from "esbuild";
import {
  mkdir,
  readFile,
  writeFile,
  copyFile,
  readdir,
  stat,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { once } from "node:events";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dev = process.argv.includes("--dev"),
  source = path.join(root, "public"),
  out = path.join(root, dev ? ".dev" : "dist");
await mkdir(out, { recursive: true });
async function copyAssets(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  const entries = await readdir(from, { withFileTypes: true });
  for (let i = 0; i < entries.length; i += 24)
    await Promise.all(
      entries
        .slice(i, i + 24)
        .map((entry) =>
          entry.isDirectory()
            ? copyAssets(path.join(from, entry.name), path.join(to, entry.name))
            : copyFile(path.join(from, entry.name), path.join(to, entry.name)),
        ),
    );
}
const options: BuildOptions = {
  entryPoints: [path.join(root, "src/main.ts")],
  bundle: true,
  format: "iife",
  minify: !dev,
  target: "es2022",
  outfile: path.join(out, "app.js"),
  write: false,
  plugins: [
    {
      name: "offline-worker",
      setup(ctx) {
        ctx.onResolve({ filter: /^embedded:decoder$/ }, () => ({
          path: "decoder",
          namespace: "worker",
        }));
        ctx.onLoad({ filter: /.*/, namespace: "worker" }, async () => {
          const file = path.join(root, "src/decoder.worker.ts");
          const result = await build({
            entryPoints: [file],
            bundle: true,
            format: "iife",
            minify: !dev,
            write: false,
          });
          return {
            contents: `export default ${JSON.stringify(result.outputFiles[0].text)}`,
            loader: "js",
            watchFiles: [file, path.join(root, "index.html")],
          };
        });
        ctx.onEnd(async (result) => {
          if (result.errors.length || !result.outputFiles) return;
          const template = await readFile(
              path.join(root, "index.html"),
              "utf8",
            ),
            code = result.outputFiles[0].text.replace(
              /<\/script/gi,
              "<\\/script",
            );
          await writeFile(
            path.join(out, "index.html"),
            template.replace("/*BUNDLE*/", () => code),
          );
        });
      },
    },
  ],
};
if (dev) {
  const buildContext = await context(options);
  await buildContext.rebuild();
  await buildContext.watch();
  const server = createServer(async (req, res) => {
    try {
      const name = decodeURIComponent(
        new URL(req.url ?? "/", "http://localhost").pathname,
      );
      const filename =
        name === "/" || name === "/index.html"
          ? path.join(out, "index.html")
          : path.resolve(source, "." + name);
      if (
        filename !== path.join(out, "index.html") &&
        !filename.startsWith(source + path.sep)
      ) {
        res.writeHead(403).end();
        return;
      }
      if (!(await stat(filename)).isFile()) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": filename.endsWith(".html")
          ? "text/html; charset=utf-8"
          : "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      });
      createReadStream(filename)
        .on("error", () => res.destroy())
        .pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  });
  const host = "127.0.0.1";
  const configuredPort = process.env.PORT;
  let port = Number(configuredPort ?? 5173);
  try {
    for (;;) {
      try {
        server.listen(port, host);
        await once(server, "listening");
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
        if (configuredPort !== undefined) {
          throw new Error(`指定的 PORT=${port} 已被占用，请更换端口或清除 PORT 后重试。`);
        }
        if (port === 65535) throw new Error("没有找到可用的开发端口。");
        console.log(`端口 ${port} 已被占用，尝试 ${port + 1}。`);
        port++;
      }
    }
    const address = server.address();
    if (address && typeof address !== "string") {
      console.log(`开发预览 http://${host}:${address.port}`);
    }
  } catch (error) {
    await buildContext.dispose();
    console.error("开发预览启动失败。", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
} else {
  await build(options);
  await copyAssets(source, out);
  console.log("已构建 dist/index.html");
}
