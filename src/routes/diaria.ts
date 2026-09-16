//routes/diaria.ts

import { Router, Request, Response } from "express";
import sql from "mssql/msnodesqlv8.js";

const router = Router();

const dbConfig = {
  server: process.env.DB_DWH_SERVER || "DESKTOP-K6HIFFS",
  database: process.env.DB_DWH_NAME || "DWH_Gestion_Cartera",
  driver: "msnodesqlv8",
  options: {
    trustedConnection: true,
  },
};

router.get(["/diaria/:periodo", "/api/diaria/:periodo"], async (req: Request, res: Response) => {
  const { periodo } = req.params;
  const dayFilter = (req.query.day as string) || 'Hoy';

  try {
    const pool = await sql.connect(dbConfig);
    
    const result = await pool.request()
      .input('periodo', sql.VarChar(6), periodo)
      .input('dayFilter', sql.VarChar(20), dayFilter)
      .query(`
        DECLARE @FechaHoraPeru DATETIME = DATEADD(hour, -5, GETUTCDATE());
        DECLARE @TargetDate DATE;

        IF @dayFilter = 'Hoy'
            SET @TargetDate = CAST(DATEADD(hour, -5, GETUTCDATE()) AS DATE);
        ELSE IF @dayFilter = 'Ayer'
            SET @TargetDate = CAST(DATEADD(day, -1, DATEADD(hour, -5, GETUTCDATE())) AS DATE);
        ELSE
            BEGIN
                BEGIN TRY
                    -- Si React envía '2026-08-15', lo convierte a fecha real
                    SET @TargetDate = CAST(@dayFilter AS DATE);
                END TRY
                BEGIN CATCH
                    -- Si hay un error, vuelve a 'Hoy' por seguridad
                    SET @TargetDate = CAST(DATEADD(hour, -5, GETUTCDATE()) AS DATE);
                END CATCH
            END
        
        -- Fallback: Si no hay meta en esa fecha, busca la última disponible del periodo
        IF NOT EXISTS (SELECT 1 FROM dm_productividad.dbo.FctDiario_MetaProy WHERE Fecha = @TargetDate)
        BEGIN
            SELECT TOP 1 @TargetDate = Fecha 
            FROM dm_productividad.dbo.FctDiario_MetaProy 
            WHERE YEAR(Fecha)*100 + MONTH(Fecha) = CAST(@periodo AS INT)
            ORDER BY Fecha DESC;
        END

        -- 1. Resumen por Agencias
        ;WITH CTE_Agencias AS (
            SELECT DISTINCT IdSAgencia FROM dm_productividad.dbo.FctMensual WHERE Periodo = @periodo
        ),
        CTE_MetasProy AS (
            SELECT IdSAgencia, ColocacionNumMeta, ColocacionNumProy, ColocacionMontoMeta, ColocacionMontoProy
            FROM dm_productividad.dbo.FctDiario_MetaProy WHERE Fecha = @TargetDate
        ),
        CTE_Logrado AS (
            SELECT IdSAgencia, 
                   ISNULL(SUM(ColocacionNumReal), 0) AS achievedCount, 
                   ISNULL(SUM(ColocacionMontoReal), 0) AS achievedAmount
            FROM DWH_Gestion_Cartera.dbo.fct_flow
            WHERE Periodo = @periodo AND CAST(Fecha AS DATE) = @TargetDate
            GROUP BY IdSAgencia
        )
        SELECT 
            CASE A.IdSAgencia 
                WHEN '01' THEN 'Wanchaq' WHEN '02' THEN 'San Jerónimo' WHEN '03' THEN 'Quillabamba' 
                WHEN '04' THEN 'Sicuani' WHEN '05' THEN 'Molino' WHEN '06' THEN 'Juliaca' 
                WHEN '07' THEN 'Lima Los Olivos' WHEN '08' THEN 'Tica Tica' WHEN '09' THEN 'Magisterio' 
                WHEN '10' THEN 'Lima SJL' WHEN '11' THEN 'Chiclayo' WHEN '12' THEN 'Arequipa' 
                WHEN '13' THEN 'Pucallpa' ELSE 'Otra Agencia' END AS agency,
            A.IdSAgencia AS idAgency,
            ISNULL(M.ColocacionNumMeta, 0) AS targetCount,
            ISNULL(M.ColocacionNumProy, 0) AS projectionCount,
            ISNULL(L.achievedCount, 0) AS achievedCount,
            ISNULL(M.ColocacionMontoMeta, 0) AS targetAmount,
            ISNULL(M.ColocacionMontoProy, 0) AS projectionAmount,
            ISNULL(L.achievedAmount, 0) AS achievedAmount
        FROM CTE_Agencias A
        LEFT JOIN CTE_MetasProy M ON A.IdSAgencia = M.IdSAgencia
        LEFT JOIN CTE_Logrado L ON A.IdSAgencia = L.IdSAgencia
        ORDER BY A.IdSAgencia ASC;

        -- 2. Detalle por Asesor para la tabla adicional
        SELECT 
            DA.AsesorNombresApellidos AS asesor,
            CASE DA.IdSAgencia 
                WHEN '01' THEN 'Wanchaq' WHEN '02' THEN 'San Jerónimo' WHEN '03' THEN 'Quillabamba' 
                WHEN '04' THEN 'Sicuani' WHEN '05' THEN 'Molino' WHEN '06' THEN 'Juliaca' 
                WHEN '07' THEN 'Lima Los Olivos' WHEN '08' THEN 'Tica Tica' WHEN '09' THEN 'Magisterio' 
                WHEN '10' THEN 'Lima SJL' WHEN '11' THEN 'Chiclayo' WHEN '12' THEN 'Arequipa' 
                WHEN '13' THEN 'Pucallpa' ELSE 'Otra Agencia' END AS agency,
            ISNULL(SUM(F.ColocacionNumReal), 0) AS operations,
            ISNULL(SUM(F.ColocacionMontoReal), 0) AS disbursements,
            @TargetDate AS fechaConsultada
        FROM DWH_Gestion_Cartera.dbo.dim_asesor DA
        LEFT JOIN DWH_Gestion_Cartera.dbo.fct_flow F ON DA.IdSAsesor = F.IdSAsesor AND F.Periodo = @periodo AND CAST(F.Fecha AS DATE) = @TargetDate
        WHERE DA.Periodo = @periodo AND (DA.Cargo <> 'RECUPERADOR' OR DA.Cargo IS NULL)
        GROUP BY DA.AsesorNombresApellidos, DA.IdSAgencia
        ORDER BY operations DESC, disbursements DESC;
      `);

    res.json({
        agencias: result.recordsets[0],
        asesores: result.recordsets[1],
        fechaConsultada: result.recordsets[1][0]?.fechaConsultada || new Date()
    });
  } catch (error) {
    console.error("Error obteniendo Productividad Diaria:", error);
    res.status(500).json({ error: "Error calculando productividad diaria" });
  }
});

export default router;