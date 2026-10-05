# 動画モードについて (APIキー不要)
- 検索: YouTubeの検索結果ページをWorkerが取得して解析 (/api/yt/search)
- 再生: Workerが動画URLを取得して中継 (/api/yt/stream?id=動画ID)
- 診断: 再生できないとき → /api/yt/debug?id=動画ID を開き、表示されたJSONを確認
