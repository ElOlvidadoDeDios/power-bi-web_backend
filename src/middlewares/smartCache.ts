import { Request, Response, NextFunction } from "express";
import { pool } from "../lib/db";

interface CacheBucket {
  version: string;
  store: Map<string, any>;
}

const cacheETL: CacheBucket = { version: "", store: new Map() };
const cacheDaemon: CacheBucket = { version: "", store: new Map() };

let isChecking = false;
let isPrewarming = false;
let serverPort = Number(process.env.PORT) || 3032;

export function setCacheServerPort(port: number) {
  serverPort = port;
}

// Obtiene las versiones actuales del DWH en ~1ms
async function getDWHVersions(): Promise<{ versionETL: string; versionDaemon: string; periodoActual: string } | null> {
  try {
    const result = await pool.request().query(`
      SELECT 
        CONVERT(VARCHAR(30), (SELECT TOP 1 [UltimaActualizacion] FROM [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] WHERE [Id] = 1), 126) AS VersionETL,
        CONVERT(VARCHAR(30), (SELECT MAX([Fecha_Calculo]) FROM [DWH_Gestion_Cartera].[dbo].[ranking_asesor_10]), 126) AS VersionDaemon,
        (SELECT TOP 1 CAST([Periodo] AS VARCHAR(6)) FROM [DWH_Gestion_Cartera].[dbo].[fct_flow] ORDER BY [Periodo] DESC) AS PeriodoActual
    `);
    const row = result.recordset?.[0];
    if (!row) return null;

    return {
      versionETL: String(row.VersionETL || "v1"),
      versionDaemon: String(row.VersionDaemon || "v1"),
      periodoActual: String(row.PeriodoActual || `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}`),
    };
  } catch (err) {
    console.error("⚠️ [SmartCache] Error leyendo semáforo SQL:", err);
    return null;
  }
}

// 🚀 PRE-CALENTAMIENTO EN SEGUNDO PLANO: Ejecuta las consultas pesadas antes de que el usuario las pida
async function prewarmHeavyRoutes(periodo: string, newVersionETL: string) {
  if (isPrewarming) return;
  isPrewarming = true;

  const baseUrl = `http://localhost:${serverPort}`;
  // Rutas más pesadas que los usuarios consultan al abrir el sistema
  const routesToWarm = [
    `/api/filtros`,
    `/api/gerencia?periodo=${periodo}&agencia=Todas&asesor=Todos`,
    `/api/supervision?periodo=${periodo}&agencia=Todas&asesor=Todos`,
    `/api/agencia?periodo=${periodo}&agencia=Todas&asesor=Todos`,
    `/api/asesores?periodo=${periodo}&agencia=Todas&asesor=Todos`,
    `/api/colocaciones?periodo=${periodo}&agencia=Todas&asesor=Todos`,
    `/api/diaria?periodo=${periodo}&agencia=Todas&asesor=Todos&dia=Hoy`,
    `/api/cancelados?agencia=Todas&asesor=Todos&tipo=Todas&frecuencia=Todas`,
    `/api/avance?agencia=Todas&asesor=Todos`,
    `/api/ranking`,
  ];

  console.log(`🔥 [SmartCache] Pre-calentando ${routesToWarm.length} reportes en RAM para el periodo ${periodo}...`);
  const start = Date.now();

  try {
    // Ejecutamos las peticiones internamente con la cabecera especial de refresco
    await Promise.allSettled(
      routesToWarm.map((route) =>
        fetch(`${baseUrl}${route}`, {
          headers: { "x-internal-prewarm": "true" },
        })
      )
    );
    cacheETL.version = newVersionETL;
    console.log(`✅ [SmartCache] RAM lista en ${((Date.now() - start) / 1000).toFixed(2)}s. Los usuarios tendrán respuesta en 0ms.`);
  } catch (err) {
    console.error("⚠️ [SmartCache] Error en pre-calentamiento:", err);
  } finally {
    isPrewarming = false;
  }
}

// Vigila cada 20 segundos si el ETL o el Daemon actualizaron SQL Server
export function startCacheWatcher() {
  const checkLoop = async () => {
    if (isChecking) return;
    isChecking = true;
    try {
      const info = await getDWHVersions();
      if (!info) return;

      // 1. Verificar cambio en el Daemon (Ranking)
      if (cacheDaemon.version !== info.versionDaemon) {
        console.log(`🔄 [SmartCache] Nuevo cálculo de Ranking detectado (${info.versionDaemon}).`);
        cacheDaemon.store.clear();
        cacheDaemon.version = info.versionDaemon;
      }

      // 2. Verificar cambio en el ETL (Log_Actualizacion)
      if (cacheETL.version !== info.versionETL) {
        console.log(`🔄 [SmartCache] Nueva carga ETL detectada (${info.versionETL}). Actualizando RAM...`);
        await prewarmHeavyRoutes(info.periodoActual, info.versionETL);
      }
    } finally {
      isChecking = false;
    }
  };

  // Primera carga apenas arranca el backend y luego revisión ligera cada 20 segundos
  setTimeout(checkLoop, 1500);
  setInterval(checkLoop, 20000);
}

export async function smartCacheMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.method !== "GET" || req.path.includes("health")) {
    return next();
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

  // Si NO es el pre-calentador interno y el dato ya está en RAM, respondemos en < 1ms
  if (!isInternalPrewarm && activeBucket.store.has(cacheKey)) {
    res.setHeader("X-Cache", "HIT");
    res.setHeader("X-Data-Version", activeBucket.version);
    return res.json(activeBucket.store.get(cacheKey));
  }

  // Si aún no estaba en RAM (ej: un filtro muy específico de un asesor), lo consultamos y lo guardamos
  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    if (res.statusCode >= 200 && res.statusCode < 300 && !body?.error) {
      activeBucket.store.set(cacheKey, body);
    }
    res.setHeader("X-Cache", isInternalPrewarm ? "PREWARM" : "MISS");
    res.setHeader("X-Data-Version", activeBucket.version);
    return originalJson(body);
  };

  next();
}