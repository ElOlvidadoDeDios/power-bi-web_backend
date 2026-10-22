// src/routes/mora.ts
import { Router, Request, Response } from "express";
import { pool } from "../lib/db";

const router = Router();

router.get(["/mora", "/api/mora"], async (_req: Request, res: Response) => {
  try {
    const request = pool.request();

    const querySQL = `
      DECLARE @UltimaFecha DATE = (
          SELECT MAX([Fecha_Foto]) 
          FROM [DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral] WITH (NOLOCK)
      );

      SELECT 
          CONVERT(VARCHAR(10), R.[Fecha_Foto], 103) AS fechaFoto,
          R.[Periodo] AS periodo,
          CASE R.[IdSAgencia]
              WHEN '01' THEN 'Wanchaq'
              WHEN '02' THEN 'San Jerónimo'
              WHEN '03' THEN 'Quillabamba'
              WHEN '04' THEN 'Sicuani'
              WHEN '05' THEN 'Molino'
              WHEN '06' THEN 'Juliaca'
              WHEN '07' THEN 'Lima Los Olivos'
              WHEN '08' THEN 'Tica Tica'
              WHEN '09' THEN 'Magisterio'
              WHEN '10' THEN 'Lima SJL'
              WHEN '11' THEN 'Chiclayo'
              WHEN '12' THEN 'Arequipa'
              WHEN '13' THEN 'Pucallpa'
              ELSE 'Otra Agencia'
          END AS agencia,
          RTRIM(LTRIM(R.[IdSAsesor])) AS idAsesor,
          ISNULL(D_AS.NombreAsesor, RTRIM(LTRIM(R.[IdSAsesor]))) AS asesor,
          RTRIM(LTRIM(R.[Pagare])) AS pagare,
          RTRIM(LTRIM(R.[Socio])) AS socio,
          RTRIM(LTRIM(ISNULL(R.[Producto], ''))) AS producto,
          ISNULL(R.[Monto_Desembolsado], 0) AS montoDesembolsado,
          ISNULL(R.[Saldo_Capital], 0) AS saldoCapital,
          ISNULL(R.[Tasa_TEA], 0) AS tasaTea,
          ISNULL(R.[Cuota_Mensual], 0) AS cuotaMensual,
          ISNULL(R.[Dias_Atraso], 0) AS diasAtraso,
          R.[Estado_Mora] AS estadoMora,
          R.[Nivel_Riesgo_IA] AS nivelRiesgoIa,
          R.[Probabilidad_IA] AS probabilidadIa,
          CASE 
              WHEN R.[Probabilidad_IA] IS NOT NULL THEN 'XGBoost EWS v2'
              ELSE NULL 
          END AS modeloIa,
          CASE 
              WHEN R.[Probabilidad_IA] IS NOT NULL THEN 1 
              ELSE 0 
          END AS advertidoPorIa,
          ISNULL(R.[Compromiso], '') AS compromiso,
          CASE 
              WHEN R.[Fecha_Promesa] IS NOT NULL THEN CONVERT(VARCHAR(10), R.[Fecha_Promesa], 103)
              ELSE ''
          END AS fechaPromesa,
          ISNULL(R.[Telefonos], '') AS telefonos
      FROM [DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral] R WITH (NOLOCK)
      OUTER APPLY (
          SELECT TOP 1 ISNULL(DA.[AsesorNombresApellidos], DA.[Asesor]) AS NombreAsesor
          FROM [DWH_Gestion_Cartera].[dbo].[dim_asesor] DA WITH (NOLOCK)
          WHERE RTRIM(LTRIM(DA.[IdSAsesor])) = RTRIM(LTRIM(R.[IdSAsesor]))
          ORDER BY DA.[Periodo] DESC
      ) D_AS
      WHERE R.[Fecha_Foto] = @UltimaFecha
        AND (
            R.[Estado_Mora] IN ('3. Mora Potencial', '2. Mora Temprana')
            OR R.[Probabilidad_IA] IS NOT NULL
        )
      ORDER BY R.[Saldo_Capital] DESC;
    `;

    const result = await request.query(querySQL);
    res.json(result.recordset || []);
  } catch (error) {
    console.error("Error obteniendo Gestión de Mora e IA:", error);
    res.status(500).json({ error: "Error al consultar la base de datos de riesgo integral" });
  }
});

export default router;