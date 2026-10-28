// D:\Proyectos\power-bi-web_backend\src\middlewares\smartCache.ts
import { Request, Response, NextFunction } from "express";
import { pool } from "../lib/db";

export type BucketName = "etl" | "gerencial" | "ranking" | "mora" | "vivo";

interface CacheBucket {
  idLog: number;
  name: BucketName;
  version: string;
  lastFormattedDate: string;
  description: string;
  store: Map<string, any>;
  knownRoutes: Set<string>;
}

const buckets: Record<BucketName, CacheBucket> = {
  etl: {
    idLog: 1,
    name: "etl",
    version: "",
    lastFormattedDate: "Sincronizando...",
    description: "ETL Principal DWH (Cartera, Flujo, Stock y Metas)",
    store: new Map(),
    knownRoutes: new Set(),
  },
  gerencial: {
    idLog: 2,
    name: "gerencial",
    version: "",
    lastFormattedDate: "Sincronizando...",
    description: "Actualizador Gerencial (Cancelados y Avance)",
    store: new Map(),
    knownRoutes: new Set(),
  },
  ranking: {
    idLog: 3,
    name: "ranking",
    version: "",
    lastFormattedDate: "Sincronizando...",
    description: "Ranking Comercial de Asesores",
    store: new Map(),
    knownRoutes: new Set(["/api/ranking"]),
  },
  mora: {
    idLog: 4,
    name: "mora",
    version: "",
    lastFormattedDate: "Sincronizando...",
    description: "Motor de Mora, Compromisos e IA Preventiva",
    store: new Map(),
    knownRoutes: new Set(["/api/mora", "/api/pagos-mora"]),
  },
  vivo: {
    idLog: 5,
    name: "vivo",
    version: "",
    lastFormattedDate: "Sincronizando...",
    description: "Productividad en Vivo (Transacmif)",
    store: new Map(),
    knownRoutes: new Set(["/api/productividad-en-vivo"]),
  },
};

let lastKnownBaseUrl = `http://localhost:${process.env.PORT || 3000}`;
let isChecking = false;

// Clasifica cada petición entrante en su propio caché independiente
export function resolveBucket(path: string): CacheBucket {
  const p = path.toLowerCase();
  if (p.includes("productividad-en-vivo")) {
    return buckets.vivo;
  }
  if (p.includes("cancelados") || p.includes("avance")) {
    return buckets.gerencial;
  }
  if (p.includes("ranking")) {
    return buckets.ranking;
  }
  if (p.includes("mora") || p.includes("preventiva")) {
    return buckets.mora;
  }
  return buckets.etl;
}

// Lee los 5 registros de Log_Actualizacion en 1 sola consulta ligera
async function syncVersionsFromDatabase(): Promise<boolean> {
  try {
    const result = await pool.request().query(`
      SELECT
        [Id],
        CONVERT(VARCHAR(30), [UltimaActualizacion], 126) AS VersionIso,
        FORMAT([UltimaActualizacion], 'dd/MM/yyyy · HH:mm:ss', 'es-PE') AS FechaFormateada,
        ISNULL([Descripcion], '') AS Descripcion
      FROM [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] WITH (NOLOCK)
      WHERE [Id] IN (1, 2, 3, 4, 5)
    `);

    const rows = result.recordset || [];
    const mapById = new Map<number, any>();
    rows.forEach((r: any) => mapById.set(Number(r.Id), r));

    let anyChanged = false;

    for (const key of ["etl", "gerencial", "ranking", "mora", "vivo"] as BucketName[]) {
      const bucket = buckets[key];
      const row = mapById.get(bucket.idLog);
      if (!row) continue;

      const latestVer = String(row.VersionIso || "v1");
      bucket.lastFormattedDate = String(row.FechaFormateada || "");
      if (row.Descripcion) {
        bucket.description = String(row.Descripcion);
      }

      if (bucket.version !== latestVer) {
        console.log(
          `🔄 [SmartCache:${key.toUpperCase()} | Id=${bucket.idLog}] Cambio detectado (${bucket.lastFormattedDate}). Refrescando solo sus tablas...`
        );
        await refreshBucketRoutes(bucket, latestVer);
        anyChanged = true;
      }
    }

    return anyChanged;
  } catch (err) {
    console.error("⚠️ [SmartCache] Error leyendo versiones SQL:", err);
    return false;
  }
}

