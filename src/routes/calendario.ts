// D:\Proyectos\power-bi-web_backend\src\routes\calendario.ts
import { Router, Request, Response } from "express";
import sql from "mssql";
import { pool } from "../lib/db";

const router = Router();

router.get(["/dias-laborales/:periodo", "/api/dias-laborales/:periodo"], async (req: Request, res: Response) => {
  const { periodo } = req.params;

  try {
    const result = await pool
      .request()
      .input("periodo", sql.VarChar(6), periodo)
      .query(`
        DECLARE @FechaHoraPeru DATETIME = DATEADD(hour, -5, GETUTCDATE());
        DECLARE @Hoy DATE = CAST(@FechaHoraPeru AS DATE);
        DECLARE @Hora TIME = CAST(@FechaHoraPeru AS TIME);

        DECLARE @EndDate DATE = (
          SELECT MAX(Fecha) 
          FROM [dm_productividad].[dbo].[dim_calendario] WITH (NOLOCK)
          WHERE Periodo = @periodo
        );

        DECLARE @CorteBase DATE = CASE WHEN @Hoy < @EndDate THEN @Hoy ELSE @EndDate END;
        DECLARE @CorteExacto DATE = CASE
          WHEN @CorteBase = @Hoy AND @Hora < '19:00:00' THEN DATEADD(day, -1, @CorteBase)
          ELSE @CorteBase
        END;

        SELECT
          COUNT(Fecha) AS totales,
          ISNULL(SUM(CASE WHEN Fecha <= @CorteExacto THEN 1 ELSE 0 END), 0) AS transcurridos,
          COUNT(Fecha) - ISNULL(SUM(CASE WHEN Fecha <= @CorteExacto THEN 1 ELSE 0 END), 0) AS restantes
        FROM [dm_productividad].[dbo].[dim_calendario] WITH (NOLOCK)
        WHERE Periodo = @periodo
          AND EsDomingo = 0
          AND EsFeriado = 0;
      `);

    res.json(result.recordset[0] || { totales: 0, transcurridos: 0, restantes: 0 });
  } catch (error) {
    console.error("Error en BD dm_productividad:", error);
    res.status(500).json({ error: "Error calculando días laborales" });
  }
});

export default router;