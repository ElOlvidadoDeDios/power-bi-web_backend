import { Router, Request, Response } from "express";
import { pool } from "../lib/db";

const router = Router();

router.get(["/ranking", "/api/ranking"], async (_req: Request, res: Response) => {
  try {
    const request = pool.request();

    // La tabla ahora almacena una única fecha vigente; formateamos Fecha_Calculo
    // con T12:00:00 para evitar que UTC-5 en el navegador reste 5 horas y muestre el día anterior
    const querySQL = `
      SELECT TOP (1000) 
          CONVERT(VARCHAR(10), CAST([Fecha_Calculo] AS DATE), 23) + 'T12:00:00' AS [Fecha_Calculo],
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
          [Puesto_Actual],
          [Puesto_Anterior],
          [Comentario_Creativo]
      FROM [DWH_Gestion_Cartera].[dbo].[ranking_asesor_10] WITH (NOLOCK)
      ORDER BY [Puesto_Actual] ASC;
    `;

    const result = await request.query(querySQL);
    res.json(result.recordset);
  } catch (error) {
    console.error("Error obteniendo Ranking de Excelencia:", error);
    res.status(500).json({ error: "Error al consultar la base de datos de ranking" });
  }
});

export default router;