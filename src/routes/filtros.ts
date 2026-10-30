// D:\Proyectos\power-bi-web_backend\src\routes\filtros.ts
import { Router, Request, Response } from "express";
import { pool } from "../lib/db";
import { getCombinedVersionSignature, getLogsStatusByBucket } from "../middlewares/smartCache";

const router = Router();

let cachedCatalogs: {
  versionEtl: string;
  periodos: string[];
  asesores: any[];
  fechas: any[];
} | null = null;

router.get(["/filtros", "/api/filtros"], async (_req: Request, res: Response) => {
  try {
    const logs = getLogsStatusByBucket();
    const currentEtlVer = logs.etl.version;

    if (!cachedCatalogs || cachedCatalogs.versionEtl !== currentEtlVer) {
      const [periodos, asesores, fechas] = await Promise.all([
        pool.request().query(`
          SELECT DISTINCT RTRIM(LTRIM([Periodo])) AS Periodo
          FROM [dm_productividad].[dbo].[dim_calendario] WITH (NOLOCK)
          WHERE [Periodo] IS NOT NULL AND LTRIM(RTRIM([Periodo])) <> ''
          ORDER BY RTRIM(LTRIM([Periodo])) DESC
        `),
        pool.request().query(`
          SELECT DISTINCT 
              RTRIM(LTRIM([Periodo])) AS [Periodo], 
              RIGHT('00' + RTRIM(LTRIM([IdSAgencia])), 2) AS [IdSAgencia], 
              RTRIM(LTRIM([IdSAsesor])) AS [IdSAsesor], 
              RTRIM(LTRIM([Asesor])) AS [Asesor], 
              RTRIM(LTRIM([AsesorNombresApellidos])) AS [AsesorNombresApellidos],
              RTRIM(LTRIM([Cargo])) AS [Cargo]
          FROM [DWH_Gestion_Cartera].[dbo].[dim_asesor] WITH (NOLOCK)
          WHERE [Asesor] IS NOT NULL 
            AND [AsesorNombresApellidos] IS NOT NULL
            AND RTRIM(LTRIM([Cargo])) IN ('ANALISTA DE CREDITOS I', 'RECUPERADOR')
        `),
        pool.request().query(`
          SELECT 
              [Periodo], 
              CAST([Fecha] AS VARCHAR(10)) AS FechaValor, 
              CONVERT(VARCHAR(10), [Fecha], 103) AS FechaVista 
          FROM [dm_productividad].[dbo].[dim_calendario] WITH (NOLOCK)
          WHERE [Fecha] <= CAST(DATEADD(hour, -5, GETUTCDATE()) AS DATE)
          ORDER BY [Fecha] DESC
        `),
      ]);

      cachedCatalogs = {
        versionEtl: currentEtlVer,
        periodos: periodos.recordset.map((p: any) => p.Periodo),
        asesores: asesores.recordset,
        fechas: fechas.recordset,
      };
    }

    res.json({
      periodos: cachedCatalogs.periodos,
      asesores: cachedCatalogs.asesores,
      fechas: cachedCatalogs.fechas,
      ultimaActualizacion: logs.etl.etiqueta,
      logsPorModulo: logs,
      versionSignature: getCombinedVersionSignature(),
    });
  } catch (error) {
    console.error("Error obteniendo filtros:", error);
    res.status(500).json({ error: "Error obteniendo filtros" });
  }
});

export default router;