// D:\Proyectos\power-bi-web_backend\src\middlewares\smartCache.ts
import { Request, Response, NextFunction } from "express";
import { pool } from "../lib/db";

type BucketName = "etl" | "gerencial" | "ranking" | "mora";

interface CacheBucket {
  name: BucketName;
  version: string;
  store: Map<string, any>;
  knownRoutes: Set<string>;
}

const buckets: Record<BucketName, CacheBucket> = {
  etl: { name: "etl", version: "", store: new Map(), knownRoutes: new Set(["/api/filtros"]) },
  gerencial: { name: "gerencial", version: "", store: new Map(), knownRoutes: new Set() },
  ranking: { name: "ranking", version: "", store: new Map(), knownRoutes: new Set(["/api/ranking"]) },
  mora: { name: "mora", version: "", store: new Map(), knownRoutes: new Set(["/api/mora", "/api/pagos-mora"]) },
};

let lastKnownBaseUrl = `http://localhost:${process.env.PORT || 3000}`;
let isChecking = false;

// Clasifica cada petición entrante en su caché correspondiente
function resolveBucket(path: string): CacheBucket {
  const p = path.toLowerCase();
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

// Consulta las 4 huellas de versión en 1 sola lectura ultrarrápida a SQL Server
async function getAllVersions(): Promise<Record<BucketName, string> | null> {
  try {
    const result = await pool.request().query(`
      SELECT 
        -- 1. Versión del ETL Principal (Id = 1)
        CONVERT(VARCHAR(30), (SELECT TOP 1 [UltimaActualizacion] FROM [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] WITH (NOLOCK) WHERE [Id] = 1), 126) AS vEtl,
        
        -- 2. Versión de Actualizador Gerencial (Id = 2 o firma de respaldo sobre las tablas)
        COALESCE(
          CONVERT(VARCHAR(30), (SELECT TOP 1 [UltimaActualizacion] FROM [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] WITH (NOLOCK) WHERE [Id] = 2), 126),
          CONCAT(
            (SELECT COUNT(*) FROM [DWH_Gestion_Cartera].[dbo].[avance_cartera] WITH (NOLOCK)), '_',
            (SELECT COUNT(*) FROM [DWH_Gestion_Cartera].[dbo].[creditos_cancelados_no_renovados] WITH (NOLOCK))
          )
        ) AS vGerencial,

        -- 3. Versión de Ranking (Id = 3 o fecha + suma de puntajes)
        COALESCE(
          CONVERT(VARCHAR(30), (SELECT TOP 1 [UltimaActualizacion] FROM [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] WITH (NOLOCK) WHERE [Id] = 3), 126),
          CONCAT(
            CONVERT(VARCHAR(20), (SELECT MAX([Fecha_Calculo]) FROM [DWH_Gestion_Cartera].[dbo].[ranking_asesor_10] WITH (NOLOCK)), 126), '_',
            CAST((SELECT ISNULL(SUM([Puntaje_Total]), 0) FROM [DWH_Gestion_Cartera].[dbo].[ranking_asesor_10] WITH (NOLOCK)) AS VARCHAR(30))
          )
        ) AS vRanking,

        -- 4. Versión de Mora e IA (Id = 4 o fecha foto + conteo + compromisos)
        COALESCE(
          CONVERT(VARCHAR(30), (SELECT TOP 1 [UltimaActualizacion] FROM [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] WITH (NOLOCK) WHERE [Id] = 4), 126),
          CONCAT(
            CONVERT(VARCHAR(20), (SELECT MAX([Fecha_Foto]) FROM [DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral] WITH (NOLOCK)), 126), '_',
            (SELECT COUNT(*) FROM [DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral] WITH (NOLOCK) WHERE [Compromiso] IS NOT NULL), '_',
            (SELECT COUNT(*) FROM [DWH_Gestion_Cartera].[dbo].[fct_pagos_mora_diarios] WITH (NOLOCK))
          )
        ) AS vMora
    `);

    const row = result.recordset?.[0];
    if (!row) return null;

    return {
      etl: String(row.vEtl || "v1"),
      gerencial: String(row.vGerencial || "v1"),
      ranking: String(row.vRanking || "v1"),
      mora: String(row.vMora || "v1"),
    };
  } catch (err) {
    console.error("⚠️ [SmartCache] Error leyendo versiones SQL:", err);
    return null;
  }
}

async function refreshBucketRoutes(bucket: CacheBucket, newVersion: string) {
  const routesToWarm = Array.from(bucket.knownRoutes);
  bucket.store.clear();
  bucket.version = newVersion;

  if (routesToWarm.length === 0) return;

  console.log(`🔥 [SmartCache:${bucket.name.toUpperCase()}] Refrescando ${routesToWarm.length} rutas en RAM...`);
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

  console.log(`✅ [SmartCache:${bucket.name.toUpperCase()}] Listo en ${((Date.now() - start) / 1000).toFixed(2)}s.`);
}

export function startCacheWatcher() {
  const checkLoop = async () => {
    if (isChecking) return;
    isChecking = true;
    try {
      const versions = await getAllVersions();
      if (!versions) return;

      for (const key of ["etl", "gerencial", "ranking", "mora"] as BucketName[]) {
        const bucket = buckets[key];
        const latestVer = versions[key];

        if (bucket.version !== latestVer) {
          console.log(`🔄 [SmartCache:${key.toUpperCase()}] Cambio detectado (${latestVer}). Actualizando su caché independiente...`);
          await refreshBucketRoutes(bucket, latestVer);
        }
      }
    } finally {
      isChecking = false;
    }
  };

  setTimeout(checkLoop, 1500);
  setInterval(checkLoop, 20000);
}

export function getCombinedVersionSignature(): string {
  return `${buckets.etl.version}|${buckets.gerencial.version}|${buckets.ranking.version}|${buckets.mora.version}`;
}

export async function smartCacheMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.method !== "GET" || req.path.includes("health")) {
    return next();
  }

  const host = req.headers.host;
  if (host) {
    lastKnownBaseUrl = `http://localhost:${host.split(":")[1] || process.env.PORT || 3000}`;
  }

  if (req.path.endsWith("/cache-clear")) {
    Object.values(buckets).forEach((b) => b.store.clear());
    return res.json({ ok: true, message: "Los 4 cachés fueron limpiados manualmente" });
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
      // Guardamos hasta 15 rutas frecuentes por bucket (incluyendo página 1 de avance/cancelados)
      if (activeBucket.knownRoutes.size < 15 && req.originalUrl && (!req.originalUrl.includes("page=") || req.originalUrl.includes("page=1"))) {
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