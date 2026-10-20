import { Router, Request, Response } from "express";
import sql from "mssql";
import { pool } from '../lib/db';

const router = Router();

router.get(["/diaria/:periodo", "/api/diaria/:periodo"], async (req: Request, res: Response) => {
  const { periodo } = req.params;
  const dayFilter = (req.query.day as string) || 'Hoy';

  try {
    const request = pool.request();
    
    const result = await request
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
                    SET @TargetDate = CAST(@dayFilter AS DATE);
                END TRY
                BEGIN CATCH
                    SET @TargetDate = CAST(DATEADD(hour, -5, GETUTCDATE()) AS DATE);
                END CATCH
            END
        
        IF NOT EXISTS (SELECT 1 FROM dm_productividad.dbo.FctDiario_MetaProy WITH (NOLOCK) WHERE Fecha = @TargetDate)
        BEGIN
            SELECT TOP 1 @TargetDate = Fecha 
            FROM dm_productividad.dbo.FctDiario_MetaProy WITH (NOLOCK)
            WHERE YEAR(Fecha)*100 + MONTH(Fecha) = CAST(@periodo AS INT)
            ORDER BY Fecha DESC;
        END

        -- 1. Resumen por Agencias
        ;WITH CTE_Agencias AS (
            SELECT DISTINCT IdSAgencia FROM dm_productividad.dbo.FctMensual WITH (NOLOCK) WHERE Periodo = @periodo
        ),
        CTE_MetasProy AS (
            SELECT IdSAgencia, ColocacionNumMeta, ColocacionNumProy, ColocacionMontoMeta, ColocacionMontoProy
            FROM dm_productividad.dbo.FctDiario_MetaProy WITH (NOLOCK) WHERE Fecha = @TargetDate
        ),
        CTE_Logrado AS (
            SELECT IdSAgencia, 
                   ISNULL(SUM(ColocacionNumReal), 0) AS achievedCount, 
                   ISNULL(SUM(ColocacionMontoReal), 0) AS achievedAmount
            FROM DWH_Gestion_Cartera.dbo.fct_flow WITH (NOLOCK)
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
        FROM DWH_Gestion_Cartera.dbo.dim_asesor DA WITH (NOLOCK)
        LEFT JOIN DWH_Gestion_Cartera.dbo.fct_flow F WITH (NOLOCK) ON DA.IdSAsesor = F.IdSAsesor AND F.Periodo = @periodo AND CAST(F.Fecha AS DATE) = @TargetDate
        WHERE DA.Periodo = @periodo AND (DA.Cargo <> 'RECUPERADOR' OR DA.Cargo IS NULL)
        GROUP BY DA.AsesorNombresApellidos, DA.IdSAgencia
        ORDER BY operations DESC, disbursements DESC;
      `);

    // 💡 Tipado seguro para evitar errores de índice en TS
    const recordsets = result.recordsets as unknown as any[];

    res.json({
        agencias: recordsets[0],
        asesores: recordsets[1],
        fechaConsultada: recordsets[1]?.[0]?.fechaConsultada || new Date()
    });
  } catch (error) {
    console.error("Error obteniendo Productividad Diaria:", error);
    res.status(500).json({ error: "Error calculando productividad diaria" });
  }
});

export default router;