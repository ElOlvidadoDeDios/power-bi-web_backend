//routes/calendario.ts

import { Router, Request, Response } from "express";
import sql from "mssql/msnodesqlv8.js";

const router = Router();

const dbConfig = {
  server: process.env.DB_DWH_SERVER || "DESKTOP-K6HIFFS",
  database: process.env.DB_PRODUCTIVIDAD_NAME || "dm_productividad",
  driver: "msnodesqlv8",
  options: {
    trustedConnection: true,
  },
};

router.get(["/dias-laborales/:periodo", "/api/dias-laborales/:periodo"], async (req: Request, res: Response) => {
  const { periodo } = req.params;

  try {
    const pool = await sql.connect(dbConfig);
    
    const result = await pool.request()
      .input('periodo', sql.VarChar(6), periodo)
      .query(`
        -- 1. Obtenemos Fecha y Hora de Perú (-5 UTC)
        DECLARE @FechaHoraPeru DATETIME = DATEADD(hour, -5, GETUTCDATE());
        DECLARE @Hoy DATE = CAST(@FechaHoraPeru AS DATE);
        DECLARE @Hora TIME = CAST(@FechaHoraPeru AS TIME);

        -- 2. Buscamos el último día del mes (EndDate DAX)
        DECLARE @EndDate DATE;
        SELECT @EndDate = MAX(Fecha) 
        FROM [dm_productividad].[dbo].[dim_calendario] 
        WHERE Periodo = @periodo;

        -- 3. Definimos la regla de Corte Base
        DECLARE @CorteBase DATE;
        IF @Hoy < @EndDate
            SET @CorteBase = @Hoy;
        ELSE
            SET @CorteBase = @EndDate;

        -- 4. Regla de las 7:00 PM (19:00 hrs)
        DECLARE @CorteExacto DATE;
        IF @CorteBase = @Hoy AND @Hora < '19:00:00'
            SET @CorteExacto = DATEADD(day, -1, @CorteBase);
        ELSE
            SET @CorteExacto = @CorteBase;

        -- 5. Calculamos usando las variables en duro
        SELECT 
            -- Días totales del mes que no son domingos ni feriados
            (SELECT COUNT(Fecha) 
             FROM [dm_productividad].[dbo].[dim_calendario] 
             WHERE Periodo = @periodo 
               AND EsDomingo = 0 
               AND EsFeriado = 0) AS totales,
               
            -- Días transcurridos hasta el corte
            (SELECT COUNT(Fecha) 
             FROM [dm_productividad].[dbo].[dim_calendario] 
             WHERE Periodo = @periodo 
               AND Fecha <= @CorteExacto 
               AND EsDomingo = 0 
               AND EsFeriado = 0) AS transcurridos,
               
            -- Días restantes (Totales - Transcurridos)
            ((SELECT COUNT(Fecha) 
              FROM [dm_productividad].[dbo].[dim_calendario] 
              WHERE Periodo = @periodo 
                AND EsDomingo = 0 
                AND EsFeriado = 0) - 
             (SELECT COUNT(Fecha) 
              FROM [dm_productividad].[dbo].[dim_calendario] 
              WHERE Periodo = @periodo 
                AND Fecha <= @CorteExacto 
                AND EsDomingo = 0 
                AND EsFeriado = 0)) AS restantes
      `);

    res.json(result.recordset[0]);
  } catch (error) {
    console.error("Error en BD dm_productividad:", error);
    res.status(500).json({ error: "Error calculando días laborales" });
  }
});

export default router;