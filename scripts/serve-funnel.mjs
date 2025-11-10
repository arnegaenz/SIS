import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const DAILY_DIR = path.join(__dirname, "..", "data", "daily");
const REGISTRY_FILE = path.join(__dirname, "..", "fi_registry.json");

function sendJson(res, obj) {
  const json = JSON.stringify(obj, null, 2);
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(json);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname === "/" || pathname === "/index.html") {
    const filePath = path.join(PUBLIC_DIR, "funnel.html");
    try {
      const html = fs.readFileSync(filePath, "utf8");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    } catch (err) {
      res.writeHead(500);
      res.end("funnel.html not found");
    }
    return;
  }

  if (pathname === "/list-daily") {
    try {
      const files = fs
        .readdirSync(DAILY_DIR)
        .filter((f) => f.endsWith(".json"))
        .sort();
      sendJson(res, { files });
    } catch (err) {
      res.writeHead(500);
      res.end("Could not list daily files");
    }
    return;
  }

  if (pathname === "/daily") {
    const date = url.searchParams.get("date");
    if (!date) {
      res.writeHead(400);
      res.end("Missing date param");
      return;
    }
    const filePath = path.join(DAILY_DIR, `${date}.json`);
    if (!fs.existsSync(filePath)) {
      sendJson(res, { error: "not found", date });
      return;
    }
    const data = fs.readFileSync(filePath, "utf8");
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(data);
    return;
  }

  if (pathname === "/fi-registry") {
    if (!fs.existsSync(REGISTRY_FILE)) {
      sendJson(res, { error: "fi_registry.json not found" });
      return;
    }
    const data = fs.readFileSync(REGISTRY_FILE, "utf8");
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(data);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Funnel server running at http://localhost:${PORT}`);
});
