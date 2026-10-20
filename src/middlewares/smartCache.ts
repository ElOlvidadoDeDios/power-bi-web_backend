import { Request, Response, NextFunction } from "express";
import { pool } from "../lib/db";

interface CacheBucket {
  version: string;
  store: Map<string, any>;
}

const cacheETL: CacheBucket = { version: "", store: new Map() };
const cacheDaemon: CacheBucket = { version: "", store: new Map() };

// Guarda las rutas reales que los servicios del frontend solicitan para pre-calentarlas sin errores 404
const knownEtlRoutes = new Set<string>(["/api/filtros"]);
let lastKnownBaseUrl = `http://localhost:${process.env.PORT || 3000}`;

let isChecking = false;
let isPrewarming = false;

async function getDWHVersions(): Promise<{ versionETL: string; versionDaemon: string } | null> {
  try {
    const result = await pool.request().query(`
      SELECT 
        CONVERT(VARCHAR(30), (SELECT TOP 1 [UltimaActualizacion] FROM [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] WHERE [Id] = 1), 126) AS VersionETL,
        CONVERT(VARCHAR(30), (SELECT MAX([Fecha_Calculo]) FROM [DWH_Gestion_Cartera].[dbo].[ranking_asesor_10]), 126) AS VersionDaemon
    `);
    const row = result.recordset?.[0];
    if (!row) return null;

    return {
      versionETL: String(row.VersionETL || "v1"),
      versionDaemon: String(row.VersionDaemon || "v1"),
    };
  } catch (err) {
    console.error("⚠️ [SmartCache] Error leyendo semáforo SQL:", err);
    return null;
  }
}

// 💡 FUNCIÓN AUXILIAR DE LOTES (CONTROL DE CONCURRENCIA)
async function runInBatches<T>(items: T[], batchSize: number, fn: (item: T) => Promise<any>): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.allSettled(
      batch.map(item => fn(item).catch(err => {
        console.error(`[SmartCache] Error refrescando ruta individual:`, err?.message || err);
      }))
    );
  }
}

async function refreshKnownRoutes(newVersionETL: string) {
  if (isPrewarming) return;
  isPrewarming = true;

  const routesToWarm = Array.from(knownEtlRoutes);
  console.log(`🔥 [SmartCache] Refrescando ${routesToWarm.length} rutas activas en RAM de forma controlada...`);
  const start = Date.now();

  try {
    // Limpiamos para que las nuevas lecturas reemplacen con datos frescos del ETL
    cacheETL.store.clear();
    cacheETL.version = newVersionETL;

    // 👈 AQUÍ APLICAMOS LOS LOTES DE 5 EN 5 EN LUGAR DE DISPARAR TODO JUNTO
    await runInBatches(routesToWarm, 5, async (route) => {
      await fetch(`${lastKnownBaseUrl}${route}`, {
        headers: { "x-internal-prewarm": "true" },
      });
    });

    console.log(`✅ [SmartCache] RAM actualizada en ${((Date.now() - start) / 1000).toFixed(2)}s.`);
  } catch (err) {
    console.error("⚠️ [SmartCache] Error en refresco de caché:", err);
  } finally {
    isPrewarming = false;
  }
}

export function startCacheWatcher() {
  const checkLoop = async () => {
    if (isChecking) return;
    isChecking = true;
    try {
      const info = await getDWHVersions();
      if (!info) return;

      if (cacheDaemon.version !== info.versionDaemon) {
        console.log(`🔄 [SmartCache] Nuevo cálculo de Ranking detectado (${info.versionDaemon}).`);
        cacheDaemon.store.clear();
        cacheDaemon.version = info.versionDaemon;
      }

      if (cacheETL.version !== info.versionETL) {
        console.log(`🔄 [SmartCache] Nueva carga ETL detectada (${info.versionETL}).`);
        await refreshKnownRoutes(info.versionETL);
      }
    } finally {
      isChecking = false;
    }
  };

  setTimeout(checkLoop, 1500);
  setInterval(checkLoop, 20000);
}

export async function smartCacheMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.method !== "GET" || req.path.includes("health")) {
    return next();
  }

  // Capturamos automáticamente el puerto real donde corre el backend (ej. localhost:3000)
  const host = req.headers.host;
  if (host) {
    lastKnownBaseUrl = `http://localhost:${host.split(":")[1] || process.env.PORT || 3000}`;
  }

  if (req.path.endsWith("/cache-clear")) {
    cacheETL.store.clear();
    cacheDaemon.store.clear();
    return res.json({ ok: true, message: "Caché limpiado manualmente" });
  }

  const isDaemonRoute = req.path.includes("ranking") || req.path.includes("preventiva");
  const activeBucket = isDaemonRoute ? cacheDaemon : cacheETL;
  const cacheKey = req.originalUrl;
  const isInternalPrewarm = req.headers["x-internal-prewarm"] === "true";

  if (!isInternalPrewarm && activeBucket.store.has(cacheKey)) {
    res.setHeader("X-Cache", "HIT");
    res.setHeader("X-Data-Version", activeBucket.version);
    return res.json(activeBucket.store.get(cacheKey));
  }

  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    if (res.statusCode >= 200 && res.statusCode < 300 && !body?.error) {
      activeBucket.store.set(cacheKey, body);
      if (!isDaemonRoute) {
        knownEtlRoutes.add(cacheKey);
      }
    }
    res.setHeader("X-Cache", isInternalPrewarm ? "PREWARM" : "MISS");
    res.setHeader("X-Data-Version", activeBucket.version);
    return originalJson(body);
  };

  next();
}