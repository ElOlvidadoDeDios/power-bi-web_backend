import { Router, Request, Response } from "express";
import sql from "mssql/msnodesqlv8.js";

const router = Router();

const dbConfig = {
  server: process.env.DB_DWH_SERVER || "DESKTOP-K6HIFFS",
  database: process.env.DB_DWH_NAME || "DWH_Gestion_Cartera",
  driver: "msnodesqlv8",
  options: { trustedConnection: true },
};

router.get(["/evolucion", "/api/evolucion"], async (req: Request, res: Response) => {
  const agencia = req.query.agencia as string || "";
  const asesor = req.query.asesor as string || "";
  const granularidad = req.query.granularidad as string || "Mensual";
  const desde = req.query.desde as string;
  const hasta = req.query.hasta as string;

  try {
    const pool = await sql.connect(dbConfig);
    let querySQL = "";

    if (granularidad === "Mensual") {
      querySQL = `
        WITH Calendario AS (
            SELECT DISTINCT Periodo, MAX(MesLargo + ' ' + CAST(Año AS VARCHAR)) AS Etiqueta
            FROM dm_productividad.dbo.dim_calendario
            WHERE Periodo >= @desde AND Periodo <= @hasta
            GROUP BY Periodo
        ),
        Flow AS (
            SELECT 
                F.Periodo, 
                SUM(F.ColocacionMontoReal) AS ColocacionMonto, 
                SUM(F.RepagoReal) AS Repagos,
                SUM(F.ColocacionNumReal) AS ColocacionNumReal,
                ISNULL(MAX(M.ColocacionMontoMetaAjus), ISNULL(MAX(M.ColocacionMontoMeta), 0)) AS ColocacionMetaMonto,
                ISNULL(MAX(M.ColocacionNumMetaAjus), ISNULL(MAX(M.ColocacionNumMeta), 0)) AS ColocacionMetaNumAgencia,
                ISNULL(MAX(D_AS.ColocacionNumMeta), 30) AS ColocacionMetaNumAsesor
            FROM DWH_Gestion_Cartera.dbo.fct_flow F
            LEFT JOIN dm_productividad.dbo.FctMensual M ON F.Periodo = M.Periodo AND F.IdSAgencia = M.IdSAgencia
            LEFT JOIN DWH_Gestion_Cartera.dbo.dim_agencia DA ON F.IdSAgencia = DA.IdSAgencia
            LEFT JOIN DWH_Gestion_Cartera.dbo.dim_asesor D_AS ON F.IdSAsesor = D_AS.IdSAsesor AND F.Periodo = D_AS.Periodo
            WHERE (@agencia = '' OR RTRIM(LTRIM(DA.Agencia)) = @agencia) 
              AND (@asesor = '' OR RTRIM(LTRIM(D_AS.AsesorNombresApellidos)) = @asesor OR RTRIM(LTRIM(D_AS.Asesor)) = @asesor)
            GROUP BY F.Periodo
        ),
        Stock AS (
            SELECT 
                S.Periodo, SUM(S.Cartera) AS CarteraTotal, SUM(S.Mora31) AS Mora31Total
            FROM DWH_Gestion_Cartera.dbo.fct_stock S
            LEFT JOIN DWH_Gestion_Cartera.dbo.dim_agencia DA ON S.IdSAgencia = DA.IdSAgencia
            LEFT JOIN DWH_Gestion_Cartera.dbo.dim_asesor D_AS ON S.IdSAsesor = D_AS.IdSAsesor AND S.Periodo = D_AS.Periodo
            WHERE (@agencia = '' OR RTRIM(LTRIM(DA.Agencia)) = @agencia) 
              AND (@asesor = '' OR RTRIM(LTRIM(D_AS.AsesorNombresApellidos)) = @asesor OR RTRIM(LTRIM(D_AS.Asesor)) = @asesor)
            GROUP BY S.Periodo
        )
        SELECT 
            C.Periodo AS periodo, C.Etiqueta AS etiqueta,
            ISNULL(F.ColocacionMonto, 0) AS colocacionMonto, ISNULL(F.Repagos, 0) AS repagos,
            ISNULL(F.ColocacionNumReal, 0) AS colocacionNumReal,
            (ISNULL(F.ColocacionMonto, 0) - ISNULL(F.Repagos, 0)) AS crecimientoBruto,
            CASE WHEN @asesor <> '' THEN 0 ELSE ISNULL(F.ColocacionMetaMonto, 0) END AS colocacionMeta,
            CASE WHEN @asesor <> '' THEN ISNULL(F.ColocacionMetaNumAsesor, 0) ELSE ISNULL(F.ColocacionMetaNumAgencia, 0) END AS colocacionNumMeta,
            ISNULL(S.CarteraTotal, 0) AS carteraTotal, ISNULL(S.Mora31Total, 0) AS mora31Total,
            CASE WHEN ISNULL(S.CarteraTotal, 0) > 0 THEN (CAST(S.Mora31Total AS FLOAT) / S.CarteraTotal) * 100 ELSE 0 END AS pctMora31
        FROM Calendario C
        LEFT JOIN Flow F ON C.Periodo = F.Periodo
        LEFT JOIN Stock S ON C.Periodo = S.Periodo
        ORDER BY C.Periodo ASC;
      `;
    } else {
      // GRANULARIDAD DIARIA
      querySQL = `
        WITH Calendario AS (
            SELECT DISTINCT Fecha, CAST(DAY(Fecha) AS VARCHAR) + ' ' + LEFT(Mes, 3) AS Etiqueta
            FROM dm_productividad.dbo.dim_calendario
            WHERE Fecha >= @desde AND Fecha <= @hasta
        ),
        Flow AS (
            SELECT 
                F.Fecha, 
                SUM(F.ColocacionMontoReal) AS ColocacionMonto, 
                SUM(F.RepagoReal) AS Repagos,
                SUM(F.ColocacionNumReal) AS ColocacionNumReal,
                ISNULL(MAX(M.ColocacionMontoMeta), 0) AS ColocacionMetaMonto,
                ISNULL(MAX(M.ColocacionNumMeta), 0) AS ColocacionMetaNumAgencia,
                ISNULL(MAX(D_AS.ColocacionNumMeta), 30) AS ColocacionMetaNumAsesor
            FROM DWH_Gestion_Cartera.dbo.fct_flow F
            LEFT JOIN dm_productividad.dbo.FctDiario_MetaProy M ON F.Fecha = M.Fecha AND F.IdSAgencia = M.IdSAgencia
            LEFT JOIN DWH_Gestion_Cartera.dbo.dim_agencia DA ON F.IdSAgencia = DA.IdSAgencia
            LEFT JOIN DWH_Gestion_Cartera.dbo.dim_asesor D_AS ON F.IdSAsesor = D_AS.IdSAsesor AND F.Periodo = D_AS.Periodo
            WHERE (@agencia = '' OR RTRIM(LTRIM(DA.Agencia)) = @agencia) 
              AND (@asesor = '' OR RTRIM(LTRIM(D_AS.AsesorNombresApellidos)) = @asesor OR RTRIM(LTRIM(D_AS.Asesor)) = @asesor)
            GROUP BY F.Fecha
        )
        SELECT 
            CONVERT(VARCHAR(10), C.Fecha, 120) AS periodo, C.Etiqueta AS etiqueta,
            ISNULL(F.ColocacionMonto, 0) AS colocacionMonto, ISNULL(F.Repagos, 0) AS repagos,
            ISNULL(F.ColocacionNumReal, 0) AS colocacionNumReal,
            (ISNULL(F.ColocacionMonto, 0) - ISNULL(F.Repagos, 0)) AS crecimientoBruto,
            CASE WHEN @asesor <> '' THEN 0 ELSE ISNULL(F.ColocacionMetaMonto, 0) END AS colocacionMeta,
            CASE WHEN @asesor <> '' THEN ISNULL(F.ColocacionMetaNumAsesor, 0) ELSE ISNULL(F.ColocacionMetaNumAgencia, 0) END AS colocacionNumMeta,
            0 AS carteraTotal, 0 AS mora31Total, 0 AS pctMora31
        FROM Calendario C
        LEFT JOIN Flow F ON C.Fecha = F.Fecha
        ORDER BY C.Fecha ASC;
      `;
    }

    const result = await pool.request()
      .input('agencia', sql.VarChar(50), agencia)
      .input('asesor', sql.VarChar(100), asesor)
      .input('desde', sql.VarChar(10), desde)
      .input('hasta', sql.VarChar(10), hasta)
      .query(querySQL);

    res.json(result.recordset);
  } catch (error) {
    console.error("Error obteniendo Evolución:", error);
    res.status(500).json({ error: "Error calculando evolución" });
  }
});

export default router;