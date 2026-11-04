// D:\Proyectos\power-bi-web_backend\src\routes\preventiva.ts
import { Router, Request, Response } from "express";
import sql from "mssql";
import { pool } from "../lib/db";

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

        WITH BasePreventivaDWH AS (
          SELECT
            CASE R.[IdSAgencia]
              WHEN '01' THEN 'Wanchaq' WHEN '02' THEN 'San Jerónimo' WHEN '03' THEN 'Quillabamba'
              WHEN '04' THEN 'Sicuani' WHEN '05' THEN 'Molino' WHEN '06' THEN 'Juliaca'
              WHEN '07' THEN 'Lima Los Olivos' WHEN '08' THEN 'Tica Tica' WHEN '09' THEN 'Magisterio'
              WHEN '10' THEN 'Lima SJL' WHEN '11' THEN 'Chiclayo' WHEN '12' THEN 'Arequipa'
              WHEN '13' THEN 'Pucallpa' ELSE 'Otra Agencia'
            END AS [agencia],
            RTRIM(LTRIM(R.[Socio])) AS [socio],
            ISNULL(NULLIF(LTRIM(RTRIM(R.[Telefonos])), ''), 'SIN TELEFONO') AS [telefono],
            ISNULL(R.[Producto], '') AS [producto],
            ISNULL(R.[Saldo_Capital], 0) AS [saldo_numerico],
            FORMAT(ISNULL(R.[Saldo_Capital], 0), 'N2', 'es-PE') AS [saldo_formateado],
            ISNULL(D_AS.NombreAsesor, RTRIM(LTRIM(R.[IdSAsesor]))) AS [analista],
            CONVERT(VARCHAR(10), R.[Fecha_Foto], 103) AS [fecha_vencimiento],
            ISNULL(R.[Dias_Atraso], 0) AS [dias_para_vencimiento]
          FROM [DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral] R WITH (NOLOCK)
          OUTER APPLY (
            SELECT TOP 1 ISNULL(DA.[AsesorNombresApellidos], DA.[Asesor]) AS NombreAsesor
            FROM [DWH_Gestion_Cartera].[dbo].[dim_asesor] DA WITH (NOLOCK)
            WHERE RTRIM(LTRIM(DA.[IdSAsesor])) = RTRIM(LTRIM(R.[IdSAsesor]))
            ORDER BY DA.[Periodo] DESC
          ) D_AS
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