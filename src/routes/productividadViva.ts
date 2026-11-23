// D:\Proyectos\power-bi-web_backend\src\routes\productividadViva.ts
import { Router, Request, Response } from "express";
import sql from "mssql";
import { pool } from "../lib/db";

const router = Router();

router.get(["/productividad-en-vivo", "/api/productividad-en-vivo"], async (req: Request, res: Response) => {
  const periodo = ((req.query.periodo as string) || "").trim();

  try {
    const result = await pool.request()
      .input("periodo", sql.VarChar(6), periodo)
      .query(`
        DECLARE @Hoy DATE = CAST(DATEADD(hour, -5, GETUTCDATE()) AS DATE);
        DECLARE @PeriodoDefault VARCHAR(6) = CASE WHEN @periodo <> '' THEN @periodo ELSE CONVERT(VARCHAR(6), @Hoy, 112) END;

        WITH Agencias AS (
          SELECT * FROM (VALUES
            ('01', 'Wanchaq'), ('02', 'San Jerónimo'), ('03', 'Quillabamba'),
            ('04', 'Sicuani'), ('05', 'Molino'), ('06', 'Juliaca'),
            ('07', 'Lima Los Olivos'), ('08', 'Tica Tica'), ('09', 'Magisterio'),
            ('10', 'Lima SJL'), ('11', 'Chiclayo'), ('12', 'Arequipa'),
            ('13', 'Pucallpa')
          ) AS t(IdSAgencia, NombreAgencia)
        ),
        ControlHoy AS (
          SELECT
            RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2) AS IdSAgencia,
            CAST(ROUND(ISNULL(Proy_Op_Admin, 0), 0) AS INT) AS Proy_Op_Admin,
            CAST(ROUND(ISNULL(Proy_Monto_Admin, 0), 0) AS FLOAT) AS Proy_Monto_Admin
          FROM [DWH_Gestion_Cartera].[dbo].[fct_metas_diarias_control] WITH (NOLOCK)
          WHERE Fecha = @Hoy
        ),
        VivoHoy AS (
          SELECT
            RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2) AS IdSAgencia,
            CONVERT(VARCHAR(10), [Fecha], 120) AS Fecha,
            [Periodo],
            SUM([ColocacionNumReal]) AS colocacionNumReal,
            SUM([ColocacionMontoReal]) AS colocacionMontoReal
          FROM [DWH_Gestion_Cartera].[dbo].[fct_productividad_en_vivo_log] WITH (NOLOCK)
          WHERE [Fecha] = @Hoy
          GROUP BY RIGHT('00' + RTRIM(LTRIM(IdSAgencia)), 2), [Fecha], [Periodo]
        )
        SELECT
          ISNULL(V.Fecha, CONVERT(VARCHAR(10), @Hoy, 120)) AS fecha,
          ISNULL(V.Periodo, @PeriodoDefault) AS periodo,
          A.IdSAgencia AS idAgencia,
          A.NombreAgencia AS agencia,
          ISNULL(C.Proy_Op_Admin, 0) AS proyeccionColocacion,
          ISNULL(C.Proy_Monto_Admin, 0) AS proyeccionMonto,
          ISNULL(V.colocacionNumReal, 0) AS colocacionNumReal,
          ISNULL(V.colocacionMontoReal, 0) AS colocacionMontoReal
        FROM Agencias A
        LEFT JOIN ControlHoy C ON A.IdSAgencia = C.IdSAgencia
        LEFT JOIN VivoHoy V ON A.IdSAgencia = V.IdSAgencia
        ORDER BY A.IdSAgencia ASC;
      `);

    const logRes = await pool.request().query(`
      SELECT TOP (1) 
        FORMAT([UltimaActualizacion], 'dd/MM/yyyy · HH:mm:ss', 'es-PE') AS UltimaActualizacion,
        ISNULL([Descripcion], 'Productividad en Vivo (Transacmif)') AS Descripcion
      FROM [DWH_Gestion_Cartera].[dbo].[Log_Actualizacion] WITH (NOLOCK)
      WHERE [Id] = 5
    `);

    const rowLog = logRes.recordset?.[0];
    const ultimaAct = rowLog?.UltimaActualizacion || "Sincronizando...";
    const desc = rowLog?.Descripcion || "Productividad en Vivo (Transacmif)";

    res.json({
      rows: result.recordset || [],
      ultimaActualizacionTexto: `${desc}: ${ultimaAct}`,
    });
  } catch (error) {
    console.error("Error consultando productividad en vivo:", error);
    res.status(500).json({ error: "Error al obtener productividad en vivo" });
  }
});

export default router;