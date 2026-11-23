// D:\Proyectos\power-bi-web_backend\src\routes\supervision.ts
import { Router, Request, Response } from "express";
import sql from "mssql";
import { pool } from "../lib/db";

const router = Router();

router.get(["/supervision/:periodo", "/api/supervision/:periodo"], async (req: Request, res: Response) => {
  const { periodo } = req.params;

  try {
    const request = pool.request();

    const result = await request
      .input("periodo", sql.VarChar(6), periodo)
      .query(`
        -- =================================================================
        -- 1. AGENCIA COMPLETA (Comerciales + Recuperadores)
        -- =================================================================
        WITH CTE_CarteraInic_All AS (
            SELECT 
                DA.IdSAgencia, 
                SUM(A.CarteraInicial) AS CarteraInicial
            FROM dm_productividad.dbo.fct_stock_manubl_asesor_month A WITH (NOLOCK)
            INNER JOIN (
                SELECT RTRIM(LTRIM(IdSAsesor)) AS IdSAsesor, MAX(RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2)) AS IdSAgencia
                FROM DWH_Gestion_Cartera.dbo.dim_asesor WITH (NOLOCK)
                WHERE Periodo = @periodo
                GROUP BY RTRIM(LTRIM(IdSAsesor))
            ) DA ON RTRIM(LTRIM(A.IdSAsesor)) = DA.IdSAsesor
            WHERE A.Periodo = @periodo
            GROUP BY DA.IdSAgencia
        ),
        CTE_Flow_All AS (
            SELECT RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2) AS IdSAgencia, ISNULL(SUM(ColocacionNumReal), 0) AS NroOper, ISNULL(SUM(ColocacionMontoReal), 0) AS Desembolsos, ISNULL(SUM(RepagoReal), 0) AS Repagos 
            FROM DWH_Gestion_Cartera.dbo.fct_flow WITH (NOLOCK) WHERE Periodo = @periodo GROUP BY RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2)
        ),
        CTE_Stock_All AS (
            SELECT 
                RIGHT('00' + RTRIM(LTRIM(S.IdSAgencia)), 2) AS IdSAgencia, 
                ISNULL(SUM(S.Cartera), 0) AS Cartera, 
                ISNULL(SUM(S.Mora9), 0) AS MoraCPP, 
                ISNULL(SUM(S.Mora31), 0) AS MoraDeficiente, 
                ISNULL(SUM(S.Mora150), 0) AS Mora150, 
                ISNULL(SUM(S.Varios), 0) AS Varios, 
                ISNULL(SUM(CASE WHEN A.Cargo <> 'RECUPERADOR' OR A.Cargo IS NULL THEN S.NroSociosAnterior ELSE 0 END), 0) AS SociosInicio, 
                ISNULL(SUM(CASE WHEN A.Cargo <> 'RECUPERADOR' OR A.Cargo IS NULL THEN S.NroSocios ELSE 0 END), 0) AS SociosActual
            FROM DWH_Gestion_Cartera.dbo.fct_stock S WITH (NOLOCK)
            LEFT JOIN (
                SELECT RTRIM(LTRIM(IdSAsesor)) AS IdSAsesor, MAX(Cargo) AS Cargo
                FROM DWH_Gestion_Cartera.dbo.dim_asesor WITH (NOLOCK)
                WHERE Periodo = @periodo
                GROUP BY RTRIM(LTRIM(IdSAsesor))
            ) A ON RTRIM(LTRIM(S.IdSAsesor)) = A.IdSAsesor
            WHERE S.Periodo = @periodo 
            GROUP BY RIGHT('00' + RTRIM(LTRIM(S.IdSAgencia)), 2)
        ),
        CTE_MetasFlow_All AS (
            SELECT RIGHT('00' + RTRIM(LTRIM(CAST(IdSAgencia AS VARCHAR(5)))), 2) AS IdSAgencia, ISNULL(SUM(CASE WHEN ColocacionNumMetaAjus > 0 THEN ColocacionNumMetaAjus ELSE ColocacionNumMeta END), 0) AS MetaOperaciones 
            FROM dm_productividad.dbo.FctMensual WITH (NOLOCK) WHERE Periodo = @periodo GROUP BY RIGHT('00' + RTRIM(LTRIM(CAST(IdSAgencia AS VARCHAR(5)))), 2)
        ),
        CTE_MetasStock_All AS (
            SELECT 
                RIGHT('00' + RTRIM(LTRIM(CAST(M.IdSAgencia AS VARCHAR(5)))), 2) AS IdSAgencia, 
                ISNULL(MAX(M.Mora9Meta), 0.10) AS MetaMoraCPP, 
                ISNULL(MAX(M.Mora31Meta), CASE WHEN @periodo >= '202610' THEN 0.023 ELSE 0.02 END) AS MetaMoraDeficiente,
                COALESCE(MAX(CI.CarteraInicial), MAX(M.CarteraInicial), 0) AS CarteraInicial
            FROM dm_productividad.dbo.fct_stock_manubl_agencia_month M WITH (NOLOCK)
            LEFT JOIN CTE_CarteraInic_All CI ON RIGHT('00' + RTRIM(LTRIM(CAST(M.IdSAgencia AS VARCHAR(5)))), 2) = CI.IdSAgencia
            WHERE M.Periodo = @periodo 
            GROUP BY RIGHT('00' + RTRIM(LTRIM(CAST(M.IdSAgencia AS VARCHAR(5)))), 2)
        ),
        CTE_TEA_All AS (
            SELECT F.IdSAgencia, CASE WHEN SUM(F.Desembolsos) > 0 THEN SUM(F.Desembolsos * ISNULL(S.MaxTEA, 0)) / SUM(F.Desembolsos) ELSE 0 END AS TEA
            FROM (SELECT RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2) AS IdSAgencia, RTRIM(LTRIM(IdSAsesor)) AS IdSAsesor, SUM(ColocacionMontoReal) AS Desembolsos FROM DWH_Gestion_Cartera.dbo.fct_flow WITH (NOLOCK) WHERE Periodo = @periodo GROUP BY RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2), RTRIM(LTRIM(IdSAsesor))) F
            LEFT JOIN (SELECT RTRIM(LTRIM(IdSAsesor)) AS IdSAsesor, MAX(TEA) AS MaxTEA FROM DWH_Gestion_Cartera.dbo.fct_stock WITH (NOLOCK) WHERE Periodo = @periodo GROUP BY RTRIM(LTRIM(IdSAsesor))) S ON F.IdSAsesor = S.IdSAsesor
            GROUP BY F.IdSAgencia
        )
        SELECT 
            CASE ISNULL(COALESCE(F.IdSAgencia, S.IdSAgencia, MF.IdSAgencia), '99') WHEN '01' THEN 'Wanchaq' WHEN '02' THEN 'San Jerónimo' WHEN '03' THEN 'Quillabamba' WHEN '04' THEN 'Sicuani' WHEN '05' THEN 'Molino' WHEN '06' THEN 'Juliaca' WHEN '07' THEN 'Lima Los Olivos' WHEN '08' THEN 'Tica Tica' WHEN '09' THEN 'Magisterio' WHEN '10' THEN 'Lima SJL' WHEN '11' THEN 'Chiclayo' WHEN '12' THEN 'Arequipa' WHEN '13' THEN 'Pucallpa' ELSE 'Otra Agencia' END AS agency,
            ((ISNULL(F.Desembolsos, 0) - ISNULL(F.Repagos, 0)) - ISNULL(S.Mora150, 0)) AS crecimientoNeto150, ISNULL(T.TEA, 0) AS tea, ISNULL(MF.MetaOperaciones, 0) AS opTarget, ISNULL(F.NroOper, 0) AS opAchieved,
            CASE WHEN ISNULL(F.NroOper, 0) > 0 THEN (ISNULL(S.Varios, 0) / CAST(F.NroOper AS FLOAT)) / 5.0 ELSE 0 END AS plazo,
            ISNULL(S.SociosInicio, 0) AS sociosInicio, ISNULL(S.SociosActual, 0) AS sociosActual, ISNULL(F.Desembolsos, 0) AS amountAchieved, 
            ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0)) AS cartera,
            (ISNULL(MS.MetaMoraCPP, 0.10) * ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0))) AS moraCppMax, ISNULL(S.MoraCPP, 0) AS moraCppActual,
            (ISNULL(MS.MetaMoraDeficiente, CASE WHEN @periodo >= '202610' THEN 0.023 ELSE 0.02 END) * ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0))) AS moraDefMax, ISNULL(S.MoraDeficiente, 0) AS moraDefActual, ISNULL(F.Repagos, 0) AS repagos
        FROM CTE_Flow_All F FULL OUTER JOIN CTE_Stock_All S ON F.IdSAgencia = S.IdSAgencia FULL OUTER JOIN CTE_MetasFlow_All MF ON COALESCE(F.IdSAgencia, S.IdSAgencia) = MF.IdSAgencia FULL OUTER JOIN CTE_MetasStock_All MS ON COALESCE(F.IdSAgencia, S.IdSAgencia, MF.IdSAgencia) = MS.IdSAgencia FULL OUTER JOIN CTE_TEA_All T ON COALESCE(F.IdSAgencia, S.IdSAgencia, MF.IdSAgencia) = T.IdSAgencia
        WHERE COALESCE(F.IdSAgencia, S.IdSAgencia, MF.IdSAgencia) IS NOT NULL ORDER BY amountAchieved DESC;

        -- =================================================================
        -- 2. AGENCIA COMERCIAL (Solo Analistas Comerciales)
        -- =================================================================
        WITH CTE_Asesores_Com AS (
            SELECT RTRIM(LTRIM(IdSAsesor)) AS IdSAsesor, MAX(RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2)) AS IdSAgencia 
            FROM DWH_Gestion_Cartera.dbo.dim_asesor WITH (NOLOCK) 
            WHERE Periodo = @periodo AND (Cargo <> 'RECUPERADOR' OR Cargo IS NULL)
            GROUP BY RTRIM(LTRIM(IdSAsesor))
        ),
        CTE_CarteraInic_Comercial AS (
            SELECT DA.IdSAgencia, SUM(A.CarteraInicial) AS CarteraInicial
            FROM dm_productividad.dbo.fct_stock_manubl_asesor_month A WITH (NOLOCK)
            INNER JOIN CTE_Asesores_Com DA ON RTRIM(LTRIM(A.IdSAsesor)) = DA.IdSAsesor
            WHERE A.Periodo = @periodo
            GROUP BY DA.IdSAgencia
        ),
        CTE_Flow_Com AS (
            SELECT RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2) AS IdSAgencia, ISNULL(SUM(ColocacionNumReal), 0) AS NroOper, ISNULL(SUM(ColocacionMontoReal), 0) AS Desembolsos, ISNULL(SUM(RepagoReal), 0) AS Repagos 
            FROM DWH_Gestion_Cartera.dbo.fct_flow WITH (NOLOCK) WHERE Periodo = @periodo AND RTRIM(LTRIM(IdSAsesor)) IN (SELECT IdSAsesor FROM CTE_Asesores_Com) GROUP BY RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2)
        ),
        CTE_Stock_Com AS (
            SELECT 
                RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2) AS IdSAgencia, 
                ISNULL(SUM(Cartera), 0) AS Cartera, 
                ISNULL(SUM(Mora9), 0) AS MoraCPP, 
                ISNULL(SUM(Mora31), 0) AS MoraDeficiente, 
                ISNULL(SUM(Mora150), 0) AS Mora150, 
                ISNULL(SUM(Varios), 0) AS Varios, 
                ISNULL(SUM(NroSociosAnterior), 0) AS SociosInicio, 
                ISNULL(SUM(NroSocios), 0) AS SociosActual,
                ISNULL(SUM(NroSociosCancelados), 0) AS SociosCancelados,
                ISNULL(SUM(NroSociosRecuperacion), 0) AS NroSociosRecuperacion, 
                ISNULL(SUM(NroSociosActivos), 0) AS SociosActivos
            FROM DWH_Gestion_Cartera.dbo.fct_stock WITH (NOLOCK)
            WHERE Periodo = @periodo AND RTRIM(LTRIM(IdSAsesor)) IN (SELECT IdSAsesor FROM CTE_Asesores_Com) 
            GROUP BY RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2)
        ),
        CTE_MetasFlow_Com AS (
            SELECT RIGHT('00' + RTRIM(LTRIM(CAST(IdSAgencia AS VARCHAR(5)))), 2) AS IdSAgencia, ISNULL(SUM(CASE WHEN ColocacionNumMetaAjus > 0 THEN ColocacionNumMetaAjus ELSE ColocacionNumMeta END), 0) AS MetaOperaciones 
            FROM dm_productividad.dbo.FctMensual WITH (NOLOCK) WHERE Periodo = @periodo GROUP BY RIGHT('00' + RTRIM(LTRIM(CAST(IdSAgencia AS VARCHAR(5)))), 2)
        ),
        CTE_MetasStock_Com AS (
            SELECT 
                RIGHT('00' + RTRIM(LTRIM(CAST(M.IdSAgencia AS VARCHAR(5)))), 2) AS IdSAgencia, 
                ISNULL(MAX(M.Mora9Meta), 0.10) AS MetaMoraCPP, 
                ISNULL(MAX(M.Mora31Meta), CASE WHEN @periodo >= '202610' THEN 0.023 ELSE 0.02 END) AS MetaMoraDeficiente,
                ISNULL(MAX(CI.CarteraInicial), 0) AS CarteraInicial
            FROM dm_productividad.dbo.fct_stock_manubl_agencia_month M WITH (NOLOCK)
            LEFT JOIN CTE_CarteraInic_Comercial CI ON RIGHT('00' + RTRIM(LTRIM(CAST(M.IdSAgencia AS VARCHAR(5)))), 2) = CI.IdSAgencia
            WHERE M.Periodo = @periodo 
            GROUP BY RIGHT('00' + RTRIM(LTRIM(CAST(M.IdSAgencia AS VARCHAR(5)))), 2)
        ),
        CTE_TEA_Com AS (
            SELECT F.IdSAgencia, CASE WHEN SUM(F.Desembolsos) > 0 THEN SUM(F.Desembolsos * ISNULL(S.MaxTEA, 0)) / SUM(F.Desembolsos) ELSE 0 END AS TEA
            FROM (SELECT RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2) AS IdSAgencia, RTRIM(LTRIM(IdSAsesor)) AS IdSAsesor, SUM(ColocacionMontoReal) AS Desembolsos FROM DWH_Gestion_Cartera.dbo.fct_flow WITH (NOLOCK) WHERE Periodo = @periodo AND RTRIM(LTRIM(IdSAsesor)) IN (SELECT IdSAsesor FROM CTE_Asesores_Com) GROUP BY RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2), RTRIM(LTRIM(IdSAsesor))) F
            LEFT JOIN (SELECT RTRIM(LTRIM(IdSAsesor)) AS IdSAsesor, MAX(TEA) AS MaxTEA FROM DWH_Gestion_Cartera.dbo.fct_stock WITH (NOLOCK) WHERE Periodo = @periodo AND RTRIM(LTRIM(IdSAsesor)) IN (SELECT IdSAsesor FROM CTE_Asesores_Com) GROUP BY RTRIM(LTRIM(IdSAsesor))) S ON F.IdSAsesor = S.IdSAsesor
            GROUP BY F.IdSAgencia
        )
        SELECT 
            CASE ISNULL(COALESCE(F.IdSAgencia, S.IdSAgencia, MF.IdSAgencia), '99') WHEN '01' THEN 'Wanchaq' WHEN '02' THEN 'San Jerónimo' WHEN '03' THEN 'Quillabamba' WHEN '04' THEN 'Sicuani' WHEN '05' THEN 'Molino' WHEN '06' THEN 'Juliaca' WHEN '07' THEN 'Lima Los Olivos' WHEN '08' THEN 'Tica Tica' WHEN '09' THEN 'Magisterio' WHEN '10' THEN 'Lima SJL' WHEN '11' THEN 'Chiclayo' WHEN '12' THEN 'Arequipa' WHEN '13' THEN 'Pucallpa' ELSE 'Otra Agencia' END AS agency,
            ((ISNULL(F.Desembolsos, 0) - ISNULL(F.Repagos, 0)) - ISNULL(S.Mora150, 0)) AS crecimientoNeto150, ISNULL(T.TEA, 0) AS tea, ISNULL(MF.MetaOperaciones, 0) AS opTarget, ISNULL(F.NroOper, 0) AS opAchieved,
            CASE WHEN ISNULL(F.NroOper, 0) > 0 THEN (ISNULL(S.Varios, 0) / CAST(F.NroOper AS FLOAT)) / 5.0 ELSE 0 END AS plazo,
            ISNULL(S.SociosInicio, 0) AS sociosInicio, ISNULL(S.SociosActual, 0) AS sociosActual, ISNULL(F.Desembolsos, 0) AS amountAchieved, 
            ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0)) AS cartera,
            (ISNULL(MS.MetaMoraCPP, 0.10) * ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0))) AS moraCppMax, ISNULL(S.MoraCPP, 0) AS moraCppActual,
            (ISNULL(MS.MetaMoraDeficiente, CASE WHEN @periodo >= '202610' THEN 0.023 ELSE 0.02 END) * ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0))) AS moraDefMax, ISNULL(S.MoraDeficiente, 0) AS moraDefActual,
            ISNULL(F.Repagos, 0) AS repagos,
            ISNULL(S.SociosCancelados, 0) AS sociosCancelados,
            ISNULL(S.NroSociosRecuperacion, 0) AS sociosRecuperacion,
            (ISNULL(S.SociosActual, 0) - (ISNULL(S.SociosInicio, 0) - ISNULL(S.NroSociosRecuperacion, 0))) AS crecimientoSocios,
            ISNULL(S.SociosActivos, 0) AS sociosActivos,
            CASE WHEN ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0)) > 0 THEN (ISNULL(S.MoraCPP, 0) / CAST(ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0)) AS FLOAT)) * 100 ELSE 0 END AS pctMoraCpp,
            CASE WHEN ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0)) > 0 THEN (ISNULL(S.MoraDeficiente, 0) / CAST(ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0)) AS FLOAT)) * 100 ELSE 0 END AS pctMoraDef,
            (ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0)) + ((ISNULL(F.Desembolsos, 0) - ISNULL(F.Repagos, 0)) - ISNULL(S.Mora150, 0))) AS carteraFin,
            CASE WHEN (ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0)) + ((ISNULL(F.Desembolsos, 0) - ISNULL(F.Repagos, 0)) - ISNULL(S.Mora150, 0))) > 0 THEN (ISNULL(S.MoraCPP, 0) / CAST((ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0)) + ((ISNULL(F.Desembolsos, 0) - ISNULL(F.Repagos, 0)) - ISNULL(S.Mora150, 0))) AS FLOAT)) * 100 ELSE 0 END AS pctMoraCppCf,
            CASE WHEN (ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0)) + ((ISNULL(F.Desembolsos, 0) - ISNULL(F.Repagos, 0)) - ISNULL(S.Mora150, 0))) > 0 THEN (ISNULL(S.MoraDeficiente, 0) / CAST((ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0)) + ((ISNULL(F.Desembolsos, 0) - ISNULL(F.Repagos, 0)) - ISNULL(S.Mora150, 0))) AS FLOAT)) * 100 ELSE 0 END AS pctMoraDefCf
        FROM CTE_Flow_Com F FULL OUTER JOIN CTE_Stock_Com S ON F.IdSAgencia = S.IdSAgencia FULL OUTER JOIN CTE_MetasFlow_Com MF ON COALESCE(F.IdSAgencia, S.IdSAgencia) = MF.IdSAgencia FULL OUTER JOIN CTE_MetasStock_Com MS ON COALESCE(F.IdSAgencia, S.IdSAgencia, MF.IdSAgencia) = MS.IdSAgencia FULL OUTER JOIN CTE_TEA_Com T ON COALESCE(F.IdSAgencia, S.IdSAgencia, MF.IdSAgencia) = T.IdSAgencia
        WHERE COALESCE(F.IdSAgencia, S.IdSAgencia, MF.IdSAgencia) IS NOT NULL ORDER BY amountAchieved DESC;

        -- =================================================================
        -- 3. RECUPERADORES 
        -- =================================================================
        WITH CTE_Metas_Agencia AS (
            SELECT RIGHT('00' + RTRIM(LTRIM(CAST(IdSAgencia AS VARCHAR(5)))), 2) AS IdSAgencia, ISNULL(MAX(Mora9Meta), 0.10) AS MetaMoraCPP, ISNULL(MAX(Mora31Meta), CASE WHEN @periodo >= '202610' THEN 0.023 ELSE 0.02 END) AS MetaMoraDeficiente
            FROM dm_productividad.dbo.fct_stock_manubl_agencia_month WITH (NOLOCK) WHERE Periodo = @periodo GROUP BY RIGHT('00' + RTRIM(LTRIM(CAST(IdSAgencia AS VARCHAR(5)))), 2)
        ),
        CTE_Metas_Asesor AS (
            SELECT RTRIM(LTRIM(IdSAsesor)) AS IdSAsesor, ISNULL(SUM(CarteraInicial), 0) AS CarteraInicial
            FROM dm_productividad.dbo.fct_stock_manubl_asesor_month WITH (NOLOCK) WHERE Periodo = @periodo GROUP BY RTRIM(LTRIM(IdSAsesor))
        ),
        CTE_Rec_List AS (
            SELECT RTRIM(LTRIM(IdSAsesor)) AS IdSAsesor, MAX(RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2)) AS IdSAgencia, MAX(AsesorNombresApellidos) AS Recuperador 
            FROM DWH_Gestion_Cartera.dbo.dim_asesor WITH (NOLOCK)
            WHERE Periodo = @periodo AND Cargo = 'RECUPERADOR'
            GROUP BY RTRIM(LTRIM(IdSAsesor))
        ),
        CTE_Flow_Rec AS (
            SELECT RTRIM(LTRIM(IdSAsesor)) AS IdSAsesor, ISNULL(SUM(ColocacionMontoReal),0) AS Desembolsos, ISNULL(SUM(RepagoReal), 0) AS Repagos 
            FROM DWH_Gestion_Cartera.dbo.fct_flow WITH (NOLOCK) WHERE Periodo = @periodo GROUP BY RTRIM(LTRIM(IdSAsesor))
        ),
        CTE_Stock_Rec AS (
            SELECT RTRIM(LTRIM(IdSAsesor)) AS IdSAsesor, ISNULL(SUM(Cartera), 0) AS Cartera, ISNULL(SUM(Mora9), 0) AS MoraCPP, ISNULL(SUM(Mora31), 0) AS MoraDeficiente, ISNULL(SUM(Mora150), 0) AS Mora150 
            FROM DWH_Gestion_Cartera.dbo.fct_stock WITH (NOLOCK) WHERE Periodo = @periodo GROUP BY RTRIM(LTRIM(IdSAsesor))
        ),
        CTE_MetasStock_Rec AS (
            SELECT R.IdSAsesor, R.IdSAgencia, ISNULL(MA.MetaMoraCPP, 0.10) AS MetaMoraCPP, ISNULL(MA.MetaMoraDeficiente, CASE WHEN @periodo >= '202610' THEN 0.023 ELSE 0.02 END) AS MetaMoraDeficiente, ISNULL(MAS.CarteraInicial, 0) AS CarteraInicial
            FROM CTE_Rec_List R
            LEFT JOIN CTE_Metas_Agencia MA ON R.IdSAgencia = MA.IdSAgencia
            LEFT JOIN CTE_Metas_Asesor MAS ON R.IdSAsesor = MAS.IdSAsesor
        )
        SELECT 
            CASE R.IdSAgencia WHEN '01' THEN 'Wanchaq' WHEN '02' THEN 'San Jerónimo' WHEN '03' THEN 'Quillabamba' WHEN '04' THEN 'Sicuani' WHEN '05' THEN 'Molino' WHEN '06' THEN 'Juliaca' WHEN '07' THEN 'Lima Los Olivos' WHEN '08' THEN 'Tica Tica' WHEN '09' THEN 'Magisterio' WHEN '10' THEN 'Lima SJL' WHEN '11' THEN 'Chiclayo' WHEN '12' THEN 'Arequipa' WHEN '13' THEN 'Pucallpa' ELSE 'Otra Agencia' END AS agency,
            R.Recuperador AS recuperador,
            ((ISNULL(F.Desembolsos, 0) - ISNULL(F.Repagos, 0)) - ISNULL(S.Mora150, 0)) AS crecimientoNeto150,
            ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0)) AS carteraInicio,
            (MS.MetaMoraCPP * ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0))) AS moraCppMax, ISNULL(S.MoraCPP, 0) AS moraCppActual,
            (MS.MetaMoraDeficiente * ISNULL(NULLIF(MS.CarteraInicial, 0), ISNULL(S.Cartera, 0))) AS moraDefMax, ISNULL(S.MoraDeficiente, 0) AS moraDefActual,
            ISNULL(F.Repagos, 0) AS repagos
        FROM CTE_Rec_List R 
        LEFT JOIN CTE_Flow_Rec F ON R.IdSAsesor = F.IdSAsesor 
        LEFT JOIN CTE_Stock_Rec S ON R.IdSAsesor = S.IdSAsesor 
        LEFT JOIN CTE_MetasStock_Rec MS ON R.IdSAsesor = MS.IdSAsesor
        ORDER BY moraCppActual DESC;
      `);

    const recordsets = result.recordsets as unknown as any[];

    res.json({
      completa: recordsets[0],
      comercial: recordsets[1],
      recuperacion: recordsets[2],
    });
  } catch (error) {
    console.error("Error obteniendo Supervisión:", error);
    res.status(500).json({ error: "Error calculando supervisión" });
  }
});

export default router;