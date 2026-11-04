// D:\Proyectos\power-bi-web_backend\src\routes\ranking.ts
import { Router, Request, Response } from "express";
import { pool } from "../lib/db";

const router = Router();

router.get(["/ranking", "/api/ranking"], async (_req: Request, res: Response) => {
  try {
    const request = pool.request();

    // Deduplica por IdSAsesor tomando únicamente el registro más reciente y mayor puntaje
    const querySQL = `
      WITH UltimoPorAsesor AS (
        SELECT
          CONVERT(VARCHAR(10), CAST([Fecha_Calculo] AS DATE), 23) + 'T12:00:00' AS [Fecha_Calculo],
          RTRIM(LTRIM([IdSAsesor])) AS [IdSAsesor],
          RTRIM(LTRIM([Asesor])) AS [Asesor],
          RTRIM(LTRIM([Agencia])) AS [Agencia],
          ISNULL([Operaciones], 0) AS [Operaciones],
          ISNULL([Crecimiento_Neto_150], 0) AS [Crecimiento_Neto_150],
          ISNULL([Seguros_Vendidos], 0) AS [Seguros_Vendidos],
          ISNULL([Puntos_Op], 0) AS [Puntos_Op],
          ISNULL([Puntos_Crec], 0) AS [Puntos_Crec],
          ISNULL([Puntos_Seg], 0) AS [Puntos_Seg],
          ISNULL([Puntaje_Total], 0) AS [Puntaje_Total],
          [Puesto_Actual] AS [Puesto_Original],
          [Puesto_Anterior],
          [Comentario_Creativo],
          ROW_NUMBER() OVER (
            PARTITION BY RTRIM(LTRIM(ISNULL(NULLIF([IdSAsesor], ''), [Asesor])))
            ORDER BY CAST([Fecha_Calculo] AS DATETIME) DESC, [Puntaje_Total] DESC, [Operaciones] DESC
          ) AS rn
        FROM [DWH_Gestion_Cartera].[dbo].[ranking_asesor_10] WITH (NOLOCK)
      )
      SELECT
        [Fecha_Calculo],
        [IdSAsesor],
        [Asesor],
        [Agencia],
        [Operaciones],
        [Crecimiento_Neto_150],
        [Seguros_Vendidos],
        [Puntos_Op],
        [Puntos_Crec],
        [Puntos_Seg],
        [Puntaje_Total],
        CAST(
          RANK() OVER (ORDER BY [Puntaje_Total] DESC, [Operaciones] DESC, [Crecimiento_Neto_150] DESC)
          AS INT
        ) AS [Puesto_Actual],
        [Puesto_Anterior],
        [Comentario_Creativo]
      FROM UltimoPorAsesor
      WHERE rn = 1
      ORDER BY [Puesto_Actual] ASC, [Operaciones] DESC;
    `;

    const result = await request.query(querySQL);
    res.json(result.recordset);
  } catch (error) {
    console.error("Error obteniendo Ranking de Excelencia:", error);
    res.status(500).json({ error: "Error al consultar la base de datos de ranking" });
  }
});

export default router;