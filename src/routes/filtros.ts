import { Router, Request, Response } from "express";
import { pool } from "../lib/db";

const router = Router();

router.get(["/filtros", "/api/filtros"], async (_req: Request, res: Response) => {
  try {
    const periodos = await pool.request().query(`
      SELECT DISTINCT [Periodo] 
      FROM [dm_productividad].[dbo].[dim_calendario] 
      WHERE [Periodo] IS NOT NULL
      ORDER BY [Periodo] DESC
    `);

    const asesores = await pool.request().query(`
      SELECT DISTINCT 
          [Periodo], 
          [IdSAgencia], 
          [Asesor], 
          [AsesorNombresApellidos] 
      FROM [DWH_Gestion_Cartera].[dbo].[dim_asesor]
      WHERE [Asesor] IS NOT NULL AND [AsesorNombresApellidos] IS NOT NULL
    `);

    const fechas = await pool.request().query(`
      SELECT 
          [Periodo], 
          CAST([Fecha] AS VARCHAR(10)) AS FechaValor, 
          CONVERT(VARCHAR(10), [Fecha], 103) AS FechaVista 
      FROM [dm_productividad].[dbo].[dim_calendario]
      WHERE [Fecha] <= CAST(DATEADD(hour, -5, GETUTCDATE()) AS DATE)
      ORDER BY [Fecha] DESC
    `);

    res.json({
      periodos: periodos.recordset.map((p: any) => p.Periodo),
      asesores: asesores.recordset,
      fechas: fechas.recordset
    });
  } catch (error) {
    console.error("Error obteniendo filtros:", error);
    res.status(500).json({ error: "Error obteniendo filtros" });
  }
});

export default router;