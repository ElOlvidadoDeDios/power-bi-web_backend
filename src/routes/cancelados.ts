import { Router, Request, Response } from "express";
import sql from "mssql";
import { pool } from "../lib/db";

const router = Router();

router.get(["/cancelados", "/api/cancelados"], async (req: Request, res: Response) => {
  const agenciaParam = (req.query.agencia as string) || "";
  const asesorParam = (req.query.asesor as string) || "";
  const tipoParam = (req.query.tipo as string) || "";
  const frecuenciaParam = (req.query.frecuencia as string) || "";
  const vista = ((req.query.vista as string) || "comercial").toLowerCase();

  const page = Math.max(parseInt(req.query.page as string) || 1, 1);
  const limit = Math.max(parseInt(req.query.limit as string) || 100, 1);
  const offset = (page - 1) * limit;

  const agencia = (agenciaParam === "Todas" || agenciaParam === "Todas las Agencias") ? "" : agenciaParam.trim();
  const asesor = (asesorParam === "Todos") ? "" : asesorParam.trim();
  const tipoCancelacion = (tipoParam === "Todas") ? "" : tipoParam.trim();
  const frecuencia = (frecuenciaParam === "Todas") ? "" : frecuenciaParam.trim();

  try {
    const request = pool.request();

    const querySQL = `
      SELECT 
          ISNULL(DA.Agencia, 'Agencia Desconocida') AS Agencia,
          CONVERT(VARCHAR(10), C.[Fecha_Cancelacion], 103) AS FechaCancelacion,
          ISNULL(D_AS.Asesor, C.IdSAsesor) AS Asesor,
          C.Cuenta,
          C.Socio,
          C.Pagare,
          C.Producto,
          C.[Tipo_Frecuencia] AS TipoFrecuencia,
          ISNULL(C.Prestamo, 0) AS Prestamo,
          ISNULL(C.[Saldo_Cancelacion], 0) AS SaldoCancelacion,
          CONVERT(VARCHAR(10), C.[Fecha_Otorgamiento], 103) AS FechaOtorgamiento,
          C.[Tipo_Cancelacion] AS TipoCancelacion,
          ISNULL(C.[Diferencia_Dias], 0) AS DiferenciaDias,
          ISNULL(C.[Telefono_celular_1], '') AS Celular1,
          ISNULL(C.[Telefono_celular_2], '') AS Celular2,
          ISNULL(C.[Telefono_fijo_1], '') AS TelefonoFijo1,
          ISNULL(C.[Telefono_fijo_2], '') AS TelefonoFijo2
      FROM [DWH_Gestion_Cartera].[dbo].[creditos_cancelados_no_renovados] C WITH (NOLOCK)
      LEFT JOIN [DWH_Gestion_Cartera].[dbo].[dim_asesor] D_AS WITH (NOLOCK)
          ON C.IdSAsesor = D_AS.IdSAsesor 
          AND D_AS.Periodo = CONVERT(VARCHAR(6), C.[Fecha_Cancelacion], 112)
      LEFT JOIN [DWH_Gestion_Cartera].[dbo].[dim_agencia] DA WITH (NOLOCK)
          ON D_AS.IdSAgencia = DA.IdSAgencia
      WHERE C.[Fecha_Cancelacion] >= DATEADD(month, -6, GETDATE()) 
        AND (@agencia = '' OR RTRIM(LTRIM(DA.Agencia)) = @agencia)
        AND (
          @asesor = '' 
          OR RTRIM(LTRIM(D_AS.AsesorNombresApellidos)) = @asesor 
          OR RTRIM(LTRIM(D_AS.Asesor)) = @asesor
          OR RTRIM(LTRIM(C.IdSAsesor)) = @asesor
        )
        AND (@tipoCancelacion = '' OR C.[Tipo_Cancelacion] = @tipoCancelacion)
        AND (@frecuencia = '' OR C.[Tipo_Frecuencia] = @frecuencia)
        AND (
          (@vista = 'comercial' AND DA.Agencia IS NOT NULL AND DA.Agencia NOT IN ('Agencia Desconocida', 'NULL'))
          OR
          (@vista = 'recuperacion' AND (DA.Agencia IS NULL OR DA.Agencia IN ('Agencia Desconocida', 'NULL')))
        )
      ORDER BY C.[Fecha_Cancelacion] DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
    `;

    const result = await request
      .input('agencia', sql.VarChar(50), agencia)
      .input('asesor', sql.VarChar(100), asesor)
      .input('tipoCancelacion', sql.VarChar(50), tipoCancelacion)
      .input('frecuencia', sql.VarChar(50), frecuencia)
      .input('vista', sql.VarChar(20), vista)
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, limit)
      .query(querySQL);

    res.json(result.recordset || []);
  } catch (error) {
    console.error("Error obteniendo Créditos Cancelados:", error);
    res.status(500).json({ error: "Error al consultar la base de datos" });
  }
});

export default router;