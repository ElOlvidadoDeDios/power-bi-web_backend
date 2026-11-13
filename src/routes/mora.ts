// D:\Proyectos\power-bi-web_backend\src\routes\mora.ts
import { Router, Request, Response } from "express";
import { pool } from "../lib/db";
import { sqlCaseAgencia } from "../lib/agencies";

const router = Router();

let moraColsEnsured = false;
async function ensureMoraCols() {
  if (moraColsEnsured) return;
  await pool.request().query(`
    IF COL_LENGTH('[DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral]', 'Fecha_Vcmto_Cuota') IS NULL
      ALTER TABLE [DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral] ADD [Fecha_Vcmto_Cuota] DATE NULL;
    IF COL_LENGTH('[DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral]', 'Dias_Vcmto_Cuota') IS NULL
      ALTER TABLE [DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral] ADD [Dias_Vcmto_Cuota] INT NULL;
    IF COL_LENGTH('[DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral]', 'Dni') IS NULL
      ALTER TABLE [DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral] ADD [Dni] VARCHAR(20) NULL;
  `);
  moraColsEnsured = true;
}

router.get(["/mora", "/api/mora"], async (_req: Request, res: Response) => {
  try {
    await ensureMoraCols();
    const request = pool.request();

    const querySQL = `
      DECLARE @UltimaFecha DATE = (
          SELECT MAX([Fecha_Foto]) 
          FROM [DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral] WITH (NOLOCK)
      );
      DECLARE @HoyPeru DATE = CAST(DATEADD(hour, -5, GETUTCDATE()) AS DATE);

      WITH UltimoAsesor AS (
          SELECT
              RTRIM(LTRIM([IdSAsesor])) AS IdSAsesor,
              ISNULL([AsesorNombresApellidos], [Asesor]) AS NombreAsesor,
              ROW_NUMBER() OVER (
                  PARTITION BY RTRIM(LTRIM([IdSAsesor]))
                  ORDER BY [Periodo] DESC
              ) AS rn
          FROM [DWH_Gestion_Cartera].[dbo].[dim_asesor] WITH (NOLOCK)
      )
      SELECT 
          CONVERT(VARCHAR(10), R.[Fecha_Foto], 103) AS fechaFoto,
          R.[Periodo] AS periodo,
          ${sqlCaseAgencia("R.[IdSAgencia]")} AS agencia,
          RTRIM(LTRIM(R.[IdSAsesor])) AS idAsesor,
          ISNULL(D_AS.NombreAsesor, RTRIM(LTRIM(R.[IdSAsesor]))) AS asesor,
          RTRIM(LTRIM(R.[Pagare])) AS pagare,
          CASE 
              WHEN R.[Cuenta] IS NULL OR LTRIM(RTRIM(R.[Cuenta])) = '' THEN ''
              ELSE RIGHT('000000000000' + LTRIM(RTRIM(R.[Cuenta])), 12)
          END AS cuenta,
          LTRIM(RTRIM(ISNULL(R.[Dni], ''))) AS dni,
          RTRIM(LTRIM(R.[Socio])) AS socio,
          RTRIM(LTRIM(ISNULL(R.[Producto], ''))) AS producto,
          ISNULL(R.[Monto_Desembolsado], 0) AS montoDesembolsado,
          ISNULL(R.[Saldo_Capital], 0) AS saldoCapital,
          ISNULL(R.[Tasa_TEA], 0) AS tasaTea,
          ISNULL(R.[Cuota_Mensual], 0) AS cuotaMensual,
          ISNULL(R.[Cuotas_Atrasadas], 0) AS cuotasAtrasadas,
          ISNULL(R.[Dias_Atraso], 0) AS diasAtraso,
          ISNULL(R.[Cuotas_Pendientes], 0) AS cuotasPendientes,
          ISNULL(R.[Cuotas_Pagadas], 0) AS cuotasPagadas,
          ISNULL(R.[Avance_Cuota], '0%') AS avanceCuota,
          CASE 
              WHEN R.[Fecha_Vcmto_Cuota] IS NOT NULL THEN CONVERT(VARCHAR(10), R.[Fecha_Vcmto_Cuota], 103)
              ELSE ''
          END AS fechaVencimientoCuota,
          CASE
              WHEN R.[Fecha_Vcmto_Cuota] IS NOT NULL THEN DATEDIFF(DAY, @HoyPeru, R.[Fecha_Vcmto_Cuota])
              ELSE R.[Dias_Vcmto_Cuota]
          END AS venceEnDias,
          R.[Estado_Mora] AS estadoMora,
          CASE
              WHEN R.[Probabilidad_IA] >= 65 THEN 'ALTO'
              WHEN R.[Probabilidad_IA] >= 30 THEN 'MEDIO'
              WHEN R.[Probabilidad_IA] IS NOT NULL THEN 'BAJO'
              ELSE R.[Nivel_Riesgo_IA]
          END AS nivelRiesgoIa,
          R.[Probabilidad_IA] AS probabilidadIa,
          CASE 
              WHEN R.[Probabilidad_IA] IS NOT NULL THEN 'XGBoost EWS v2'
              ELSE NULL 
          END AS modeloIa,
          CASE 
              WHEN R.[Probabilidad_IA] >= 30 THEN 1 
              ELSE 0 
          END AS advertidoPorIa,
          COALESCE(CW.[Compromiso_Actual], R.[Compromiso], '') AS compromiso,
          CASE 
              WHEN CW.[Fecha_Promesa_Actual] IS NOT NULL THEN CONVERT(VARCHAR(10), CW.[Fecha_Promesa_Actual], 103)
              WHEN R.[Fecha_Promesa] IS NOT NULL THEN CONVERT(VARCHAR(10), R.[Fecha_Promesa], 103)
              ELSE ''
          END AS fechaPromesa,
          ISNULL(R.[Telefonos], '') AS telefonos
      FROM [DWH_Gestion_Cartera].[dbo].[fct_riesgo_integral] R WITH (NOLOCK)
      LEFT JOIN [DWH_Gestion_Cartera].[dbo].[fct_compromisos_mora_web] CW WITH (NOLOCK)
          ON RTRIM(LTRIM(R.[Pagare])) = RTRIM(LTRIM(CW.[Pagare]))
      LEFT JOIN UltimoAsesor D_AS
          ON D_AS.IdSAsesor = RTRIM(LTRIM(R.[IdSAsesor])) AND D_AS.rn = 1
      WHERE R.[Fecha_Foto] = @UltimaFecha
        AND (
            R.[Estado_Mora] IN ('3. Mora Potencial', '2. Mora Temprana')
            OR R.[Probabilidad_IA] >= 30
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