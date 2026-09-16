//routes/agencia.ts

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

router.get(["/agencia", "/api/agencia"], async (req: Request, res: Response) => {
  const periodo = req.query.periodo as string;

  if (!periodo) {
    return res.status(400).json({ error: "El periodo es requerido" });
  }

  try {
    const pool = await sql.connect(dbConfig);
    
    const result = await pool.request()
      .input('periodo', sql.VarChar(6), periodo)
      .query(`
        -- =================================================================
        -- 1. ASESORES COMERCIALES
        -- =================================================================
        WITH CTE_Metas_Agencia AS (
            SELECT IdSAgencia, ISNULL(SUM(Mora9Meta), 0.10) AS MetaMoraCPP, ISNULL(SUM(Mora31Meta), 0.05) AS MetaMoraDeficiente
            FROM dm_productividad.dbo.fct_stock_manubl_agencia_month
            WHERE Periodo = @periodo GROUP BY IdSAgencia
        ),
        CTE_Metas_Asesor AS (
            SELECT IdSAsesor, ISNULL(SUM(CarteraInicial), 0) AS CarteraInicial
            FROM dm_productividad.dbo.fct_stock_manubl_asesor_month
            WHERE Periodo = @periodo GROUP BY IdSAsesor
        ),
        CTE_Asesores_Com AS (
            SELECT IdSAsesor, IdSAgencia, AsesorNombresApellidos AS Asesor, ISNULL(ColocacionNumMeta, 30) AS MetaAsesor
            FROM DWH_Gestion_Cartera.dbo.dim_asesor 
            WHERE Periodo = @periodo AND (Cargo <> 'RECUPERADOR' OR Cargo IS NULL)
        ),
        CTE_Flow_Com AS (
            SELECT IdSAsesor, ISNULL(SUM(ColocacionNumReal), 0) AS NroOper, ISNULL(SUM(ColocacionMontoReal), 0) AS Desembolsos, ISNULL(SUM(RepagoReal), 0) AS Repagos 
            FROM DWH_Gestion_Cartera.dbo.fct_flow 
            WHERE Periodo = @periodo GROUP BY IdSAsesor
        ),
        CTE_Stock_Com AS (
            SELECT IdSAsesor, ISNULL(SUM(Cartera), 0) AS Cartera, ISNULL(SUM(Mora9), 0) AS MoraCPP, ISNULL(SUM(Mora31), 0) AS MoraDeficiente, ISNULL(SUM(Mora150), 0) AS Mora150, ISNULL(SUM(Varios), 0) AS Varios, ISNULL(SUM(NroSociosAnterior), 0) AS SociosInicio, ISNULL(SUM(NroSocios), 0) AS SociosActual, ISNULL(MAX(TEA), 0) AS TEA 
            FROM DWH_Gestion_Cartera.dbo.fct_stock 
            WHERE Periodo = @periodo GROUP BY IdSAsesor
        ),
        CTE_MetasStock_Com AS (
            SELECT A.IdSAsesor, A.IdSAgencia, ISNULL(MA.MetaMoraCPP, 0.10) AS MetaMoraCPP, ISNULL(MA.MetaMoraDeficiente, 0.05) AS MetaMoraDeficiente, ISNULL(MAS.CarteraInicial, 0) AS CarteraInicial
            FROM CTE_Asesores_Com A
            LEFT JOIN CTE_Metas_Agencia MA ON A.IdSAgencia = MA.IdSAgencia
            LEFT JOIN CTE_Metas_Asesor MAS ON A.IdSAsesor = MAS.IdSAsesor
        )
        SELECT 
            CASE A.IdSAgencia WHEN '01' THEN 'Wanchaq' WHEN '02' THEN 'San Jerónimo' WHEN '03' THEN 'Quillabamba' WHEN '04' THEN 'Sicuani' WHEN '05' THEN 'Molino' WHEN '06' THEN 'Juliaca' WHEN '07' THEN 'Lima Los Olivos' WHEN '08' THEN 'Tica Tica' WHEN '09' THEN 'Magisterio' WHEN '10' THEN 'Lima SJL' WHEN '11' THEN 'Chiclayo' WHEN '12' THEN 'Arequipa' WHEN '13' THEN 'Pucallpa' ELSE 'Otra Agencia' END AS agency,
            A.Asesor AS asesor, 
            A.MetaAsesor AS metaAsesor,
            ((ISNULL(F.Desembolsos, 0) - ISNULL(F.Repagos, 0)) - ISNULL(S.Mora150, 0)) AS crecimientoNeto150, 
            ISNULL(F.Desembolsos, 0) AS amountAchieved, ISNULL(F.Repagos, 0) AS repagos, ISNULL(S.TEA, 0) AS tea, ISNULL(F.NroOper, 0) AS opAchieved,
            CASE WHEN ISNULL(F.NroOper, 0) > 0 THEN (ISNULL(S.Varios, 0) / CAST(F.NroOper AS FLOAT)) / 5.0 ELSE 0 END AS plazo, ISNULL(S.SociosInicio, 0) AS sociosInicio, ISNULL(S.SociosActual, 0) AS sociosActual, ISNULL(S.Cartera, 0) AS cartera,
            (MS.MetaMoraCPP * ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0))) AS moraCppMax, ISNULL(S.MoraCPP, 0) AS moraCppActual, CASE WHEN ISNULL(S.Cartera, 0) > 0 THEN (ISNULL(S.MoraCPP, 0) / CAST(S.Cartera AS FLOAT)) * 100 ELSE 0 END AS pctMoraCpp,
            (MS.MetaMoraDeficiente * ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0))) AS moraDefMax, ISNULL(S.MoraDeficiente, 0) AS moraDefActual
        FROM CTE_Asesores_Com A 
        LEFT JOIN CTE_Flow_Com F ON A.IdSAsesor = F.IdSAsesor 
        LEFT JOIN CTE_Stock_Com S ON A.IdSAsesor = S.IdSAsesor 
        LEFT JOIN CTE_MetasStock_Com MS ON A.IdSAsesor = MS.IdSAsesor 
        ORDER BY amountAchieved DESC;

        -- =================================================================
        -- 2. RECUPERADORES
        -- =================================================================
        WITH CTE_Metas_Agencia AS (
            SELECT IdSAgencia, ISNULL(SUM(Mora9Meta), 0.10) AS MetaMoraCPP, ISNULL(SUM(Mora31Meta), 0.05) AS MetaMoraDeficiente
            FROM dm_productividad.dbo.fct_stock_manubl_agencia_month WHERE Periodo = @periodo GROUP BY IdSAgencia
        ),
        CTE_Metas_Asesor AS (
            SELECT IdSAsesor, ISNULL(SUM(CarteraInicial), 0) AS CarteraInicial
            FROM dm_productividad.dbo.fct_stock_manubl_asesor_month WHERE Periodo = @periodo GROUP BY IdSAsesor
        ),
        CTE_Rec_List AS (
            SELECT IdSAsesor, IdSAgencia, AsesorNombresApellidos AS Recuperador FROM DWH_Gestion_Cartera.dbo.dim_asesor WHERE Periodo = @periodo AND Cargo = 'RECUPERADOR'
        ),
        CTE_Flow_Rec AS (
            SELECT IdSAsesor, ISNULL(SUM(ColocacionMontoReal),0) AS Desembolsos, ISNULL(SUM(RepagoReal), 0) AS Repagos FROM DWH_Gestion_Cartera.dbo.fct_flow WHERE Periodo = @periodo GROUP BY IdSAsesor
        ),
        CTE_Stock_Rec AS (
            SELECT IdSAsesor, ISNULL(SUM(Cartera), 0) AS Cartera, ISNULL(SUM(Mora9), 0) AS MoraCPP, ISNULL(SUM(Mora31), 0) AS MoraDeficiente, ISNULL(SUM(Mora150), 0) AS Mora150 FROM DWH_Gestion_Cartera.dbo.fct_stock WHERE Periodo = @periodo GROUP BY IdSAsesor
        ),
        CTE_MetasStock_Rec AS (
            SELECT R.IdSAsesor, R.IdSAgencia, ISNULL(MA.MetaMoraCPP, 0.10) AS MetaMoraCPP, ISNULL(MA.MetaMoraDeficiente, 0.05) AS MetaMoraDeficiente, ISNULL(MAS.CarteraInicial, 0) AS CarteraInicial
            FROM CTE_Rec_List R
            LEFT JOIN CTE_Metas_Agencia MA ON R.IdSAgencia = MA.IdSAgencia
            LEFT JOIN CTE_Metas_Asesor MAS ON R.IdSAsesor = MAS.IdSAsesor
        )
        SELECT 
            CASE R.IdSAgencia WHEN '01' THEN 'Wanchaq' WHEN '02' THEN 'San Jerónimo' WHEN '03' THEN 'Quillabamba' WHEN '04' THEN 'Sicuani' WHEN '05' THEN 'Molino' WHEN '06' THEN 'Juliaca' WHEN '07' THEN 'Lima Los Olivos' WHEN '08' THEN 'Tica Tica' WHEN '09' THEN 'Magisterio' WHEN '10' THEN 'Lima SJL' WHEN '11' THEN 'Chiclayo' WHEN '12' THEN 'Arequipa' WHEN '13' THEN 'Pucallpa' ELSE 'Otra Agencia' END AS agency,
            R.Recuperador AS recuperador, ((ISNULL(F.Desembolsos, 0) - ISNULL(F.Repagos, 0)) - ISNULL(S.Mora150, 0)) AS crecimientoNeto150, ISNULL(F.Repagos, 0) AS repagos, ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0)) AS carteraInicio,
            (MS.MetaMoraCPP * ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0))) AS moraCppMax, ISNULL(S.MoraCPP, 0) AS moraCppActual, (MS.MetaMoraDeficiente * ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0))) AS moraDefMax, ISNULL(S.MoraDeficiente, 0) AS moraDefActual
        FROM CTE_Rec_List R LEFT JOIN CTE_Flow_Rec F ON R.IdSAsesor = F.IdSAsesor LEFT JOIN CTE_Stock_Rec S ON R.IdSAsesor = S.IdSAsesor LEFT JOIN CTE_MetasStock_Rec MS ON R.IdSAsesor = MS.IdSAsesor ORDER BY moraCppActual DESC;

        -- =================================================================
        -- 3. RESUMEN DE AGENCIA 
        -- =================================================================
        SELECT 
            CASE IdSAgencia WHEN '01' THEN 'Wanchaq' WHEN '02' THEN 'San Jerónimo' WHEN '03' THEN 'Quillabamba' WHEN '04' THEN 'Sicuani' WHEN '05' THEN 'Molino' WHEN '06' THEN 'Juliaca' WHEN '07' THEN 'Lima Los Olivos' WHEN '08' THEN 'Tica Tica' WHEN '09' THEN 'Magisterio' WHEN '10' THEN 'Lima SJL' WHEN '11' THEN 'Chiclayo' WHEN '12' THEN 'Arequipa' WHEN '13' THEN 'Pucallpa' ELSE 'Otra Agencia' END AS agency,
            ISNULL(SUM(CASE WHEN ColocacionNumMetaAjus > 0 THEN ColocacionNumMetaAjus ELSE ColocacionNumMeta END), 0) AS opTarget
        FROM dm_productividad.dbo.FctMensual WHERE Periodo = @periodo GROUP BY IdSAgencia;
      `);

    res.json({ comercial: result.recordsets[0], recuperacion: result.recordsets[1], resumen: result.recordsets[2] });
  } catch (error) {
    console.error("Error obteniendo Agencia:", error);
    res.status(500).json({ error: "Error calculando detalle de agencia" });
  }
});

export default router;