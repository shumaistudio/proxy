// 最小のサービスワーカー: インストール要件を満たすためのもの。
// キャッシュはせず、すべて通常どおりネットワークへ流す(プロキシの内容を古く見せないため)。
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
