//routes/gerencia.ts

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

router.get(["/indicadores-gerencia/:periodo", "/api/indicadores-gerencia/:periodo"], async (req: Request, res: Response) => {
  const { periodo } = req.params;

  try {
    const pool = await sql.connect(dbConfig);
    
    const result = await pool.request()
      .input('periodo', sql.VarChar(6), periodo)
      .query(`
        -- =================================================================
        -- QUERY 1: CARTERA COMERCIAL (Excluyendo Recuperadores)
        -- =================================================================
        WITH CTE_Asesores_Comercial AS (
            SELECT IdSAsesor FROM DWH_Gestion_Cartera.dbo.dim_asesor WHERE Periodo = @periodo AND (Cargo <> 'RECUPERADOR' OR Cargo IS NULL)
        ),
        CTE_Flow AS (
            SELECT IdSAgencia, ISNULL(SUM(ColocacionNumReal), 0) AS NroOper, ISNULL(SUM(ColocacionMontoReal), 0) AS Desembolsos, ISNULL(SUM(RepagoReal), 0) AS Repagos
            FROM DWH_Gestion_Cartera.dbo.fct_flow WHERE Periodo = @periodo AND IdSAsesor IN (SELECT IdSAsesor FROM CTE_Asesores_Comercial) GROUP BY IdSAgencia
        ),
        CTE_Stock AS (
            SELECT IdSAgencia, ISNULL(SUM(Cartera), 0) AS Cartera, ISNULL(SUM(Mora9), 0) AS MoraCPP, ISNULL(SUM(Mora31), 0) AS MoraDeficiente, ISNULL(SUM(Mora150), 0) AS Mora150, ISNULL(SUM(Varios), 0) AS Varios
            FROM DWH_Gestion_Cartera.dbo.fct_stock WHERE Periodo = @periodo AND IdSAsesor IN (SELECT IdSAsesor FROM CTE_Asesores_Comercial) GROUP BY IdSAgencia
        ),
        CTE_MetasFlow AS (
            SELECT IdSAgencia, ISNULL(SUM(ColocacionNumMeta), 0) AS MetaOperacionesBase, ISNULL(SUM(CASE WHEN ColocacionNumMetaAjus > 0 THEN ColocacionNumMetaAjus ELSE ColocacionNumMeta END), 0) AS MetaOperaciones, ISNULL(SUM(ColocacionMontoMeta), 0) AS MetaMontoBase, ISNULL(SUM(CASE WHEN ColocacionMontoMetaAjus > 0 THEN ColocacionMontoMetaAjus ELSE ColocacionMontoMeta END), 0) AS MetaMonto
            FROM dm_productividad.dbo.FctMensual WHERE Periodo = @periodo GROUP BY IdSAgencia
        ),
        CTE_MetasStock AS (
            SELECT IdSAgencia, ISNULL(MAX(Mora9Meta), 0.10) AS MetaMoraCPP
            FROM dm_productividad.dbo.fct_stock_manubl_agencia_month WHERE Periodo = @periodo GROUP BY IdSAgencia
        )
        SELECT 
            CASE ISNULL(COALESCE(F.IdSAgencia, S.IdSAgencia, MF.IdSAgencia), '99') WHEN '01' THEN 'Wanchaq' WHEN '02' THEN 'San Jerónimo' WHEN '03' THEN 'Quillabamba' WHEN '04' THEN 'Sicuani' WHEN '05' THEN 'Molino' WHEN '06' THEN 'Juliaca' WHEN '07' THEN 'Lima Los Olivos' WHEN '08' THEN 'Tica Tica' WHEN '09' THEN 'Magisterio' WHEN '10' THEN 'Lima SJL' WHEN '11' THEN 'Chiclayo' WHEN '12' THEN 'Arequipa' WHEN '13' THEN 'Pucallpa' ELSE 'Otra Agencia' END AS agency,
            ISNULL(S.Cartera, 0) AS cartera, ISNULL(F.NroOper, 0) AS opAchieved, ISNULL(F.Desembolsos, 0) AS amountAchieved, ISNULL(F.Repagos, 0) AS repagos,
            ISNULL(MF.MetaOperacionesBase, 0) AS opTargetBase, ISNULL(MF.MetaOperaciones, 0) AS opTarget, ISNULL(MF.MetaMontoBase, 0) AS amountTargetBase, ISNULL(MF.MetaMonto, 0) AS amountTarget,
            (ISNULL(F.Desembolsos, 0) - ISNULL(F.Repagos, 0)) AS crecimientoBruto,
            ((ISNULL(F.Desembolsos, 0) - ISNULL(F.Repagos, 0)) - ISNULL(S.Mora150, 0)) AS crecimientoNeto150,
            CASE WHEN ISNULL(F.NroOper, 0) > 0 THEN (ISNULL(S.Varios, 0) / CAST(F.NroOper AS FLOAT)) / 5.0 ELSE 0 END AS duration,
            ISNULL(S.MoraCPP, 0) AS moraCPP_soles, ISNULL(S.MoraDeficiente, 0) AS moraDeficiente_soles,
            CASE WHEN ISNULL(S.Cartera, 0) > 0 THEN (ISNULL(S.MoraCPP, 0) / CAST(S.Cartera AS FLOAT)) * 100.0 ELSE 0 END AS cpp,
            ISNULL(MS.MetaMoraCPP, 0.10) * 100.0 AS meta,
            ISNULL(S.MoraCPP, 0) - (ISNULL(S.Cartera, 0) * ISNULL(MS.MetaMoraCPP, 0.10)) AS excedente
        FROM CTE_Flow F FULL OUTER JOIN CTE_Stock S ON F.IdSAgencia = S.IdSAgencia FULL OUTER JOIN CTE_MetasFlow MF ON COALESCE(F.IdSAgencia, S.IdSAgencia) = MF.IdSAgencia FULL OUTER JOIN CTE_MetasStock MS ON COALESCE(F.IdSAgencia, S.IdSAgencia, MF.IdSAgencia) = MS.IdSAgencia
        WHERE COALESCE(F.IdSAgencia, S.IdSAgencia, MF.IdSAgencia) IS NOT NULL ORDER BY amountAchieved DESC;

        -- =================================================================
        -- QUERY 2: CARTERA DE NORMALIZACIÓN (Solo Recuperadores, por Asesor)
        -- =================================================================
        WITH CTE_Recuperadores AS (
            SELECT IdSAsesor, IdSAgencia, AsesorNombresApellidos AS Recuperador FROM DWH_Gestion_Cartera.dbo.dim_asesor WHERE Periodo = @periodo AND Cargo = 'RECUPERADOR'
        ),
        CTE_Flow_Rec AS (
            SELECT IdSAsesor, ISNULL(SUM(RepagoReal), 0) AS Repagos FROM DWH_Gestion_Cartera.dbo.fct_flow WHERE Periodo = @periodo GROUP BY IdSAsesor
        ),
        CTE_Stock_Rec AS (
            SELECT IdSAsesor, ISNULL(SUM(Cartera), 0) AS Cartera, ISNULL(SUM(Mora9), 0) AS MoraCPP, ISNULL(SUM(Mora31), 0) AS MoraDeficiente FROM DWH_Gestion_Cartera.dbo.fct_stock WHERE Periodo = @periodo GROUP BY IdSAsesor
        )
        SELECT 
            CASE R.IdSAgencia WHEN '01' THEN 'Wanchaq' WHEN '02' THEN 'San Jerónimo' WHEN '03' THEN 'Quillabamba' WHEN '04' THEN 'Sicuani' WHEN '05' THEN 'Molino' WHEN '06' THEN 'Juliaca' WHEN '07' THEN 'Lima Los Olivos' WHEN '08' THEN 'Tica Tica' WHEN '09' THEN 'Magisterio' WHEN '10' THEN 'Lima SJL' WHEN '11' THEN 'Chiclayo' WHEN '12' THEN 'Arequipa' WHEN '13' THEN 'Pucallpa' ELSE 'Otra Agencia' END AS agency,
            R.Recuperador AS recuperador, ISNULL(S.Cartera, 0) AS cartera, ISNULL(F.Repagos, 0) AS repagos, ISNULL(S.MoraCPP, 0) AS moraCPP_soles, ISNULL(S.MoraDeficiente, 0) AS moraDeficiente_soles,
            CASE WHEN ISNULL(S.Cartera, 0) > 0 THEN (ISNULL(S.MoraCPP, 0) / CAST(S.Cartera AS FLOAT)) * 100.0 ELSE 0 END AS pctMora9,
            (0 - ISNULL(F.Repagos, 0)) - ISNULL(S.MoraDeficiente, 0) AS crecNeto30
        FROM CTE_Recuperadores R LEFT JOIN CTE_Flow_Rec F ON R.IdSAsesor = F.IdSAsesor LEFT JOIN CTE_Stock_Rec S ON R.IdSAsesor = S.IdSAsesor ORDER BY cartera DESC;
      `);

    res.json({
        comercial: result.recordsets[0],
        normalizacion: result.recordsets[1]
    });
  } catch (error) {
    console.error("Error obteniendo Indicadores Gerenciales:", error);
    res.status(500).json({ error: "Error calculando indicadores gerenciales" });
  }
});

export default router;