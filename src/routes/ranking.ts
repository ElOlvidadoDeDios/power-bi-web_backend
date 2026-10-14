import { Router, Request, Response } from "express";
import sql from "mssql";
import { pool } from "../lib/db";

const router = Router();

router.get(["/ranking", "/api/ranking"], async (req: Request, res: Response) => {
  try {
    const request = pool.request();
    
    // Obtenemos los registros correspondientes a la ÚLTIMA FECHA CALCULADA.
    // Esto garantiza que siempre veamos el "ranking de hoy" automáticamente.
    const querySQL = `
      SELECT TOP (1000) 
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
         [Puesto_Actual],
         [Puesto_Anterior],
         [Comentario_Creativo]
      FROM [DWH_Gestion_Cartera].[dbo].[ranking_asesor_10]
      WHERE CAST([Fecha_Calculo] AS DATE) = (
          SELECT MAX(CAST([Fecha_Calculo] AS DATE)) 
          FROM [DWH_Gestion_Cartera].[dbo].[ranking_asesor_10]
      )
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