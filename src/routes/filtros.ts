// En D:\Proyectos\power-bi-web_backend\src\routes\filtros.ts
import { Router, Request, Response } from "express";
import { pool } from "../lib/db";
import { getCombinedVersionSignature } from "../middlewares/smartCache";

const router = Router();

router.get(["/filtros", "/api/filtros"], async (_req: Request, res: Response) => {
  try {
    const periodos = await pool.request().query(`
      SELECT DISTINCT [Periodo] 
      FROM [dm_productividad].[dbo].[dim_calendario] WITH (NOLOCK)
      WHERE [Periodo] IS NOT NULL
      ORDER BY [Periodo] DESC
    `);

    const asesores = await pool.request().query(`
      SELECT DISTINCT 
          [Periodo], 
          [IdSAgencia], 
          [IdSAsesor], 
          [Asesor], 
          [AsesorNombresApellidos] 
      FROM [DWH_Gestion_Cartera].[dbo].[dim_asesor] WITH (NOLOCK)
      WHERE [Asesor] IS NOT NULL AND [AsesorNombresApellidos] IS NOT NULL
    `);

    const fechas = await pool.request().query(`
      SELECT 
          [Periodo], 
          CAST([Fecha] AS VARCHAR(10)) AS FechaValor, 
          CONVERT(VARCHAR(10), [Fecha], 103) AS FechaVista 
      FROM [dm_productividad].[dbo].[dim_calendario] WITH (NOLOCK)
      WHERE [Fecha] <= CAST(DATEADD(hour, -5, GETUTCDATE()) AS DATE)
      ORDER BY [Fecha] DESC
    `);

    const logResult = await pool.request().query(`
      SELECT TOP (1) 
        FORMAT([UltimaActualizacion], 'dd/MM/yyyy · hh:mm tt', 'es-PE') AS UltimaActualizacion
      FROM [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] WITH (NOLOCK)
      ORDER BY [UltimaActualizacion] DESC
    `);

    const ultimaActualizacion = logResult.recordset.length > 0 
      ? logResult.recordset[0].UltimaActualizacion 
      : 'Desconocido';

    res.json({
      periodos: periodos.recordset.map((p: any) => p.Periodo),
      asesores: asesores.recordset,
      fechas: fechas.recordset,
      ultimaActualizacion: ultimaActualizacion,
      versionSignature: getCombinedVersionSignature(), // 👈 Firma unificada de los 4 cachés
    });
  } catch (error) {
    console.error("Error obteniendo filtros:", error);
    res.status(500).json({ error: "Error obteniendo filtros" });
  }
});

export default router;