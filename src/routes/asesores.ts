//routes/asesores.ts

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

router.get(["/asesores/:periodo", "/api/asesores/:periodo"], async (req: Request, res: Response) => {
  const { periodo } = req.params;

  try {
    const pool = await sql.connect(dbConfig);
    
    const result = await pool.request()
      .input('periodo', sql.VarChar(6), periodo)
      .query(`
        WITH CTE_Asesores_Com AS (
            SELECT IdSAsesor, IdSAgencia, AsesorNombresApellidos AS Asesor 
            FROM DWH_Gestion_Cartera.dbo.dim_asesor 
            WHERE Periodo = @periodo AND (Cargo <> 'RECUPERADOR' OR Cargo IS NULL)
        ),
        CTE_Flow_Com AS (
            SELECT IdSAsesor, ISNULL(SUM(ColocacionNumReal), 0) AS NroOper, ISNULL(SUM(ColocacionMontoReal), 0) AS Desembolsos, ISNULL(SUM(RepagoReal), 0) AS Repagos 
            FROM DWH_Gestion_Cartera.dbo.fct_flow 
            WHERE Periodo = @periodo 
            GROUP BY IdSAsesor
        ),
        CTE_Stock_Com AS (
            SELECT IdSAsesor, ISNULL(SUM(Cartera), 0) AS Cartera, ISNULL(SUM(Mora9), 0) AS MoraCPP, ISNULL(SUM(Mora31), 0) AS MoraDeficiente, ISNULL(SUM(Mora150), 0) AS Mora150, ISNULL(SUM(Varios), 0) AS Varios, ISNULL(SUM(NroSociosAnterior), 0) AS SociosInicio, ISNULL(SUM(NroSocios), 0) AS SociosActual 
            FROM DWH_Gestion_Cartera.dbo.fct_stock 
            WHERE Periodo = @periodo 
            GROUP BY IdSAsesor
        ),
        -- 🚀 OPTIMIZACIÓN: Pre-agrupamos metas para evitar el problema N+1
        CTE_Metas_Agencia AS (
            SELECT IdSAgencia, ISNULL(SUM(Mora9Meta), 0.10) AS MetaMoraCPP, ISNULL(SUM(Mora31Meta), 0.05) AS MetaMoraDeficiente
            FROM dm_productividad.dbo.fct_stock_manubl_agencia_month
            WHERE Periodo = @periodo GROUP BY IdSAgencia
        ),
        CTE_Metas_Asesor AS (
            SELECT IdSAsesor, ISNULL(SUM(CarteraInicial), 0) AS CarteraInicial
            FROM dm_productividad.dbo.fct_stock_manubl_asesor_month
            WHERE Periodo = @periodo GROUP BY IdSAsesor
        ),
        CTE_MetasStock_Com AS (
            SELECT A.IdSAsesor, A.IdSAgencia,
                ISNULL(MA.MetaMoraCPP, 0.10) AS MetaMoraCPP,
                ISNULL(MA.MetaMoraDeficiente, 0.05) AS MetaMoraDeficiente,
                ISNULL(MAS.CarteraInicial, 0) AS CarteraInicial
            FROM CTE_Asesores_Com A
            LEFT JOIN CTE_Metas_Agencia MA ON A.IdSAgencia = MA.IdSAgencia
            LEFT JOIN CTE_Metas_Asesor MAS ON A.IdSAsesor = MAS.IdSAsesor
        )
        SELECT 
            CASE A.IdSAgencia WHEN '01' THEN 'Wanchaq' WHEN '02' THEN 'San Jerónimo' WHEN '03' THEN 'Quillabamba' WHEN '04' THEN 'Sicuani' WHEN '05' THEN 'Molino' WHEN '06' THEN 'Juliaca' WHEN '07' THEN 'Lima Los Olivos' WHEN '08' THEN 'Tica Tica' WHEN '09' THEN 'Magisterio' WHEN '10' THEN 'Lima SJL' WHEN '11' THEN 'Chiclayo' WHEN '12' THEN 'Arequipa' WHEN '13' THEN 'Pucallpa' ELSE 'Otra Agencia' END AS agency,
            A.Asesor AS asesor,
            ISNULL(S.Cartera, 0) AS cartera,
            ISNULL(F.Desembolsos, 0) AS desembolsos,
            ISNULL(F.Repagos, 0) AS repagos,
            (ISNULL(F.Desembolsos, 0) - ISNULL(F.Repagos, 0)) AS crecimientoBruto,
            ISNULL(S.Mora150, 0) AS mora150,
            CASE WHEN ISNULL(S.Cartera, 0) > 0 THEN (ISNULL(S.Mora150, 0) / CAST(S.Cartera AS FLOAT)) * 100 ELSE 0 END AS pctMora150,
            ((ISNULL(F.Desembolsos, 0) - ISNULL(F.Repagos, 0)) - ISNULL(S.Mora150, 0)) AS crecimientoNeto150,
            CASE WHEN ((ISNULL(F.Desembolsos, 0) - ISNULL(F.Repagos, 0)) - ISNULL(S.Mora150, 0)) < 20000 THEN 20000 - ((ISNULL(F.Desembolsos, 0) - ISNULL(F.Repagos, 0)) - ISNULL(S.Mora150, 0)) ELSE 0 END AS faltante20k,
            ISNULL(F.NroOper, 0) AS opAchieved,
            CASE WHEN ISNULL(F.NroOper, 0) > 0 THEN (ISNULL(S.Varios, 0) / CAST(F.NroOper AS FLOAT)) / 5.0 ELSE 0 END AS duracion,
            ISNULL(S.SociosInicio, 0) AS sociosInicio,
            ISNULL(S.SociosActual, 0) AS sociosActual,
            (ISNULL(S.SociosActual, 0) - ISNULL(S.SociosInicio, 0)) AS sociosNuevos,
            ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0)) AS carteraInicio,
            ISNULL(S.MoraCPP, 0) AS moraCppActual,
            CASE WHEN ISNULL(S.Cartera, 0) > 0 THEN (ISNULL(S.MoraCPP, 0) / CAST(S.Cartera AS FLOAT)) * 100 ELSE 0 END AS pctMoraCpp,
            (MS.MetaMoraCPP * 100) AS metaMoraCpp,
            CASE WHEN ISNULL(S.Cartera, 0) > 0 THEN ((ISNULL(S.MoraCPP, 0) / CAST(S.Cartera AS FLOAT)) * 100) - (MS.MetaMoraCPP * 100) ELSE 0 END AS excedentePctCpp,
            ISNULL(S.MoraCPP, 0) - (MS.MetaMoraCPP * ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0))) AS excedenteSolesCpp,
            ISNULL(S.MoraDeficiente, 0) AS moraDefActual,
            CASE WHEN ISNULL(S.Cartera, 0) > 0 THEN (ISNULL(S.MoraDeficiente, 0) / CAST(S.Cartera AS FLOAT)) * 100 ELSE 0 END AS pctMoraDef,
            (MS.MetaMoraDeficiente * 100) AS metaMoraDef,
            CASE WHEN ISNULL(S.Cartera, 0) > 0 THEN ((ISNULL(S.MoraDeficiente, 0) / CAST(S.Cartera AS FLOAT)) * 100) - (MS.MetaMoraDeficiente * 100) ELSE 0 END AS excedentePctDef,
            ISNULL(S.MoraDeficiente, 0) - (MS.MetaMoraDeficiente * ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0))) AS excedenteSolesDef
        FROM CTE_Asesores_Com A 
        LEFT JOIN CTE_Flow_Com F ON A.IdSAsesor = F.IdSAsesor 
        LEFT JOIN CTE_Stock_Com S ON A.IdSAsesor = S.IdSAsesor 
        LEFT JOIN CTE_MetasStock_Com MS ON A.IdSAsesor = MS.IdSAsesor 
        ORDER BY A.Asesor ASC;
      `);

    res.json(result.recordset);
  } catch (error) {
    console.error("Error obteniendo Indicadores Asesores:", error);
    res.status(500).json({ error: "Error calculando asesores" });
  }
});

export default router;