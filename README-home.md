# 自宅サーバー経由で再生する
1. 自宅PCに Node.js 18以上を入れる
2. このフォルダで:  YT_SECRET=合言葉 node home/yt-home.mjs   (Windows PowerShell: $env:YT_SECRET="合言葉"; node home/yt-home.mjs)
3. 別の窓で外部公開:  cloudflared tunnel --url http://localhost:8787  → 表示された https://〇〇.trycloudflare.com をコピー
   (起動のたびにURLが変わります。固定したい場合は Cloudflare の Named Tunnel を使う)
4. Cloudflare の Worker → Settings → Variables and Secrets に、種類「Secret」で追加
   YT_HOME = 上のURL / YT_SECRET = 合言葉  → Deploy
5. /api/yt/debug?id=dQw4w9WgXcQ を開き、clients の status が OK になっているか確認
