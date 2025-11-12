
import { startHttp } from "../src/http_adapter.ts";
await startHttp({ baseDir: ".trinkets", port: 8787, cache: "kv", validateEvents: true, cors: { origin: "*" }, etag: "weak" });
