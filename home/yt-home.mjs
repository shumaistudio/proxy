// 自宅PC用: YouTubeへの問い合わせと動画の中継だけを担当する小さなサーバー (Node.js 18以上)
// 起動: YT_SECRET=好きな合言葉 node home/yt-home.mjs   (ポート: PORT, 既定 8787)
import http from "node:http";
import { Readable } from "node:stream";
import { handleYtStream, handleYtDebug } from "../src/yt.js";

const SECRET = process.env.YT_SECRET || "";
const PORT = Number(process.env.PORT || 8787);

http.createServer(async (req, res) => {
  try {
    if (SECRET && req.headers["x-yt-secret"] !== SECRET) return res.writeHead(403).end("forbidden");
    const url = new URL(req.url, "http://localhost");
    const headers = {};
    if (req.headers.range) headers.range = req.headers.range;
    const request = new Request(url, { headers });

    let r;
    if (url.pathname === "/api/yt/stream") r = await handleYtStream(request);
    else if (url.pathname === "/api/yt/debug") r = await handleYtDebug(request);
    else return res.writeHead(404).end("not found");

    res.writeHead(r.status, Object.fromEntries(r.headers));
    if (!r.body) return res.end();
    const src = Readable.fromWeb(r.body);
    res.on("close", () => src.destroy());
    src.on("error", () => res.end()).pipe(res);
  } catch (e) {
    res.writeHead(500).end("error: " + e.message);
  }
}).listen(PORT, () => console.log("yt-home listening on :" + PORT));