async function refreshBucketRoutes(bucket: CacheBucket, newVersion: string) {
  const routesToWarm = Array.from(bucket.knownRoutes);
  bucket.store.clear();
  bucket.version = newVersion;

  if (routesToWarm.length === 0) return;

  const start = Date.now();
  for (let i = 0; i < routesToWarm.length; i += 4) {
    const batch = routesToWarm.slice(i, i + 4);
    await Promise.allSettled(
      batch.map((route) =>
        fetch(`${lastKnownBaseUrl}${route}`, {
          headers: { "x-internal-prewarm": "true" },
        }).catch(() => {})
      )
    );
  }
  console.log(
    `✅ [SmartCache:${bucket.name.toUpperCase()}] ${routesToWarm.length} rutas actualizadas en RAM en ${((Date.now() - start) / 1000).toFixed(2)}s.`
  );
}

export function startCacheWatcher() {
  const checkLoop = async () => {
    if (isChecking) return;
    isChecking = true;
    try {
      await syncVersionsFromDatabase();
    } finally {
      isChecking = false;
    }
  };

  setTimeout(checkLoop, 1000);
  setInterval(checkLoop, 10000); // Revisa Log_Actualizacion cada 10s (consulta de 5 filas en <1ms)
}

// Firma de 5 partes: etl|gerencial|ranking|mora|vivo
export function getCombinedVersionSignature(): string {
  return `${buckets.etl.version}|${buckets.gerencial.version}|${buckets.ranking.version}|${buckets.mora.version}|${buckets.vivo.version}`;
}

// Devuelve el estado detallado de los 5 logs para el frontend sin golpear la BD
export function getLogsStatusByBucket() {
  return {
    etl: {
      id: 1,
      descripcion: buckets.etl.description,
      fechaHora: buckets.etl.lastFormattedDate,
      etiqueta: `ETL Principal DWH: ${buckets.etl.lastFormattedDate}`,
      version: buckets.etl.version,
    },
    gerencial: {
      id: 2,
      descripcion: buckets.gerencial.description,
      fechaHora: buckets.gerencial.lastFormattedDate,
      etiqueta: `Cancelados y Avance: ${buckets.gerencial.lastFormattedDate}`,
      version: buckets.gerencial.version,
    },
    ranking: {
      id: 3,
      descripcion: buckets.ranking.description,
      fechaHora: buckets.ranking.lastFormattedDate,
      etiqueta: `Ranking Comercial: ${buckets.ranking.lastFormattedDate}`,
      version: buckets.ranking.version,
    },
    mora: {
      id: 4,
      descripcion: buckets.mora.description,
      fechaHora: buckets.mora.lastFormattedDate,
      etiqueta: `Gestión de Mora e IA: ${buckets.mora.lastFormattedDate}`,
      version: buckets.mora.version,
    },
    vivo: {
      id: 5,
      descripcion: buckets.vivo.description,
      fechaHora: buckets.vivo.lastFormattedDate,
      etiqueta: `Productividad en Vivo (Transacmif): ${buckets.vivo.lastFormattedDate}`,
      version: buckets.vivo.version,
    },
  };
}

export async function smartCacheMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.method !== "GET" || req.path.includes("health")) {
    return next();
  }

  const host = req.headers.host;
  if (host) {
    lastKnownBaseUrl = `http://localhost:${host.split(":")[1] || process.env.PORT || 3000}`;
  }

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  if (req.path.endsWith("/cache-clear")) {
    Object.values(buckets).forEach((b) => b.store.clear());
    return res.json({ ok: true, message: "Los 5 cachés fueron limpiados manualmente" });
  }

  // ⚠️ IMPORTANTE: /api/filtros NUNCA debe quedarse congelado en un solo bucket,
  // porque transporta las firmas en vivo de los 5 buckets hacia el navegador.
  if (req.path.includes("/filtros")) {
    return next();
  }

  const activeBucket = resolveBucket(req.path);
  const cacheKey = req.originalUrl;
  const isInternalPrewarm = req.headers["x-internal-prewarm"] === "true";

  if (!isInternalPrewarm && activeBucket.store.has(cacheKey)) {
    res.setHeader("X-Cache", `HIT-${activeBucket.name.toUpperCase()}`);
    res.setHeader("X-Cache-Bucket", activeBucket.name);
    res.setHeader("X-Data-Version", activeBucket.version);
    return res.json(activeBucket.store.get(cacheKey));
  }

  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    if (res.statusCode >= 200 && res.statusCode < 300 && !body?.error) {
      activeBucket.store.set(cacheKey, body);
      if (
        activeBucket.knownRoutes.size < 20 &&
        req.originalUrl &&
        (!req.originalUrl.includes("page=") || req.originalUrl.includes("page=1"))
      ) {
        activeBucket.knownRoutes.add(req.originalUrl);
      }
    }
    res.setHeader("X-Cache", isInternalPrewarm ? "PREWARM" : `MISS-${activeBucket.name.toUpperCase()}`);
    res.setHeader("X-Cache-Bucket", activeBucket.name);
    res.setHeader("X-Data-Version", activeBucket.version);
    return originalJson(body);
  };

  next();
}