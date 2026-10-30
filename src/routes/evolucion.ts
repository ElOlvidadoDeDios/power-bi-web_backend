// D:\Proyectos\power-bi-web_backend\src\routes\evolucion.ts
import { Router, Request, Response } from "express";
import sql from "mssql";
import { pool } from "../lib/db";

const router = Router();

router.get(["/evolucion", "/api/evolucion"], async (req: Request, res: Response) => {
  const agenciaParam = (req.query.agencia as string) || "";
  const asesorParam = (req.query.asesor as string) || "";
  const granularidad = (req.query.granularidad as string) || "Mensual";
  const desde = (req.query.desde as string) || "";
  const hasta = (req.query.hasta as string) || "";

  const agencia =
    agenciaParam === "Todas" || agenciaParam === "Todas las Agencias"
      ? ""
      : agenciaParam.trim();
  const asesor =
    asesorParam === "Todos" || asesorParam === "Todos los Analistas"
      ? ""
      : asesorParam.trim();

  try {
    const request = pool.request();
    let querySQL = "";

    if (granularidad === "Mensual") {
      querySQL = `
        WITH Calendario AS (
            SELECT DISTINCT 
                RTRIM(LTRIM(Periodo)) AS Periodo, 
                MAX(MesLargo + ' ' + CAST(Año AS VARCHAR)) AS Etiqueta
            FROM dm_productividad.dbo.dim_calendario WITH (NOLOCK)
            WHERE RTRIM(LTRIM(Periodo)) >= @desde AND RTRIM(LTRIM(Periodo)) <= @hasta
            GROUP BY RTRIM(LTRIM(Periodo))
        ),
        AsesoresValidos AS (
            SELECT 
                RTRIM(LTRIM(D_AS.Periodo)) AS Periodo,
                RTRIM(LTRIM(D_AS.IdSAsesor)) AS IdSAsesor,
                MAX(RIGHT('00' + RTRIM(LTRIM(D_AS.IdSAgencia)), 2)) AS IdSAgencia,
                ISNULL(MAX(D_AS.ColocacionNumMeta), 30) AS MetaOpAsesor
            FROM DWH_Gestion_Cartera.dbo.dim_asesor D_AS WITH (NOLOCK)
            LEFT JOIN DWH_Gestion_Cartera.dbo.dim_agencia DA WITH (NOLOCK)
                ON RIGHT('00' + RTRIM(LTRIM(D_AS.IdSAgencia)), 2) = RIGHT('00' + RTRIM(LTRIM(DA.IdSAgencia)), 2)
            WHERE RTRIM(LTRIM(D_AS.Cargo)) = 'ANALISTA DE CREDITOS I'
              AND (@agencia = '' OR RTRIM(LTRIM(DA.Agencia)) = @agencia)
              AND (
                @asesor = '' 
                OR RTRIM(LTRIM(D_AS.AsesorNombresApellidos)) = @asesor 
                OR RTRIM(LTRIM(D_AS.Asesor)) = @asesor
                OR RTRIM(LTRIM(D_AS.IdSAsesor)) = @asesor
              )
            GROUP BY RTRIM(LTRIM(D_AS.Periodo)), RTRIM(LTRIM(D_AS.IdSAsesor))
        ),
        MetasAgencia AS (
            SELECT 
                RTRIM(LTRIM(M.Periodo)) AS Periodo,
                SUM(CASE WHEN ISNULL(M.ColocacionMontoMetaAjus, 0) > 0 THEN M.ColocacionMontoMetaAjus ELSE ISNULL(M.ColocacionMontoMeta, 0) END) AS MetaMontoAgencia,
                SUM(CASE WHEN ISNULL(M.ColocacionNumMetaAjus, 0) > 0 THEN M.ColocacionNumMetaAjus ELSE ISNULL(M.ColocacionNumMeta, 0) END) AS MetaNumAgencia
            FROM dm_productividad.dbo.FctMensual M WITH (NOLOCK)
            LEFT JOIN DWH_Gestion_Cartera.dbo.dim_agencia DA WITH (NOLOCK)
                ON RIGHT('00' + RTRIM(LTRIM(CAST(M.IdSAgencia AS VARCHAR(5)))), 2) = RIGHT('00' + RTRIM(LTRIM(DA.IdSAgencia)), 2)
            WHERE (@agencia = '' OR RTRIM(LTRIM(DA.Agencia)) = @agencia)
            GROUP BY RTRIM(LTRIM(M.Periodo))
        ),
        FlowPorAsesor AS (
            SELECT 
                RTRIM(LTRIM(F.Periodo)) AS Periodo,
                RTRIM(LTRIM(F.IdSAsesor)) AS IdSAsesor,
                ISNULL(SUM(F.ColocacionMontoReal), 0) AS ColocacionMonto,
                ISNULL(SUM(F.RepagoReal), 0) AS Repagos,
                ISNULL(SUM(F.ColocacionNumReal), 0) AS ColocacionNumReal
            FROM DWH_Gestion_Cartera.dbo.fct_flow F WITH (NOLOCK)
            WHERE RTRIM(LTRIM(F.Periodo)) >= @desde AND RTRIM(LTRIM(F.Periodo)) <= @hasta
            GROUP BY RTRIM(LTRIM(F.Periodo)), RTRIM(LTRIM(F.IdSAsesor))
        ),
        Flow AS (
            SELECT 
                AV.Periodo,
                ISNULL(SUM(FP.ColocacionMonto), 0) AS ColocacionMonto,
                ISNULL(SUM(FP.Repagos), 0) AS Repagos,
                ISNULL(SUM(FP.ColocacionNumReal), 0) AS ColocacionNumReal,
                ISNULL(SUM(AV.MetaOpAsesor), 30) AS MetaNumAsesor
            FROM AsesoresValidos AV
            LEFT JOIN FlowPorAsesor FP 
                ON AV.Periodo = FP.Periodo AND AV.IdSAsesor = FP.IdSAsesor
            GROUP BY AV.Periodo
        ),
        CarteraInic AS (
            SELECT
                RTRIM(LTRIM(CI.Periodo)) AS Periodo,
                ISNULL(SUM(CI.CarteraInicial), 0) AS CarteraInicial
            FROM dm_productividad.dbo.fct_stock_manubl_asesor_month CI WITH (NOLOCK)
            INNER JOIN AsesoresValidos AV
                ON RTRIM(LTRIM(CI.Periodo)) = AV.Periodo
                AND RTRIM(LTRIM(CI.IdSAsesor)) = AV.IdSAsesor
            GROUP BY RTRIM(LTRIM(CI.Periodo))
        ),
        Stock AS (
            SELECT 
                RTRIM(LTRIM(S.Periodo)) AS Periodo,
                ISNULL(SUM(S.Cartera), 0) AS CarteraStock,
                ISNULL(SUM(S.Mora9), 0) AS MoraCppTotal,
                ISNULL(SUM(S.Mora31), 0) AS Mora31Total,
                ISNULL(SUM(S.Mora150), 0) AS Mora150Total,
                ISNULL(SUM(S.NroSociosAnterior), 0) AS SociosInicio,
                ISNULL(SUM(S.NroSocios), 0) AS SociosActual,
                ISNULL(SUM(S.NroSociosCancelados), 0) AS SociosCancelados,
                ISNULL(SUM(S.NroSociosRecuperacion), 0) AS SociosRecuperacion,
                ISNULL(SUM(S.NroSociosTraspasados), 0) AS SociosTraspasados,
                ISNULL(SUM(S.NroSociosActivos), 0) AS SociosActivos
            FROM DWH_Gestion_Cartera.dbo.fct_stock S WITH (NOLOCK)
            INNER JOIN AsesoresValidos AV 
                ON RTRIM(LTRIM(S.Periodo)) = AV.Periodo 
                AND RTRIM(LTRIM(S.IdSAsesor)) = AV.IdSAsesor
            GROUP BY RTRIM(LTRIM(S.Periodo))
        )
        SELECT 
            C.Periodo AS periodo,
            C.Etiqueta AS etiqueta,
            ISNULL(F.ColocacionMonto, 0) AS colocacionMonto,
            ISNULL(F.Repagos, 0) AS repagos,
            ISNULL(F.ColocacionNumReal, 0) AS colocacionNumReal,
            (ISNULL(F.ColocacionMonto, 0) - ISNULL(F.Repagos, 0)) AS crecimientoBruto,
            ((ISNULL(F.ColocacionMonto, 0) - ISNULL(F.Repagos, 0)) - ISNULL(S.Mora150Total, 0)) AS crecimientoNeto150,
            CASE WHEN @asesor <> '' THEN (ISNULL(F.MetaNumAsesor, 30) * 2500) ELSE ISNULL(MA.MetaMontoAgencia, 0) END AS colocacionMeta,
            CASE WHEN @asesor <> '' THEN ISNULL(F.MetaNumAsesor, 30) ELSE ISNULL(MA.MetaNumAgencia, 0) END AS colocacionNumMeta,
            COALESCE(NULLIF(CI.CarteraInicial, 0), S.CarteraStock, 0) AS carteraTotal,
            ISNULL(S.MoraCppTotal, 0) AS moraCppTotal,
            ISNULL(S.Mora31Total, 0) AS mora31Total,
            ISNULL(S.Mora150Total, 0) AS mora150Total,
            CASE WHEN COALESCE(NULLIF(CI.CarteraInicial, 0), S.CarteraStock, 0) > 0 
                 THEN (CAST(ISNULL(S.MoraCppTotal, 0) AS FLOAT) / COALESCE(NULLIF(CI.CarteraInicial, 0), S.CarteraStock, 0)) * 100 
                 ELSE 0 END AS pctMoraCpp,
            CASE WHEN COALESCE(NULLIF(CI.CarteraInicial, 0), S.CarteraStock, 0) > 0 
                 THEN (CAST(ISNULL(S.Mora31Total, 0) AS FLOAT) / COALESCE(NULLIF(CI.CarteraInicial, 0), S.CarteraStock, 0)) * 100 
                 ELSE 0 END AS pctMora31,
            ISNULL(S.SociosInicio, 0) AS sociosInicio,
            ISNULL(S.SociosActual, 0) AS sociosActual,
            (ISNULL(S.SociosActual, 0) - ISNULL(S.SociosInicio, 0)) AS sociosNuevos,
            ISNULL(S.SociosRecuperacion, 0) AS sociosRecuperacion,
            ISNULL(S.SociosCancelados, 0) AS sociosCancelados,
            ISNULL(S.SociosTraspasados, 0) AS sociosTraspasados,
            ISNULL(S.SociosActivos, 0) AS sociosActivos
        FROM Calendario C
        LEFT JOIN Flow F ON C.Periodo = F.Periodo
        LEFT JOIN MetasAgencia MA ON C.Periodo = MA.Periodo
        LEFT JOIN Stock S ON C.Periodo = S.Periodo
        LEFT JOIN CarteraInic CI ON C.Periodo = CI.Periodo
        ORDER BY C.Periodo ASC;
      `;
    } else {
      querySQL = `
        WITH Calendario AS (
            SELECT DISTINCT Fecha, CAST(DAY(Fecha) AS VARCHAR) + ' ' + LEFT(Mes, 3) AS Etiqueta
            FROM dm_productividad.dbo.dim_calendario WITH (NOLOCK)
            WHERE Fecha >= @desde AND Fecha <= @hasta
        ),
        MetasDiarias AS (
            SELECT 
                M.Fecha,
                SUM(ISNULL(M.ColocacionMontoMeta, 0)) AS MetaMontoDia,
                SUM(ISNULL(M.ColocacionNumMeta, 0)) AS MetaNumDia
            FROM dm_productividad.dbo.FctDiario_MetaProy M WITH (NOLOCK)
            LEFT JOIN DWH_Gestion_Cartera.dbo.dim_agencia DA WITH (NOLOCK)
                ON RIGHT('00' + RTRIM(LTRIM(CAST(M.IdSAgencia AS VARCHAR(5)))), 2) = RIGHT('00' + RTRIM(LTRIM(DA.IdSAgencia)), 2)
            WHERE (@agencia = '' OR RTRIM(LTRIM(DA.Agencia)) = @agencia)
            GROUP BY M.Fecha
        ),
        Flow AS (
            SELECT 
                F.Fecha, 
                SUM(F.ColocacionMontoReal) AS ColocacionMonto, 
                SUM(F.RepagoReal) AS Repagos,
                SUM(F.ColocacionNumReal) AS ColocacionNumReal
            FROM DWH_Gestion_Cartera.dbo.fct_flow F WITH (NOLOCK)
            LEFT JOIN DWH_Gestion_Cartera.dbo.dim_agencia DA WITH (NOLOCK) 
                ON RIGHT('00' + RTRIM(LTRIM(F.IdSAgencia)), 2) = RIGHT('00' + RTRIM(LTRIM(DA.IdSAgencia)), 2)
            LEFT JOIN DWH_Gestion_Cartera.dbo.dim_asesor D_AS WITH (NOLOCK) 
                ON RTRIM(LTRIM(F.IdSAsesor)) = RTRIM(LTRIM(D_AS.IdSAsesor)) AND F.Periodo = D_AS.Periodo
            WHERE RTRIM(LTRIM(D_AS.Cargo)) = 'ANALISTA DE CREDITOS I'
              AND (@agencia = '' OR RTRIM(LTRIM(DA.Agencia)) = @agencia) 
              AND (@asesor = '' OR RTRIM(LTRIM(D_AS.AsesorNombresApellidos)) = @asesor OR RTRIM(LTRIM(D_AS.Asesor)) = @asesor)
            GROUP BY F.Fecha
        )
        SELECT 
            CONVERT(VARCHAR(10), C.Fecha, 120) AS periodo,
            C.Etiqueta AS etiqueta,
            ISNULL(F.ColocacionMonto, 0) AS colocacionMonto,
            ISNULL(F.Repagos, 0) AS repagos,
            ISNULL(F.ColocacionNumReal, 0) AS colocacionNumReal,
            (ISNULL(F.ColocacionMonto, 0) - ISNULL(F.Repagos, 0)) AS crecimientoBruto,
            (ISNULL(F.ColocacionMonto, 0) - ISNULL(F.Repagos, 0)) AS crecimientoNeto150,
            CASE WHEN @asesor <> '' THEN 0 ELSE ISNULL(MD.MetaMontoDia, 0) END AS colocacionMeta,
            CASE WHEN @asesor <> '' THEN 2 ELSE ISNULL(MD.MetaNumDia, 0) END AS colocacionNumMeta,
            0 AS carteraTotal, 0 AS moraCppTotal, 0 AS mora31Total, 0 AS mora150Total,
            0 AS pctMoraCpp, 0 AS pctMora31,
            0 AS sociosInicio, 0 AS sociosActual, 0 AS sociosNuevos, 0 AS sociosRecuperacion, 0 AS sociosCancelados, 0 AS sociosTraspasados, 0 AS sociosActivos
        FROM Calendario C
        LEFT JOIN Flow F ON C.Fecha = F.Fecha
        LEFT JOIN MetasDiarias MD ON C.Fecha = MD.Fecha
        ORDER BY C.Fecha ASC;
      `;
    }

    const result = await request
      .input("agencia", sql.VarChar(50), agencia)
      .input("asesor", sql.VarChar(100), asesor)
      .input("desde", sql.VarChar(10), desde)
      .input("hasta", sql.VarChar(10), hasta)
      .query(querySQL);

    res.json(result.recordset);
  } catch (error) {
    console.error("Error obteniendo Evolución:", error);
    res.status(500).json({ error: "Error calculando evolución" });
  }
});

export default router;