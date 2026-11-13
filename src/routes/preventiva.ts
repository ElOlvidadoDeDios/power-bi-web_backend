// D:\Proyectos\power-bi-web_backend\src\routes\preventiva.ts
import { Router, Request, Response } from "express";
import sql from "mssql";
import { pool } from "../lib/db";
import { sqlCaseAgencia } from "../lib/agencies";

const router = Router();

router.get(["/gestion-preventiva", "/api/gestion-preventiva"], async (req: Request, res: Response) => {
  const agenciaParam = ((req.query.agencia as string) || "").trim();
  const analistaParam = ((req.query.analista as string) || (req.query.asesor as string) || "").trim();

  const agencia = agenciaParam === "Todas" || agenciaParam === "Todas las Agencias" ? "" : agenciaParam;
  const analista = analistaParam === "Todos" || analistaParam === "Todos los Analistas" ? "" : analistaParam;

  try {
    const result = await pool
      .request()
      .input("agencia", sql.VarChar(60), agencia)
      .input("analista", sql.VarChar(150), analista)
      .query(`
        DECLARE @UltimaFecha DATE = (
          SELECT MAX([Fecha_Foto]) FROM [DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral] WITH (NOLOCK)
        );

        WITH UltimoAsesor AS (
          SELECT
            RTRIM(LTRIM([IdSAsesor])) AS IdSAsesor,
            ISNULL([AsesorNombresApellidos], [Asesor]) AS NombreAsesor,
            ROW_NUMBER() OVER (
              PARTITION BY RTRIM(LTRIM([IdSAsesor]))
              ORDER BY [Periodo] DESC
            ) AS rn
          FROM [DWH_Gestion_Cartera].[dbo].[dim_asesor] WITH (NOLOCK)
        ),
        BasePreventivaDWH AS (
          SELECT
            ${sqlCaseAgencia("R.[IdSAgencia]")} AS [agencia],
            RTRIM(LTRIM(R.[Socio])) AS [socio],
            ISNULL(NULLIF(LTRIM(RTRIM(R.[Telefonos])), ''), 'SIN TELEFONO') AS [telefono],
            ISNULL(R.[Producto], '') AS [producto],
            ISNULL(R.[Saldo_Capital], 0) AS [saldo_numerico],
            FORMAT(ISNULL(R.[Saldo_Capital], 0), 'N2', 'es-PE') AS [saldo_formateado],
            ISNULL(D_AS.NombreAsesor, RTRIM(LTRIM(R.[IdSAsesor]))) AS [analista],
            CONVERT(VARCHAR(10), R.[Fecha_Foto], 103) AS [fecha_vencimiento],
            ISNULL(R.[Dias_Atraso], 0) AS [dias_para_vencimiento]
          FROM [DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral] R WITH (NOLOCK)
          LEFT JOIN UltimoAsesor D_AS
            ON D_AS.IdSAsesor = RTRIM(LTRIM(R.[IdSAsesor])) AND D_AS.rn = 1
          WHERE R.[Fecha_Foto] = @UltimaFecha
            AND R.[Probabilidad_IA] >= 30
        )
        SELECT * FROM BasePreventivaDWH
        WHERE (@agencia = '' OR [agencia] = @agencia)
          AND (@analista = '' OR [analista] LIKE '%' + @analista + '%')
        ORDER BY [saldo_numerico] DESC;
      `);

    res.json(result.recordset || []);
  } catch (error) {
    console.error("Error en /gestion-preventiva:", error);
    res.status(500).json({ error: "Error obteniendo datos de Gestión Preventiva desde DWH" });
  }
});

export default router;